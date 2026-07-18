/* BKQ Market Intelligence - renders data/market.json into the dashboard DOM */

function biasClass(biasLabel){
  if(!biasLabel) return 'neutral';
  const b = biasLabel.toLowerCase();
  if(b.includes('bear')) return 'bear';
  if(b.includes('bull')) return 'bull';
  return 'neutral';
}

function scoreColor(value){
  if(value >= 65) return 'var(--green)';
  if(value >= 40) return 'var(--gold)';
  return 'var(--red)';
}

function checklistDot(status){
  if(status === 'green') return '🟢';
  if(status === 'yellow') return '🟡';
  return '🔴';
}

function renderOverview(data){
  const o = data.overall;
  const el = document.getElementById('overview');
  const biasCls = biasClass(o.bias);
  el.innerHTML = `
    <div class="term ov-card">
      <div class="ov-label">Overall Bias</div>
      <div class="ov-value bias-${biasCls}">${o.emoji} ${o.bias}</div>
      <div class="ov-sub">Confidence ${o.confidence}%</div>
    </div>
    <div class="term ov-card">
      <div class="ov-label">Today's Trade</div>
      <div class="ov-value" style="font-size:19px;">${o.todays_trade}</div>
      <div class="ov-sub">${o.preferred_asset} preferred</div>
    </div>
    <div class="term ov-card">
      <div class="ov-label">Risk Level</div>
      <div class="ov-value" style="font-size:22px;">${o.risk_level}</div>
      <div class="ov-sub">${o.risk_note}</div>
    </div>
    <div class="term ov-card">
      <div class="ov-label">BKQ Conviction</div>
      <div class="ov-value" style="color:var(--gold-soft);">${o.conviction}%</div>
      <div class="ov-sub">Composite score</div>
    </div>`;
}

function renderAssets(data){
  const el = document.getElementById('assets');
  el.innerHTML = Object.entries(data.assets).map(([symbol, a]) => {
    const cls = biasClass(a.bias);
    return `
    <div class="term">
      <div class="term-bar"><span class="term-dot gold"></span><span class="term-dot teal"></span><span class="term-dot orange"></span><span class="term-title">${symbol.toLowerCase()}.bias</span></div>
      <div class="term-body">
        <div class="asset-head">
          <span class="asset-name">${a.name}</span>
          <span class="asset-bias ${cls}">${a.bias} · ${a.confidence}%</span>
        </div>
        <div class="conf-bar-track"><div class="conf-bar-fill" style="width:${a.confidence}%;"></div></div>
        <div class="sr-row"><span>Support</span><b>$${a.support != null ? a.support.toLocaleString() : '—'}</b></div>
        <div class="sr-row"><span>Resistance</span><b>$${a.resistance != null ? a.resistance.toLocaleString() : '—'}</b></div>
        <div class="trade-plan">${a.trade_plan}</div>
      </div>
    </div>`;
  }).join('');
}

function renderScores(data){
  const s = data.scores;
  const el = document.getElementById('scores');
  const items = [
    {label:'🌍 Macro', value:s.macro},
    {label:'💰 Flow', value:s.flow},
    {label:'📈 Technical', value:s.technical},
    {label:'⚠️ Risk', value:s.risk},
  ];
  el.innerHTML = items.map(i => `
    <div class="term score-card">
      <div class="term-body">
        <div class="score-label">${i.label}</div>
        <div class="score-value" style="color:${scoreColor(i.label.includes('Risk') ? 100 - i.value : i.value)}">${i.value}%</div>
        <div class="score-bar-track"><div class="score-bar-fill" style="width:${i.value}%; background:${scoreColor(i.label.includes('Risk') ? 100 - i.value : i.value)};"></div></div>
      </div>
    </div>`).join('');
}

function renderDrivers(data){
  const el = document.getElementById('drivers');
  if(!data.drivers || !data.drivers.length){
    el.innerHTML = '<div class="driver-row">No headlines available this run.</div>';
    return;
  }
  el.innerHTML = data.drivers.map(d => `
    <div class="driver-row"><span class="emoji">${d.emoji}</span><span>${d.text}</span></div>`).join('');
}

function renderEvents(data){
  const el = document.getElementById('events');
  el.innerHTML = data.events.map(e => `
    <div class="event-row">
      <span>
        <span class="event-label">${e.label}</span>
        ${e.note ? `<span class="event-note">${e.note}</span>` : ''}
      </span>
      <span class="event-when">${e.when}</span>
    </div>`).join('');
}

function renderChecklist(data){
  const el = document.getElementById('checklist');
  el.innerHTML = Object.entries(data.checklist).map(([label, status]) => `
    <div class="check-item">
      <div class="check-label">${label}</div>
      <div class="check-dot">${checklistDot(status)}</div>
    </div>`).join('');
}

function renderUpdated(data){
  document.getElementById('updated-date').textContent = data.last_updated.date;
  document.getElementById('updated-time').textContent = data.last_updated.time;

  // Flag if the data is more than 36 hours stale (engine likely didn't run)
  try{
    const iso = new Date(data.last_updated.iso);
    const ageHours = (Date.now() - iso.getTime()) / 36e5;
    if(ageHours > 36){
      document.getElementById('stale-banner').classList.add('show');
    }
  }catch(e){}
}

async function loadMarketData(){
  try{
    const res = await fetch('data/market.json', {cache:'no-store'});
    if(!res.ok) throw new Error('market.json fetch failed: ' + res.status);
    const data = await res.json();
    renderOverview(data);
    renderAssets(data);
    renderScores(data);
    renderDrivers(data);
    renderEvents(data);
    renderChecklist(data);
    renderUpdated(data);
  }catch(e){
    console.error('[market.js] failed to load market.json', e);
    document.getElementById('overview').innerHTML =
      '<div class="term ov-card" style="grid-column:1/-1;">Could not load market data. The daily engine may not have run yet — check the GitHub Actions tab.</div>';
  }
}

loadMarketData();
