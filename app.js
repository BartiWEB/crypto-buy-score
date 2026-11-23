import {COINS, scoreAll, plan, backtest, cycles, windowChanges, monthly, fmtUsd, fmtPln, fmtBoth, bucket, zone, ZONES, TP_LADDER, GROUPS} from './score.js';
import {fetchMarkets, fetchChart, fetchFng, fetchFngHistory, fetchOnchain, fetchStables, fetchFunding, fetchUsdPln, nbpRateBefore} from './api.js';
import {ASSETS, holdings, pit, toCsv, fromCsv, toPln, TAX} from './portfolio.js';

const COLOR = {violet: 'var(--violet)', red: 'var(--red)', slate: 'var(--slate)', amber: 'var(--amber)', green: 'var(--green)'};
const CYCLE_COLOR = {'2012': 'var(--violet)', '2016': 'var(--amber)', '2020': 'var(--green)', '2024': 'var(--cyan)'};
const $ = (id) => document.getElementById(id);
const num = (v, d = 0) => Number(v).toLocaleString('pl-PL', {minimumFractionDigits: d, maximumFractionDigits: d});
const pct = (v) => { v = Math.round(Number(v) * 10) / 10 || 0; return (v > 0 ? '+' : '') + num(v, Math.abs(v) < 10 ? 1 : 0) + '%'; };
const xmult = (m) => num(m, m % 1 ? 1 : 0) + '×';
const today = () => new Date().toISOString().slice(0, 10);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* brak zapisu */ } }
};

const state = {coin: store.get('coin', 'BTC'), range: store.get('range', 7), hist: null, charts: {}, prices: null, fng: null, series: {}, scores: {},
  cm: {}, fngHist: [], stables: [], funding: {}, fx: store.get('fx', null), txs: store.get('txs', []), bt: {}};
const fx = () => state.fx?.rate || null;
const both = (usd) => fmtBoth(usd, fx());
const HOUR = 3600e3, DAYMS = 864e5;

function status(text, kind) { $('status').textContent = text; $('status-dot').className = 'dot ' + (kind || ''); }

// ---------- dane ----------
async function loadHistory() {
  const r = await fetch('data/history.json');
  state.hist = (await r.json()).coins;
}
// Wykresy dzienne (365 dni) trzymane na urządzeniu przez godzinę, żeby nie wyczerpać limitu CoinGecko.
async function loadCharts(force) {
  const cached = store.get('charts', null);
  if (cached) state.charts = cached.data;
  if (!force && cached && Date.now() - cached.at < HOUR) return;
  for (const c of COINS) {
    try { state.charts[c.sym] = await fetchChart(c.id); } catch { /* zostają dane z pamięci */ }
  }
  store.set('charts', {at: Date.now(), data: state.charts});
}
// Dane wolnozmienne trzymane na urządzeniu: on-chain i historia F&G co 6 h, funding co godzinę, kurs NBP co 6 h.
async function cached(key, maxAge, fn) {
  const c = store.get(key, null);
  if (c && Date.now() - c.at < maxAge) return c.data;
  try { const data = await fn(); store.set(key, {at: Date.now(), data}); return data; } catch (e) { if (c) return c.data; throw e; }
}
async function loadSlow() {
  const start = state.hist.BTC.cal.date;
  const jobs = {
    cm: cached('onchain', 6 * HOUR, () => fetchOnchain(['btc', 'eth', 'ada'], start)),
    fngHist: cached('fngHist', 6 * HOUR, fetchFngHistory),
    stables: cached('stables', 12 * HOUR, fetchStables),
    funding: cached('funding', HOUR, async () => {
      const out = {};
      for (const s of ['BTC', 'ETH', 'ADA']) { try { out[s] = await fetchFunding(s); } catch { /* brak dla tej monety */ } }
      return out;
    }),
    fx: cached('fx2', 6 * HOUR, fetchUsdPln)
  };
  for (const [k, p] of Object.entries(jobs)) {
    try { const v = await p; if (v) state[k] = v; } catch { /* zostaje to, co było */ }
  }
  if (state.fx) store.set('fx', state.fx);
}
async function loadLive() {
  const [p, f] = await Promise.allSettled([fetchMarkets(COINS.map((c) => c.id)), fetchFng()]);
  if (p.status === 'fulfilled') { state.prices = p.value; state.pricesAt = Date.now(); store.set('prices', {at: state.pricesAt, data: p.value}); }
  if (f.status === 'fulfilled') { state.fng = f.value; store.set('fng', f.value); }
  if (p.status === 'rejected') throw p.reason;
}
// Dane wykresu ceny: 24h i 7 dni z godzinowego sparkline, 30 dni–1 rok z wykresu dziennego, lata z historii.
function rangeData() {
  const sym = state.coin, days = state.range, id = COINS.find((c) => c.sym === sym).id, from = Date.now() - days * DAYMS;
  const live = state.prices?.[id];
  let data;
  if (days <= 7 && live?.spark?.length) data = live.spark.filter((r) => r.t >= from);
  else if (days <= 365 && state.charts[sym]?.length) data = state.charts[sym].map((r) => ({t: Date.parse(r.date), price: r.price})).filter((r) => r.t >= from);
  else data = (state.series[sym] || []).map((r) => ({t: Date.parse(r.date), price: r.price})).filter((r) => r.t >= from);
  if (live?.usd && data.length) data.push({t: Math.max(Date.now(), data[data.length - 1].t + 1), price: live.usd});
  return data;
}
function showRange() {
  document.querySelectorAll('.rbtn').forEach((b) => b.classList.toggle('on', +b.dataset.days === state.range));
  drawPrice();
}

