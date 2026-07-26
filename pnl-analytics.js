// ===== PNL Analytics page logic (Delta Exchange account_analytics-style dashboard) =====
let netEquityChart, equityChart, realizedChart, netBarChart, volumeChart, feesChart;
let activeRange = "all";     // "7" | "30" | "90" | "all" | "custom" — for the Trading Equity chart
let activeInstr = "all";     // "all" | "futures" | "options" — for the bottom charts
let customRange = null;      // {type:"fixed", start, end} | {type:"last", days} — set via the Customize popover

const isOption = (symbol) => /^[CP]-/.test(symbol || "");

function weekBucketLabel(dateStr) {
  // Bucket trades into ISO-ish week-start labels (Mon), matching the "MM-DD" style Delta uses.
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diffToMonday);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

function bucketWeekly(trades, valueFn) {
  const buckets = {};
  trades.forEach(t => {
    const key = weekBucketLabel(t.date);
    buckets[key] = (buckets[key] || 0) + valueFn(t);
  });
  return Object.entries(buckets)
    .sort((a, b) => new Date("2000-" + a[0].split("-").reverse().join("-")) - new Date("2000-" + b[0].split("-").reverse().join("-")))
    .map(([label, value]) => ({ label, value }));
}

function dayLabel(dateStr) {
  const [, mm, dd] = dateStr.split("-");
  return `${mm}-${dd}`;
}

function bucketDaily(trades, valueFn) {
  const buckets = {};
  trades.forEach(t => {
    buckets[t.date] = (buckets[t.date] || 0) + valueFn(t);
  });
  return Object.keys(buckets)
    .sort()
    .map(date => ({ label: dayLabel(date), value: buckets[date] }));
}

function filterByInstrument(trades) {
  if (activeInstr === "futures") return trades.filter(t => !isOption(t.symbol));
  if (activeInstr === "options") return trades.filter(t => isOption(t.symbol));
  return trades;
}

