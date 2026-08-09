// ===== BKQ Journal page logic =====
let equityChart;
let equityModalChart;
let equityTrades = []; // parallel array to the equity chart's points, for tooltip lookups
let calViewYear, calViewMonth; // 0-indexed month, initialized on first render from trade data
let calDayIndex = {}; // date (YYYY-MM-DD) -> trades on that date, rebuilt every render
let lastAllTrades = []; // full (unfiltered) trade list from the last render(), used by column filters
let columnFilters = {}; // { date, symbol, side, session, setup, tag, pnl, source } -> current filter value

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function renderCalendar(trades) {
  const grid = document.getElementById("calendarGrid");
  const label = document.getElementById("calLabel");

  // Default the visible month to the most recent trade's month (falls back to today).
  if (calViewYear == null) {
    if (trades.length) {
      const last = trades[trades.length - 1].date;
      calViewYear = parseInt(last.slice(0,4), 10);
      calViewMonth = parseInt(last.slice(5,7), 10) - 1;
    } else {
      const now = new Date();
      calViewYear = now.getFullYear();
      calViewMonth = now.getMonth();
    }
  }

  // Sum NET P&L (after fees) per date (YYYY-MM-DD) across all trades, and keep
  // the trade list per date so a clicked day can show its detail.
  const byDate = {};
  calDayIndex = {};
  trades.forEach(t => {
    byDate[t.date] = (byDate[t.date] || 0) + (t.pnl - (t.fees || 0));
    (calDayIndex[t.date] = calDayIndex[t.date] || []).push(t);
  });

  label.textContent = `${MONTH_NAMES[calViewMonth]} ${calViewYear}`;

  // Monthly stat cards (Net P&L after fees, Win Rate, Profit Factor, BKQ Score) —
  // scoped to whichever month is currently in view, recomputed on every render/nav.
  const monthTrades = trades.filter(t => {
    const y = parseInt(t.date.slice(0,4), 10);
    const m = parseInt(t.date.slice(5,7), 10) - 1;
    return y === calViewYear && m === calViewMonth;
  });
  const monthStats = computeStats(monthTrades);

  const monthPnlEl = document.getElementById("month-stat-pnl");
  if (monthPnlEl) {
    monthPnlEl.textContent = fmtDual(monthStats.netPnl);
    monthPnlEl.className = "month-stat-value " + (monthStats.netPnl >= 0 ? "up" : "down");
  }
  const monthPnlSubEl = document.getElementById("month-stat-pnl-sub");
  if (monthPnlSubEl) {
    monthPnlSubEl.textContent = monthTrades.length
      ? `Gross ${fmtDualPlain(monthStats.grossPnl)} − Fees ${fmtDualPlain(monthStats.totalFees)}`
      : "No trades this month";
  }

  const monthWrEl = document.getElementById("month-stat-winrate");
  if (monthWrEl) monthWrEl.textContent = `${monthStats.winRate.toFixed(1)}%`;
  const monthWrSubEl = document.getElementById("month-stat-winrate-sub");
  if (monthWrSubEl) monthWrSubEl.textContent = `${monthStats.wins}W / ${monthStats.losses}L`;

  const monthPfEl = document.getElementById("month-stat-pf");
  if (monthPfEl) monthPfEl.textContent = monthStats.profitFactor.toFixed(2);

  const monthBkqEl = document.getElementById("month-stat-bkq");
  if (monthBkqEl) monthBkqEl.innerHTML = `${monthStats.bkqScore}<span class="muted" style="font-size:10px;">/100</span>`;
  const monthBkqSubEl = document.getElementById("month-stat-bkq-sub");
  if (monthBkqSubEl) {
    monthBkqSubEl.textContent = !monthTrades.length ? "—" :
      monthStats.bkqScore >= 70 ? "Strong, consistent edge" :
      monthStats.bkqScore >= 45 ? "Developing, some leaks" : "High risk / inconsistent";
  }

  const firstOfMonth = new Date(calViewYear, calViewMonth, 1);
  const startDow = firstOfMonth.getDay();
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0,10);

  let dowHtml = `<div class="cal-dow-row">${["S","M","T","W","T","F","S"].map(d => `<div class="cal-dow">${d}</div>`).join("")}</div>`;

  let cells = "";
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calViewYear}-${String(calViewMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const pnl = byDate[dateStr];
    const hasTrades = !!(calDayIndex[dateStr] && calDayIndex[dateStr].length);
    const cls = ["cal-day"];
    if (pnl != null) cls.push(pnl >= 0 ? "win" : "loss");
    if (dateStr === todayStr) cls.push("today");
    if (hasTrades) cls.push("clickable");
    cells += `<div class="${cls.join(" ")}" ${hasTrades ? `onclick="openDayModal('${dateStr}')" style="cursor:pointer;"` : ""}>
      <div class="cal-date">${d}</div>
      ${pnl != null ? `<div class="cal-pnl ${pnl>=0?'up':'down'}">${fmtDual(pnl)}</div>` : ""}
    </div>`;
  }
  grid.innerHTML = dowHtml + `<div class="cal-grid">${cells}</div>`;
}

