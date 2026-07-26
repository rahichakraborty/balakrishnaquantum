// ===== FinAI logic (rule-based over local journal data) — finance-desk assistant, separate from the site's main AI/ML hub =====

function activeTrades() {
  const trades = Store.getTrades();
  return trades.length ? trades : DEMO_TRADES;
}

const DOW_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function statsByDayOfWeek(trades) {
  const buckets = {};
  DOW_NAMES.forEach(d => buckets[d] = { pnl: 0, count: 0, wins: 0 });
  trades.forEach(t => {
    const d = DOW_NAMES[new Date(t.date + "T12:00:00").getDay()];
    buckets[d].pnl += t.pnl;
    buckets[d].count += 1;
    if (t.pnl > 0) buckets[d].wins += 1;
  });
  return buckets;
}

function bestWorstSetup(trades) {
  const bySetup = {};
  trades.forEach(t => {
    const s = t.setup || "Untagged";
    if (!bySetup[s]) bySetup[s] = { pnl: 0, count: 0, wins: 0 };
    bySetup[s].pnl += t.pnl;
    bySetup[s].count += 1;
    if (t.pnl > 0) bySetup[s].wins += 1;
  });
  const entries = Object.entries(bySetup).filter(([,v]) => v.count >= 1);
  entries.sort((a,b) => b[1].pnl - a[1].pnl);
  return { best: entries[0], worst: entries[entries.length-1], all: entries };
}

function revengeStats(trades) {
  const tagged = trades.filter(t => (t.mistake || "").toLowerCase().includes("revenge"));
  return { count: tagged.length, pct: trades.length ? (tagged.length / trades.length * 100) : 0, trades: tagged };
}

function answerQuestion(q) {
  const trades = activeTrades();
  const stats = computeStats(trades);
  const lower = q.toLowerCase();

  if (lower.includes("friday") || lower.includes("day")) {
    const buckets = statsByDayOfWeek(trades);
    const worst = Object.entries(buckets).filter(([,v]) => v.count > 0).sort((a,b) => a[1].pnl - b[1].pnl)[0];
    const best = Object.entries(buckets).filter(([,v]) => v.count > 0).sort((a,b) => b[1].pnl - a[1].pnl)[0];
    if (!worst) return "I don't have enough logged trades yet to break this down by day. Log a few trades in your journal and ask again.";
    const wr = worst[1].count ? (worst[1].wins / worst[1].count * 100).toFixed(0) : 0;
    return `Your worst day is ${worst[0]}: ${fmtMoney(worst[1].pnl)} net across ${worst[1].count} trades (${wr}% win rate). Your best day is ${best[0]} at ${fmtMoney(best[1].pnl)}. If ${worst[0]} keeps bleeding, consider sizing down or skipping it entirely — the data says your edge isn't there yet on that day.`;
  }

  if (lower.includes("setup") || lower.includes("best") || lower.includes("edge")) {
    const { best, worst } = bestWorstSetup(trades);
    if (!best) return "Log a few trades with a setup tag and I'll tell you which one is actually making you money.";
    const bestWr = (best[1].wins / best[1].count * 100).toFixed(0);
    let msg = `Your best performing setup is "${best[0]}": ${fmtMoney(best[1].pnl)} net across ${best[1].count} trades (${bestWr}% win rate).`;
    if (worst && worst[0] !== best[0]) {
      const worstWr = (worst[1].wins / worst[1].count * 100).toFixed(0);
      msg += ` Your weakest is "${worst[0]}" at ${fmtMoney(worst[1].pnl)} (${worstWr}% win rate) — worth reviewing whether it's a conditions problem or an execution problem.`;
    }
    return msg;
  }

  if (lower.includes("revenge") || lower.includes("tilt")) {
    const r = revengeStats(trades);
    if (r.count === 0) return "No revenge trades detected in your tagged history — clean discipline so far. Keep tagging honestly and I'll flag it the moment a pattern shows up.";
    const revengePnl = r.trades.reduce((s,t) => s + t.pnl, 0);
    return `Yes — ${r.count} trades (${r.pct.toFixed(0)}% of your log) are tagged as revenge trades, netting ${fmtMoney(revengePnl)}. That's a real leak. A simple rule — no new entries within 15 minutes of a loss — would likely have avoided most of these.`;
  }

  if (lower.includes("score")) {
    let tier = stats.bkqScore >= 70 ? "strong and consistent" : stats.bkqScore >= 45 ? "developing, with some leaks to fix" : "inconsistent — risk management needs attention";
    return `Your BKQ Score is ${stats.bkqScore}/100 — ${tier}. It's built from your profit factor (${stats.profitFactor.toFixed(2)}), win rate (${stats.winRate.toFixed(1)}%), and payoff ratio (avg win ${fmtMoneyPlain(stats.avgWin)} vs avg loss ${fmtMoneyPlain(stats.avgLoss)}).`;
  }

  if (lower.includes("win rate") || lower.includes("winrate")) {
    return `Your win rate across ${stats.total} logged trades is ${stats.winRate.toFixed(1)}% (${stats.wins}W / ${stats.losses}L), with a profit factor of ${stats.profitFactor.toFixed(2)}.`;
  }

  if (lower.includes("p&l") || lower.includes("pnl") || lower.includes("profit")) {
    return `Net P&L across your logged trades is ${fmtMoney(stats.netPnl)}. Average win is ${fmtMoneyPlain(stats.avgWin)}, average loss is ${fmtMoneyPlain(stats.avgLoss)}.`;
  }

  return `Here's what I see across your ${stats.total} logged trades: ${fmtMoney(stats.netPnl)} net, ${stats.winRate.toFixed(1)}% win rate, profit factor ${stats.profitFactor.toFixed(2)}, BKQ Score ${stats.bkqScore}/100. Try asking about Fridays, your best setup, revenge trading, or your BKQ Score for a deeper read.`;
}

