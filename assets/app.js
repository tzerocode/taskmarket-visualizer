/* Taskmarket live market visualizer.
   Reads only local JSON written by fetch-data.py. No network calls,
   no wallet connection, no analytics. All numbers come from the public
   Taskmarket API (see Methods). Money is integer micro-units, 6 decimals. */
(function () {
  "use strict";
  var state = { chain: "tempo", range: "7d", heatDim: "mode", heatRange: "7d" };
  var DATA = {};
  var $ = function (id) { return document.getElementById(id); };

  function loadJSON(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error("failed to load " + path);
      return r.json();
    });
  }

  function money(micro, dp) {
    var v = (micro || 0) / 1e6;
    return "$" + v.toLocaleString("en-US", {
      minimumFractionDigits: dp === undefined ? 0 : dp,
      maximumFractionDigits: dp === undefined ? 0 : dp,
    });
  }
  function money2(micro) { return money(micro, 2); }
  function num(n) { return (n || 0).toLocaleString("en-US"); }
  function pct(x) { return (x * 100).toFixed(1) + "%"; }
  function trunc(addr) {
    if (!addr) return "—";
    return addr.length > 12 ? addr.slice(0, 6) + "…" + addr.slice(-4) : addr;
  }
  function relTime(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return Math.floor(s) + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function currencyLabel() {
    return state.chain === "tempo" ? "OUSD" : state.chain === "base" ? "USDC" : "OUSD + USDC";
  }

  /* ---------- SVG helpers ---------- */
  var NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function svgRoot(w, h) {
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 " + w + " " + h);
    s.setAttribute("role", "img");
    return s;
  }

  function lineChart(svg, series, opts) {
    // series: [{label, color, values:[{x, y}...]}]; opts: {w,h,pad, yLabel}
    var W = opts.w || 960, H = opts.h || 260, pad = { l: 64, r: 12, t: 14, b: 26 };
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var allY = [];
    series.forEach(function (s) { s.values.forEach(function (p) { allY.push(p.y); }); });
    var maxY = Math.max.apply(null, allY.concat([1]));
    maxY = maxY * 1.1;
    var n = series[0].values.length;
    function X(i) { return pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, n - 1); }
    function Y(v) { return H - pad.b - (v / maxY) * (H - pad.t - pad.b); }
    var i, g;
    for (i = 0; i <= 4; i++) {
      var gy = pad.t + (i * (H - pad.t - pad.b)) / 4;
      el("line", { x1: pad.l, y1: gy, x2: W - pad.r, y2: gy, class: "gridline" }, svg);
      var t = el("text", { x: pad.l - 8, y: gy + 3, class: "axis", "text-anchor": "end" }, svg);
      t.textContent = fmtAxis(maxY * (1 - i / 4));
    }
    series.forEach(function (s) {
      var d = s.values.map(function (p, idx) {
        return (idx === 0 ? "M" : "L") + X(idx).toFixed(1) + "," + Y(p.y).toFixed(1);
      }).join(" ");
      el("path", { d: d, fill: "none", stroke: s.color, "stroke-width": 2.2, "stroke-linejoin": "round" }, svg);
      s.values.forEach(function (p, idx) {
        el("circle", { cx: X(idx), cy: Y(p.y), r: 2.6, fill: s.color }, svg);
      });
    });
    var step = Math.max(1, Math.floor(n / 8));
    for (i = 0; i < n; i += step) {
      var tx = el("text", { x: X(i), y: H - 8, class: "axis", "text-anchor": "middle" }, svg);
      tx.textContent = series[0].values[i].x;
    }
    return svg;
  }
  function fmtAxis(v) {
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k";
    return String(Math.round(v));
  }

  function barChart(svg, data, opts) {
    // data: [{label, value}]
    var W = opts.w || 960, H = opts.h || 240, pad = { l: 64, r: 12, t: 14, b: 26 };
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var maxV = Math.max.apply(null, data.map(function (d) { return d.value; }).concat([1])) * 1.1;
    var bw = (W - pad.l - pad.r) / data.length;
    data.forEach(function (d, i) {
      var bh = (d.value / maxV) * (H - pad.t - pad.b);
      el("rect", {
        x: (pad.l + i * bw + bw * 0.18).toFixed(1),
        y: (H - pad.b - bh).toFixed(1),
        width: (bw * 0.64).toFixed(1),
        height: Math.max(1, bh).toFixed(1),
        rx: 3, fill: opts.color || "#E74079",
      }, svg);
    });
    var step = Math.max(1, Math.floor(data.length / 8));
    data.forEach(function (d, i) {
      if (i % step !== 0) return;
      var t = el("text", { x: pad.l + i * bw + bw / 2, y: H - 8, class: "axis", "text-anchor": "middle" }, svg);
      t.textContent = d.label;
    });
    [0, 0.5, 1].forEach(function (f) {
      var gy = H - pad.b - f * (H - pad.t - pad.b);
      el("line", { x1: pad.l, y1: gy, x2: W - pad.r, y2: gy, class: "gridline" }, svg);
      var t = el("text", { x: pad.l - 8, y: gy + 3, class: "axis", "text-anchor": "end" }, svg);
      t.textContent = fmtAxis(maxV * f);
    });
    return svg;
  }

  /* ---------- data access ---------- */
  function chainData() {
    if (state.chain === "all") return null;
    return DATA[state.chain];
  }
  function derived() {
    if (state.chain === "all") {
      var t = DATA.derived.tempo, b = DATA.derived.base;
      return {
        task_count: t.task_count + b.task_count,
        distinct_posters: null,
        money_flow: {
          total_put_up: t.money_flow.total_put_up + b.money_flow.total_put_up,
          paid_to_winners: t.money_flow.paid_to_winners + b.money_flow.paid_to_winners,
          reclaimed: t.money_flow.reclaimed + b.money_flow.reclaimed,
          still_open: t.money_flow.still_open + b.money_flow.still_open,
        },
        by_status: mergeCounts(t.by_status, b.by_status),
        by_mode: mergeCounts(t.by_mode, b.by_mode),
        posters_per_week: mergeWeeks(t.posters_per_week, b.posters_per_week),
        died: { count: t.died.count + b.died.count, reward: t.died.reward + b.died.reward,
                expired: t.died.expired + b.died.expired, cancelled: t.died.cancelled + b.died.cancelled },
        completed_no_award: t.completed_no_award + b.completed_no_award,
        top10_reward_share: null,
      };
    }
    return DATA.derived[state.chain];
  }
  function mergeCounts(a, b) {
    var out = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) { out[k] = (a[k] || 0) + (b[k] || 0); });
    return out;
  }
  function mergeWeeks(a, b) {
    var map = {};
    a.concat(b).forEach(function (w) {
      map[w.week] = map[w.week] || { week: w.week, posters: 0, tasks: 0 };
      map[w.week].tasks += w.tasks;
      map[w.week].posters += w.posters; // upper bound; chains may share posters
    });
    return Object.keys(map).sort().map(function (k) { return map[k]; });
  }

  /* ---------- renderers ---------- */
  function renderMeta() {
    var m = DATA.meta;
    var dt = new Date(m.fetchedAt);
    $("asof").textContent = "Data as of " + dt.toISOString().replace("T", " ").slice(0, 19) + " UTC · " +
      relTime(m.fetchedAt) + " · refreshed hourly";
  }

  function renderHeadline() {
    var d = derived();
    var stats = state.chain === "all" ? DATA.tempo.market_stats : chainData().market_stats;
    var ts7 = chainData() ? chainData().time_series["7d"] : DATA.tempo.time_series["7d"];
    var paid7 = ts7.reduce(function (a, x) { return a + parseInt(x.paidVolume || "0", 10); }, 0);
    var put7 = ts7.reduce(function (a, x) { return a + parseInt(x.rewardVolume || "0", 10); }, 0);
    var created7 = ts7.reduce(function (a, x) { return a + (x.tasksCreated || 0); }, 0);
    var maxAgents = Math.max.apply(null, ts7.map(function (x) { return x.activeAgents || 0; }));
    var paidWorkers, wallets;
    if (state.chain === "all") {
      paidWorkers = num(DATA.tempo.market_stats.paidWorkers) + " T · " + num(DATA.base.market_stats.paidWorkers) + " B";
      wallets = num(DATA.tempo.market_stats.activeWallets) + " T · " + num(DATA.base.market_stats.activeWallets) + " B";
    } else {
      paidWorkers = num(stats.paidWorkers);
      wallets = num(stats.activeWallets);
    }
    var cards = [
      { label: "Open tasks", value: num(stats.openTasks), note: "as reported by /api/market/stats" },
      { label: "Active agents · 7d", value: num(stats.activeAgents7d), note: "peak day in range: " + num(maxAgents) },
      { label: "Rewards paid · 7d", value: money(paid7), note: "from the platform time series" },
      { label: "Rewards put up · 7d", value: money(put7), note: num(created7) + " tasks created in 7d" },
      { label: "Workers paid", value: paidWorkers, note: state.chain === "all" ? "Tempo · Base split" : "on " + (state.chain === "tempo" ? "Tempo" : "Base") },
      { label: "Active wallets", value: wallets, note: state.chain === "all" ? "Tempo · Base split" : "on " + (state.chain === "tempo" ? "Tempo" : "Base") },
    ];
    $("cards").innerHTML = cards.map(function (c) {
      return '<div class="card"><div class="label">' + c.label + '</div>' +
        '<div class="num">' + c.value + '</div><div class="note">' + c.note + '</div></div>';
    }).join("");
    $("headline-note").innerHTML = "Headline figures are the API's own counts for " +
      (state.chain === "all" ? "the platform" : state.chain === "tempo" ? "Tempo (OUSD)" : "Base (USDC)") +
      ". Registered workers: <b>" + num(stats.registeredWorkers) + "</b> · active workers 7d: <b>" +
      num(stats.activeWorkers7d) + "</b>.";
  }

  function renderFlow() {
    var d = derived();
    var f = d.money_flow;
    var total = f.total_put_up || 1;
    var parts = [
      { label: "Paid to winners", value: f.paid_to_winners, color: "#E74079" },
      { label: "Still open in escrow", value: f.still_open, color: "#D9A097" },
      { label: "Reclaimed (expired / cancelled)", value: f.reclaimed, color: "#6b5f55" },
    ];
    var W = 960, H = 250;
    var svg = svgRoot(W, H);
    var x0 = 30, colW = 190, gap = 150;
    function colX(i) { return x0 + i * (colW + gap); }
    // Left node: put up. Right nodes: three outcomes.
    var barH = 64;
    var yTop = 40;
    var leftY = yTop + (H - 2 * yTop - barH) / 2;
    var r = el("rect", { x: colX(0), y: leftY, width: colW, height: barH, rx: 8, fill: "#221E1A", stroke: "#453E37" }, svg);
    var t1 = el("text", { x: colX(0) + colW / 2, y: leftY + 26, fill: "#FFF6E8", "font-size": 15, "text-anchor": "middle", "font-family": "Departure Mono, monospace" }, svg);
    t1.textContent = money(f.total_put_up, 2);
    var t2 = el("text", { x: colX(0) + colW / 2, y: leftY + 48, fill: "#B0A79D", "font-size": 12, "text-anchor": "middle" }, svg);
    t2.textContent = "put up by posters";
    var y = yTop;
    var rowH = (H - 2 * yTop) / 3;
    parts.forEach(function (p, i) {
      var cy = y + i * rowH + rowH / 2;
      // flow band
      var wLeft = 1, wRight = Math.max(2, (p.value / total) * barH);
      var path = "M" + (colX(0) + colW) + "," + (leftY + barH / 2 - wLeft / 2) +
        " C" + (colX(0) + colW + gap / 2) + "," + (leftY + barH / 2 - wLeft / 2) +
        " " + (colX(1) - gap / 2) + "," + (cy - wRight / 2) +
        " " + colX(1) + "," + (cy - wRight / 2) +
        " L" + colX(1) + "," + (cy + wRight / 2) +
        " C" + (colX(1) - gap / 2) + "," + (cy + wRight / 2) +
        " " + (colX(0) + colW + gap / 2) + "," + (leftY + barH / 2 + wLeft / 2) +
        " " + (colX(0) + colW) + "," + (leftY + barH / 2 + wLeft / 2) + " Z";
      el("path", { d: path, fill: p.color, opacity: 0.28 }, svg);
      el("rect", { x: colX(1), y: cy - 26, width: colW, height: 52, rx: 8, fill: "#221E1A", stroke: "#453E37" }, svg);
      var a = el("text", { x: colX(1) + colW / 2, y: cy - 4, fill: "#FFF6E8", "font-size": 14, "text-anchor": "middle", "font-family": "Departure Mono, monospace" }, svg);
      a.textContent = money(p.value, 2) + " · " + pct(p.value / total);
      var b = el("text", { x: colX(1) + colW / 2, y: cy + 16, fill: "#B0A79D", "font-size": 12, "text-anchor": "middle" }, svg);
      b.textContent = p.label;
    });
    var h1 = el("text", { x: colX(0) + colW / 2, y: 20, fill: "#B0A79D", "font-size": 12, "text-anchor": "middle" }, svg);
    h1.textContent = "REWARDS POSTED";
    var h2 = el("text", { x: colX(1) + colW / 2, y: 20, fill: "#B0A79D", "font-size": 12, "text-anchor": "middle" }, svg);
    h2.textContent = "WHERE THEY ENDED UP";
    var host = $("flow-svg");
    host.innerHTML = "";
    host.appendChild(svg);
    $("flow-legend").innerHTML = parts.map(function (p) {
      return '<span><i style="background:' + p.color + '"></i>' + p.label + ": <b style='color:#EFE9E2'>" +
        money(p.value, 2) + " " + currencyLabel() + "</b></span>";
    }).join("");
    $("flow-note").innerHTML = "Computed from the " + num(d.task_count) +
      " public tasks in the fetched list (" + currencyLabel() + "). Paid = rewards of completed tasks; " +
      "reclaimed = rewards of expired and cancelled tasks; still open = open, claimed, pending approval.";
  }

  function renderSeries() {
    var cd = chainData() || DATA.tempo; // time series is platform-wide
    var ts = cd.time_series[state.range];
    var labels = ts.map(function (x) { return state.range === "all" ? x.bucket.slice(0, 10) : x.bucket.slice(5); });
    var agents = ts.map(function (x) { return x.activeAgents || 0; });
    var created = ts.map(function (x) { return x.tasksCreated || 0; });
    var put = ts.map(function (x) { return (parseInt(x.rewardVolume || "0", 10)) / 1e6; });
    var paid = ts.map(function (x) { return (parseInt(x.paidVolume || "0", 10)) / 1e6; });
    var svg1 = lineChart($("chart-activity"), [
      { label: "active agents", color: "#E74079", values: agents.map(function (v, i) { return { x: labels[i], y: v }; }) },
      { label: "tasks created", color: "#D9A097", values: created.map(function (v, i) { return { x: labels[i], y: v }; }) },
    ], { w: 960, h: 260 });
    var svg2 = lineChart($("chart-money"), [
      { label: "put up", color: "#E74079", values: put.map(function (v, i) { return { x: labels[i], y: v }; }) },
      { label: "paid", color: "#D9A097", values: paid.map(function (v, i) { return { x: labels[i], y: v }; }) },
    ], { w: 960, h: 260 });
    var best = ts.reduce(function (a, x) {
      return (parseInt(x.rewardVolume || "0", 10) > parseInt(a.rewardVolume || "0", 10)) ? x : a;
    }, ts[0] || {});
    $("activity-total").textContent = num(created.reduce(function (a, b) { return a + b; }, 0)) +
      " tasks · " + num(ts.reduce(function (a, x) { return a + (x.newAgents || 0); }, 0)) + " new agents";
    $("money-total").textContent = money(put.reduce(function (a, b) { return a + b; }, 0) * 1e6, 2) +
      " put up · " + money(paid.reduce(function (a, b) { return a + b; }, 0) * 1e6, 2) + " paid · biggest day " +
      (best.bucket || "—") + " (" + money2(parseInt(best.rewardVolume || "0", 10)) + ")";
    $("series-note").textContent = "The API reports this series platform-wide; it does not split by chain. " +
      "Range: " + state.range + ", bucket: " + (state.range === "all" ? "week" : "day") + ".";
  }

  function hbars(hostId, items, maxV, colorCls) {
    var host = $(hostId);
    host.innerHTML = items.map(function (it) {
      var w = maxV ? Math.max(1.5, (it.value / maxV) * 100) : 0;
      return '<div class="bar-row"><div class="bl">' + esc(it.label) + '</div>' +
        '<div class="bar-track"><div class="bar-fill ' + (colorCls || "") + '" style="width:' + w.toFixed(1) + '%"></div></div>' +
        '<div class="bv">' + num(it.value) + '</div></div>';
    }).join("");
  }

  function renderBreakdowns() {
    var bd = (chainData() || DATA.tempo).breakdowns; // platform-wide
    var modes = bd.mode.slice().sort(function (a, b) { return b.count - a.count; });
    var maxMode = modes[0] ? modes[0].count : 1;
    hbars("bars-mode", modes.map(function (m) { return { label: m.mode, value: m.count }; }), maxMode);
    var order = ["completed", "open", "claimed", "pending_approval", "worker_selected", "expired", "cancelled"];
    var statuses = bd.status.slice().sort(function (a, b) { return order.indexOf(a.status) - order.indexOf(b.status); });
    var maxStatus = Math.max.apply(null, statuses.map(function (s) { return s.count; }).concat([1]));
    hbars("bars-status", statuses.map(function (s) {
      return { label: s.status.replace(/_/g, " "), value: s.count };
    }), maxStatus, "soft");
    var total = bd.actorType.reduce(function (a, x) { return a + x.count; }, 0);
    var agents = (bd.actorType.filter(function (x) { return x.actorType === "agent"; })[0] || {}).count || 0;
    var humans = (bd.actorType.filter(function (x) { return x.actorType === "human"; })[0] || {}).count || 0;
    $("actor-line").innerHTML = "<b>" + num(agents) + "</b> registered workers are agents, <b>" + num(humans) +
      "</b> are people — " + (agents / Math.max(1, total) * 100).toFixed(2) + "% agent. Bounty is the dominant mode at <b>" +
      pct((modes.filter(function (m) { return m.mode === "bounty"; })[0] || { count: 0 }).count /
        Math.max(1, modes.reduce(function (a, m) { return a + m.count; }, 0))) + "</b> of all tasks.";
  }

  function renderPosters() {
    var d = derived();
    var weeks = d.posters_per_week;
    var svg = barChart($("chart-posters"), weeks.map(function (w) {
      return { label: w.week.slice(5), value: w.posters };
    }), { w: 960, h: 220, color: "#D9A097" });
    var last = weeks[weeks.length - 1];
    $("posters-total").textContent = (d.distinct_posters === null ? "—" : num(d.distinct_posters)) +
      " distinct posters in the fetched list" + (last ? " · latest week " + last.week + ": " + last.posters + " posters, " + last.tasks + " tasks" : "");
    // Top posters table — per chain only (merged "all" would double count).
    var host = $("top-posters");
    if (state.chain === "all") {
      host.innerHTML = "<p class='sub'>Pick Tempo or Base to see that chain's top posters.</p>";
    } else {
      var rows = DATA.derived[state.chain].top_posters_by_reward.slice(0, 8);
      host.innerHTML = '<table class="plain"><thead><tr><th>#</th><th>Poster</th>' +
        '<th class="num">Reward put up</th><th class="num">Tasks</th></tr></thead><tbody>' +
        rows.map(function (r, i) {
          var tc = DATA.derived[state.chain].poster_task_counts[r.requester] || 0;
          return "<tr><td>" + (i + 1) + "</td><td class='mono'>" + esc(trunc(r.requester)) + "</td>" +
            "<td class='num'>" + money(r.reward, 2) + "</td><td class='num'>" + num(tc) + "</td></tr>";
        }).join("") + "</tbody></table>";
    }
    var share = state.chain === "all" ? null : DATA.derived[state.chain].top10_reward_share;
    $("concentration").innerHTML = share === null
      ? "Concentration is computed per chain — pick Tempo or Base above."
      : "The top 10 posters put up <b>" + pct(share) + "</b> of all reward volume on " +
        (state.chain === "tempo" ? "Tempo" : "Base") + " and posted <b>" +
        pct(DATA.derived[state.chain].top10_task_share) + "</b> of its tasks.";
  }

  function renderHeatmap() {
    var cd = chainData() || DATA.tempo;
    var hm = cd.heatmap[state.heatDim][state.heatRange];
    var max = 0;
    hm.cells.forEach(function (c) { if (c.count > max) max = c.count; });
    var cellMap = {};
    hm.cells.forEach(function (c) { cellMap[c.row + "|" + c.col] = c; });
    var dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var rows = hm.rowKeys, cols = hm.colKeys;
    var html = "<table><thead><tr><th></th>";
    cols.forEach(function (c) {
      html += "<th>" + (state.heatDim === "mode" ? esc(c.slice(5)) : esc(c) + "h") + "</th>";
    });
    html += "</tr></thead><tbody>";
    rows.forEach(function (r) {
      html += "<tr><td class='rowlab'>" + (state.heatDim === "hourOfWeek" ? dayNames[parseInt(r, 10)] || r : esc(r)) + "</td>";
      cols.forEach(function (c) {
        var cell = cellMap[r + "|" + c];
        var v = cell ? cell.count : 0;
        var a = max ? v / max : 0;
        var bg = a > 0 ? "background:rgba(231,64,121," + (0.12 + 0.78 * a).toFixed(2) + ")" : "";
        html += "<td class='cell" + (a > 0.45 ? " hot" : "") + "' style='" + bg + "' title='" +
          esc(r) + " × " + esc(c) + ": " + num(v) + " tasks" +
          (cell && cell.volume ? " · " + money2(parseInt(cell.volume, 10)) : "") + "'>" + (v || "") + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    $("heatmap").innerHTML = html;
    $("heatmap-note").textContent = state.heatDim === "mode"
      ? "Tasks per day by mode. Cell colour scales with task count; hover a cell for its volume."
      : "Tasks by weekday and hour (UTC). Weekday is the API's 0–6 row key, shown as Sun–Sat (0 = Sunday).";
  }

  function renderFeed() {
    var items = [];
    var seen = {};
    ["tempo", "base"].forEach(function (ch) {
      DATA[ch].activity_feed.items.forEach(function (it) {
        // The feed endpoint returns the same cross-chain events for either
        // chainId, so dedupe on type + task + timestamp.
        var key = it.type + "|" + (it.taskId || "") + "|" + it.timestamp;
        if (seen[key]) return;
        seen[key] = true;
        items.push({ chain: ch, it: it });
      });
    });
    items.sort(function (a, b) { return new Date(b.it.timestamp) - new Date(a.it.timestamp); });
    var labels = {
      task_submitted: "submission", task_created: "task posted", task_completed: "completed",
      settlement: "paid out", task_claimed: "claimed", task_cancelled: "cancelled", rating: "rated",
    };
    $("feed").innerHTML = items.slice(0, 20).map(function (row) {
      var it = row.it;
      var badge = row.it.chainId === 8453 || row.chain === "base"
        ? '<span class="badge base">Base</span>' : '<span class="badge">Tempo</span>';
      var type = labels[it.type] || it.type;
      var meta = type + " · " + (it.actorType || "agent") + " " + trunc(it.actor) +
        (it.amount ? " · " + money2(parseInt(it.amount, 10)) : "") +
        (it.rating ? " · ★" + it.rating : "");
      return "<li><span class='when'>" + relTime(it.timestamp) + "</span>" +
        "<span class='what'><span class='t'>" + esc((it.taskTitle || it.taskId || "").slice(0, 110)) + "</span><br>" +
        "<span class='m'>" + esc(meta) + "</span></span>" + badge + "</li>";
    }).join("");
  }

  function renderInsights() {
    var t = DATA.derived.tempo, b = DATA.derived.base;
    var d = derived();
    var items = [];
    items.push({
      k: "CONCENTRATION",
      html: "On Tempo, the top 10 posters put up <b>" + pct(t.top10_reward_share) +
        "</b> of reward volume and <b>" + pct(t.top10_task_share) + "</b> of tasks, from only <b>" +
        num(t.distinct_posters) + "</b> distinct posters. On Base the same top 10 hold <b>" + pct(b.top10_reward_share) +
        "</b> — still concentrated, but spread across <b>" + num(b.distinct_posters) + "</b> posters.",
    });
    items.push({
      k: "TASKS THAT DIED",
      html: "<b>" + num(b.died.count) + "</b> of " + num(b.task_count) + " Base tasks expired or were cancelled, returning <b>" +
        money(b.died.reward, 2) + "</b> to posters. Tempo lost only <b>" + num(t.died.count) + "</b> tasks (" +
        money(t.died.reward, 2) + "). A task that ends with no submissions is money that never left escrow.",
    });
    items.push({
      k: "EVERY FINISH PAID",
      html: "Across the public list, <b>" + num(d.completed_no_award) +
        "</b> completed tasks ended without an award. When a task completes here, somebody gets paid.",
    });
    var ts7 = DATA.tempo.time_series["7d"];
    var best = ts7.reduce(function (a, x) {
      return (parseInt(x.rewardVolume || "0", 10) > parseInt(a.rewardVolume || "0", 10)) ? x : a;
    }, ts7[0]);
    var first = ts7[0], lastFull = ts7[ts7.length - 2] || ts7[ts7.length - 1];
    items.push({
      k: "WHAT IS GROWING",
      html: "The busiest day in the last week was <b>" + best.bucket + "</b> with <b>" +
        money2(parseInt(best.rewardVolume || "0", 10)) + "</b> put up. Daily active agents moved from <b>" +
        num(first.activeAgents) + "</b> on " + first.bucket + " to <b>" + num(lastFull.activeAgents) + "</b> on " +
        lastFull.bucket + " (the latest full day; today is still partial), with <b>" + num(ts7.reduce(function (a, x) { return a + (x.newAgents || 0); }, 0)) +
        "</b> new agents in the week.",
    });
    $("insights").innerHTML = items.map(function (it) {
      return '<div class="insight"><div class="k">' + it.k + '</div><p>' + it.html + "</p></div>";
    }).join("");
  }

  function renderMethods() {
    var m = DATA.meta;
    $("methods").innerHTML =
      "<li>Source: the public Taskmarket API at <code>https://api.taskmarket.dev</code> — no key, no login. " +
      "Fetched by <code>fetch-data.py</code> and committed as static JSON; this page makes no API calls from the browser.</li>" +
      "<li>Endpoints used: " + m.endpoints.map(function (e) { return "<code>" + esc(e) + "</code>"; }).join(" ") + "</li>" +
      "<li>Money is integer micro-units (6 decimals): 1,000,000 = 1 OUSD on Tempo, 1 USDC on Base.</li>" +
      "<li>Breakdowns, time series and heatmaps are returned platform-wide by the API regardless of <code>chainId</code>; " +
      "the chain switcher changes the per-chain figures (headline paid workers / active wallets, money flow, posters, top posters), " +
      "which are computed from the paginated public task list.</li>" +
      "<li>Reconciliation: the public task list returns 1,550 tasks; the API's own status breakdown totals 1,697. " +
      "The 147-task gap is tasks the list does not return (delisted, private, or in a status the list omits, e.g. worker_selected). " +
      "Per-chain figures use the 1,550 public tasks; platform totals use the API's own breakdowns.</li>" +
      "<li>Refresh: GitHub Actions runs <code>fetch-data.py</code> hourly and commits <code>data/*.json</code>. " +
      "No cookies, no analytics, no wallet connection. Addresses are shown truncated; no names are attached to them.</li>";
  }

  function renderAll() {
    renderMeta();
    renderHeadline();
    renderFlow();
    renderSeries();
    renderBreakdowns();
    renderPosters();
    renderHeatmap();
    renderFeed();
    renderInsights();
    renderMethods();
  }

  function bindSeg(id, key, fn) {
    $(id).addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      setSeg(id, key, b.getAttribute("data-v"));
      fn();
    });
  }
  function setSeg(id, key, value) {
    state[key] = value;
    Array.prototype.forEach.call($(id).querySelectorAll("button"), function (x) {
      x.classList.toggle("on", x.getAttribute("data-v") === value);
    });
  }
  function applyUrlParams() {
    // Deep links: ?chain=tempo|base|all&range=7d|30d|90d|all
    var q = new URLSearchParams(window.location.search);
    var chain = q.get("chain"), range = q.get("range");
    if (chain && ["tempo", "base", "all"].indexOf(chain) !== -1) setSeg("chain-seg", "chain", chain);
    if (range && ["7d", "30d", "90d", "all"].indexOf(range) !== -1) setSeg("range-seg", "range", range);
  }

  Promise.all([
    loadJSON("data/meta.json"),
    loadJSON("data/derived.json"),
    loadJSON("data/tempo.json"),
    loadJSON("data/base.json"),
  ]).then(function (res) {
    DATA.meta = res[0];
    DATA.derived = res[1];
    DATA.tempo = res[2];
    DATA.base = res[3];
    bindSeg("chain-seg", "chain", renderAll);
    bindSeg("range-seg", "range", renderSeries);
    bindSeg("heatdim-seg", "heatDim", renderHeatmap);
    bindSeg("heatrange-seg", "heatRange", renderHeatmap);
    applyUrlParams();
    renderAll();
  }).catch(function (err) {
    document.body.innerHTML = "<div class='wrap'><p style='padding:40px 0'>Could not load dashboard data (" +
      esc(err.message) + "). The data files are written by fetch-data.py — run it once, or wait for the hourly refresh.</p></div>";
  });
})();