function compute() {
  const prices = {};
  for (const c of COINS) { const p = state.prices?.[c.id]?.usd; if (p) prices[c.sym] = p; }
  const res = scoreAll({hist: state.hist, cm: state.cm, charts: state.charts, prices, fng: state.fngHist, stables: state.stables, funding: state.funding, today: today()});
  for (const c of COINS) {
    state.series[c.sym] = res[c.sym].series;
    state.scores[c.sym] = {...res[c.sym], chg: state.prices?.[c.id]?.usd_24h_change};
    state.bt[c.sym] = backtest(res[c.sym].series, {sym: c.sym, gold: c.gold});
  }
}

// ---------- widok ----------
function render() {
  const sym = state.coin, s = state.scores[sym], coin = COINS.find((c) => c.sym === sym);
  document.querySelectorAll('.tab').forEach((t) => { const on = t.dataset.coin === sym; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
  drawGauge(s, sym);
  $('t-mult').textContent = xmult(s.mult);
  $('t-price-lbl').textContent = coin.gold ? 'Złoto (uncja)' : 'Cena ' + sym;
  $('t-price').textContent = fmtUsd(s.price);
  $('t-price-pln').textContent = fx() ? fmtPln(s.price * fx()) : '';
  $('t-chg').textContent = s.chg == null ? '—' : pct(s.chg);
  $('t-chg').style.color = s.chg == null ? '' : s.chg >= 0 ? 'var(--green)' : 'var(--red)';
  $('t-fng').textContent = state.fng ? state.fng.value : '—';
  $('t-fng-sub').textContent = state.fng ? `${state.fng.label} · tydzień temu ${state.fng.week}, miesiąc temu ${state.fng.month}` : 'brak danych';
  const bt = state.bt[sym] || [], p0 = bt.find((r) => r.period === 'od 2018') ? 'od 2018' : bt[0]?.period;
  const d = bt.find((r) => r.period === p0 && r.strategy === 'Zwykłe DCA'), m = bt.find((r) => r.period === p0 && r.strategy === 'DCA z mnożnikiem');
  $('t-bt').textContent = d && m ? pct((1 - m.avg_cost / d.avg_cost) * 100) : '—';
  $('t-bt-lbl').textContent = 'Backtest ' + (p0 || '');
  const z = zone(s.score);
  const zl = $('zone-lbl'); zl.replaceChildren(z.name);
  const sm = document.createElement('small'); sm.textContent = z.action; zl.append(sm); zl.style.color = COLOR[z.key];
  $('explain').textContent = s.explain || '';
  $('explain').style.borderColor = COLOR[z.key];
  const tp = s.tp;
  $('tp-note').hidden = !tp;
  if (tp) $('tp-note').textContent = `Sygnał realizacji zysków (szczebel ${tp.step} z ${TP_LADDER.length}): sprzedaj ${tp.pct}% pozycji ${sym}${tp.step > 1 ? `, łącznie ${tp.total}% od pierwszego sygnału w tym cyklu` : ''}. Każdy szczebel wykonaj raz. Pamiętaj o 19% podatku od zysku.`;
  const note = $('alt-note'), gold = !!coin.gold;
  const alt = {
    GOLD: 'Złoto nie ma danych on-chain ani halvingu, więc wynik liczony jest inaczej: cena względem średniej 200- i 52-tygodniowej, spadek od szczytu oraz zmiana w 12 miesięcy i 3 lata. Historia to średnie miesięczne od 1975 r., cena na żywo pochodzi z PAX Gold. Złoto traktujemy jako zabezpieczenie, więc nie ma dla niego drabinki sprzedaży. Podatki: PAXG to token, więc najpewniej rozlicza się go jak kryptowalutę (PIT-38, 19%). Fizyczne złoto inwestycyjne jest zwolnione z VAT, a sprzedaż po upływie pół roku od końca miesiąca zakupu jest wolna od PIT. ETF na złoto można trzymać w IKE lub IKZE bez podatku od zysku.',
    ETH: 'Ethereum nie ma halvingu, więc zamiast fazy cyklu liczy się siła względem BTC. Wskaźniki górników (Puell, Hash Ribbons) dotyczą tylko BTC.',
    ADA: 'Cardano: model słabszy, mniej danych (brak zapasu na giełdach i wskaźników górników). W długim trendzie spadkowym moneta potrafi długo wyglądać „tanio” i tanieć dalej, dlatego mnożnik jest ograniczony do 1,5×.'
  };
  const approx = !gold && s.approx ? ' Uwaga: Coin Metrics chwilowo nie odpowiada, MVRV liczone z ostatniej znanej realized price.' : '';
  note.hidden = !alt[sym] && !approx;
  note.textContent = (alt[sym] || '') + approx;
  document.querySelectorAll('.rbtn').forEach((b) => b.classList.toggle('on', +b.dataset.days === state.range));
  drawPrice();
  renderPlan();
  const groups = gold ? [null] : GROUPS;
  const pr = [];
  for (const g of groups) {
    const ps = s.parts.filter((p) => (p.group || null) === g);
    if (!ps.length) continue;
    if (g) pr.push([['grp', g], '', ['num grp', num(ps.reduce((a, p) => a + p.pts, 0), 1)], ['num grp', ps.reduce((a, p) => a + p.max, 0)], '']);
    for (const p of ps) pr.push([p.label, p.value, ['num', num(p.pts, 1)], ['num', p.max], ['src', p.note]]);
  }
  rows('parts-rows', pr);
  const avail = s.parts.reduce((a, p) => a + p.max, 0);
  $('parts-note').textContent = gold ? 'Wynik złota to suma punktów.' : `Dostępne wskaźniki dają ${avail} ze 100 pkt, wynik = punkty / ${avail} × 100. Brakujące dane (np. funding, gdy giełda nie odpowiada) nie zaniżają wyniku.`;
  $('cyc-only').hidden = gold;
  $('bt-note').textContent = (gold ? '100 $ miesięcznie (średnie ceny miesięczne)' : '100 $ tygodniowo') + ', wycena po dzisiejszej cenie. Wynik w przeszłości liczony tylko z danych dostępnych w danym dniu. Wariant z mnożnikiem wpłaca więcej, dlatego porównuj średnią cenę zakupu. ' + (gold ? '' : '„+ realizacja zysków”: jak wariant z mnożnikiem, plus sprzedaż według drabinki przy wyniku < 20 i powrót gotówki na rynek (10% tygodniowo), gdy wynik ≥ 60; wartość obejmuje gotówkę. Funding nie ma historii, więc w backteście go nie ma.');
  const cyc = gold ? [] : cycles(state.series[sym]);
  const fd = (x) => x.slice(8, 10) + '.' + x.slice(5, 7) + '.' + x.slice(0, 4);
  rows('cycle-rows', cyc.map((c) => [[null, c.cycle + (c.ongoing ? ' (trwa)' : ''), CYCLE_COLOR[c.cycle]], fd(c.peak.date) + ' · ' + fmtUsd(c.peak.price), ['num', c.peakDay + ' d'], fd(c.bottom.date) + ' · ' + fmtUsd(c.bottom.price), ['num', pct(c.drawdown)], ['num', c.daysToBottom + ' d']]));
  rows('bt-rows', bt.map((r) => [r.period, r.strategy, ['num', fmtUsd(r.invested)], ['num', num(r.units, r.units >= 100 ? 0 : 3)], ['num', r.avg_cost ? fmtUsd(r.avg_cost) : '—'], ['num', num(r.multiple, 2) + '×']]));
  drawHistory(state.series[sym], sym);
  if (!gold) { drawCycles(cyc); drawWindow(); }
  drawHeat(monthly(state.series[sym]));
}

// Na telefonie tabele układają się w karty: każda komórka dostaje podpis z nagłówka kolumny.
function labelTables() {
  for (const tb of document.querySelectorAll('table')) {
    const heads = [...tb.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    for (const tr of tb.querySelectorAll('tbody tr')) [...tr.cells].forEach((td, i) => { if (heads[i] && !td.classList.contains('grp')) td.dataset.label = heads[i]; });
  }
}
function rows(id, data) {
  const tb = $(id); tb.replaceChildren();
  for (const r of data) {
    const tr = tb.insertRow();
    for (const c of r) {
      const td = tr.insertCell();
      if (Array.isArray(c)) { if (c[0]) td.className = c[0]; td.textContent = c[1]; if (c[2]) td.style.color = c[2]; } else td.textContent = c;
    }
  }
  labelTables();
}

function planInputs() {
  const v = (id, d) => { const n = parseFloat($(id).value); return isFinite(n) && n >= 0 ? n : d; };
  return {budget: v('p-budget', 0), w: {BTC: v('p-BTC', 0), ETH: v('p-ETH', 0), ADA: v('p-ADA', 0), GOLD: v('p-GOLD', 0)}};
}
// Bieżąca wartość portfela w zł według planowych grup (PAXG i złoto fizyczne liczą się jako złoto).
function portfolioValues() {
  const out = {};
  for (const h of holdings(state.txs)) {
    const a = ASSETS.find((x) => x.key === h.asset), s = state.scores[a.plan];
    if (!s || !fx()) continue;
    out[a.plan] = (out[a.plan] || 0) + h.qty * s.price * fx();
  }
  return out;
}
function renderPlan() {
  const {budget, w} = planInputs();
  const vals = portfolioValues();
  const p = plan(budget, w, state.scores, Object.keys(vals).length ? vals : null);
  const name = (s) => (s === 'GOLD' ? 'Złoto' : s);
  rows('plan-rows', p.rows.map((r) => [name(r.sym), ['num', Math.round(r.share * 100) + '%'], ['num', r.cur == null ? '—' : Math.round(r.cur * 100) + '%'], ['num', r.score == null ? '—' : num(r.score)], ['num', xmult(r.mult)],
    ['num', fmtPln(r.amount, 2) + (fx() ? ' · ' + fmtUsd(r.amount / fx(), 2) : ''), r.over ? 'var(--dim)' : null]]));
  $('plan-total').textContent = `${fmtPln(p.total, 2)}${fx() ? ' · ' + fmtUsd(p.total / fx(), 2) : ''} (${num(budget ? p.total / budget : 0, 1)}× budżetu)`;
  const notes = [];
  if (p.rebalanced) notes.push('Rebalancing: ' + p.rows.filter((r) => r.over).map((r) => `${name(r.sym)} ma ${Math.round(r.cur * 100)}% portfela przy docelowych ${Math.round(r.share * 100)}%`).join(', ') + ', więc w tym tygodniu jego część idzie na pozostałe aktywa.');
  const sells = p.rows.filter((r) => state.scores[r.sym].tp && vals[r.sym]);
  for (const r of sells) { const tp = state.scores[r.sym].tp; notes.push(`${name(r.sym)}: wynik ${Math.round(r.score)}, sprzedaj ${tp.pct}% pozycji ≈ ${fmtPln(vals[r.sym] * tp.pct / 100)}.`); }
  if (!sells.length) { const z = p.rows.filter((r) => state.scores[r.sym].tp); if (z.length) notes.push(z.map((r) => name(r.sym)).join(', ') + ': sygnał realizacji zysków. Dodaj zakupy do dziennika, a pokażę kwotę do sprzedaży.'); }
  $('plan-note').hidden = !notes.length;
  $('plan-note').textContent = notes.join(' ');
}

// ---------- portfel, dziennik, PIT-38 ----------
function saveTxs() { store.set('txs', state.txs); renderPortfolio(); renderPlan(); }
function renderPortfolio() {
  const hs = holdings(state.txs), r = fx();
  let totPln = 0, totCost = 0;
  rows('pf-rows', hs.map((h) => {
    const a = ASSETS.find((x) => x.key === h.asset), s = state.scores[a.plan];
    const valUsd = s ? h.qty * s.price : null, valPln = valUsd != null && r ? valUsd * r : null;
    if (valPln != null) { totPln += valPln; totCost += h.cost; }
    const gain = valPln != null ? valPln - h.cost : null;
    return [a.label, ['num', num(h.qty, h.qty >= 100 ? 2 : 6)], ['num', fmtPln(h.cost / h.qty) + (h.costUsd ? ' · ' + fmtUsd(h.costUsd / h.qty) : '')],
      ['num', valPln != null ? fmtPln(valPln) + ' · ' + fmtUsd(valUsd) : '—'],
      ['num', gain != null ? `${gain >= 0 ? '+' : ''}${fmtPln(gain)} (${pct(gain / h.cost * 100)})` : '—', gain == null ? null : gain >= 0 ? 'var(--green)' : 'var(--red)']];
  }));
  $('pf-total').textContent = hs.length && r ? `${fmtPln(totPln)} · ${fmtUsd(totPln / r)}, zysk/strata ${totPln - totCost >= 0 ? '+' : ''}${fmtPln(totPln - totCost)}` : 'Brak transakcji';
  const fmtTx = (t) => [t.date, ASSETS.find((x) => x.key === t.asset)?.label || t.asset, t.type === 'buy' ? 'kupno' : 'sprzedaż', ['num', num(t.qty, 8).replace(/,?0+$/, '')],
    ['num', (t.cur === 'USD' ? fmtUsd(t.value) + ' · ' : '') + fmtPln(toPln(t, t.value))], ['num', fmtPln(toPln(t, t.fee || 0))], ['src', t.cur === 'USD' ? `kurs NBP ${num(t.rate, 4)} z ${t.rateDate}` : '']];
  const tb = $('tx-rows'); tb.replaceChildren();
  for (const t of [...state.txs].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    const tr = tb.insertRow();
    for (const c of fmtTx(t)) { const td = tr.insertCell(); if (Array.isArray(c)) { td.className = c[0]; td.textContent = c[1]; } else td.textContent = c; }
    const td = tr.insertCell(), b = document.createElement('button');
    b.type = 'button'; b.className = 'rbtn'; b.textContent = 'Usuń'; b.setAttribute('aria-label', `Usuń transakcję z ${t.date}`);
    b.addEventListener('click', () => { state.txs = state.txs.filter((x) => x.id !== t.id); saveTxs(); });
    td.append(b);
  }
  labelTables();
  const zl = (v) => fmtPln(v, 2);
  rows('pit-rows', pit(state.txs).map((y) => [y.year, ['num', zl(y.income)], ['num', zl(y.cost)], ['num', zl(y.prior)], ['num', zl(y.gain)], ['num', fmtPln(y.tax, 0)], ['num', zl(y.carryOut)]]));
}
async function addTx(e) {
  e.preventDefault();
  const f = (id) => $(id).value, n = (id) => parseFloat(String(f(id)).replace(',', '.'));
  const tx = {id: Math.random().toString(36).slice(2, 10), date: f('tx-date'), asset: f('tx-asset'), type: f('tx-type'), qty: n('tx-qty'), value: n('tx-value'), fee: n('tx-fee') || 0, cur: f('tx-cur')};
  const msg = $('tx-msg');
  if (!tx.date || !(tx.qty > 0) || !(tx.value >= 0)) { msg.textContent = 'Uzupełnij datę, ilość i wartość.'; return; }
  if (tx.cur === 'USD') {
    msg.textContent = 'Pobieram kurs NBP…';
    try { const r = await nbpRateBefore(tx.date); Object.assign(tx, {rate: r.rate, rateDate: r.date, table: r.table}); } catch { msg.textContent = 'Nie udało się pobrać kursu NBP. Spróbuj ponownie albo wpisz kwotę w zł.'; return; }
  }
  state.txs.push(tx); saveTxs();
  msg.textContent = `Dodano: ${tx.type === 'buy' ? 'kupno' : 'sprzedaż'} ${num(tx.qty, 8).replace(/,?0+$/, '')} ${tx.asset}` + (tx.rate ? ` (kurs NBP ${num(tx.rate, 4)} z ${tx.rateDate})` : '') + '.';
  ['tx-qty', 'tx-value', 'tx-fee'].forEach((id) => ($(id).value = ''));
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type: 'text/csv;charset=utf-8'})); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- wykresy ----------
function svgIn(el, W, H, label) {
  el.replaceChildren();
  return d3.select(el).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', label);
}
function hover(el, svg, W, x, y0, y1, find, text) {
  const tip = d3.select(el).append('div').attr('class', 'tip').style('display', 'none');
  const rule = svg.append('line').attr('y1', y0).attr('y2', y1).style('stroke', 'var(--cyan)').style('stroke-opacity', 0.5).style('display', 'none');
  const [xa, xb] = x.range();
  svg.append('rect').attr('x', xa).attr('y', y0).attr('width', xb - xa).attr('height', y1 - y0).attr('fill', 'transparent')
    .on('pointermove', (ev) => {
      const [px] = d3.pointer(ev); const r = find(x.invert(px)); if (!r) return;
      const xx = r.x; rule.attr('x1', xx).attr('x2', xx).style('display', null);
      tip.style('display', null).text(text(r.d));
      const bw = el.clientWidth, tw = tip.node().offsetWidth, sx = xx * bw / W;
      tip.style('left', Math.max(0, Math.min(bw - tw, sx - tw / 2)) + 'px').style('top', '0px');
    })
    .on('pointerleave', () => { tip.style('display', 'none'); rule.style('display', 'none'); });
}

function drawGauge(s, sym) {
  const el = $('gauge'), S = 300, C = S / 2, score = s.score ?? 0, color = COLOR[bucket(score)];
  const svg = svgIn(el, S, S, `Wynik ${sym}: ${Math.round(score)} na 100, mnożnik ${s.mult}×`);
  const g = svg.append('g').attr('transform', `translate(${C},${C})`);
  g.append('circle').attr('r', 140).attr('fill', 'none').style('stroke', 'var(--line)').attr('stroke-dasharray', '2 6').attr('class', 'spin');
  g.append('circle').attr('r', 132).attr('fill', 'none').style('stroke', 'var(--cyan)').style('stroke-opacity', 0.35).attr('stroke-dasharray', '60 18 6 18').attr('class', 'spin rev');
  const ang = (v) => (-135 + 270 * v / 100) * Math.PI / 180;
  d3.range(0, 101, 5).forEach((v) => {
    const r2 = v % 25 === 0 ? 104 : 110, t = ang(v);
    g.append('line').attr('x1', 116 * Math.sin(t)).attr('y1', -116 * Math.cos(t)).attr('x2', r2 * Math.sin(t)).attr('y2', -r2 * Math.cos(t))
      .style('stroke', v <= score ? color : 'var(--slate)').attr('stroke-width', v % 25 === 0 ? 2 : 1);
  });
  const band = d3.arc().innerRadius(90).outerRadius(96);
  ZONES.map((z, i) => [Math.max(0, z.min), i ? ZONES[i - 1].min : 100, z.key]).forEach(([a, b, c]) => g.append('path').attr('d', band({startAngle: ang(a), endAngle: ang(b) - 0.01})).style('fill', COLOR[c]).style('opacity', 0.28));
  const va = d3.arc().innerRadius(78).outerRadius(88).cornerRadius(2);
  g.append('path').attr('d', va({startAngle: ang(0), endAngle: ang(100)})).style('fill', 'rgba(56,189,248,.08)');
  g.append('path').attr('d', va({startAngle: ang(0), endAngle: ang(Math.min(100, score))})).style('fill', color).style('filter', `drop-shadow(0 0 8px ${color})`);
  g.append('circle').attr('r', 72).attr('fill', 'rgba(5,15,28,.85)').style('stroke', 'var(--line)');
  const t = (y, size, fill, txt, extra = {}) => { const e = g.append('text').attr('y', y).attr('text-anchor', 'middle').style('fill', fill).style('font-family', 'var(--mono)').style('font-size', size).text(txt); Object.entries(extra).forEach(([k, v]) => e.style(k, v)); };
  // Teksty mieszczą się w wewnętrznym kole (średnica 144), żeby nie nachodziły na łuk.
  t(-30, '9px', 'var(--dim)', sym + ' · WYNIK', {'letter-spacing': '.18em'});
  t(16, '46px', color, Math.round(score), {'font-weight': 600, filter: `drop-shadow(0 0 10px ${color})`});
  t(38, '11px', 'var(--fg)', `DCA ${xmult(s.mult)}`, {'letter-spacing': '.12em'});
  [0, 25, 50, 75, 100].forEach((v) => g.append('text').attr('x', 126 * Math.sin(ang(v))).attr('y', -126 * Math.cos(ang(v)) + 4).attr('text-anchor', 'middle').style('fill', 'var(--dim)').style('font-size', '9px').style('font-family', 'var(--mono)').text(v));
}

function drawPrice() {
  const el = $('ch-price'), data = rangeData(), sym = state.coin, days = state.range;
  if (data.length < 2) { el.replaceChildren(); $('r-chg').textContent = state.pricesAt ? 'Brak danych dla tego zakresu' : 'Wczytywanie…'; $('r-chg').style.color = ''; $('r-hl').textContent = ''; return; }
  const first = data[0].price, last = data[data.length - 1].price, chg = (last / first - 1) * 100;
  const hi = data.reduce((a, r) => (r.price > a.price ? r : a)), lo = data.reduce((a, r) => (r.price < a.price ? r : a));
  const col = chg >= 0 ? 'var(--green)' : 'var(--red)', rgb = chg >= 0 ? '61,245,164' : '255,93,108';
  const lbl = {1: '24h', 7: '7 dni', 30: '30 dni', 90: '90 dni', 365: 'rok', 1826: '5 lat', 3652: '10 lat'}[days];
  $('r-chg').textContent = `${pct(chg)} w ${lbl}`; $('r-chg').style.color = col;
  $('r-hl').textContent = `min ${both(lo.price)} · max ${both(hi.price)}`;
  const W = Math.max(300, el.clientWidth), H = 260, m = {t: 14, r: 12, b: 26, l: 64};
  const svg = svgIn(el, W, H, `Cena ${sym} w ostatnim okresie: ${lbl}, zmiana ${pct(chg)}`);
  const x = d3.scaleTime().domain(d3.extent(data, (r) => r.t)).range([m.l, W - m.r]);
  const pad = (hi.price - lo.price) * 0.12 || hi.price * 0.01;
  const logY = days > 365;
  const y = logY ? d3.scaleLog().domain([lo.price * 0.85, hi.price * 1.15]).range([H - m.b, m.t]) : d3.scaleLinear().domain([lo.price - pad, hi.price + pad]).range([H - m.b, m.t]);
  const gid = 'pg' + Math.random().toString(36).slice(2, 8);
  const gr = svg.append('defs').append('linearGradient').attr('id', gid).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
  gr.append('stop').attr('offset', '0%').attr('stop-color', `rgba(${rgb},.32)`);
  gr.append('stop').attr('offset', '100%').attr('stop-color', `rgba(${rgb},0)`);
  const yt = logY ? [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5].filter((v) => v >= y.domain()[0] && v <= y.domain()[1]) : y.ticks(5);
  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(yt).tickFormat(fmtUsd).tickSize(-(W - m.l - m.r))).call((g) => g.select('.domain').remove());
  const tf = days === 1 ? d3.timeFormat('%H:%M') : days <= 30 ? d3.timeFormat('%d.%m') : days <= 365 ? d3.timeFormat('%m.%Y') : d3.timeFormat('%Y');
  svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(W < 500 ? 4 : 7).tickFormat(tf).tickSizeOuter(0));
  svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(first)).attr('y2', y(first)).style('stroke', 'var(--dim)').attr('stroke-dasharray', '3 5').style('opacity', 0.6);
  if (logY) gr.select('stop').attr('stop-color', `rgba(${rgb},.22)`);
  svg.append('path').datum(data).attr('fill', `url(#${gid})`).attr('d', d3.area().x((r) => x(r.t)).y0(H - m.b).y1((r) => y(r.price)));
  svg.append('path').datum(data).attr('fill', 'none').style('stroke', col).attr('stroke-width', 1.8).style('filter', `drop-shadow(0 0 4px rgba(${rgb},.8))`).attr('d', d3.line().x((r) => x(r.t)).y((r) => y(r.price)));
  const L = data[data.length - 1];
  svg.append('circle').attr('cx', x(L.t)).attr('cy', y(L.price)).attr('r', 4).style('fill', col).attr('class', 'blink').style('filter', `drop-shadow(0 0 6px rgba(${rgb},1))`);
  [[hi, -8], [lo, 16]].forEach(([r, dy]) => {
    const xx = x(r.t), anchor = xx > W - 90 ? 'end' : xx < m.l + 60 ? 'start' : 'middle';
    svg.append('text').attr('x', xx).attr('y', y(r.price) + dy).attr('text-anchor', anchor).style('fill', 'var(--fg)').text(fmtUsd(r.price));
  });
  const bis = d3.bisector((r) => r.t).center, ff = days <= 7 ? '%d.%m %H:%M' : '%d.%m.%Y';
  hover(el, svg, W, x, m.t, H - m.b, (t) => { const r = data[bis(data, +t)]; return r && {x: x(r.t), d: r}; },
    (r) => `${d3.timeFormat(ff)(new Date(r.t))} · ${both(r.price)} · ${pct((r.price / first - 1) * 100)}`);
}