function filterByRange(trades) {
  if (!trades.length) return trades;

  if (activeRange === "custom" && customRange) {
    if (customRange.type === "fixed") {
      const { start, end } = customRange;
      return trades.filter(t => (!start || t.date >= start) && (!end || t.date <= end));
    }
    if (customRange.type === "last") {
      const maxDate = trades.reduce((m, t) => (t.date > m ? t.date : m), trades[0].date);
      const cutoff = new Date(maxDate + "T00:00:00");
      cutoff.setDate(cutoff.getDate() - customRange.days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      return trades.filter(t => t.date >= cutoffStr);
    }
  }

  if (activeRange === "all") return trades;
  const days = activeRange === "7" ? 7 : activeRange === "30" ? 30 : activeRange === "90" ? 90 : 30;
  const maxDate = trades.reduce((m, t) => (t.date > m ? t.date : m), trades[0].date);
  const cutoff = new Date(maxDate + "T00:00:00");
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return trades.filter(t => t.date >= cutoffStr);
}

function rangeLabelText() {
  if (activeRange === "custom" && customRange) {
    if (customRange.type === "fixed") return `${customRange.start || "…"} → ${customRange.end || "…"}`;
    if (customRange.type === "last") return `Last ${customRange.days} days`;
  }
  if (activeRange === "all") return "";
  return `Last ${activeRange} days`;
}

function render() {
  const allTrades = Store.getTrades().slice().sort((a, b) => (a.date + (a.entryTime || a.time || "")).localeCompare(b.date + (b.entryTime || b.time || "")));
  document.getElementById("tradeCountPill").textContent = `${allTrades.length} trades`;

  // ---------- Net P&L Analysis (new, on top) ----------
  const grossPnl = allTrades.reduce((s, t) => s + t.pnl, 0);
  const totalFees = allTrades.reduce((s, t) => s + (t.fees || 0), 0);
  const netPnl = grossPnl - totalFees;
  const grossProfit = allTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const feeDragPct = grossProfit > 0 ? (totalFees / grossProfit * 100) : 0;

  document.getElementById("net-pnl").textContent = fmtDualPlain(netPnl);
  document.getElementById("net-pnl").className = "stat-value " + (netPnl >= 0 ? "up" : "down");
  document.getElementById("net-pnl-sub").textContent = `Gross ${fmtDualPlain(grossPnl)} − Fees ${fmtDualPlain(totalFees)}`;
  document.getElementById("net-gross").textContent = fmtDualPlain(grossPnl);
  document.getElementById("net-fees").textContent = fmtDualPlain(totalFees);
  document.getElementById("net-fees-sub").textContent = allTrades.length ? `Across ${allTrades.length} trades` : "—";
  document.getElementById("net-drag").textContent = `${feeDragPct.toFixed(1)}%`;
  document.getElementById("net-drag").className = "stat-value " + (feeDragPct > 15 ? "down" : "up");

  renderNetEquityChart(allTrades);

  // ---------- Delta-style: Trading Equity (date-range filtered, gross) ----------
  const rangeTrades = filterByRange(allTrades);
  renderEquityChart(rangeTrades);
  const rlEl = document.getElementById("rangeLabel");
  if (rlEl) rlEl.textContent = rangeLabelText();

  // ---------- Delta-style: summary stats row (range + instrument filtered, gross-based) ----------
  const instrTrades = filterByInstrument(rangeTrades);
  const wins = instrTrades.filter(t => t.pnl > 0);
  const losses = instrTrades.filter(t => t.pnl <= 0);
  const instrGross = instrTrades.reduce((s, t) => s + t.pnl, 0);
  const instrFees = instrTrades.reduce((s, t) => s + (t.fees || 0), 0);
  const instrNet = instrGross - instrFees;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const volume = instrTrades.reduce((s, t) => s + (t.notional || 0), 0);

  document.getElementById("d-realized").textContent = fmtDualPlain(instrGross);
  document.getElementById("d-realized").className = "stat-value " + (instrGross >= 0 ? "up" : "down");
  document.getElementById("d-net").textContent = fmtDualPlain(instrNet);
  document.getElementById("d-net").className = "stat-value " + (instrNet >= 0 ? "up" : "down");
  document.getElementById("d-winrate").textContent = instrTrades.length ? `${(wins.length / instrTrades.length * 100).toFixed(1)}%` : "0%";
  document.getElementById("d-avgwin").textContent = fmtDualPlain(avgWin);
  document.getElementById("d-avgloss").textContent = fmtDualPlain(avgLoss);
  document.getElementById("d-trades").textContent = instrTrades.length;
  document.getElementById("d-fees").textContent = fmtDualPlain(instrFees);
  document.getElementById("d-volume").textContent = fmtDualPlain(volume);
  const rr = (avgWin > 0 && avgLoss < 0) ? (avgWin / Math.abs(avgLoss)) : null;
  document.getElementById("d-rr").textContent = rr != null ? `${rr.toFixed(2)} : 1` : "—";
  document.getElementById("d-rr").className = "stat-value " + (rr != null ? (rr >= 1.5 ? "up" : rr < 1 ? "down" : "") : "");

  renderRealizedChart(instrTrades);
  renderNetBarChart(instrTrades);
  renderVolumeChart(instrTrades);
  renderFeesChart(instrTrades);
}

function renderNetEquityChart(trades) {
  const ctx = document.getElementById("netEquityChart");
  let running = 0;
  const points = trades.map(t => { running += (t.pnl - (t.fees || 0)); return running; });
  const netAt = (i) => { const t = trades[i]; return t ? (t.pnl - (t.fees || 0)) : 0; };
  const data = {
    labels: trades.length ? trades.map(t => t.date) : ["Start"],
    datasets: [{
      label: "Net Equity",
      data: points.length ? points : [0],
      borderColor: "#8b93a7",
      backgroundColor: "rgba(139,147,167,.08)",
      segment: { borderColor: (c) => (netAt(c.p1DataIndex) >= 0 ? "#22c55e" : "#ef4444") },
      pointBackgroundColor: (c) => (netAt(c.dataIndex) >= 0 ? "#22c55e" : "#ef4444"),
      pointBorderColor: (c) => (netAt(c.dataIndex) >= 0 ? "#22c55e" : "#ef4444"),
      fill: true, tension: 0.25, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 10, borderWidth: 2,
    }]
  };
  const opts = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#151a22", borderColor: "#232b36", borderWidth: 1, padding: 10,
        titleFont: { family: "JetBrains Mono", size: 11 }, bodyFont: { family: "JetBrains Mono", size: 11 },
        callbacks: {
          title: (items) => { const t = trades[items[0].dataIndex]; return t ? `${t.symbol} · ${t.side} · ${t.date}` : ""; },
          label: (item) => {
            const t = trades[item.dataIndex];
            if (!t) return `Equity: ${fmtDualPlain(item.parsed.y)}`;
            return [`Trade Net P&L: ${fmtDual(t.pnl - (t.fees || 0))}`, `Running Net Equity: ${fmtDualPlain(item.parsed.y)}`];
          }
        }
      }
    },
    scales: {
      x: { ticks: { color: "#5b6472", maxTicksLimit: 8, font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#232b36" } },
      y: { ticks: { color: "#5b6472", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#232b36" } }
    }
  };
  if (netEquityChart) { netEquityChart.data = data; netEquityChart.options = opts; netEquityChart.update(); }
  else netEquityChart = new Chart(ctx, { type: "line", data, options: opts });
}

function renderEquityChart(trades) {
  const ctx = document.getElementById("equityChart");
  let running = 0;
  const points = trades.map(t => { running += t.pnl; return running; }); // gross, to mirror Delta's own chart
  const data = {
    labels: trades.length ? trades.map(t => t.date) : ["Start"],
    datasets: [{
      label: "Trading Equity",
      data: points.length ? points : [0],
      borderColor: "#d4a017",
      backgroundColor: "rgba(212,160,23,.10)",
      fill: true, tension: 0.2, pointRadius: 0, pointHoverRadius: 3, pointHitRadius: 8, borderWidth: 2,
    }]
  };
  const opts = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#151a22", borderColor: "#232b36", borderWidth: 1, padding: 10,
        titleFont: { family: "JetBrains Mono", size: 11 }, bodyFont: { family: "JetBrains Mono", size: 11 },
        callbacks: {
          title: (items) => { const t = trades[items[0].dataIndex]; return t ? `${t.symbol} · ${t.side} · ${t.date}` : ""; },
          label: (item) => {
            const t = trades[item.dataIndex];
            if (!t) return `Trading Equity: ${fmtDualPlain(item.parsed.y)}`;
            return [`Trade Gross P&L: ${fmtDual(t.pnl)}`, `Cumulative Trading Equity: ${fmtDualPlain(item.parsed.y)}`];
          }
        }
      }
    },
    scales: {
      x: { ticks: { color: "#5b6472", maxTicksLimit: 8, font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#232b36" } },
      y: { ticks: { color: "#5b6472", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#232b36" } }
    }
  };
  if (equityChart) { equityChart.data = data; equityChart.options = opts; equityChart.update(); }
  else equityChart = new Chart(ctx, { type: "line", data, options: opts });
}

function renderRealizedChart(trades) {
  const ctx = document.getElementById("realizedChart");
  const rows = bucketDaily(trades, t => t.pnl);
  const data = {
    labels: rows.length ? rows.map(r => r.label) : ["—"],
    datasets: [{
      data: rows.length ? rows.map(r => r.value) : [0],
      backgroundColor: rows.map(r => (r.value >= 0 ? "#2dd4bf" : "#f87171")),
      borderRadius: 3,
    }]
  };
  const opts = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#151a22", borderColor: "#232b36", borderWidth: 1, padding: 10,
        titleFont: { family: "JetBrains Mono", size: 11 }, bodyFont: { family: "JetBrains Mono", size: 11 },
        callbacks: { label: (item) => `Realized PNL: ${fmtDual(item.parsed.y)}` }
      }
    },
    scales: {
      x: { ticks: { color: "#5b6472", maxTicksLimit: 12, font: { family: "JetBrains Mono", size: 10 } }, grid: { display: false } },
      y: { ticks: { color: "#5b6472", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#232b36" } }
    }
  };
  if (realizedChart) { realizedChart.data = data; realizedChart.options = opts; realizedChart.update(); }
  else realizedChart = new Chart(ctx, { type: "bar", data, options: opts });
}

function renderNetBarChart(trades) {
  const ctx = document.getElementById("netBarChart");
  const rows = bucketDaily(trades, t => t.pnl - (t.fees || 0));
  const data = {
    labels: rows.length ? rows.map(r => r.label) : ["—"],
    datasets: [{
      data: rows.length ? rows.map(r => r.value) : [0],
      backgroundColor: rows.map(r => (r.value >= 0 ? "#2dd4bf" : "#f87171")),
      borderRadius: 3,
    }]
  };
  const opts = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#151a22", borderColor: "#232b36", borderWidth: 1, padding: 10,
        titleFont: { family: "JetBrains Mono", size: 11 }, bodyFont: { family: "JetBrains Mono", size: 11 },
        callbacks: { label: (item) => `Net PNL (after fees): ${fmtDual(item.parsed.y)}` }
      }
    },
    scales: {
      x: { ticks: { color: "#5b6472", maxTicksLimit: 12, font: { family: "JetBrains Mono", size: 10 } }, grid: { display: false } },
      y: { ticks: { color: "#5b6472", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#232b36" } }
    }
  };
  if (netBarChart) { netBarChart.data = data; netBarChart.options = opts; netBarChart.update(); }
  else netBarChart = new Chart(ctx, { type: "bar", data, options: opts });
}

function renderVolumeChart(trades) {
  const ctx = document.getElementById("volumeChart");
  const rows = bucketDaily(trades, t => t.notional || 0);
  const data = {
    labels: rows.length ? rows.map(r => r.label) : ["—"],
    datasets: [{
      data: rows.length ? rows.map(r => r.value) : [0],
      backgroundColor: "#a78bfa",
      borderRadius: 3,
    }]
  };
  const opts = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#151a22", borderColor: "#232b36", borderWidth: 1, padding: 10,
        titleFont: { family: "JetBrains Mono", size: 11 }, bodyFont: { family: "JetBrains Mono", size: 11 },
        callbacks: { label: (item) => `Volume: ${fmtDualPlain(item.parsed.y)}` }
      }
    },
    scales: {
      x: { ticks: { color: "#5b6472", maxTicksLimit: 12, font: { family: "JetBrains Mono", size: 10 } }, grid: { display: false } },
      y: { ticks: { color: "#5b6472", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#232b36" } }
    }
  };
  if (volumeChart) { volumeChart.data = data; volumeChart.options = opts; volumeChart.update(); }
  else volumeChart = new Chart(ctx, { type: "bar", data, options: opts });
}