function openDayModal(dateStr) {
  const dayTrades = (calDayIndex[dateStr] || []).slice().sort((a,b) => (a.entryTime||a.time||"").localeCompare(b.entryTime||b.time||""));
  const netTotal = dayTrades.reduce((s,t) => s + (t.pnl - (t.fees||0)), 0);
  const grossTotal = dayTrades.reduce((s,t) => s + t.pnl, 0);
  const feesTotal = dayTrades.reduce((s,t) => s + (t.fees||0), 0);

  const rows = dayTrades.map(t => `
    <tr>
      <td>${t.entryTime || "—"}</td>
      <td>${t.exitTime || "—"}</td>
      <td>${t.symbol}</td>
      <td>${t.side}</td>
      <td>${t.size != null ? t.size : "—"}</td>
      <td>${t.entry != null ? t.entry : "—"}</td>
      <td>${t.exit != null ? t.exit : "—"}</td>
      <td>${t.duration || "—"}</td>
      <td>${t.session ? `<span class="tag">${t.session}</span>` : "—"}</td>
      <td>${t.setup || "—"}</td>
      <td class="${(t.pnl-(t.fees||0))>=0?'up':'down'}">${fmtDual(t.pnl-(t.fees||0))}</td>
      <td>${fmtDualPlain(t.fees||0)}</td>
    </tr>`).join("");

  const modalHtml = `
    <div class="modal-backdrop" id="dayModalBackdrop" onclick="if(event.target===this) closeDayModal()">
      <div class="modal-box">
        <div class="flex-between" style="margin-bottom:6px;">
          <h3 style="margin:0;">${dateStr}</h3>
          <button class="btn btn-ghost btn-sm" onclick="closeDayModal()">✕</button>
        </div>
        <div class="flex gap-16" style="margin-bottom:16px;flex-wrap:wrap;">
          <span class="pill">Gross ${fmtDual(grossTotal)}</span>
          <span class="pill">Fees ${fmtDualPlain(feesTotal)}</span>
          <span class="pill ${netTotal>=0?'live':''}">Net ${fmtDual(netTotal)}</span>
          <span class="pill">${dayTrades.length} trade${dayTrades.length===1?'':'s'}</span>
        </div>
        <div style="overflow-x:auto;max-height:400px;overflow-y:auto;">
          <table>
            <thead><tr><th>Entry Time</th><th>Exit Time</th><th>Symbol</th><th>Side</th><th>Size</th><th>Entry</th><th>Exit</th><th>Duration</th><th>Session</th><th>Setup</th><th>Net P&amp;L</th><th>Fees</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  const holder = document.createElement("div");
  holder.id = "dayModalHolder";
  holder.innerHTML = modalHtml;
  document.body.appendChild(holder);
}

function closeDayModal() {
  const holder = document.getElementById("dayModalHolder");
  if (holder) holder.remove();
}

document.getElementById("calPrev").addEventListener("click", () => {
  calViewMonth--;
  if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
  renderCalendar(Store.getTrades());
});
document.getElementById("calNext").addEventListener("click", () => {
  calViewMonth++;
  if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
  renderCalendar(Store.getTrades());
});

function render() {
  const trades = Store.getTrades().sort((a,b) => (a.date+(a.entryTime||a.time||"")).localeCompare(b.date+(b.entryTime||b.time||"")));
  const stats = computeStats(trades);

  document.getElementById("stat-pnl").textContent = fmtDual(stats.netPnl);
  document.getElementById("stat-pnl").style.fontSize = "18px";
  document.getElementById("stat-pnl").className = "stat-value " + (stats.netPnl >= 0 ? "up" : "down");
  document.getElementById("stat-pnl-sub").textContent = `Gross ${fmtDualPlain(stats.grossPnl)} − Fees ${fmtDualPlain(stats.totalFees)}`;

  document.getElementById("stat-winrate").textContent = `${stats.winRate.toFixed(1)}%`;
  document.getElementById("stat-winrate-sub").textContent = `${stats.wins}W / ${stats.losses}L`;

  document.getElementById("stat-pf").textContent = stats.profitFactor.toFixed(2);

  document.getElementById("stat-bkq").innerHTML = `${stats.bkqScore}<span class="muted" style="font-size:13px;">/100</span>`;
  document.getElementById("stat-bkq-sub").textContent = stats.bkqScore >= 70 ? "Strong, consistent edge" : stats.bkqScore >= 45 ? "Developing, some leaks" : "High risk / inconsistent";

  document.getElementById("tradeCountPill").textContent = `${stats.total} trades`;

  // Table (filterable — see renderTradeTable)
  lastAllTrades = trades;
  populateTagFilterOptions(trades);
  renderTradeTable(trades);

  // Equity curve (net of fees — reflects true account balance change)
  let running = 0;
  const points = trades.map(t => { running += (t.pnl - (t.fees || 0)); return running; });
  const labels = trades.map(t => t.date);
  equityTrades = trades; // used by the tooltip callback below to look up per-point trade detail
  const ctx = document.getElementById("equityChart");
  // Color each segment/point green when that trade was a net win, red when a net loss —
  // makes the curve read at a glance instead of a flat single-color line.
  const netAt = (i) => { const t = equityTrades[i]; return t ? (t.pnl - (t.fees || 0)) : 0; };
  const segmentColor = (segCtx) => (netAt(segCtx.p1DataIndex) >= 0 ? "#22c55e" : "#ef4444");
  const pointColor = (dataCtx) => (netAt(dataCtx.dataIndex) >= 0 ? "#22c55e" : "#ef4444");
  const data = {
    labels: labels.length ? labels : ["Start"],
    datasets: [{
      label: "Equity",
      data: points.length ? points : [0],
      borderColor: "#8b93a7",
      backgroundColor: "rgba(139,147,167,.08)",
      segment: { borderColor: segmentColor },
      pointBackgroundColor: pointColor,
      pointBorderColor: pointColor,
      fill: true,
      tension: 0.25,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHitRadius: 10,
      borderWidth: 2,
    }]
  };
  const tooltipOptions = {
    backgroundColor: "#151a22",
    borderColor: "#232b36",
    borderWidth: 1,
    padding: 10,
    titleFont: { family: "JetBrains Mono", size: 11 },
    bodyFont: { family: "JetBrains Mono", size: 11 },
    callbacks: {
      title: (items) => {
        const t = equityTrades[items[0].dataIndex];
        return t ? `${t.symbol} · ${t.side} · ${t.date}` : "";
      },
      label: (item) => {
        const t = equityTrades[item.dataIndex];
        if (!t) return `Equity: ${fmtMoneyPlain(item.parsed.y)}`;
        const net = t.pnl - (t.fees || 0);
        return [
          `Trade Net P&L: ${fmtDual(net)}`,
          `Running Equity: ${fmtDualPlain(item.parsed.y)}`
        ];
      }
    }
  };
  if (equityChart) {
    equityChart.data = data;
    equityChart.options.plugins.tooltip = tooltipOptions;
    equityChart.update();
  } else {
    equityChart = new Chart(ctx, {
      type: "line",
      data,
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: tooltipOptions },
        scales: {
          x: { ticks: { color: "#5b6472", maxTicksLimit: 6, font:{family:"JetBrains Mono", size:10} }, grid: { color: "#232b36" } },
          y: { ticks: { color: "#5b6472", font:{family:"JetBrains Mono", size:10} }, grid: { color: "#232b36" } }
        }
      }
    });
  }

  renderInsights(trades);
  renderCalendar(trades);
}

// ---- Trade Log column filters ----
function populateTagFilterOptions(trades) {
  const select = document.querySelector('.col-filter[data-col="tag"]');
  if (!select) return;
  const current = select.value;
  const tags = Array.from(new Set(trades.map(t => t.mistake).filter(m => m && m !== "None"))).sort();
  select.innerHTML = `<option value="">All</option>` + tags.map(tag => `<option value="${tag}">${tag}</option>`).join("");
  if (tags.includes(current)) select.value = current;
}

function applyColumnFilters(trades) {
  return trades.filter(t => {
    if (columnFilters.date && !t.date.toLowerCase().includes(columnFilters.date.toLowerCase())) return false;
    if (columnFilters.symbol && !(t.symbol || "").toLowerCase().includes(columnFilters.symbol.toLowerCase())) return false;
    if (columnFilters.side && t.side !== columnFilters.side) return false;
    if (columnFilters.session && t.session !== columnFilters.session) return false;
    if (columnFilters.setup && !(t.setup || "").toLowerCase().includes(columnFilters.setup.toLowerCase())) return false;
    if (columnFilters.tag && t.mistake !== columnFilters.tag) return false;
    if (columnFilters.pnl) {
      const netPnl = t.pnl - (t.fees || 0);
      if (columnFilters.pnl === "win" && netPnl < 0) return false;
      if (columnFilters.pnl === "loss" && netPnl >= 0) return false;
    }
    if (columnFilters.source) {
      const sourceLabel = t.source === "delta_import" ? "CSV Import" : t.source === "demo" ? "Demo" : "Manual";
      if (sourceLabel !== columnFilters.source) return false;
    }
    return true;
  });
}

function renderTradeTable(allTrades) {
  const trades = applyColumnFilters(allTrades);
  const tbody = document.getElementById("tradeTableBody");
  tbody.innerHTML = "";
  const emptyState = document.getElementById("emptyState");
  const hasActiveFilters = Object.values(columnFilters).some(v => v);
  if (!trades.length) {
    emptyState.style.display = "block";
    emptyState.textContent = allTrades.length && hasActiveFilters
      ? "No trades match the current filters."
      : "No trades logged yet. Add one above, import your CSV, or load demo trades to explore the dashboard.";
  } else {
    emptyState.style.display = "none";
    trades.slice().reverse().forEach(t => {
      const tr = document.createElement("tr");
      const sourceLabel = t.source === "delta_import" ? "CSV Import" : t.source === "demo" ? "Demo" : "Manual";
      const netPnl = t.pnl - (t.fees || 0);
      tr.innerHTML = `
        <td>${t.date}</td>
        <td>${t.entryTime || "—"}</td>
        <td>${t.exitTime || "—"}</td>
        <td>${t.symbol}</td>
        <td>${t.side}</td>
        <td>${t.size != null ? t.size : "—"}</td>
        <td>${t.entry != null ? t.entry : "—"}</td>
        <td>${t.exit != null ? t.exit : "—"}</td>
        <td>${t.duration || "—"}</td>
        <td>${t.session ? `<span class="tag">${t.session}</span>` : "—"}</td>
        <td>${t.setup || "—"}</td>
        <td>${t.mistake && t.mistake !== "None" ? `<span class="tag">${t.mistake}</span>` : "—"}</td>
        <td class="${netPnl >= 0 ? 'up' : 'down'}">${fmtDual(netPnl)}</td>
        <td>${t.fees != null ? fmtDualPlain(t.fees) : "—"}</td>
        <td><span class="tag">${sourceLabel}</span></td>
        <td><button class="btn btn-ghost btn-sm" data-id="${t.id}" onclick="removeTrade(${t.id})">✕</button></td>
      `;
      tbody.appendChild(tr);
    });
  }
  const pill = document.getElementById("tradeCountPill");
  if (pill && hasActiveFilters) pill.textContent = `${trades.length} of ${allTrades.length} trades`;
  else if (pill) pill.textContent = `${allTrades.length} trades`;
}

document.querySelectorAll(".col-filter").forEach(el => {
  const evt = el.tagName === "SELECT" ? "change" : "input";
  el.addEventListener(evt, () => {
    columnFilters[el.dataset.col] = el.value;
    renderTradeTable(lastAllTrades);
  });
});
document.getElementById("clearFiltersBtn").addEventListener("click", () => {
  columnFilters = {};
  document.querySelectorAll(".col-filter").forEach(el => { el.value = ""; });
  renderTradeTable(lastAllTrades);
});

// ---- Equity curve expand modal ----
function openEquityModal() {
  if (document.getElementById("equityModalHolder")) return;
  const holder = document.createElement("div");
  holder.id = "equityModalHolder";
  holder.innerHTML = `
    <div class="modal-backdrop" onclick="closeEquityModal(event)">
      <div class="modal-box" style="max-width:960px;width:92vw;" onclick="event.stopPropagation();">
        <div class="flex-between" style="margin-bottom:16px;">
          <h3 style="margin:0;">Equity Curve</h3>
          <button class="btn btn-ghost btn-sm" onclick="closeEquityModal(event)">✕</button>
        </div>
        <canvas id="equityChartExpanded" height="110"></canvas>
      </div>
    </div>`;
  document.body.appendChild(holder);

  const ctx = document.getElementById("equityChartExpanded");
  const netAt = (i) => { const t = equityTrades[i]; return t ? (t.pnl - (t.fees || 0)) : 0; };
  const segmentColor = (segCtx) => (netAt(segCtx.p1DataIndex) >= 0 ? "#22c55e" : "#ef4444");
  const pointColor = (dataCtx) => (netAt(dataCtx.dataIndex) >= 0 ? "#22c55e" : "#ef4444");
  if (equityModalChart) { equityModalChart.destroy(); equityModalChart = null; }
  equityModalChart = new Chart(ctx, {
    type: "line",
    data: JSON.parse(JSON.stringify(equityChart.data)),
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: equityChart.options.plugins.tooltip },
      scales: {
        x: { ticks: { color: "#5b6472", maxTicksLimit: 10, font:{family:"JetBrains Mono", size:11} }, grid: { color: "#232b36" } },
        y: { ticks: { color: "#5b6472", font:{family:"JetBrains Mono", size:11} }, grid: { color: "#232b36" } }
      }
    }
  });
  // JSON round-trip drops function-valued options (segment/point callbacks) — reapply them directly.
  equityModalChart.data.datasets[0].segment = { borderColor: segmentColor };
  equityModalChart.data.datasets[0].pointBackgroundColor = pointColor;
  equityModalChart.data.datasets[0].pointBorderColor = pointColor;
  equityModalChart.update();
}
function closeEquityModal(e) {
  if (e) e.stopPropagation();
  const holder = document.getElementById("equityModalHolder");
  if (holder) holder.remove();
  if (equityModalChart) { equityModalChart.destroy(); equityModalChart = null; }
}
document.getElementById("equityExpandBtn").addEventListener("click", openEquityModal);
document.getElementById("equityChart").addEventListener("click", openEquityModal);

function insightRow(label, value, sub) {
  return `<div class="stat-card">
    <div class="stat-label">${label}</div>
    <div class="stat-value" style="font-size:16px;">${value}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
  </div>`;
}

function renderInsights(trades) {
  const section = document.getElementById("insightsSection");
  const container = document.getElementById("insightsContainer");
  const meta = Store.getImportMeta();
  const ins = computeInsights(trades, meta);

  if (!ins) {
    section.style.display = "none";
    container.innerHTML = "";
    return;
  }
  section.style.display = "block";

  const aggPnl = ins.grossProfit - ins.grossLoss; // sum of all realized P&L, before fees
  const netPnl = aggPnl - (ins.totalFees || 0); // true net after fees

  let html = "";

  // --- Overview / performance ---
  html += `<div class="card" style="margin-bottom:20px;">
    <h3 style="margin-top:0;font-size:15px;">Overview &amp; Performance</h3>
    <p class="muted" style="font-size:12.5px;margin-bottom:16px;">
      ${ins.total} closed trades with realized P&amp;L${meta ? ` · ${meta.totalOrders} total order rows, ${meta.closedOrders} closed, ${meta.cancelledOrders} cancelled` : ""}.
    </p>
    <div class="grid grid-4" style="margin-bottom:14px;">
      ${insightRow("Gross Profit", fmtDual(ins.grossProfit))}
      ${insightRow("Gross Loss", fmtDual(-ins.grossLoss))}
      ${insightRow("Trading Fees", fmtDualPlain(ins.totalFees || 0))}
      ${insightRow("Net P&amp;L (after fees)", fmtDual(netPnl))}
    </div>
    <div class="grid grid-4">
      ${insightRow("Profit Factor", ins.profitFactor.toFixed(2))}
      ${insightRow("Win Rate", `${ins.winRate.toFixed(1)}%`, `${ins.wins}W / ${ins.losses}L`)}
      ${insightRow("Avg Win / Loss", `${fmtDualPlain(ins.avgWin)} / ${fmtDualPlain(-ins.avgLoss)}`)}
      ${insightRow("Largest Win / Loss", `${fmtDualPlain(ins.largestWin)} / ${fmtDualPlain(ins.largestLoss)}`)}
    </div>
    <div class="grid grid-4" style="margin-top:14px;">
      ${insightRow("Streaks", `${ins.maxWinStreak}W / ${ins.maxLossStreak}L`, "Longest win-streak / loss-streak")}
      ${insightRow("Max Drawdown", fmtDualPlain(ins.maxDrawdown), "Full breakdown below ↓")}
    </div>
  </div>`;

  // --- Edge by symbol ---
  html += `<div class="card" style="margin-bottom:20px;">
    <h3 style="margin-top:0;font-size:15px;">Your Edge — By Symbol</h3>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Symbol</th><th>Trades</th><th>Net P&amp;L</th><th>Avg / Trade</th><th>% of Net Profit</th></tr></thead>
        <tbody>
          ${ins.symbolRows.map(r => `<tr>
            <td>${r.symbol}</td><td>${r.count}</td>
            <td class="${r.pnl>=0?'up':'down'}">${fmtDual(r.pnl)}</td>
            <td class="${r.avg>=0?'up':'down'}">${fmtDualPlain(r.avg)}</td>
            <td>${r.pctOfNetProfit != null ? r.pctOfNetProfit.toFixed(1)+"%" : "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>`;

  // --- Exit type comparison ---
  if (ins.exitTypeRows) {
    html += `<div class="card" style="margin-bottom:20px;">
      <h3 style="margin-top:0;font-size:15px;">Exit Discipline — Market vs Limit</h3>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Exit Type</th><th>Trades</th><th>Net P&amp;L</th><th>Avg / Trade</th></tr></thead>
          <tbody>
            ${ins.exitTypeRows.map(r => `<tr>
              <td>${r.type}</td><td>${r.count}</td>
              <td class="${r.pnl>=0?'up':'down'}">${fmtDual(r.pnl)}</td>
              <td class="${r.avg>=0?'up':'down'}">${fmtDualPlain(r.avg)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // --- Time-of-day, day-of-week & global session ---
  html += `<div class="grid grid-3" style="margin-bottom:20px;">`;
  if (ins.hourRows) {
    html += `<div class="card">
      <h3 style="margin-top:0;font-size:15px;">Best / Worst Time Windows (IST)</h3>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Window</th><th>Trades</th><th>Net P&amp;L</th></tr></thead>
          <tbody>
            ${ins.hourRows.slice(0,4).map(r => `<tr><td>${r.bucket}</td><td>${r.count}</td><td class="up">${fmtDual(r.pnl)}</td></tr>`).join("")}
            ${ins.hourRows.slice(-2).map(r => `<tr><td>${r.bucket}</td><td>${r.count}</td><td class="${r.pnl>=0?'up':'down'}">${fmtDual(r.pnl)}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }
  html += `<div class="card">
    <h3 style="margin-top:0;font-size:15px;">Day of Week</h3>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Day</th><th>Trades</th><th>Net P&amp;L</th></tr></thead>
        <tbody>
          ${ins.dowRows.map(r => `<tr><td>${r.day}</td><td>${r.count}</td><td class="${r.pnl>=0?'up':'down'}">${fmtDual(r.pnl)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>`;
  if (ins.sessionRows) {
    html += `<div class="card">
      <h3 style="margin-top:0;font-size:15px;">Global Session (Sydney / Asia / London / NY)</h3>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Session</th><th>Trades</th><th>Net P&amp;L</th></tr></thead>
          <tbody>
            ${ins.sessionRows.map(r => `<tr><td>${r.session}</td><td>${r.count}</td><td class="${r.pnl>=0?'up':'down'}">${fmtDual(r.pnl)}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }
  html += `</div>`;

  // --- Position sizing quartiles ---
  if (ins.sizingQuartiles) {
    html += `<div class="card" style="margin-bottom:20px;">
      <h3 style="margin-top:0;font-size:15px;">Position Sizing Over Time</h3>
      ${ins.sizeEscalation && ins.sizeEscalation > 3 ? `<p style="color:var(--red);font-size:12.5px;">⚠ Size has grown ~${ins.sizeEscalation.toFixed(1)}× from your earliest to most recent trades.</p>` : ""}
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Period</th><th>Avg Size ($ notional)</th><th>Win Rate</th><th>Avg P&amp;L / Trade</th></tr></thead>
          <tbody>
            ${ins.sizingQuartiles.map(q => `<tr>
              <td>${q.label}</td><td>${fmtMoneyPlain(q.avgSize)}</td><td>${q.winRate.toFixed(1)}%</td>
              <td class="${q.avgPnl>=0?'up':'down'}">${fmtDualPlain(q.avgPnl)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // --- Risk events / cancellations / fees ---
  if (ins.riskEvents.length || ins.cancelStats || ins.feeDragPct != null) {
    html += `<div class="grid grid-2" style="margin-bottom:20px;">`;
    if (ins.riskEvents.length) {
      html += `<div class="card">
        <h3 style="margin-top:0;font-size:15px;">Risk Events</h3>
        ${ins.riskEvents.map(e => `<div style="padding:10px 12px;border-radius:8px;margin-bottom:8px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);font-size:12.5px;">⚠ ${e.type} — ${e.symbol} on ${e.date}</div>`).join("")}
      </div>`;
    }
    if (ins.cancelStats || ins.feeDragPct != null) {
      html += `<div class="card">
        <h3 style="margin-top:0;font-size:15px;">Cancellations &amp; Fee Drag</h3>
        ${ins.cancelStats ? `<p style="font-size:12.5px;">${ins.cancelStats.total} of ${meta.totalOrders} orders cancelled (${ins.cancelStats.pct.toFixed(1)}%)${ins.cancelStats.worstSymbol ? ` — mostly ${ins.cancelStats.worstSymbol[0]} (${ins.cancelStats.worstSymbol[1]})` : ""}.</p>` : ""}
        ${ins.feeDragPct != null ? `<p style="font-size:12.5px;margin-bottom:0;">Total fees: ${fmtDualPlain(ins.totalFees)} — ${ins.feeDragPct.toFixed(1)}% of gross profit.</p>` : ""}
      </div>`;
    }
    html += `</div>`;
  }

  // --- Drawdown analysis ---
  if (ins.drawdownInfo) {
    const dd = ins.drawdownInfo;
    html += `<div class="card" style="margin-bottom:20px;">
      <h3 style="margin-top:0;font-size:15px;">Drawdown Analysis</h3>
      <div class="grid grid-4" style="margin-bottom:14px;">
        ${insightRow("Max Drawdown", fmtDualPlain(dd.amount), dd.pct != null ? `${dd.pct.toFixed(1)}% off peak equity` : "—")}
        ${insightRow("Peak Equity", fmtDual(dd.peakEquity), `Reached ${dd.fromDate}`)}
        ${insightRow("Trough Equity", fmtDual(dd.troughEquity), `Hit ${dd.toDate}`)}
        ${insightRow("Trades In Drawdown", `${dd.path.length}`, "From peak to trough")}
      </div>
      <p class="muted" style="font-size:12.5px;margin-bottom:10px;">
        Equity peaked at ${fmtDual(dd.peakEquity)} on ${dd.fromDate}, then bled down to ${fmtDual(dd.troughEquity)} by ${dd.toDate} — a drawdown of ${fmtDual(dd.amount)}.
        The trade that marked the bottom was <strong>${dd.trade.symbol}</strong> (${dd.trade.side}), closed ${dd.trade.date}${dd.trade.exitTime ? ' at ' + dd.trade.exitTime : ''}, net ${fmtDual(dd.trade.pnl - (dd.trade.fees||0))}.
      </p>
      ${dd.path.length ? `<div style="overflow-x:auto;">
        <table>
          <thead><tr><th>Date</th><th>Exit Time</th><th>Symbol</th><th>Side</th><th>Net P&amp;L</th></tr></thead>
          <tbody>
            ${dd.path.map(t => `<tr${t === dd.trade ? ' style="background:rgba(248,113,113,.1);"' : ''}>
              <td>${t.date}</td><td>${t.exitTime || t.entryTime || "—"}</td><td>${t.symbol}</td><td>${t.side}</td>
              <td class="${(t.pnl-(t.fees||0))>=0?'up':'down'}">${fmtDual(t.pnl - (t.fees||0))}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>` : ""}
    </div>`;
  }

  // --- Recommendations ---
  html += `<div class="card">
    <h3 style="margin-top:0;font-size:15px;">◆ Where To Improve</h3>
    ${ins.recs.map(r => `<p style="font-size:13px;margin-bottom:10px;">→ ${r}</p>`).join("")}
  </div>`;

  container.innerHTML = html;
}

function removeTrade(id) {
  Store.deleteTrade(id);
  render();
}

document.getElementById("tradeForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const date = document.getElementById("f-date").value;
  const entryTimeStr = document.getElementById("f-entry-time").value;
  const exitTimeStr = document.getElementById("f-exit-time").value;
  const entryPrice = document.getElementById("f-entry").value;
  const exitPrice = document.getElementById("f-exit").value;
  const size = document.getElementById("f-size").value;

  let duration = null, session = null;
  if (entryTimeStr) {
    session = classifySession(entryTimeStr);
    if (exitTimeStr) {
      const [eh, em] = entryTimeStr.split(":").map(Number);
      const [xh, xm] = exitTimeStr.split(":").map(Number);
      let diff = (xh * 60 + xm) - (eh * 60 + em);
      if (diff < 0) diff += 24 * 60; // crossed midnight
      duration = formatDuration(diff);
    }
  }

  const trade = {
    id: Date.now(),
    date,
    time: entryTimeStr || null,
    entryTime: entryTimeStr || null,
    exitTime: exitTimeStr || null,
    symbol: document.getElementById("f-symbol").value.toUpperCase(),
    side: document.getElementById("f-side").value,
    size: size !== "" ? parseFloat(size) : null,
    entry: entryPrice !== "" ? parseFloat(entryPrice) : null,
    exit: exitPrice !== "" ? parseFloat(exitPrice) : null,
    duration,
    session,
    pnl: parseFloat(document.getElementById("f-pnl").value),
    fees: document.getElementById("f-fees").value !== "" ? parseFloat(document.getElementById("f-fees").value) : 0,
    setup: document.getElementById("f-setup").value,
    mistake: document.getElementById("f-mistake").value,
    notes: document.getElementById("f-notes").value,
    source: "manual"
  };
  Store.addTrade(trade);
  e.target.reset();
  document.getElementById("f-date").valueAsDate = new Date();
  render();
});

// ---- Currency toggle (INR / Both / USD) — affects every fee & P&L figure on the page ----
document.querySelectorAll(".curr-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".curr-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    setCurrencyMode(btn.dataset.mode);
    render();
  });
});

document.getElementById("seedBtn").addEventListener("click", () => {
  Store.saveTrades(genDemoTrades());
  render();
});

document.getElementById("clearBtn").addEventListener("click", () => {
  if (confirm("Clear all logged trades? This cannot be undone.")) {
    Store.clearTrades();
    render();
  }
});

// ---- CSV import ----
const dropzone = document.getElementById("dropzone");
const csvInput = document.getElementById("csvInput");
const importStatus = document.getElementById("importStatus");

dropzone.addEventListener("click", () => csvInput.click());
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleCSVFile(e.dataTransfer.files[0]);
});
csvInput.addEventListener("change", (e) => {
  if (e.target.files.length) handleCSVFile(e.target.files[0]);
});

function handleCSVFile(file) {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    importStatus.textContent = "Please upload a .csv file.";
    importStatus.style.color = "var(--red)";
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const result = parseDeltaCSV(e.target.result);
    if (!result.trades.length) {
      importStatus.textContent = `No closed trades with realized P&L found in ${result.total} rows. Check the file format.`;
      importStatus.style.color = "var(--red)";
      return;
    }
    Store.addTrades(result.trades);
    Store.mergeImportMeta(result.meta);
    const grossPnl = result.trades.reduce((s,t) => s + t.pnl, 0);
    const fees = result.trades.reduce((s,t) => s + (t.fees || 0), 0);
    const netPnl = grossPnl - fees;
    importStatus.innerHTML = `Imported <strong>${result.trades.length}</strong> trades — gross ${fmtMoney(grossPnl)}, fees ${fmtMoneyPlain(fees)}, net ${fmtMoney(netPnl)} — from ${result.total} order rows (${result.skipped} skipped: opens, cancels, zero-P&L legs).`;
    importStatus.style.color = "var(--teal)";
    render();
  };
  reader.readAsText(file);
}

// Default date field to today
document.getElementById("f-date").valueAsDate = new Date();

render();
