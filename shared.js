// ===== BKQ Journal — shared data layer =====
// All data lives in localStorage. Nothing leaves the browser.

const STORAGE_KEY = "bkq_trades_v1";
const BACKTEST_KEY = "bkq_backtests_v1";
const META_KEY = "bkq_import_meta_v1";

const Store = {
  getTrades() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch (e) { return []; }
  },
  saveTrades(trades) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  },
  addTrade(trade) {
    const trades = Store.getTrades();
    trades.push(trade);
    Store.saveTrades(trades);
    return trades;
  },
  addTrades(newTrades) {
    const trades = Store.getTrades().concat(newTrades);
    Store.saveTrades(trades);
    return trades;
  },
  deleteTrade(id) {
    const trades = Store.getTrades().filter(t => t.id !== id);
    Store.saveTrades(trades);
    return trades;
  },
  clearTrades() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(META_KEY);
  },
  getImportMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || null; }
    catch (e) { return null; }
  },
  mergeImportMeta(meta) {
    if (!meta) return;
    const existing = Store.getImportMeta() || {
      totalOrders: 0, closedOrders: 0, cancelledOrders: 0, cancelledBySymbol: {}, liquidations: [], leverageEvents: []
    };
    existing.totalOrders += meta.totalOrders || 0;
    existing.closedOrders += meta.closedOrders || 0;
    existing.cancelledOrders += meta.cancelledOrders || 0;
    Object.entries(meta.cancelledBySymbol || {}).forEach(([sym, n]) => {
      existing.cancelledBySymbol[sym] = (existing.cancelledBySymbol[sym] || 0) + n;
    });
    existing.liquidations = (existing.liquidations || []).concat(meta.liquidations || []);
    existing.leverageEvents = (existing.leverageEvents || []).concat(meta.leverageEvents || []);
    localStorage.setItem(META_KEY, JSON.stringify(existing));
    return existing;
  },
  getBacktests() {
    try { return JSON.parse(localStorage.getItem(BACKTEST_KEY)) || []; }
    catch (e) { return []; }
  },
  saveBacktest(bt) {
    const list = Store.getBacktests();
    list.unshift(bt);
    localStorage.setItem(BACKTEST_KEY, JSON.stringify(list.slice(0, 20)));
  },
  seedDemoTrades() {
    if (Store.getTrades().length) return;
    Store.saveTrades(DEMO_TRADES);
  }
};

function addMinutesToTime(timeStr, minutes) {
  if (!timeStr || minutes == null) return null;
  const [h, m] = timeStr.split(":").map(Number);
  let total = (h * 60 + m + Math.round(minutes)) % (24 * 60);
  if (total < 0) total += 24 * 60;
  const oh = Math.floor(total / 60), om = total % 60;
  return `${String(oh).padStart(2,"0")}:${String(om).padStart(2,"0")}`;
}

