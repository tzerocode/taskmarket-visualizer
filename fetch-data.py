#!/usr/bin/env python3
"""Fetch Taskmarket public API data and write static JSON for the dashboard.

The Taskmarket API blocks browser requests from other origins (CORS), so the
deployed page never calls the API. This script runs server-side (GitHub
Actions, hourly) and writes data/*.json, which the page reads as local files.

Public API, no key required: https://api.taskmarket.dev
Chains: Tempo (chainId 4217, rewards in OUSD) and Base (chainId 8453, USDC).
Money values from the API are integer micro-units (6 decimals): 1_000_000 = $1.

Usage: python3 fetch-data.py [--out DIR] [--max-task-pages N]
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone

BASE = "https://api.taskmarket.dev"
CHAINS = {"tempo": 4217, "base": 8453}
RANGES = [("7d", "day"), ("30d", "day"), ("90d", "day"), ("all", "week")]


def get(path, tries=3):
    url = BASE + path
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "taskmarket-visualizer/1.0 (+https://taskmarket.dev)"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - retry transient failures
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET {url} failed after {tries} tries: {last}")


def fetch_chain(out, chain_name, chain_id, max_task_pages):
    data = {}
    data["market_stats"] = get(f"/api/market/stats?chainId={chain_id}")
    data["breakdowns"] = get(f"/api/stats/breakdowns?chainId={chain_id}")
    data["time_series"] = {}
    for rng, bucket in RANGES:
        data["time_series"][rng] = get(
            f"/api/stats/platform-time-series?chainId={chain_id}&range={rng}&bucket={bucket}"
        )
    data["heatmap"] = {}
    for dim in ("mode", "hourOfWeek"):
        data["heatmap"][dim] = {}
        for rng in ("7d", "30d"):
            data["heatmap"][dim][rng] = get(
                f"/api/stats/activity-heatmap?chainId={chain_id}&range={rng}&dimension={dim}"
            )
    data["activity_feed"] = get(f"/api/stats/activity-feed?chainId={chain_id}&limit=50")

    # Paginate the full public task list for this chain.
    tasks = []
    cursor = None
    pages = 0
    while True:
        q = f"/api/tasks?chainId={chain_id}&sort=newest&limit=100"
        if cursor:
            q += f"&cursor={cursor}"
        page = get(q)
        tasks.extend(page.get("tasks", []))
        pages += 1
        cursor = page.get("nextCursor")
        if not page.get("hasMore") or not cursor or pages >= max_task_pages:
            break
    slim = [
        {
            "id": t.get("id"),
            "ref": t.get("referenceCode"),
            "requester": t.get("requester"),
            "reward": t.get("reward"),
            "status": t.get("status"),
            "mode": t.get("mode"),
            "createdAt": t.get("createdAt"),
            "expiryTime": t.get("expiryTime"),
            "awardCount": t.get("awardCount", 0),
            "submissionCount": t.get("submissionCount", 0),
            "tags": t.get("tags", []),
        }
        for t in tasks
    ]
    data["tasks"] = slim
    data["tasks_fetched"] = len(slim)
    data["tasks_pages"] = pages
    with open(os.path.join(out, f"{chain_name}.json"), "w") as f:
        json.dump(data, f)
    return data


def week_key(iso):
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    y, w, _ = dt.isocalendar()
    return f"{y}-W{w:02d}"


def derive(chain_data):
    """Per-chain aggregates computed only from the fetched task list."""
    tasks = chain_data["tasks"]
    by_status = Counter(t["status"] for t in tasks)
    by_mode = Counter(t["mode"] for t in tasks)
    reward_by_status = defaultdict(int)
    for t in tasks:
        try:
            reward_by_status[t["status"]] += int(t["reward"] or 0)
        except (TypeError, ValueError):
            pass
    # Money flow: posters -> escrow -> winners / reclaimed / still open.
    paid = reward_by_status.get("completed", 0)
    open_now = sum(reward_by_status.get(s, 0) for s in ("open", "claimed", "pending_approval", "worker_selected"))
    reclaimed = sum(reward_by_status.get(s, 0) for s in ("cancelled", "expired"))
    total = sum(reward_by_status.values())
    # Posters per week (distinct requesters by ISO week of task creation).
    posters_week = defaultdict(set)
    tasks_week = Counter()
    for t in tasks:
        if t.get("createdAt") and t.get("requester"):
            wk = week_key(t["createdAt"])
            posters_week[wk].add(t["requester"])
            tasks_week[wk] += 1
    posters_series = [
        {"week": wk, "posters": len(posters_week[wk]), "tasks": tasks_week[wk]}
        for wk in sorted(posters_week)
    ]
    # Concentration: top posters by task count and by reward volume.
    by_poster_tasks = Counter(t["requester"] for t in tasks if t.get("requester"))
    by_poster_reward = defaultdict(int)
    for t in tasks:
        if t.get("requester"):
            try:
                by_poster_reward[t["requester"]] += int(t["reward"] or 0)
            except (TypeError, ValueError):
                pass
    top_tasks = [{"requester": r, "tasks": c} for r, c in by_poster_tasks.most_common(10)]
    top_reward = [
        {"requester": r, "reward": v} for r, v in sorted(by_poster_reward.items(), key=lambda kv: -kv[1])[:10]
    ]
    poster_task_counts = dict(by_poster_tasks)
    top10_reward_share = (sum(v for _, v in sorted(by_poster_reward.items(), key=lambda kv: -kv[1])[:10]) / total) if total else 0
    top10_task_share = (sum(c for _, c in by_poster_tasks.most_common(10)) / len(tasks)) if tasks else 0
    # Tasks that died: expired or cancelled, and completed tasks with no award.
    died = [t for t in tasks if t["status"] in ("expired", "cancelled")]
    completed_no_award = [t for t in tasks if t["status"] == "completed" and not t.get("awardCount")]
    return {
        "task_count": len(tasks),
        "by_status": dict(by_status),
        "by_mode": dict(by_mode),
        "reward_by_status": dict(reward_by_status),
        "money_flow": {
            "total_put_up": total,
            "paid_to_winners": paid,
            "reclaimed": reclaimed,
            "still_open": open_now,
        },
        "posters_per_week": posters_series,
        "distinct_posters": len(by_poster_tasks),
        "top_posters_by_tasks": top_tasks,
        "top_posters_by_reward": top_reward,
        "poster_task_counts": poster_task_counts,
        "top10_reward_share": round(top10_reward_share, 4),
        "top10_task_share": round(top10_task_share, 4),
        "died": {
            "count": len(died),
            "reward": sum(int(t["reward"] or 0) for t in died),
            "expired": by_status.get("expired", 0),
            "cancelled": by_status.get("cancelled", 0),
        },
        "completed_no_award": len(completed_no_award),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
    ap.add_argument("--max-task-pages", type=int, default=50)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    derived = {}
    for name, cid in CHAINS.items():
        chain_data = fetch_chain(args.out, name, cid, args.max_task_pages)
        derived[name] = derive(chain_data)
        print(f"{name}: {chain_data['tasks_fetched']} tasks, {chain_data['tasks_pages']} pages")
    with open(os.path.join(args.out, "derived.json"), "w") as f:
        json.dump(derived, f)
    meta = {
        "fetchedAt": fetched_at,
        "source": "https://api.taskmarket.dev",
        "chains": CHAINS,
        "endpoints": [
            "/api/market/stats?chainId=…",
            "/api/stats/breakdowns?chainId=…",
            "/api/stats/platform-time-series?chainId=…&range=…&bucket=…",
            "/api/stats/activity-heatmap?chainId=…&range=…&dimension=…",
            "/api/stats/activity-feed?chainId=…&limit=…",
            "/api/tasks?chainId=…&sort=newest&limit=100&cursor=…",
        ],
        "moneyUnit": "integer micro-units, 6 decimals (1,000,000 = 1 OUSD on Tempo / 1 USDC on Base)",
        "note": "breakdowns, time series and heatmaps are returned platform-wide by the API "
        "regardless of chainId; per-chain figures in derived.json are computed from the "
        "paginated task list. market/stats paidWorkers and activeWallets differ per chain.",
    }
    with open(os.path.join(args.out, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"done, fetchedAt={fetched_at}")


if __name__ == "__main__":
    sys.exit(main())