function pushMessage(text, who) {
  const win = document.getElementById("chatWindow");
  const div = document.createElement("div");
  div.className = `msg ${who === "user" ? "msg-user" : "msg-ai"}`;
  div.textContent = text;
  win.appendChild(div);
  win.scrollTop = win.scrollHeight;
}

function askBkqAI(q) {
  pushMessage(q, "user");
  setTimeout(() => pushMessage(answerQuestion(q), "ai"), 350);
}

document.getElementById("chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("chatInput");
  if (!input.value.trim()) return;
  askBkqAI(input.value.trim());
  input.value = "";
});

document.querySelectorAll(".suggest-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const map = {
      friday: "Why do I keep losing on Fridays?",
      setup: "Show me my best performing setup.",
      revenge: "Am I revenge trading?",
      score: "What's my BKQ Score?"
    };
    askBkqAI(map[chip.dataset.q]);
  });
});

function renderAlerts() {
  const trades = activeTrades();
  const box = document.getElementById("alertsBox");
  box.innerHTML = "";
  const r = revengeStats(trades);
  const buckets = statsByDayOfWeek(trades);
  const worstDay = Object.entries(buckets).filter(([,v]) => v.count > 0).sort((a,b) => a[1].pnl - b[1].pnl)[0];
  const stats = computeStats(trades);

  const alerts = [];
  if (r.count > 0) {
    alerts.push({ level: "warn", text: `Revenge trading detected: ${r.count} trades (${r.pct.toFixed(0)}%) tagged, costing ${fmtMoney(r.trades.reduce((s,t)=>s+t.pnl,0))}.` });
  }
  if (worstDay && worstDay[1].pnl < 0) {
    alerts.push({ level: "warn", text: `${worstDay[0]}s are your weakest day: ${fmtMoney(worstDay[1].pnl)} net.` });
  }
  if (stats.profitFactor >= 1.5) {
    alerts.push({ level: "good", text: `Profit factor of ${stats.profitFactor.toFixed(2)} — your edge is holding up well.` });
  }
  if (alerts.length === 0) {
    alerts.push({ level: "good", text: "No major behavior issues detected in your current log." });
  }

  alerts.forEach(a => {
    const el = document.createElement("div");
    el.style.cssText = "padding:12px 14px;border-radius:10px;margin-bottom:10px;font-size:13px;line-height:1.4;";
    el.style.background = a.level === "warn" ? "rgba(244,63,94,.1)" : "rgba(34,197,94,.1)";
    el.style.border = `1px solid ${a.level === "warn" ? "rgba(244,63,94,.3)" : "rgba(34,197,94,.3)"}`;
    el.textContent = (a.level === "warn" ? "⚠ " : "✓ ") + a.text;
    box.appendChild(el);
  });
}