function drawHistory(series, sym) {
  const el = $('ch-history');
  const data = series.map((r) => ({...r, d: d3.utcParse('%Y-%m-%d')(r.date)}));
  const W = Math.max(300, el.clientWidth), H = 400, m = {t: 8, r: 12, b: 26, l: 64}, gap = 26;
  const h1 = (H - m.t - m.b - gap) * 0.62, h2 = H - m.t - m.b - gap - h1;
  const svg = svgIn(el, W, H, `Cena ${sym} w skali logarytmicznej z kolorem wyniku i wykres wyniku`);
  const x = d3.scaleUtc().domain(d3.extent(data, (r) => r.d)).range([m.l, W - m.r]);
  const y1 = d3.scaleLog().domain([d3.min(data, (r) => r.price) * 0.8, d3.max(data, (r) => r.price) * 1.2]).range([m.t + h1, m.t]);
  const y2 = d3.scaleLinear().domain([0, 100]).range([m.t + h1 + gap + h2, m.t + h1 + gap]);
  const pows = d3.range(-4, 7).map((e) => 10 ** e).filter((v) => v >= y1.domain()[0] && v <= y1.domain()[1]);
  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y1).tickValues(pows).tickFormat((v) => (v >= 1000 ? v / 1000 + 'k' : v) + ' $').tickSize(-(W - m.l - m.r))).call((g) => g.select('.domain').remove());
  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y2).tickValues([0, 30, 50, 70, 85, 100]).tickSize(-(W - m.l - m.r))).call((g) => g.select('.domain').remove());
  svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(W < 500 ? 4 : 8).tickSizeOuter(0));
  const segs = data.slice(1).map((r, i) => [data[i], r]);
  svg.append('g').selectAll('line').data(segs).join('line').attr('x1', (s) => x(s[0].d)).attr('y1', (s) => y1(s[0].price)).attr('x2', (s) => x(s[1].d)).attr('y2', (s) => y1(s[1].price))
    .style('stroke', (s) => COLOR[bucket(s[1].score)]).attr('stroke-width', 1.6);
  svg.append('path').datum(data).attr('fill', 'none').style('stroke', 'var(--cyan)').attr('stroke-width', 1.2).style('filter', 'drop-shadow(0 0 3px rgba(56,217,245,.8))').attr('d', d3.line().defined((r) => r.score != null).x((r) => x(r.d)).y((r) => y2(r.score)));
  const bis = d3.bisector((r) => r.d).center;
  hover(el, svg, W, x, m.t, H - m.b, (t) => { const r = data[bis(data, t)]; return r && {x: x(r.d), d: r}; },
    (r) => `${d3.utcFormat('%d.%m.%Y')(r.d)} · ${fmtUsd(r.price)} · wynik ${r.score == null ? '—' : Math.round(r.score)}`);
}