function renderFeesChart(trades) {
  const ctx = document.getElementById("feesChart");
  const rows = bucketDaily(trades, t => t.fees || 0);
  const data = {
    labels: rows.length ? rows.map(r => r.label) : ["—"],
    datasets: [{
      data: rows.length ? rows.map(r => r.value) : [0],
      backgroundColor: "#d4a017",
      borderRadius: 3,
    }]
  };
  const opts = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#151a22", borderColor: "#232b36", borderWidth: 1, padding: 10,
        titleFont: { family: "JetBrains Mono", size: 11 }, bodyFont: { family: "JetBrains Mono", size: 11 },
        callbacks: { label: (item) => `Fees Paid: ${fmtDualPlain(item.parsed.y)}` }
      }
    },
    scales: {
      x: { ticks: { color: "#5b6472", maxTicksLimit: 12, font: { family: "JetBrains Mono", size: 10 } }, grid: { display: false } },
      y: { ticks: { color: "#5b6472", font: { family: "JetBrains Mono", size: 10 } }, grid: { color: "#232b36" } }
    }
  };
  if (feesChart) { feesChart.data = data; feesChart.options = opts; feesChart.update(); }
  else feesChart = new Chart(ctx, { type: "bar", data, options: opts });
}

// ---- Currency toggle (INR / Both / USD) ----
document.querySelectorAll(".curr-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".curr-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    setCurrencyMode(btn.dataset.mode);
    render();
  });
});