function renderAgents() {
  const trades = activeTrades();
  const box = document.getElementById("agentsBox");
  const tagged = trades.filter(t => t.setup).length;
  box.innerHTML = `
    <div class="card-flat">
      <div class="flex-between"><strong style="font-size:13px;">Sentiment Agent</strong><span class="tag">On</span></div>
      <p class="muted" style="font-size:12.5px;margin:8px 0 0;">Scans market conditions each morning before your session.</p>
    </div>
    <div class="card-flat">
      <div class="flex-between"><strong style="font-size:13px;">Auto-Tagging Agent</strong><span class="tag">On</span></div>
      <p class="muted" style="font-size:12.5px;margin:8px 0 0;">${tagged} of ${trades.length} trades auto-tagged with a setup.</p>
    </div>
    <div class="card-flat" style="opacity:.6;">
      <div class="flex-between"><strong style="font-size:13px;">Custom Agent Builder</strong><span class="tag">Coming soon</span></div>
      <p class="muted" style="font-size:12.5px;margin:8px 0 0;">Describe a rule in plain English, BKQ AI builds the agent.</p>
    </div>
  `;
}

// ===== CSV import (drop or browse) — same parser/store as the Journal page =====
const aiDropzone = document.getElementById("aiDropzone");
const aiCsvInput = document.getElementById("aiCsvInput");
const aiImportStatus = document.getElementById("aiImportStatus");

aiDropzone.addEventListener("click", () => aiCsvInput.click());
aiDropzone.addEventListener("dragover", (e) => { e.preventDefault(); aiDropzone.classList.add("dragover"); });
aiDropzone.addEventListener("dragleave", () => aiDropzone.classList.remove("dragover"));
aiDropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  aiDropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleAiCSVFile(e.dataTransfer.files[0]);
});
aiCsvInput.addEventListener("change", (e) => {
  if (e.target.files.length) handleAiCSVFile(e.target.files[0]);
});

function handleAiCSVFile(file) {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    aiImportStatus.textContent = "Please upload a .csv file.";
    aiImportStatus.style.color = "var(--red)";
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const result = parseDeltaCSV(e.target.result);
    if (!result.trades.length) {
      aiImportStatus.textContent = `No closed trades with realized P&L found in ${result.total} rows. Check the file format.`;
      aiImportStatus.style.color = "var(--red)";
      return;
    }
    Store.addTrades(result.trades);
    Store.mergeImportMeta(result.meta);
    const grossPnl = result.trades.reduce((s,t) => s + t.pnl, 0);
    const fees = result.trades.reduce((s,t) => s + (t.fees || 0), 0);
    const netPnl = grossPnl - fees;
    aiImportStatus.innerHTML = `Imported <strong>${result.trades.length}</strong> trades — net ${fmtMoney(netPnl)}. Ask me anything about them below.`;
    aiImportStatus.style.color = "var(--teal)";
    renderAlerts();
    renderAgents();
    pushMessage(`I just read in ${result.trades.length} newly imported trades (net ${fmtMoney(netPnl)}). Ask me anything about them.`, "ai");
  };
  reader.readAsText(file);
}

renderAlerts();
renderAgents();
pushMessage("Hey — I've read through your trade log. Ask me anything, or tap a suggestion below to get started.", "ai");