function drawCycles(cyc) {
  const el = $('ch-cycles'), anchor = $('anchor').value;
  const xk = anchor === 'peak' ? 'dP' : 'dH', yk = anchor === 'peak' ? 'rP' : 'rH';
  const all = cyc.flatMap((c) => c.pts);
  if (!all.length) { el.replaceChildren(); return; }
  const W = Math.max(300, el.clientWidth), H = 340, m = {t: 12, r: 46, b: 30, l: 56};
  const svg = svgIn(el, W, H, 'Cykle nałożone na siebie');
  const x = d3.scaleLinear().domain(d3.extent(all, (r) => r[xk])).range([m.l, W - m.r]);
  const y = d3.scaleLog().domain([d3.min(all, (r) => r[yk]) * 0.85, d3.max(all, (r) => r[yk]) * 1.15]).range([H - m.b, m.t]);
  const yt = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].filter((v) => v >= y.domain()[0] && v <= y.domain()[1]);
  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues(yt).tickFormat((v) => v + '×').tickSize(-(W - m.l - m.r))).call((g) => g.select('.domain').remove());
  svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(W < 500 ? 4 : 8).tickFormat((v) => (v > 0 ? '+' : '') + v + ' d').tickSizeOuter(0));
  svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', m.t).attr('y2', H - m.b).style('stroke', 'var(--dim)').attr('stroke-dasharray', '3 4');
  svg.append('text').attr('x', x(0) + 4).attr('y', m.t + 10).text(anchor === 'peak' ? 'szczyt' : 'halving');
  const line = d3.line().x((r) => x(r[xk])).y((r) => y(r[yk]));
  for (const c of cyc) {
    const cur = c.cycle === '2024', col = CYCLE_COLOR[c.cycle] || 'var(--slate)';
    svg.append('path').datum(c.pts).attr('fill', 'none').style('stroke', col).attr('stroke-width', cur ? 2.4 : 1.3).style('opacity', cur ? 1 : 0.7).style('filter', cur ? 'drop-shadow(0 0 4px rgba(56,217,245,.9))' : null).attr('d', line);
    const l = c.pts[c.pts.length - 1];
    svg.append('text').attr('x', Math.min(W - m.r + 4, x(l[xk]) + 4)).attr('y', y(l[yk]) + 4).style('fill', col).style('font-weight', cur ? 700 : 400).text(c.cycle);
  }
  hover(el, svg, W, x, m.t, H - m.b, (dx) => ({x: x(Math.round(dx)), d: Math.round(dx)}), (dx) => {
    const parts = cyc.map((c) => { const r = c.pts.reduce((a, p) => (Math.abs(p[xk] - dx) < Math.abs(a[xk] - dx) ? p : a), c.pts[0]); return Math.abs(r[xk] - dx) <= 5 ? `${c.cycle}: ${num(r[yk], 2)}×` : null; }).filter(Boolean);
    return `${dx > 0 ? '+' : ''}${dx} dni · ${parts.join(' · ') || 'brak danych'}`;
  });
}

