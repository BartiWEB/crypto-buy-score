import {COINS, mergeSeries, liveScore, plan, cycles, windowChanges, monthly, fmtUsd, bucket} from './score.js';
import {fetchPrices, fetchChart, fetchFng, fetchRange} from './api.js';

const COLOR = {red: 'var(--red)', slate: 'var(--slate)', amber: 'var(--amber)', green: 'var(--green)'};
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

const state = {coin: store.get('coin', 'BTC'), range: store.get('range', 7), hist: null, charts: {}, prices: null, fng: null, series: {}, scores: {}, ranges: {}};

function status(text, kind) { $('status').textContent = text; $('status-dot').className = 'dot ' + (kind || ''); }

// ---------- dane ----------
async function loadHistory() {
  const r = await fetch('data/history.json');
  state.hist = (await r.json()).coins;
}
async function loadCharts() {
  const res = await Promise.allSettled(COINS.map((c) => fetchChart(c.id)));
  res.forEach((r, i) => { if (r.status === 'fulfilled') state.charts[COINS[i].sym] = r.value; });
}
async function loadLive() {
  const [p, f] = await Promise.allSettled([fetchPrices(COINS.map((c) => c.id)), fetchFng()]);
  if (p.status === 'fulfilled') state.prices = p.value;
  if (f.status === 'fulfilled') state.fng = f.value;
  if (p.status === 'rejected') throw p.reason;
}
// Dane wykresu ceny: 1R z wykresu dziennego, krótsze zakresy pobierane osobno i trzymane 5 minut.
async function loadRange(force) {
  const sym = state.coin, days = state.range, key = sym + '|' + days, id = COINS.find((c) => c.sym === sym).id;
  if (days === 365) return;
  const c = state.ranges[key];
  if (!force && c && Date.now() - c.at < 5 * 60 * 1000) return;
  try { state.ranges[key] = {at: Date.now(), data: await fetchRange(id, days)}; } catch { /* zostają poprzednie dane */ }
}
function rangeData() {
  const sym = state.coin, days = state.range;
  let data = days === 365
    ? (state.charts[sym] || state.series[sym].filter((r) => Date.parse(r.date) > Date.now() - 365 * 864e5)).map((r) => ({t: Date.parse(r.date), price: r.price}))
    : (state.ranges[sym + '|' + days]?.data || []).slice();
  const live = state.prices?.[COINS.find((c) => c.sym === sym).id]?.usd;
  if (live && data.length) data.push({t: Date.now(), price: live});
  return data;
}
async function showRange() {
  document.querySelectorAll('.rbtn').forEach((b) => b.classList.toggle('on', +b.dataset.days === state.range));
  drawPrice();
  await loadRange();
  drawPrice();
}

function compute() {
  for (const c of COINS) {
    const h = state.hist[c.sym];
    const series = mergeSeries(h, state.charts[c.sym]);
    const live = state.prices?.[c.id];
    const price = live?.usd ?? series[series.length - 1].price;
    state.series[c.sym] = series;
    state.scores[c.sym] = {...liveScore(h, series, price, today()), price, chg: live?.usd_24h_change};
  }
}