// ---- Range / instrument tab wiring ----
document.querySelectorAll('.tab-btn[data-range]').forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll('.tab-btn[data-range]').forEach(b => b.classList.remove("active"));
    document.getElementById("customizeBtn").classList.remove("active");
    btn.classList.add("active");
    activeRange = btn.dataset.range;
    customRange = null;
    render();
  });
});

// ---- Customize popover (Fixed start/end date, or Last N days) ----
const customizeBtn = document.getElementById("customizeBtn");
const customizePopover = document.getElementById("customizePopover");
const custTabFixed = document.getElementById("custTabFixed");
const custTabLast = document.getElementById("custTabLast");
const custFixedPanel = document.getElementById("custFixedPanel");
const custLastPanel = document.getElementById("custLastPanel");

customizeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  customizePopover.style.display = customizePopover.style.display === "none" ? "block" : "none";
});
custTabFixed.addEventListener("click", () => {
  custTabFixed.classList.add("active");
  custTabLast.classList.remove("active");
  custFixedPanel.style.display = "block";
  custLastPanel.style.display = "none";
});
custTabLast.addEventListener("click", () => {
  custTabLast.classList.add("active");
  custTabFixed.classList.remove("active");
  custLastPanel.style.display = "block";
  custFixedPanel.style.display = "none";
});
document.getElementById("custCancel").addEventListener("click", () => {
  customizePopover.style.display = "none";
});
document.getElementById("custApply").addEventListener("click", () => {
  const usingLast = custTabLast.classList.contains("active");
  if (usingLast) {
    const days = parseInt(document.getElementById("custDays").value, 10) || 1;
    customRange = { type: "last", days };
  } else {
    const start = document.getElementById("custStart").value;
    const end = document.getElementById("custEnd").value;
    if (!start && !end) { customizePopover.style.display = "none"; return; }
    customRange = { type: "fixed", start, end };
  }
  activeRange = "custom";
  document.querySelectorAll('.tab-btn[data-range]').forEach(b => b.classList.remove("active"));
  customizeBtn.classList.add("active");
  customizePopover.style.display = "none";
  render();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#customizePopover") && e.target !== customizeBtn) {
    customizePopover.style.display = "none";
  }
});

document.querySelectorAll('.tab-btn[data-instr]').forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll('.tab-btn[data-instr]').forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeInstr = btn.dataset.instr;
    render();
  });
});

// ---- CSV import (same parser/store as the Journal page) ----
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

document.getElementById("clearBtn").addEventListener("click", () => {
  if (confirm("Clear all logged trades? This also clears them from the Journal page (same shared data). This cannot be undone.")) {
    Store.clearTrades();
    render();
  }
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
    const grossPnl = result.trades.reduce((s, t) => s + t.pnl, 0);
    const fees = result.trades.reduce((s, t) => s + (t.fees || 0), 0);
    const netPnl = grossPnl - fees;
    importStatus.innerHTML = `Imported <strong>${result.trades.length}</strong> trades — gross ${fmtMoney(grossPnl)}, fees ${fmtMoneyPlain(fees)}, net ${fmtMoney(netPnl)} — from ${result.total} order rows (${result.skipped} skipped: opens, cancels, zero-P&L legs).`;
    importStatus.style.color = "var(--teal)";
    render();
  };
  reader.readAsText(file);
}

render();