function drawWindow() {
  const el = $('ch-window'), n = +$('win').value, {day, rows: data} = windowChanges(state.series[state.coin], n);
  const W = Math.max(300, el.clientWidth), bh = 34, m = {t: 24, r: 70, b: 8, l: 56}, H = m.t + m.b + data.length * bh;
  const svg = svgIn(el, W, H, `Zmiana ceny w ${n} dniach teraz i w poprzednich cyklach`);
  const ext = d3.extent(data.map((r) => r.change).concat([0]));
  const x = d3.scaleLinear().domain([Math.min(ext[0], -10) * 1.1, Math.max(ext[1], 10) * 1.1]).range([m.l, W - m.r]);
  svg.append('text').attr('x', m.l).attr('y', 12).text(`${day}. dzień po halvingu · zmiana w ${n} dniach`);
  svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', m.t - 4).attr('y2', H - m.b).style('stroke', 'var(--dim)');
  data.forEach((r, i) => {
    const yy = m.t + i * bh, cur = r.cycle === '2024';
    svg.append('text').attr('x', m.l - 8).attr('y', yy + bh / 2 + 4).attr('text-anchor', 'end').style('fill', CYCLE_COLOR[r.cycle]).style('font-weight', cur ? 700 : 400).text(r.cycle);
    svg.append('rect').attr('x', x(Math.min(0, r.change))).attr('y', yy + 6).attr('width', Math.max(1, Math.abs(x(r.change) - x(0)))).attr('height', bh - 12)
      .style('fill', r.change >= 0 ? 'var(--green)' : 'var(--red)').style('opacity', cur ? 0.95 : 0.55);
    svg.append('text').attr('x', r.change >= 0 ? x(r.change) + 6 : x(r.change) - 6).attr('y', yy + bh / 2 + 4).attr('text-anchor', r.change >= 0 ? 'start' : 'end').style('fill', 'var(--fg)').text(pct(r.change));
  });
}