// ---------- widok ----------
function render() {
  const sym = state.coin, s = state.scores[sym], coin = COINS.find((c) => c.sym === sym);
  document.querySelectorAll('.tab').forEach((t) => { const on = t.dataset.coin === sym; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
  drawGauge(s, sym);
  $('t-mult').textContent = xmult(s.mult);
  $('t-price-lbl').textContent = 'Cena ' + sym;
  $('t-price').textContent = fmtUsd(s.price);
  $('t-chg').textContent = s.chg == null ? '—' : pct(s.chg);
  $('t-chg').style.color = s.chg == null ? '' : s.chg >= 0 ? 'var(--green)' : 'var(--red)';
  $('t-fng').textContent = state.fng ? state.fng.value : '—';
  $('t-fng-sub').textContent = state.fng ? `${state.fng.label} · tydzień temu ${state.fng.week}, miesiąc temu ${state.fng.month}` : 'brak danych';
  const bt = state.hist[sym].backtest.filter((r) => r.period === 'od 2018');
  const d = bt.find((r) => r.strategy === 'Zwykłe DCA'), m = bt.find((r) => r.strategy !== 'Zwykłe DCA');
  $('t-bt').textContent = d && m ? pct((d.avg_cost / m.avg_cost - 1) * 100) : '—';
  const note = $('alt-note');
  note.hidden = sym === 'BTC';
  note.textContent = sym === 'BTC' ? '' : `${coin.name} nie ma własnego halvingu, więc faza cyklu liczona jest według BTC. Dla altcoinów model jest słabszy: w długim trendzie spadkowym moneta potrafi długo wyglądać „tanio” i tanieć dalej. Realized price pochodzi z 05.2026, więc po dużych spadkach wynik bywa zawyżony.`;
  document.querySelectorAll('.rbtn').forEach((b) => b.classList.toggle('on', +b.dataset.days === state.range));
  drawPrice();
  renderPlan();
  rows('parts-rows', s.parts.map((p) => [p.label, p.value, ['num', num(p.pts, 1)], ['num', p.max], ['src', p.note]]));
  const cyc = cycles(state.series[sym]);
  const fd = (x) => x.slice(8, 10) + '.' + x.slice(5, 7) + '.' + x.slice(0, 4);
  rows('cycle-rows', cyc.map((c) => [[null, c.cycle + (c.ongoing ? ' (trwa)' : ''), CYCLE_COLOR[c.cycle]], fd(c.peak.date) + ' · ' + fmtUsd(c.peak.price), ['num', c.peakDay + ' d'], fd(c.bottom.date) + ' · ' + fmtUsd(c.bottom.price), ['num', pct(c.drawdown)], ['num', c.daysToBottom + ' d']]));
  rows('bt-rows', state.hist[sym].backtest.map((r) => [r.period, r.strategy, ['num', fmtUsd(r.invested)], ['num', num(r.units, r.units >= 100 ? 0 : 3)], ['num', fmtUsd(r.avg_cost)], ['num', num(r.multiple, 2) + '×']]));
  drawHistory(state.series[sym], sym);
  drawCycles(cyc);
  drawWindow();
  drawHeat(monthly(state.series[sym]));
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
}

function planInputs() {
  const v = (id, d) => { const n = parseFloat($(id).value); return isFinite(n) && n >= 0 ? n : d; };
  return {budget: v('p-budget', 0), w: {BTC: v('p-BTC', 0), ETH: v('p-ETH', 0), ADA: v('p-ADA', 0)}};
}
function renderPlan() {
  const {budget, w} = planInputs();
  const p = plan(budget, w, state.scores);
  rows('plan-rows', p.rows.map((r) => [r.sym, ['num', Math.round(r.share * 100) + '%'], ['num', num(r.score)], ['num', xmult(r.mult)], ['num', num(r.amount)]]));
  $('plan-total').textContent = `${num(p.total)} (${num(budget ? p.total / budget : 0, 1)}× budżetu)`;
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
  const el = $('gauge'), S = 300, C = S / 2, score = s.score, color = COLOR[bucket(score)];
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
  [[0, 30, 'red'], [30, 50, 'slate'], [50, 70, 'amber'], [70, 100, 'green']].forEach(([a, b, c]) => g.append('path').attr('d', band({startAngle: ang(a), endAngle: ang(b) - 0.01})).style('fill', COLOR[c]).style('opacity', 0.28));
  const va = d3.arc().innerRadius(78).outerRadius(88).cornerRadius(2);
  g.append('path').attr('d', va({startAngle: ang(0), endAngle: ang(100)})).style('fill', 'rgba(56,189,248,.08)');
  g.append('path').attr('d', va({startAngle: ang(0), endAngle: ang(Math.min(100, score))})).style('fill', color).style('filter', `drop-shadow(0 0 8px ${color})`);
  g.append('circle').attr('r', 66).attr('fill', 'rgba(5,15,28,.85)').style('stroke', 'var(--line)');
  const t = (y, size, fill, txt, extra = {}) => { const e = g.append('text').attr('y', y).attr('text-anchor', 'middle').style('fill', fill).style('font-family', 'var(--mono)').style('font-size', size).text(txt); Object.entries(extra).forEach(([k, v]) => e.style(k, v)); };
  t(-26, '9px', 'var(--dim)', sym + ' · BUY SCORE', {'letter-spacing': '.25em'});
  t(18, '46px', color, Math.round(score), {'font-weight': 600, filter: `drop-shadow(0 0 10px ${color})`});
  t(40, '11px', 'var(--fg)', `/100 · DCA ${xmult(s.mult)}`, {'letter-spacing': '.15em'});
  [0, 25, 50, 75, 100].forEach((v) => g.append('text').attr('x', 126 * Math.sin(ang(v))).attr('y', -126 * Math.cos(ang(v)) + 4).attr('text-anchor', 'middle').style('fill', 'var(--dim)').style('font-size', '9px').style('font-family', 'var(--mono)').text(v));
}

function drawPrice() {
  const el = $('ch-price'), data = rangeData(), sym = state.coin, days = state.range;
  if (data.length < 2) { el.replaceChildren(); $('r-chg').textContent = 'Wczytywanie…'; $('r-hl').textContent = ''; return; }
  const first = data[0].price, last = data[data.length - 1].price, chg = (last / first - 1) * 100;
  const hi = data.reduce((a, r) => (r.price > a.price ? r : a)), lo = data.reduce((a, r) => (r.price < a.price ? r : a));
  const col = chg >= 0 ? 'var(--green)' : 'var(--red)', rgb = chg >= 0 ? '61,245,164' : '255,93,108';
  const lbl = {1: '24h', 7: '7 dni', 30: '30 dni', 90: '90 dni', 365: 'rok'}[days];
  $('r-chg').textContent = `${pct(chg)} w ${lbl}`; $('r-chg').style.color = col;
  $('r-hl').textContent = `min ${fmtUsd(lo.price)} · max ${fmtUsd(hi.price)}`;
  const W = Math.max(300, el.clientWidth), H = 260, m = {t: 14, r: 12, b: 26, l: 64};
  const svg = svgIn(el, W, H, `Cena ${sym} w ostatnim okresie: ${lbl}, zmiana ${pct(chg)}`);
  const x = d3.scaleTime().domain(d3.extent(data, (r) => r.t)).range([m.l, W - m.r]);
  const pad = (hi.price - lo.price) * 0.12 || hi.price * 0.01;
  const y = d3.scaleLinear().domain([lo.price - pad, hi.price + pad]).range([H - m.b, m.t]);
  const gid = 'pg' + Math.random().toString(36).slice(2, 8);
  const gr = svg.append('defs').append('linearGradient').attr('id', gid).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
  gr.append('stop').attr('offset', '0%').attr('stop-color', `rgba(${rgb},.32)`);
  gr.append('stop').attr('offset', '100%').attr('stop-color', `rgba(${rgb},0)`);
  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(fmtUsd).tickSize(-(W - m.l - m.r))).call((g) => g.select('.domain').remove());
  const tf = days === 1 ? d3.timeFormat('%H:%M') : days <= 30 ? d3.timeFormat('%d.%m') : d3.timeFormat('%m.%Y');
  svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(W < 500 ? 4 : 7).tickFormat(tf).tickSizeOuter(0));
  svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(first)).attr('y2', y(first)).style('stroke', 'var(--dim)').attr('stroke-dasharray', '3 5').style('opacity', 0.6);
  svg.append('path').datum(data).attr('fill', `url(#${gid})`).attr('d', d3.area().x((r) => x(r.t)).y0(H - m.b).y1((r) => y(r.price)));
  svg.append('path').datum(data).attr('fill', 'none').style('stroke', col).attr('stroke-width', 1.8).style('filter', `drop-shadow(0 0 4px rgba(${rgb},.8))`).attr('d', d3.line().x((r) => x(r.t)).y((r) => y(r.price)));
  const L = data[data.length - 1];
  svg.append('circle').attr('cx', x(L.t)).attr('cy', y(L.price)).attr('r', 4).style('fill', col).attr('class', 'blink').style('filter', `drop-shadow(0 0 6px rgba(${rgb},1))`);
  [[hi, -8], [lo, 16]].forEach(([r, dy]) => {
    const xx = x(r.t), anchor = xx > W - 90 ? 'end' : xx < m.l + 60 ? 'start' : 'middle';
    svg.append('text').attr('x', xx).attr('y', y(r.price) + dy).attr('text-anchor', anchor).style('fill', 'var(--fg)').text(fmtUsd(r.price));
  });
  const bis = d3.bisector((r) => r.t).center, ff = days === 1 ? '%d.%m %H:%M' : days <= 90 ? '%d.%m %H:%M' : '%d.%m.%Y';
  hover(el, svg, W, x, m.t, H - m.b, (t) => { const r = data[bis(data, +t)]; return r && {x: x(r.t), d: r}; },
    (r) => `${d3.timeFormat(ff)(new Date(r.t))} · ${fmtUsd(r.price)} · ${pct((r.price / first - 1) * 100)}`);
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
  svg.append('path').datum(data).attr('fill', 'none').style('stroke', 'var(--cyan)').attr('stroke-width', 1.2).style('filter', 'drop-shadow(0 0 3px rgba(56,217,245,.8))').attr('d', d3.line().x((r) => x(r.d)).y((r) => y2(r.score)));
  const bis = d3.bisector((r) => r.d).center;
  hover(el, svg, W, x, m.t, H - m.b, (t) => { const r = data[bis(data, t)]; return r && {x: x(r.d), d: r}; },
    (r) => `${d3.utcFormat('%d.%m.%Y')(r.d)} · ${fmtUsd(r.price)} · wynik ${Math.round(r.score)}${r.live ? ' (przybl.)' : ''}`);
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
  const years = [...new Set(rowsM.map((r) => r.year))].sort();
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
  $('anchor').addEventListener('change', () => drawCycles(cycles(state.series[state.coin])));
  $('win').addEventListener('change', drawWindow);
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 200); });
}

async function refreshPrices() {
  try {
    await Promise.all([loadLive(), loadRange()]); compute(); render();
    status('Na żywo · ' + new Date().toLocaleTimeString('pl-PL', {hour: '2-digit', minute: '2-digit'}), 'ok');
  } catch (e) {
    status('Brak połączenia z CoinGecko, pokazuję ostatnie dane', 'err');
  }
}

(async function main() {
  bind();
  try { await loadHistory(); } catch { status('Nie udało się wczytać danych historycznych', 'err'); return; }
  compute(); render();
  await loadCharts();
  await refreshPrices();
  setInterval(refreshPrices, 60 * 1000);
  setInterval(async () => { await loadCharts(); compute(); render(); }, 30 * 60 * 1000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