function formatDuration(minutes) {
  if (minutes == null || isNaN(minutes)) return null;
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ===== Global FX session classification (Sydney / Asia / London / New York) =====
// Standard session hours (UTC): Sydney 22:00-07:00, Tokyo/Asia 00:00-09:00,
// London 08:00-17:00, New York 13:00-22:00 — converted to IST (+05:30):
// New York 18:30-03:30, London 13:30-22:30, Asia 05:30-14:30, Sydney 03:30-12:30.
// Sessions overlap in reality; where they do, priority order below picks the
// dominant/highest-liquidity session (New York > London > Asia > Sydney).
function classifySession(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (isNaN(h)) return null;
  const t = h + (m || 0) / 60;
  const inRange = (start, end, x) => start <= end ? (x >= start && x < end) : (x >= start || x < end);
  if (inRange(18.5, 3.5, t)) return "New York";
  if (inRange(13.5, 22.5, t)) return "London";
  if (inRange(5.5, 14.5, t)) return "Asia";
  if (inRange(3.5, 12.5, t)) return "Sydney";
  return "Off-Session";
}

// Seed data so the journal/BKQ AI feel alive on first visit.
function genDemoTrades() {
  const symbols = ["BTCUSD","ETHUSD","SOLUSD","XAUTUSD","SPCXXUSD"];
  const setups = ["Break & Retest","Paroshpathar Scalp","VWAP Reclaim","5 EMA Breakout","Pullback (21 EMA)"];
  const mistakes = ["None","FOMO entry","Late entry","Oversized","Revenge trade"];
  const trades = [];
  let day = new Date();
  day.setDate(day.getDate() - 45);
  let id = 1;
  for (let i = 0; i < 40; i++) {
    day = new Date(day.getTime() + (Math.random() > 0.6 ? 2 : 1) * 86400000);
    const dow = day.getDay();
    // Bias Fridays (5) to lose more, mimicking the "why do I lose on Fridays" pattern
    const fridayPenalty = dow === 5 ? -0.22 : 0;
    const winChance = 0.56 + fridayPenalty;
    const isWin = Math.random() < winChance;
    const risk = 100 + Math.round(Math.random() * 150);
    const pnl = isWin ? Math.round(risk * (1 + Math.random() * 1.6)) : -Math.round(risk * (0.6 + Math.random() * 0.6));
    const hour = Math.floor(Math.random() * 24);
    const minute = Math.floor(Math.random()*60);
    const timeStr = `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
    const durMin = 4 + Math.floor(Math.random() * 90);
    const entryPrice = +(100 + Math.random()*400).toFixed(2);
    const exitPrice = +(entryPrice + (isWin ? 1 : -1) * (Math.random()*8)).toFixed(2);
    const fees = +((Math.random() * 0.4 + 0.1) * (risk / 20)).toFixed(2);
    trades.push({
      id: id++,
      date: day.toISOString().slice(0,10),
      time: timeStr,
      entryTime: timeStr,
      exitTime: addMinutesToTime(timeStr, durMin),
      symbol: symbols[Math.floor(Math.random()*symbols.length)],
      side: Math.random() > 0.5 ? "Long" : "Short",
      entry: entryPrice,
      exit: exitPrice,
      size: Math.ceil(Math.random()*10),
      duration: formatDuration(durMin),
      session: classifySession(timeStr),
      pnl,
      fees,
      setup: setups[Math.floor(Math.random()*setups.length)],
      mistake: dow === 5 && !isWin && Math.random() > 0.4 ? "Revenge trade" : mistakes[Math.floor(Math.random()*mistakes.length)],
      notes: "",
      source: "demo"
    });
  }
  return trades;
}
const DEMO_TRADES = genDemoTrades();

// ===== Shared stat computation =====
function computeStats(trades) {
  if (!trades.length) {
    return { netPnl:0, grossPnl:0, totalFees:0, winRate:0, profitFactor:0, total:0, wins:0, losses:0, avgWin:0, avgLoss:0, bkqScore:0 };
  }
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossPnl = trades.reduce((s,t) => s + t.pnl, 0);
  const totalFees = trades.reduce((s,t) => s + (t.fees || 0), 0);
  const netPnl = grossPnl - totalFees; // true net after fees
  const grossProfit = wins.reduce((s,t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s,t) => s + t.pnl, 0));
  const winRate = (wins.length / trades.length) * 100;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  // BKQ composite score: profitability, consistency, risk control, win rate
  const pfScore = Math.min(profitFactor / 2, 1) * 30;
  const wrScore = Math.min(winRate / 70, 1) * 25;
  const payoff = avgLoss > 0 ? avgWin / avgLoss : 1;
  const payoffScore = Math.min(payoff / 2, 1) * 25;
  const consistencyPenalty = losses.length && (losses.length / trades.length) > 0.6 ? 0.7 : 1;
  const bkqScore = Math.round(Math.min(100, (pfScore + wrScore + payoffScore + 20) * consistencyPenalty));

  return { netPnl, grossPnl, totalFees, winRate, profitFactor, total: trades.length, wins: wins.length, losses: losses.length, avgWin, avgLoss, bkqScore };
}

function fmtMoney(n) {
  const sign = n < 0 ? "-" : "+";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}
function fmtMoneyPlain(n) {
  return `$${Math.round(n).toLocaleString()}`;
}

// ===== INR / USD dual display (Delta Exchange conversion rate: ₹85 = $1) =====
const INR_RATE = 85;
// CURRENCY_MODE: "dual" (₹ with $ in brackets, default/original behavior) | "inr" | "usd" —
// toggled by the Currency switch on the Journal page; read live by every fmtDual*/call site,
// so flipping it + re-rendering reformats stat cards, tables, calendar, insights, tooltips, etc.
let CURRENCY_MODE = "dual";
function setCurrencyMode(mode) { CURRENCY_MODE = mode; }
function fmtDual(usd) {
  const sign = usd < 0 ? "-" : "+";
  const absInr = Math.abs(Math.round(usd * INR_RATE));
  const absUsd = Math.abs(Math.round(usd));
  if (CURRENCY_MODE === "inr") return `${sign}₹${absInr.toLocaleString("en-IN")}`;
  if (CURRENCY_MODE === "usd") return `${sign}$${absUsd.toLocaleString()}`;
  return `${sign}₹${absInr.toLocaleString("en-IN")} (${sign}$${absUsd.toLocaleString()})`;
}
function fmtDualPlain(usd) {
  const absInr = Math.abs(Math.round(usd * INR_RATE));
  const absUsd = Math.abs(Math.round(usd));
  if (CURRENCY_MODE === "inr") return `₹${absInr.toLocaleString("en-IN")}`;
  if (CURRENCY_MODE === "usd") return `$${absUsd.toLocaleString()}`;
  return `₹${absInr.toLocaleString("en-IN")} ($${absUsd.toLocaleString()})`;
}

// ===== Delta Exchange OrderHistory CSV importer =====
// Expected header: Time,Contract,Qty,Side,Filled/Remaining,Exec.Price,Order Price,
//                  Stop Price,Order Value,Trading Fees,Cashflow,Realised P&L,
//                  Order Type,Status,Explanation,Client Order ID,Order ID

function parseDeltaTime(raw) {
  // "2026-07-22 04:53:47.058073+05:30 IST Asia/Kolkata" -> Date
  const m = raw.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2}:\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}${m[3]}`);
  return isNaN(d.getTime()) ? null : d;
}

function parseDeltaCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return { trades: [], skipped: 0, total: 0, meta: null };

  const header = lines[0].split(",").map(h => h.trim());
  const idx = (name) => header.indexOf(name);
  const iTime = idx("Time"), iContract = idx("Contract"), iQty = idx("Qty"),
        iSide = idx("Side"), iExecPrice = idx("Exec.Price"), iFees = idx("Trading Fees"),
        iPnl = idx("Realised P&L"), iStatus = idx("Status"), iOrderValue = idx("Order Value"),
        iOrderType = idx("Order Type"), iExplanation = idx("Explanation");

  // Pre-parse every data row once so we can look ahead for the matching open leg.
  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = lines[li].split(",");
    if (cols.length < header.length - 2) { rows.push(null); continue; }
    rows.push({
      li,
      status: (cols[iStatus] || "").trim(),
      pnlRaw: (cols[iPnl] || "").trim(),
      timeRaw: (cols[iTime] || "").trim(),
      side: (cols[iSide] || "").trim().toLowerCase(),
      symbol: (cols[iContract] || "").trim(),
      qty: parseFloat(cols[iQty]) || 0,
      execPrice: parseFloat(cols[iExecPrice]) || 0,
      fees: parseFloat(cols[iFees]) || 0,
      orderValue: parseFloat(cols[iOrderValue]) || 0,
      orderType: (cols[iOrderType] || "").trim(),
      explanation: (cols[iExplanation] || "").trim(),
    });
  }

  const trades = [];
  let skipped = 0;
  const consumed = new Set();

  // ---- Order-level meta: totals, cancellations, risk events ----
  const meta = {
    totalOrders: rows.filter(Boolean).length,
    closedOrders: 0,
    cancelledOrders: 0,
    cancelledBySymbol: {},
    liquidations: [],
    leverageEvents: [],
  };
  rows.forEach(row => {
    if (!row) return;
    if (row.status === "closed") meta.closedOrders++;
    if (row.status === "cancelled") {
      meta.cancelledOrders++;
      meta.cancelledBySymbol[row.symbol] = (meta.cancelledBySymbol[row.symbol] || 0) + 1;
    }
    if (row.explanation.includes("liquidat")) {
      meta.liquidations.push({ date: row.timeRaw.slice(0,10), symbol: row.symbol });
    }
    if (row.explanation.includes("leverage_limit_exceeded")) {
      meta.leverageEvents.push({ date: row.timeRaw.slice(0,10), symbol: row.symbol });
    }
  });

  rows.forEach((row, i) => {
    if (!row) { skipped++; return; }
    const isClose = row.status === "closed" && row.pnlRaw !== "" && parseFloat(row.pnlRaw) !== 0;
    if (!isClose) { skipped++; return; }

    const pnl = parseFloat(row.pnlRaw);
    const closeTime = parseDeltaTime(row.timeRaw);
    const date = row.timeRaw.slice(0, 10);
    const exitTimeStr = row.timeRaw.slice(11, 16);
    // You sell to close a long, buy to close a short.
    const side = row.side === "sell" ? "Long" : "Short";
    const openSideWanted = row.side === "sell" ? "buy" : "sell";

    // Look ahead (later in the file = earlier in time, since the export is newest-first)
    // for the matching opening leg: same symbol + qty, opposite side, a flat (zero P&L) closed fill.
    let openRow = null, openIdx = -1;
    for (let j = i + 1; j < Math.min(rows.length, i + 8); j++) {
      const cand = rows[j];
      if (!cand || consumed.has(j)) continue;
      if (cand.status === "closed" && cand.side === openSideWanted &&
          cand.symbol === row.symbol && cand.qty === row.qty &&
          (cand.pnlRaw === "" || parseFloat(cand.pnlRaw) === 0)) {
        openRow = cand; openIdx = j; break;
      }
    }
    if (openIdx >= 0) consumed.add(openIdx);

    const openTime = openRow ? parseDeltaTime(openRow.timeRaw) : null;
    const entryTimeStr = openRow ? openRow.timeRaw.slice(11, 16) : null;
    let durationMin = null;
    if (openTime && closeTime) durationMin = Math.abs(closeTime - openTime) / 60000;

    if (!date || isNaN(pnl)) { skipped++; return; }

    // Total round-trip fee = closing leg fee + opening leg fee (when the open leg was matched).
    const totalFees = (row.fees || 0) + (openRow ? (openRow.fees || 0) : 0);

    trades.push({
      id: Date.now() + row.li,
      date,
      time: entryTimeStr || exitTimeStr, // kept for sorting/back-compat — prefers entry time
      entryTime: entryTimeStr,
      exitTime: exitTimeStr,
      symbol: row.symbol,
      side,
      entry: openRow ? openRow.execPrice : null,
      exit: row.execPrice || null,
      size: row.qty,
      notional: row.orderValue || null,
      exitOrderType: row.orderType || null,
      fees: totalFees,
      duration: durationMin != null ? formatDuration(durationMin) : null,
      session: classifySession(entryTimeStr || exitTimeStr),
      pnl,
      setup: "",
      mistake: "None",
      notes: `Imported from Delta Exchange · fees $${totalFees.toFixed(2)}${!openRow ? ' (closing leg only — opening leg not matched)' : ''}`,
      source: "delta_import"
    });
  });

  return { trades, skipped, total: lines.length - 1, meta };
}