function drawHeat(rowsM) {
  const el = $('ch-heat');
  const years = [...new Set(rowsM.map((r) => r.year))].sort().slice(-16); // ostatnie 16 lat
  rowsM = rowsM.filter((r) => r.year >= years[0]);
  const M = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
  const W = Math.max(300, el.clientWidth), m = {t: 22, r: 4, b: 30, l: 40}, cw = (W - m.l - m.r) / 12, ch = Math.min(26, Math.max(18, cw * 0.6));
  const H = m.t + m.b + (years.length + 1) * ch + 4;
  const svg = svgIn(el, W, H, 'Zwroty miesięczne rok po roku');
  const col = (v) => (v >= 0 ? `rgba(61,245,164,${Math.min(0.9, 0.12 + Math.abs(v) / 60)})` : `rgba(255,93,108,${Math.min(0.9, 0.12 + Math.abs(v) / 45)})`);
  const show = cw >= 34;
  M.forEach((mm, i) => svg.append('text').attr('x', m.l + i * cw + cw / 2).attr('y', 14).attr('text-anchor', 'middle').text(mm));
  years.forEach((yr, yi) => {
    const yy = m.t + yi * ch;
    svg.append('text').attr('x', m.l - 6).attr('y', yy + ch / 2 + 4).attr('text-anchor', 'end').text(yr);
    rowsM.filter((r) => r.year === yr).forEach((r) => {
      const xx = m.l + (r.month - 1) * cw;
      svg.append('rect').attr('x', xx + 1).attr('y', yy + 1).attr('width', cw - 2).attr('height', ch - 2).style('fill', col(r.change)).append('title').text(`${M[r.month - 1]} ${yr}: ${pct(r.change)}`);
      if (show) svg.append('text').attr('x', xx + cw / 2).attr('y', yy + ch / 2 + 4).attr('text-anchor', 'middle').style('fill', 'var(--fg)').style('font-size', '10px').style('pointer-events', 'none').text(Math.round(r.change));
    });
  });
  const yy = m.t + years.length * ch + 4;
  svg.append('text').attr('x', m.l - 6).attr('y', yy + ch / 2 + 4).attr('text-anchor', 'end').style('fill', 'var(--cyan)').text('med.');
  M.forEach((_, i) => {
    const v = rowsM.filter((r) => r.month === i + 1).map((r) => r.change); if (!v.length) return;
    const med = d3.median(v), up = v.filter((x) => x > 0).length;
    svg.append('rect').attr('x', m.l + i * cw + 1).attr('y', yy + 1).attr('width', cw - 2).attr('height', ch - 2).style('fill', col(med)).style('stroke', 'var(--cyan)').style('stroke-opacity', 0.5);
    if (show) svg.append('text').attr('x', m.l + i * cw + cw / 2).attr('y', yy + ch / 2 + 4).attr('text-anchor', 'middle').style('fill', 'var(--fg)').style('font-size', '10px').text(Math.round(med));
    svg.append('text').attr('x', m.l + i * cw + cw / 2).attr('y', yy + ch + 14).attr('text-anchor', 'middle').style('font-size', '9px').text(`${up}/${v.length}↑`);
  });
}

