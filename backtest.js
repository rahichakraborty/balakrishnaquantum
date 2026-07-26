// ===== Backtesting engine (simulated, deterministic per input) =====
let btChart;

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function mulberry32(seed) {
  return function() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Very small "keyword scan" so the described strategy nudges the simulated edge,
// mimicking how BKQ AI parses plain-English rules into structured logic.
function parseStrategy(text) {
  const t = text.toLowerCase();
  let edgeBias = 0; // -1..1, shifts win rate / payoff
  const rules = [];

  if (t.includes("atr")) { rules.push("ATR-based stop distance"); edgeBias += 0.05; }
  if (t.includes("retest") || t.includes("break")) { rules.push("Break & retest confirmation entry"); edgeBias += 0.08; }
  if (t.includes("vwap")) { rules.push("VWAP reclaim / rejection logic"); edgeBias += 0.04; }
  if (t.includes("2:1") || t.includes("2r") || t.includes("reward")) { rules.push("Defined reward-to-risk target"); edgeBias += 0.06; }
  if (t.includes("news") || t.includes("fed") || t.includes("cpi")) { rules.push("Avoids high-impact news windows"); edgeBias += 0.05; }
  if (t.includes("revenge") || t.includes("no stop") || t.includes("martingale")) { edgeBias -= 0.25; }
  if (rules.length === 0) rules.push("General trend-following entry with fixed stop/target");

  return { rules, edgeBias: Math.max(-0.3, Math.min(0.3, edgeBias)) };
}

function runBacktest(cfg) {
  const seedStr = `${cfg.symbol}|${cfg.timeframe}|${cfg.balance}|${cfg.session}|${cfg.logic}`;
  const rng = mulberry32(hashString(seedStr));
  const parsed = parseStrategy(cfg.logic);

  const numTrades = 60 + Math.floor(rng() * 80); // 60-140 trades
  const baseWinRate = 0.42 + parsed.edgeBias; // baseline near coin-flip, nudged by parsed rules
  const avgRisk = cfg.balance * (0.005 + rng() * 0.01); // 0.5%-1.5% risk per trade
  const payoffRatio = 1.3 + parsed.edgeBias * 2 + rng() * 0.6; // reward:risk realized

  let balance = cfg.balance;
  let peak = balance;
  let maxDD = 0;
  const trades = [];
  let day = new Date();
  day.setDate(day.getDate() - numTrades * 1.6);

  let wins = 0, losses = 0, grossProfit = 0, grossLoss = 0;
  let longWins=0, longCount=0, shortWins=0, shortCount=0;

  for (let i = 0; i < numTrades; i++) {
    day = new Date(day.getTime() + (1 + Math.floor(rng()*2)) * 86400000);
    const isWin = rng() < baseWinRate;
    const side = rng() > 0.5 ? "Long" : "Short";
    side === "Long" ? longCount++ : shortCount++;

    const variance = 0.6 + rng() * 0.8;
    const pnl = isWin ? Math.round(avgRisk * payoffRatio * variance) : -Math.round(avgRisk * variance);

    if (isWin) { wins++; grossProfit += pnl; if (side==="Long") longWins++; else shortWins++; }
    else { losses++; grossLoss += Math.abs(pnl); }

    balance += pnl;
    peak = Math.max(peak, balance);
    maxDD = Math.max(maxDD, (peak - balance) / peak * 100);

    trades.push({
      n: i + 1,
      date: day.toISOString().slice(0,10),
      side,
      pnl,
      balance: Math.round(balance),
    });
  }

  const netPnl = balance - cfg.balance;
  const winRate = (wins / numTrades) * 100;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 99;
  const avgWin = wins ? grossProfit / wins : 0;
  const avgLoss = losses ? grossLoss / losses : 0;

  return {
    cfg, parsed, trades, numTrades, winRate, profitFactor, netPnl, maxDD,
    avgWin, avgLoss, longWins, longCount, shortWins, shortCount, wins, losses
  };
}

function verdictText(r) {
  const payoff = r.avgLoss > 0 ? (r.avgWin / r.avgLoss) : 0;
  let lines = [];

  if (r.profitFactor >= 1.5 && r.winRate >= 50) {
    lines.push(`Solid edge. Profit factor of ${r.profitFactor.toFixed(2)} with a ${r.winRate.toFixed(1)}% win rate is a healthy combination — you're winning often and your winners are sized well.`);
  } else if (r.profitFactor >= 1.0) {
    lines.push(`Marginally profitable. The edge is real, but thin — profit factor sits at ${r.profitFactor.toFixed(2)}.`);
    if (payoff > 1.3) {
      lines.push(`You're winning on payoff, not hit rate: avg win runs ${payoff.toFixed(1)}× avg loss against a ${r.winRate.toFixed(1)}% win rate.`);
    }
  } else {
    lines.push(`Not profitable as described. Profit factor of ${r.profitFactor.toFixed(2)} means gross losses outweigh gross profit — refine entries or tighten the stop before risking real capital.`);
  }

  if (r.maxDD > 20) {
    lines.push(`Max drawdown of ${r.maxDD.toFixed(1)}% is steep for a ${r.cfg.balance.toLocaleString()} account — consider reducing size or adding a daily loss limit.`);
  }
  const longWR = r.longCount ? (r.longWins/r.longCount*100) : 0;
  const shortWR = r.shortCount ? (r.shortWins/r.shortCount*100) : 0;
  if (Math.abs(longWR - shortWR) > 15) {
    const better = longWR > shortWR ? "longs" : "shorts";
    lines.push(`Directional skew detected: ${better} outperform meaningfully (${Math.max(longWR,shortWR).toFixed(0)}% vs ${Math.min(longWR,shortWR).toFixed(0)}% win rate) — consider filtering out the weaker side.`);
  }

  return lines.join(" ");
}

function edgeGrade(r) {
  const score = (Math.min(r.profitFactor,2)/2*40) + (Math.min(r.winRate,70)/70*30) + (Math.max(0,(30-r.maxDD))/30*30);
  if (score >= 80) return "A";
  if (score >= 65) return "B+";
  if (score >= 50) return "B";
  if (score >= 35) return "C";
  return "D";
}

function renderResults(r) {
  document.getElementById("placeholder").style.display = "none";
  const results = document.getElementById("results");
  results.style.display = "block";

  document.getElementById("resultTitle").textContent = `${r.cfg.symbol} · ${r.parsed.rules[0]}`;
  document.getElementById("resultMeta").textContent = `${r.cfg.timeframe} · ${r.numTrades} trades · grade ${edgeGrade(r)}`;

  document.getElementById("r-pnl").textContent = fmtMoney(r.netPnl);
  document.getElementById("r-pnl").className = "stat-value " + (r.netPnl >= 0 ? "up" : "down");
  document.getElementById("r-wr").textContent = `${r.winRate.toFixed(1)}%`;
  document.getElementById("r-pf").textContent = r.profitFactor.toFixed(2);
  document.getElementById("r-dd").textContent = `-${r.maxDD.toFixed(1)}%`;
  document.getElementById("r-dd").className = "stat-value down";

  document.getElementById("r-verdict").textContent = verdictText(r);
  document.getElementById("r-tradecount").textContent = `${r.numTrades} trades · showing all`;

  // chart
  const labels = r.trades.map(t => t.date);
  const data = r.trades.map(t => t.balance);
  const ctx = document.getElementById("btChart");
  const chartData = {
    labels,
    datasets: [{
      label: "Equity",
      data,
      borderColor: r.netPnl >= 0 ? "#22c55e" : "#f43f5e",
      backgroundColor: r.netPnl >= 0 ? "rgba(34,197,94,.12)" : "rgba(244,63,94,.12)",
      fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2,
    }]
  };
  if (btChart) { btChart.data = chartData; btChart.update(); }
  else {
    btChart = new Chart(ctx, {
      type: "line",
      data: chartData,
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#676d92", maxTicksLimit: 6 }, grid: { color: "#232847" } },
          y: { ticks: { color: "#676d92" }, grid: { color: "#232847" } }
        }
      }
    });
  }

  // table
  const tbody = document.getElementById("btTableBody");
  tbody.innerHTML = "";
  r.trades.slice().reverse().slice(0, 200).forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.n}</td><td>${t.date}</td><td>${t.side}</td>
      <td class="${t.pnl >= 0 ? 'up' : 'down'}">${fmtMoney(t.pnl)}</td>
      <td>${fmtMoneyPlain(t.balance)}</td>`;
    tbody.appendChild(tr);
  });

  Store.saveBacktest({
    date: new Date().toISOString(),
    symbol: r.cfg.symbol, netPnl: r.netPnl, winRate: r.winRate, profitFactor: r.profitFactor
  });
}

document.getElementById("btForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const cfg = {
    symbol: document.getElementById("bt-symbol").value,
    timeframe: document.getElementById("bt-timeframe").value,
    balance: parseInt(document.getElementById("bt-balance").value, 10),
    session: document.getElementById("bt-session").value,
    logic: document.getElementById("bt-logic").value,
  };
  const result = runBacktest(cfg);
  renderResults(result);
  document.getElementById("results").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelectorAll(".suggest-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const templates = {
      "Break & Retest": "Trade the break and retest of the previous day's high and low. Go long when price breaks above the prior high, pulls back, and prints a bullish candle. Stop: 1.5x ATR. Target: 2:1 reward-to-risk.",
      "Opening Range Breakout": "Backtest the opening range breakout on the first 15 minutes of the IST session. Enter on a break of the opening range high or low with volume confirmation. Stop below/above the range. Target 2R.",
      "VWAP Reclaim": "Enter long when price reclaims VWAP after being below it for at least 10 minutes, with a bullish candle close above VWAP. Stop below the recent swing low. Target 2:1 reward-to-risk.",
      "Pullback 21 EMA": "Arm when price trends above the 21 EMA with rising ADX. Trigger on a rejection candle at the 21 EMA with volume confirmation. Stop below the rejection low. Target 2:1 reward-to-risk.",
      "Bollinger Squeeze Scalp": "EMA/RSI/ADX confluence with a Bollinger Band squeeze breakout. Enter on the breakout candle with volume expansion. Stop at the squeeze midline. Two-tranche exit with the remainder trailed by ATR."
    };
    document.getElementById("bt-logic").value = templates[chip.dataset.t];
  });
});
