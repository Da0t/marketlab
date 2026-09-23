const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(cents / 100);
const number = n => new Intl.NumberFormat('en-US').format(n);
const uid = prefix => `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
const time = stamp => new Date(stamp).toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
const page = 'market';
let market, execution, busy = false, playing = false, timer, toastTimer;
let pendingOrder = null;
let publicDemo = false;
const sandboxSessions = {};
let formDraft = {side:'buy',type:'market',quantity:'50',limit:'100.00'};

function sandbox(project) {
  if (!sandboxSessions[project]) {
    try { sandboxSessions[project] = JSON.parse(sessionStorage.getItem('fintech-demo-v1-'+project)); } catch (_) { /* Storage is optional. */ }
    if (!sandboxSessions[project]) sandboxSessions[project] = {version:1,started_at:new Date().toISOString(),history:[]};
  }
  return sandboxSessions[project];
}

async function api(path, body) {
  const project = 'market';
  const target = publicDemo ? '/api/demo' : path;
  const requestBody = publicDemo ? {path,body:body ?? null,session:sandbox(project)} : body;
  const response = await fetch(target, {method: requestBody === undefined ? 'GET' : 'POST', headers:{'Content-Type':'application/json'}, ...(requestBody === undefined ? {} : {body:JSON.stringify(requestBody)})});
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Invalid input. Check the amounts and identifiers.');
  if (publicDemo) {
    sandboxSessions[project] = result.session;
    try { sessionStorage.setItem('fintech-demo-v1-'+project, JSON.stringify(result.session)); } catch (_) { /* In-memory sandbox still works. */ }
    return result.value;
  }
  return result;
}
function toast(message, error=false) {
  clearTimeout(toastTimer);
  const element = $('#toast'); element.textContent = message; element.hidden = false; element.classList.toggle('error', error);
  toastTimer = setTimeout(() => element.hidden = true, error ? 9000 : 6500);
}
function dollars(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Enter a positive dollar amount with at most two decimal places.');
  const [whole, fraction=''] = String(value).split('.');
  const cents = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Amount must be positive.');
  return cents;
}
async function action(work) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await work(); }
  catch (error) { toast(error.message, true); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
async function load() { market = await api('/api/market/state'); render(); }
function render() {
 document.title = 'MarketLab';
 $('#main').innerHTML = renderMarket();
}
function stat(label, value, foot, featured=false) {
  return `<div class="stat ${featured?'featured':''}"><div class="label">${label}<span>↗</span></div><div class="value">${value}</div><div class="stat-foot">${foot}</div></div>`;
}
function badge(label, tone='') { return `<span class="badge ${tone}">${esc(label)}</span>`; }
function checks(data, descriptions) {
  return `<div class="health-list">${Object.entries(descriptions).map(([key, [label, sub]]) => `<div class="health-row"><span class="check ${data[key]?'':'fail'}">${data[key]?'✓':'!'}</span><div><strong>${label}</strong><small>${sub}</small></div><span class="mono ${data[key]?'green':'red'}">${data[key]?'PASS':'FAIL'}</span></div>`).join('')}</div>`;
}
function timeline(rows) {
  return rows.length ? `<div class="timeline">${rows.map(r => `<div class="timeline-item"><span class="timeline-marker"></span><div><strong>${esc(r.action || r.type)}</strong><p>${esc(r.detail)}</p><small>${r.created_at ? time(r.created_at) : 'TICK '+r.tick}${r.reference?' · '+esc(r.reference):''}</small></div></div>`).join('')}</div>` : '<div class="empty">Your next action starts the story.</div>';
}

function chart(prices) {
  const data=prices.slice(-100), w=740,h=172,p=8;
  const low=Math.min(...data.map(d=>d.price))-8, high=Math.max(...data.map(d=>d.price))+8;
  const points=data.map((d,i)=>`${p+(data.length===1?0:i/(data.length-1))*(w-2*p)},${h-p-(d.price-low)/(high-low)*(h-2*p)}`);
  if (points.length===1) points.push(`${w-p},${points[0].split(',')[1]}`);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Synthetic reference price history. Current price ${money(prices.at(-1).price)}"><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#8bbcff" stop-opacity=".16"/><stop offset="100%" stop-color="#8bbcff" stop-opacity="0"/></linearGradient></defs>${[.15,.5,.85].map(y=>`<line x1="0" y1="${h*y}" x2="${w}" y2="${h*y}" stroke="#26354b" stroke-dasharray="3 5"/>`).join('')}<polygon points="${p},${h} ${points.join(' ')} ${w-p},${h}" fill="url(#area)"/><polyline points="${points.join(' ')}" fill="none" stroke="#8bbcff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="chart-labels"><span>TICK ${data[0].tick}</span><span>${data.length===1?'Press play to generate the session':'SYNTHETIC REFERENCE PRICE · USD'}</span><span>TICK ${data.at(-1).tick}</span></div>`;
}
function depth(rows, side) {
  const max=Math.max(...rows.map(r=>r.quantity),1);
  return `<div><div class="depth-header"><span>${side==='bid'?'BID':'ASK'} (USD)</span><span>QTY</span></div>${rows.length?rows.slice(0,10).map(r=>`<div class="depth-row ${side}" style="--depth:${r.quantity/max*95}%"><span class="${side==='bid'?'green':'orange'}">${money(r.price)}${r.user_quantity?' •':''}</span><span>${number(r.quantity)}</span></div>`).join(''):'<div class="empty">No liquidity</div>'}</div>`;
}
function executionDetails() {
  if(!execution || execution.duplicate) return '<div class="execution-empty">Place an order to see its fills, execution price, and fees.</div>';
  const fills=execution.fills || [], qty=fills.reduce((sum,f)=>sum+f.quantity,0), total=fills.reduce((sum,f)=>sum+f.quantity*f.price,0), fee=fills.reduce((sum,f)=>sum+f.fee,0);
  if(!qty) return `<div class="execution-empty">No immediate fills. ${execution.unfilled} shares ${formDraft.type==='limit'?'remain on the book at your limit price':'were cancelled because there was no liquidity'}.</div>`;
  const side=fills[0].side, sign=side==='buy'?1:-1, avg=total/qty;
  const spread=execution.reference_mid===null || execution.reference_best===null ? null : sign*(execution.reference_best-execution.reference_mid)*qty;
  const impact=execution.reference_best===null ? null : sign*(avg-execution.reference_best)*qty;
  return `<div class="explanation"><div class="row"><span class="muted">Order</span><span class="mono">${esc(execution.order_id)}</span></div><div class="row"><span>Filled / requested</span><span class="mono">${qty} / ${execution.requested}</span></div><div class="row"><span>Average execution</span><span class="amount">${money(avg)}</span></div><div class="row"><span>Spread cost vs. arrival midpoint</span><span class="amount">${spread===null?'N/A':money(spread)}</span></div><div class="row"><span>Book depth impact vs. best quote</span><span class="amount">${impact===null?'N/A':money(impact)}</span></div><div class="row"><span>Fees · 10 bps, rounded per fill</span><span class="amount">${money(fee)}</span></div><div class="row total"><span>${side==='buy'?'Total paid':'Net proceeds'}</span><span class="amount">${money(total+(side==='buy'?fee:-fee))}</span></div></div><p class="muted" style="font-size:10px;margin-bottom:0">Breakdown is for immediate fills at submission. Later fills on resting orders appear in the tape below.</p>`;
}
function renderMarket() {
  const s=market.state;
  return `<div class="page-header"><div><div class="tag">MARKET MICROSTRUCTURE</div><h1>The price is only <span>the beginning.</span></h1><p class="subtitle">Replay a market. Place a paper order. Follow every fill from the order book to your balance.</p></div><div class="header-actions"><button data-action="replay">↶ Verify replay</button><button data-action="feed" class="${s.connected?'':'primary'}">${s.connected?'Disconnect feed':'Reconnect feed'}</button></div></div>
  <div class="intro-strip"><div><strong>Same order. Different market.</strong> <span>Try a 50-share market buy in both liquidity modes and compare execution costs.</span></div><span class="mono">NOVA · SYNTHETIC INSTRUMENT</span></div>
  <section class="stats" aria-label="Trading metrics">${stat('Reference price',money(s.mid),`NOVA · tick ${s.tick}`,true)}${stat('Available buying power',money(s.available_cash),`${money(s.reserved_cash)} reserved`)}${stat('Position',number(s.position)+' <span style="font-size:15px;letter-spacing:0">shares</span>',`${s.available_position} available to sell`)}${stat('Execution fees',money(s.fees),`${s.fills.length} fills · 10 basis points`)}</section>
  <div class="market-grid"><div class="market-left"><section class="panel"><div class="panel-header"><div><h2>Session replay</h2><small>A deterministic synthetic market, advanced one tick at a time</small></div><div class="controls"><button class="compact ${playing?'accent':'primary'}" data-action="play">${playing?'Ⅱ Pause':'▶ Play'}</button><button class="compact" data-action="step">+ 10 ticks</button></div></div><div class="chart-area"><div class="chart-meta"><span>${s.connected?'<span class="status-dot"></span>Feed connected':'<span class="orange">Feed disconnected · order entry blocked</span>'}</span><span class="mono">BOOK SNAPSHOT: T${s.feed_tick}</span></div>${chart(s.prices)}</div><div class="panel-footer row"><span>Simulation clock · no live market connection</span><span>${market.commands} accepted commands</span></div></section>
  <section class="panel"><div class="panel-header"><div><h2 id="order-book">Order book</h2><small>Price / time priority · dots identify your resting liquidity</small></div><div class="tabs" aria-label="Liquidity mode"><button class="${s.liquidity==='liquid'?'selected':''}" data-action="liquidity" data-mode="liquid">Liquid</button><button class="${s.liquidity==='thin'?'selected':''}" data-action="liquidity" data-mode="thin">Thin</button></div></div><div class="depth-grid">${depth(s.bids,'bid')}${depth(s.asks,'ask')}</div><div class="panel-footer">Changing liquidity starts a fresh paper session, including balances and orders.</div></section>
  <section class="panel"><div class="panel-header"><h2>Open orders</h2><span class="metric-inline">${s.orders.length} RESTING</span></div>${s.orders.length?`<div class="table-wrap"><table><thead><tr><th>ORDER</th><th>SIDE</th><th>LIMIT</th><th>REMAINING</th><th></th></tr></thead><tbody>${s.orders.map(o=>`<tr><td class="mono">${esc(o.id)}</td><td>${badge(o.side,o.side==='buy'?'good':'warn')}</td><td class="amount">${money(o.price)}</td><td class="mono">${o.remaining}</td><td><button class="compact" data-action="cancel" data-id="${esc(o.id)}">Cancel</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No resting orders.<span>Submit a limit order away from the market to reserve buying power.</span></div>'}</section></div>
  <div class="market-left"><section class="panel"><div class="panel-header"><h2>Order ticket</h2>${badge('PAPER ONLY')}</div><div class="panel-body"><form class="order-form" id="order-form"><div class="fields-two"><div class="field"><label for="side">Side</label><select id="side" name="side"><option value="buy" ${formDraft.side==='buy'?'selected':''}>Buy</option><option value="sell" ${formDraft.side==='sell'?'selected':''}>Sell</option></select></div><div class="field"><label for="type">Order type</label><select id="type" name="type"><option value="market" ${formDraft.type==='market'?'selected':''}>Market</option><option value="limit" ${formDraft.type==='limit'?'selected':''}>Limit</option></select></div></div><div class="fields-two"><div class="field"><label for="quantity">Quantity (shares)</label><input id="quantity" name="quantity" type="number" min="1" max="10000" step="1" required value="${esc(formDraft.quantity)}"></div><div class="field" id="limit-field" ${formDraft.type==='market'?'hidden':''}><label for="limit">Limit price (USD)</label><input id="limit" name="limit" inputmode="decimal" value="${esc(formDraft.limit)}"></div></div><button class="primary" type="submit">Submit paper order →</button><div class="order-note">Whole shares · no leverage or short selling. Unfilled market quantity is cancelled. Limit orders reserve funds until filled or cancelled.</div></form></div></section>
  <section class="panel"><div class="panel-header"><h2>Why this execution price?</h2><span class="code-pill">FILL ANALYSIS</span></div><div class="panel-body">${executionDetails()}</div></section>
  <section class="panel"><div class="panel-header"><h2>Engine integrity</h2><span class="code-pill">JAVA</span></div><div class="panel-body">${checks(s.checks,{cash_reconciled:['Cash reconciled','Balance matches every fill and fee'],position_reconciled:['Position reconciled','Holdings match executed quantities'],nonnegative_buying_power:['Buying power protected','Open orders reserve sufficient funds'],no_overselling:['No overselling','Sell orders reserve available shares'],uncrossed_book:['Uncrossed book','Best bid remains below best ask']})}</div></section></div></div>
  <div class="section-grid"><section class="panel"><div class="panel-header"><div><h2 id="execution-tape">Execution tape</h2><small>Actual simulated fills from the Java matching engine</small></div><span class="metric-inline">LATEST 20</span></div>${s.fills.length?`<div class="table-wrap"><table><thead><tr><th>TICK / ORDER</th><th>SIDE</th><th class="right">QTY</th><th class="right">PRICE</th><th class="right">FEE</th></tr></thead><tbody>${s.fills.slice(-20).reverse().map(f=>`<tr><td class="mono">T${f.tick} · ${esc(f.order_id)}<br><small class="muted">${f.liquidity}</small></td><td>${badge(f.side,f.side==='buy'?'good':'warn')}</td><td class="right mono">${f.quantity}</td><td class="right amount">${money(f.price)}</td><td class="right amount">${money(f.fee)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">The tape is clear.<span>Submit your first paper order to see its individual fills.</span></div>'}</section><section class="panel"><div class="panel-header"><h2>Session events</h2><span class="metric-inline">LATEST ACTIVITY</span></div><div class="panel-body">${timeline(s.events.slice(-12).reverse())}</div></section></div>`;
}

function stop() { playing=false; clearTimeout(timer); }
async function playTick() {
  if(!playing || page!=='market') return;
  if(busy || $('#order-form')?.contains(document.activeElement)) { timer=setTimeout(playTick,500); return; }
  busy=true;
  try { market=await api('/api/market/step',{ticks:1}); render(); }
  catch(error) { stop(); toast(error.message,true); render(); }
  finally { busy=false; }
  if(playing) timer=setTimeout(playTick,500);
}

document.addEventListener('click', async event => {
  const button=event.target.closest('[data-action]');
  if(!button) {
    return;
  }
  const a=button.dataset.action, id=button.dataset.id;
  await action(async () => {
    if(a==='new-session') {
      stop(); sandboxSessions[page]={version:1,started_at:new Date().toISOString(),history:[]};
      try { sessionStorage.removeItem('fintech-demo-v1-'+page); } catch (_) {}
      execution=null; pendingOrder=null;
      await load(); toast('New sandbox ready. Only this tab’s session was reset.');
    }
    if(a==='step') { market=await api('/api/market/step',{ticks:10}); render(); }
    if(a==='play') { if(playing) stop(); else { playing=true; timer=setTimeout(playTick,500); } render(); }
    if(a==='replay') { stop(); market=await api('/api/market/replay',{}); render(); toast(`Replay verified: ${market.result.commands_replayed} commands rebuilt an identical state.`); }
    if(a==='feed') { const name=market.state.connected?'disconnect':'reconnect'; market=await api('/api/market/feed/'+name,{}); render(); toast(name==='disconnect'?'Feed paused. Advance ticks to create a gap, then reconnect.':`Feed recovered with a fresh snapshot. ${market.result.gap} missed ticks.`); }
    if(a==='liquidity') { stop(); market=await api('/api/market/reset',{liquidity:button.dataset.mode}); execution=null; pendingOrder=null; render(); toast('Fresh '+button.dataset.mode+' session. Cash and position reset.'); }
    if(a==='cancel') { market=await api(`/api/market/orders/${encodeURIComponent(id)}/cancel`,{}); render(); toast('Order cancelled. Remaining reservation released.'); }
  });
});
document.addEventListener('input', event => {
  if(event.target.closest('#order-form')) formDraft[event.target.name]=event.target.value;
});
document.addEventListener('change', event => {
  if(event.target.closest('#order-form')) {
    formDraft[event.target.name]=event.target.value;
    if(event.target.name==='type') $('#limit-field').hidden=event.target.value==='market';
  }
});
document.addEventListener('submit', event => {
  if(event.target.id==='order-form') {
    event.preventDefault();
    action(async () => {
      stop();
      const quantity=Number(formDraft.quantity);
      if(!Number.isInteger(quantity) || quantity<=0) throw new Error('Quantity must be a positive whole number.');
      const payload={side:formDraft.side,type:formDraft.type,quantity,limit:formDraft.type==='limit'?dollars(formDraft.limit):10000};
      const fingerprint=JSON.stringify(payload);
      if(!pendingOrder || pendingOrder.fingerprint!==fingerprint) pendingOrder={fingerprint,body:{id:uid('order'),...payload}};
      // A retry after a lost response retains the economic order's identity.
      market=await api('/api/market/orders',pendingOrder.body);
      pendingOrder=null;
      execution=market.result; render();
      toast(execution.duplicate?'Original order confirmed. The retry did not execute another trade.':`Order accepted. ${execution.filled} of ${execution.requested} shares filled immediately.`);
    });
  }
});
async function initialize() {
  const config=await fetch('/api/config').then(r=>r.json());
  publicDemo=config.public_demo;
  if (publicDemo) {
    $('#new-session').hidden=false;
    $('.sidebar-bottom').innerHTML='<span class="status-dot"></span>Your demo session<small>Synthetic funds · isolated to this tab</small>';
    $('.sandbox-label').textContent='PUBLIC SANDBOX';
    $('footer span').textContent='Synthetic USD · session saved in this tab';
  }
  await load();
}
initialize().catch(error => { $('#main').innerHTML='<div class="loading">Unable to load the demo. Please reload or start a new session.</div>'; toast(error.message,true); });