// ---------- start ----------
function bind() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { state.coin = t.dataset.coin; store.set('coin', state.coin); render(); showRange(); }));
  document.querySelectorAll('.rbtn').forEach((b) => b.addEventListener('click', () => { state.range = +b.dataset.days; store.set('range', state.range); showRange(); }));
  const saved = store.get('plan', null);
  if (saved) for (const [id, v] of Object.entries(saved)) if ($(id)) $(id).value = v;
  document.querySelectorAll('#plan-form input').forEach((i) => i.addEventListener('input', () => {
    const o = {}; document.querySelectorAll('#plan-form input').forEach((x) => (o[x.id] = x.value)); store.set('plan', o); renderPlan();
  }));
  $('plan-form').addEventListener('submit', (e) => e.preventDefault());
  $('tx-date').value = today();
  $('tx-form').addEventListener('submit', addTx);
  $('tx-export').addEventListener('click', () => download(`dziennik-krypto-${today()}.csv`, toCsv(state.txs)));
  $('tx-import').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const add = fromCsv(await file.text());
    const key = (t) => [t.date, t.asset, t.type, t.qty, t.value].join('|'), have = new Set(state.txs.map(key));
    const fresh = add.filter((t) => !have.has(key(t)));
    state.txs.push(...fresh); saveTxs(); $('tx-msg').textContent = `Wczytano ${fresh.length} nowych transakcji.`; e.target.value = '';
  });
  $('anchor').addEventListener('change', () => drawCycles(cycles(state.series[state.coin])));
  $('win').addEventListener('change', drawWindow);
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 200); });
}