// ===== BKQ Insights — the deep-dive analysis, recomputed live from stored trades =====
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function computeInsights(trades, meta) {
  if (!trades.length) return null;
  const sorted = trades.slice().sort((a,b) => (a.date+(a.time||"")).localeCompare(b.date+(b.time||"")));
  const net = t => t.pnl - (t.fees || 0); // every breakdown below is fee-adjusted (net)

  const wins = sorted.filter(t => t.pnl > 0);
  const losses = sorted.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((s,t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s,t) => s + t.pnl, 0));
  const netProfitTotal = sorted.reduce((s,t) => { const n = net(t); return n > 0 ? s + n : s; }, 0);

  // Streaks
  let curWin = 0, curLoss = 0, maxWinStreak = 0, maxLossStreak = 0;
  sorted.forEach(t => {
    if (t.pnl > 0) { curWin++; curLoss = 0; } else { curLoss++; curWin = 0; }
    maxWinStreak = Math.max(maxWinStreak, curWin);
    maxLossStreak = Math.max(maxLossStreak, curLoss);
  });

  // Drawdown on the equity curve (net, fee-adjusted) — track which trade sits at the trough,
  // the peak it fell from, and every trade along the way down.
  let running = 0, peak = 0, maxDrawdown = 0;
  let peakIdx = -1, troughIdx = -1, bestPeakIdxSoFar = -1;
  sorted.forEach((t, i) => {
    running += net(t);
    if (running > peak) { peak = running; bestPeakIdxSoFar = i; }
    const dd = running - peak;
    if (dd < maxDrawdown) { maxDrawdown = dd; troughIdx = i; peakIdx = bestPeakIdxSoFar; }
  });
  let drawdownInfo = null;
  if (troughIdx > -1) {
    const peakEquity = peakIdx > -1 ? peak : 0; // equity level at the peak this drawdown fell from
    const path = sorted.slice(peakIdx + 1, troughIdx + 1); // every trade from just after the peak through the trough
    drawdownInfo = {
      amount: maxDrawdown,
      pct: peakEquity !== 0 ? (maxDrawdown / Math.abs(peakEquity) * 100) : null,
      trade: sorted[troughIdx],
      fromDate: peakIdx > -1 ? sorted[peakIdx].date : sorted[0].date,
      toDate: sorted[troughIdx].date,
      peakEquity,
      troughEquity: peakEquity + maxDrawdown,
      path
    };
  }

  const largestWin = wins.length ? Math.max(...wins.map(t => t.pnl)) : 0;
  const largestLoss = losses.length ? Math.min(...losses.map(t => t.pnl)) : 0;

  // Edge by symbol
  const bySymbol = {};
  sorted.forEach(t => {
    bySymbol[t.symbol] = bySymbol[t.symbol] || { count: 0, pnl: 0 };
    bySymbol[t.symbol].count++;
    bySymbol[t.symbol].pnl += net(t);
  });
  const symbolRows = Object.entries(bySymbol)
    .map(([symbol, v]) => ({ symbol, count: v.count, pnl: v.pnl, avg: v.pnl / v.count, pctOfNetProfit: netProfitTotal > 0 ? (v.pnl / netProfitTotal * 100) : null }))
    .sort((a,b) => b.pnl - a.pnl);

  // Exit order type (market vs limit) — only present on Delta-imported trades
  const withExitType = sorted.filter(t => t.exitOrderType);
  let exitTypeRows = null;
  if (withExitType.length) {
    const byType = {};
    withExitType.forEach(t => {
      const k = t.exitOrderType === "market_order" ? "Market" : "Limit";
      byType[k] = byType[k] || { count: 0, pnl: 0 };
      byType[k].count++;
      byType[k].pnl += net(t);
    });
    exitTypeRows = Object.entries(byType).map(([type, v]) => ({ type, count: v.count, pnl: v.pnl, avg: v.pnl / v.count }));
  }

  // Time-of-day (2-hour buckets), using logged/imported time-of-day if present
  const withTime = sorted.filter(t => t.time);
  let hourRows = null;
  if (withTime.length) {
    const buckets = {};
    withTime.forEach(t => {
      const h = parseInt(t.time.slice(0,2), 10);
      const start = Math.floor(h / 2) * 2;
      const key = `${String(start).padStart(2,"0")}:00–${String((start+2)%24).padStart(2,"0")}:00`;
      buckets[key] = buckets[key] || { count: 0, pnl: 0 };
      buckets[key].count++;
      buckets[key].pnl += net(t);
    });
    hourRows = Object.entries(buckets).map(([bucket, v]) => ({ bucket, count: v.count, pnl: v.pnl, avg: v.pnl / v.count }))
      .sort((a,b) => b.pnl - a.pnl);
  }

  // Day of week
  const dowBuckets = {};
  sorted.forEach(t => {
    const d = WEEKDAYS[new Date(t.date + "T12:00:00").getDay()];
    dowBuckets[d] = dowBuckets[d] || { count: 0, pnl: 0 };
    dowBuckets[d].count++;
    dowBuckets[d].pnl += net(t);
  });
  const dowRows = Object.entries(dowBuckets).map(([day, v]) => ({ day, count: v.count, pnl: v.pnl, avg: v.pnl / v.count }))
    .sort((a,b) => b.pnl - a.pnl);

  // Global FX session (Sydney / Asia / London / New York)
  const withSession = sorted.filter(t => t.session);
  let sessionRows = null;
  if (withSession.length) {
    const sessBuckets = {};
    withSession.forEach(t => {
      sessBuckets[t.session] = sessBuckets[t.session] || { count: 0, pnl: 0 };
      sessBuckets[t.session].count++;
      sessBuckets[t.session].pnl += net(t);
    });
    sessionRows = Object.entries(sessBuckets).map(([session, v]) => ({ session, count: v.count, pnl: v.pnl, avg: v.pnl / v.count }))
      .sort((a,b) => b.pnl - a.pnl);
  }

  // Position-size quartiles (chronological), using notional $ value if available, else raw size
  let sizingQuartiles = null, sizeEscalation = null;
  const sizeField = t => (t.notional != null ? t.notional : t.size);
  const withSize = sorted.filter(t => sizeField(t) != null);
  if (withSize.length >= 8) {
    const n = withSize.length;
    const qLen = Math.ceil(n / 4);
    sizingQuartiles = [];
    for (let i = 0; i < 4; i++) {
      const chunk = withSize.slice(i * qLen, (i + 1) * qLen);
      if (!chunk.length) continue;
      const avgSize = chunk.reduce((s,t) => s + sizeField(t), 0) / chunk.length;
      const chunkWins = chunk.filter(t => t.pnl > 0).length;
      const avgPnl = chunk.reduce((s,t) => s + net(t), 0) / chunk.length;
      sizingQuartiles.push({ label: `Q${i+1}`, avgSize, winRate: chunkWins / chunk.length * 100, avgPnl });
    }
    if (sizingQuartiles.length === 4 && sizingQuartiles[0].avgSize > 0) {
      sizeEscalation = sizingQuartiles[3].avgSize / sizingQuartiles[0].avgSize;
    }
  }

  // Fees
  const withFees = sorted.filter(t => t.fees != null);
  const totalFees = withFees.reduce((s,t) => s + t.fees, 0);
  const feeDragPct = withFees.length && grossProfit > 0 ? (totalFees / grossProfit * 100) : null;

  // Cancellations & risk events (order-level, from the CSV import meta)
  const cancelStats = meta ? {
    total: meta.cancelledOrders,
    pct: meta.totalOrders ? (meta.cancelledOrders / meta.totalOrders * 100) : null,
    bySymbol: meta.cancelledBySymbol,
    worstSymbol: Object.entries(meta.cancelledBySymbol || {}).sort((a,b) => b[1]-a[1])[0] || null,
  } : null;
  const riskEvents = meta ? [
    ...(meta.liquidations || []).map(e => ({ ...e, type: "Liquidation" })),
    ...(meta.leverageEvents || []).map(e => ({ ...e, type: "Leverage limit exceeded" })),
  ] : [];

  // ---- Recommendations (rule-based) ----
  const recs = [];
  if (sizeEscalation && sizeEscalation > 3) {
    recs.push(`Position size has grown roughly ${sizeEscalation.toFixed(1)}× from your earliest trades to your most recent — cap size as a fixed % of equity rather than letting it drift up.`);
  }
  if (riskEvents.length) {
    recs.push(`${riskEvents.length} liquidation/leverage event${riskEvents.length>1?'s':''} detected (${riskEvents.slice(0,3).map(e=>`${e.symbol} · ${e.date}`).join(', ')}) — review sizing around those dates.`);
  }
  if (exitTypeRows) {
    const market = exitTypeRows.find(r => r.type === "Market");
    const limit = exitTypeRows.find(r => r.type === "Limit");
    if (market && limit && limit.pnl < 0 && market.pnl > 0) {
      recs.push(`Limit-order exits are net negative (${fmtMoney(limit.pnl)}) while market-order exits are net positive (${fmtMoney(market.pnl)}) — a decisive market exit looks like part of your edge; hopeful limits on the way out are a leak.`);
    }
  }
  if (symbolRows.length > 1) {
    const worst = symbolRows[symbolRows.length - 1];
    if (worst.pnl < 0) recs.push(`${worst.symbol} is your worst performer at ${fmtMoney(worst.pnl)} across ${worst.count} trades — consider cutting or shrinking size on this symbol.`);
    const best = symbolRows[0];
    if (best.pctOfNetProfit && best.pctOfNetProfit > 60) recs.push(`${best.symbol} alone accounts for ${best.pctOfNetProfit.toFixed(0)}% of net profit — your edge is concentrated here, not spread evenly across symbols.`);
  }
  if (drawdownInfo && drawdownInfo.amount < 0) {
    const dt = drawdownInfo.trade;
    recs.push(`Your deepest drawdown was ${fmtMoney(drawdownInfo.amount)} net, bottoming out on the ${dt.symbol} trade closed ${dt.date}${dt.exitTime ? ' ' + dt.exitTime : ''} — from equity peak on ${drawdownInfo.fromDate} to that trade.`);
  }
  if (cancelStats && cancelStats.pct != null && cancelStats.pct > 35) {
    recs.push(`${cancelStats.pct.toFixed(0)}% of your orders are being cancelled rather than filled${cancelStats.worstSymbol ? ` (mostly ${cancelStats.worstSymbol[0]}, ${cancelStats.worstSymbol[1]} cancels)` : ''} — tighter entries would cut the re-quoting.`);
  }
  if (feeDragPct != null && feeDragPct > 15) {
    recs.push(`Fees are eating ${feeDragPct.toFixed(1)}% of gross profit — factor this into position sizing and which order type you use to exit.`);
  }
  if (hourRows && hourRows.length > 1) {
    const worstHour = hourRows[hourRows.length-1];
    if (worstHour.pnl < 0) recs.push(`Your weakest time window is ${worstHour.bucket} IST at ${fmtMoney(worstHour.pnl)} net — avoid or shrink size there.`);
  }
  if (sessionRows && sessionRows.length > 1) {
    const worstSession = sessionRows[sessionRows.length-1];
    if (worstSession.pnl < 0) recs.push(`Your weakest global session is ${worstSession.session} at ${fmtMoney(worstSession.pnl)} net across ${worstSession.count} trades — avoid or shrink size there.`);
  }
  if (!recs.length) recs.push("No major red flags detected in the current log — keep logging consistently to sharpen these insights.");

  return {
    total: sorted.length, wins: wins.length, losses: losses.length,
    winRate: sorted.length ? wins.length / sorted.length * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0),
    grossProfit, grossLoss,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    largestWin, largestLoss, maxWinStreak, maxLossStreak, maxDrawdown, drawdownInfo, netProfitTotal,
    symbolRows, exitTypeRows, hourRows, dowRows, sessionRows,
    sizingQuartiles, sizeEscalation,
    totalFees: withFees.length ? totalFees : null, feeDragPct,
    cancelStats, riskEvents, recs,
  };
}
