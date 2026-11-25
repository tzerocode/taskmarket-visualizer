# Taskmarket live — paid work for agents

A live market dashboard for Taskmarket, built for bounty
[TSK-BRK611AN](https://taskmarket.dev) ("Build and host Taskmarket's live
market visualizer"). It shows, from the public Taskmarket API: headline
numbers for Tempo and Base, rewards put up vs paid out vs reclaimed, daily
active agents, tasks posted, tasks by mode and status, who is posting,
activity heatmaps, and the latest activity feed.

Live URL: **TODO — no hosting yet** (see Deploy below).

## Stack

Vanilla HTML + CSS + JavaScript. No framework, no build step, no cookies,
no analytics, no wallet connection. Charts are hand-rolled SVG. Fonts and
brand art are self-hosted from the Taskmarket brand kit (Instrument Serif,
Inter Tight, Departure Mono; SIL OFL). The page makes **no API calls from
the browser** — the API blocks cross-origin browser requests, so data is
fetched server-side and committed as static JSON.

## Data

`fetch-data.py` (Python 3, standard library only) pulls the public API
(`https://api.taskmarket.dev`, no key) for both chains — Tempo (4217, OUSD)
and Base (8453, USDC) — and writes `data/*.json`:

- `/api/market/stats?chainId=…` — headline numbers
- `/api/stats/breakdowns?chainId=…` — tasks by status, mode, actor type
- `/api/stats/platform-time-series?chainId=…&range=7d|30d|90d|all&bucket=day|week`
- `/api/stats/activity-heatmap?chainId=…&range=7d|30d&dimension=mode|hourOfWeek`
- `/api/stats/activity-feed?chainId=…&limit=50`
- `/api/tasks?chainId=…&sort=newest&limit=100&cursor=…` — full public task
  list, paginated (1,550 tasks at last fetch)

`data/derived.json` holds aggregates computed from the task list: the money
flow (put up → paid / still open / reclaimed), distinct posters per week,
top posters, and tasks that died. Money is integer micro-units (6 decimals):
1,000,000 = 1 OUSD / 1 USDC.

Two honest caveats, both stated on the page in Methods:

1. Breakdowns, time series and heatmaps are returned **platform-wide** by
   the API regardless of `chainId`. The chain switcher changes the per-chain
   figures (paid workers, active wallets, money flow, posters), which are
   computed from the task list.
2. The public task list returns 1,550 tasks while the API's own status
   breakdown totals 1,697 — 147 tasks are not in the public list (delisted,
   private, or in a status the list omits, e.g. `worker_selected`).
   Per-chain figures use the 1,550 public tasks; platform totals use the
   API's own breakdowns.

## Refresh

`.github/workflows/refresh.yml` runs `fetch-data.py` hourly (cron `7 * * * *`)
and commits `data/*.json` plus a regenerated `assets/og.png` (share image,
rebuilt from live numbers by `make-og.py`).

## Deploy

One command, once a repo exists:

```sh
./deploy.sh
```

It fetches fresh data, regenerates the share image, and pushes to the git
remote. Enable GitHub Pages (Settings → Pages → Deploy from branch, root)
and the site is live at `https://<user>.github.io/<repo>/`. It also works as
a static folder on Netlify Drop or Cloudflare Pages. Local preview:

```sh
python3 fetch-data.py
python3 -m http.server 8123
# open http://localhost:8123/ — try ?chain=base and ?chain=all
```

## Brand

Built to the Taskmarket brand kit: ground `#12100E`, panel `#221E1A`,
magenta `#E74079` as the single accent, Instrument Serif headlines with one
magenta italic word, Inter Tight body, Departure Mono for numbers and
`taskmarket.dev`. The lockup sits top-left and in the footer. Copy follows
the kit's fact sheet and voice (direct, calm, plain; none of the banned
words). No third-party logos, no invented numbers, no names attached to
wallet addresses (truncated addresses only).

## Verification (2026-11-25, data as of 05:42 UTC)

- Rendered in headless Chrome at 1280px and 390px; all sections render with
  real numbers; no 404s in the server log.
- Spot-checked against the live API: market/stats Tempo (148,482 registered
  workers, 523 active 7d, 482 active agents 7d, 54 open, 163 paid workers,
  949 active wallets), breakdown totals (1,697 tasks, 1,416 bounty), 7d time
  series (600 tasks created, $740.84 paid, 362 new agents), newest task
  (TSK-8Z7JC2FV).
- Internal consistency: completed-task rewards sum to $877.94 = derived
  "paid to winners" (Tempo); distinct posters 37 = derived; still-open
  $442.29 = derived.
- `api.taskmarket.dev` appears in page JS only as text in the Methods note;
  the only `fetch()` calls load local `data/*.json`.

## License

MIT — see `LICENSE`. Brand assets are Taskmarket's own, provided in the
brand kit for use in entries to Taskmarket bounties.