async function refreshPrices() {
  try {
    await loadLive(); compute(); render(); renderPortfolio();
    status('Na żywo · ' + new Date().toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit'}), 'ok');
  } catch (e) {
    const t = state.pricesAt ? ' z ' + new Date(state.pricesAt).toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit'}) : '';
    status(`CoinGecko chwilowo nie odpowiada (${e.message.includes('429') ? 'limit zapytań' : 'brak sieci'}), ceny${t}`, 'err');
  }
}

(async function main() {
  bind();
  try { await loadHistory(); } catch { status('Nie udało się wczytać danych historycznych', 'err'); return; }
  const cp = store.get('prices', null); if (cp) { state.prices = cp.data; state.pricesAt = cp.at; }
  state.fng = store.get('fng', null);
  state.charts = store.get('charts', {data: {}}).data;
  state.cm = store.get('onchain', {data: {}}).data; state.fngHist = store.get('fngHist', {data: []}).data;
  state.stables = store.get('stables', {data: []}).data; state.funding = store.get('funding', {data: {}}).data;
  compute(); render(); renderPortfolio();
  await refreshPrices();
  await loadSlow(); compute(); render(); renderPortfolio();
  await loadCharts(); compute(); render();
  setInterval(refreshPrices, 90 * 1000);
  setInterval(async () => { await loadSlow(); await loadCharts(); compute(); render(); renderPortfolio(); }, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - (state.pricesAt || 0) > 60e3) refreshPrices(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
