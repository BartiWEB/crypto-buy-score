// Wspólna logika wyniku 0–100 (przeglądarka i skrypt alertów).
//
// Kryptowaluty: 5 grup sygnałów, ta sama skala w obie strony.
//   Wysoki wynik = rynek tani i przestraszony, kupuj więcej. Niski (< 20) = euforia, pora realizować część zysków.
//   1. Wycena on-chain (35): MVRV Z-score, NUPL
//   2. Trend i cykl (20): cena / średnia 200 tyg., Mayer Multiple, Pi Cycle Top, faza halvingu (ETH, ADA: siła względem BTC)
//   3. Sentyment (20): Fear & Greed (średnia 30 dni), funding kontraktów
//   4. Płynność (10): siła nabywcza stablecoinów (SSR)
//   5. Zachowanie rynku (15): Puell Multiple i Hash Ribbons (górnicy BTC), zapas monet na giełdach
// Wskaźniki oceniane percentylem porównują wartość tylko z wcześniejszą historią monety, więc backtest nie „zagląda w przyszłość”.
// Brakujący wskaźnik nie zaniża wyniku: wynik to suma punktów podzielona przez sumę dostępnych maksimów.

export const COINS = [
  {sym: 'BTC', id: 'bitcoin', cm: 'btc', name: 'Bitcoin'},
  {sym: 'ETH', id: 'ethereum', cm: 'eth', name: 'Ethereum'},
  {sym: 'ADA', id: 'cardano', cm: 'ada', name: 'Cardano'},
  {sym: 'GOLD', id: 'pax-gold', name: 'Złoto', gold: true} // cena z PAX Gold (1 token = 1 uncja)
];
export const HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20', '2028-04-15'];
export const MULT_CAP = {ADA: 1.5}; // mała, ryzykowna pozycja: bez agresywnego dokupowania
export const GROUPS = ['Wycena on-chain', 'Trend i cykl', 'Sentyment', 'Płynność', 'Zachowanie rynku'];
const DAY = 86400000;
const MIN_DAYS = 1095; // wynik liczony dopiero, gdy moneta ma 3 lata historii (wcześniej percentyle są niestabilne)

const lin = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
const r1 = (v) => Math.round(v * 10) / 10;

// Płynny mnożnik DCA: zamiast skoków (np. 84,9 → 2×, 85 → 3×) interpolacja między punktami.
// Poniżej 20 nie kupujemy (0×), tylko realizujemy część zysków, patrz takeProfit().
const ANCHORS = [[20, 0.5], [40, 1], [60, 1.5], [77, 2], [92, 3]];
export function mult(s, cap = 3) {
  if (s == null || !isFinite(s)) return 1;
  if (s < ANCHORS[0][0]) return 0;
  let m = ANCHORS[ANCHORS.length - 1][1];
  for (let i = 1; i < ANCHORS.length; i++) {
    const [a, ma] = ANCHORS[i - 1], [b, mb] = ANCHORS[i];
    if (s >= a && s <= b) { m = ma + (mb - ma) * (s - a) / (b - a); break; }
  }
  return Math.min(cap, Math.round(m * 20) / 20);
}
export const bucket = (s) => (s == null ? 'slate' : s < 20 ? 'violet' : s < 40 ? 'red' : s < 60 ? 'slate' : s < 77 ? 'amber' : 'green');

// Strefy wyniku i co z nich wynika: jedna skala dla kupna i sprzedaży.
export const ZONES = [
  {min: 77, key: 'green', name: 'Silna okazja', action: 'Kupuj więcej niż zwykle (2–3× kwoty).'},
  {min: 60, key: 'amber', name: 'Okazja', action: 'Kupuj trochę więcej niż zwykle (1,5–2×).'},
  {min: 40, key: 'slate', name: 'Neutralnie', action: 'Kupuj zwykłą kwotę.'},
  {min: 20, key: 'red', name: 'Drogo', action: 'Kupuj mniej (0,5–1×), nie goń ceny.'},
  {min: -1, key: 'violet', name: 'Euforia', action: 'Nie kupuj. Zrealizuj część zysków według drabinki.'}
];
export const zone = (s) => ZONES.find((z) => (s ?? 50) >= z.min);

// Drabinka realizacji zysków: im głębiej w euforii, tym większa część pozycji do sprzedaży (łącznie do 50%).
// Każdy szczebel wykonuje się raz na cykl, dopiero po spadku wyniku poniżej progu.
export const TP_LADDER = [{below: 20, pct: 10}, {below: 12, pct: 15}, {below: 6, pct: 25}];
// Gotówka ze sprzedaży wraca na rynek, gdy wynik ≥ 60: co tydzień taka część odłożonej kwoty.
export const REDEPLOY = 0.1;
export function takeProfit(s) {
  if (s == null) return null;
  const hit = TP_LADDER.filter((l) => s < l.below);
  return hit.length ? {step: hit.length, pct: hit[hit.length - 1].pct, total: hit.reduce((a, l) => a + l.pct, 0)} : null;
}

// ---------- percentyle i średnie kroczące ----------
function below(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; }
const insert = (arr, v) => arr.splice(below(arr, v), 0, v);
const rank = (arr, v) => (arr.length ? below(arr, v) / arr.length : 0.5); // część historii poniżej v

class Roll { // średnia z okna czasowego
  constructor(days) { this.w = days * DAY; this.q = []; this.h = 0; this.s = 0; }
  add(t, v) {
    if (v == null || !isFinite(v)) return;
    this.q.push([t, v]); this.s += v;
    while (t - this.q[this.h][0] > this.w) this.s -= this.q[this.h++][1];
    if (this.h > 2000) { this.q = this.q.slice(this.h); this.h = 0; }
  }
  get n() { return this.q.length - this.h; }
  get mean() { return this.n ? this.s / this.n : null; }
  get span() { return this.n ? (this.q[this.q.length - 1][0] - this.q[this.h][0]) / DAY : 0; }
  get first() { return this.n ? this.q[this.h][1] : null; }
  get last() { return this.n ? this.q[this.q.length - 1][1] : null; }
}

function cyclePhase(t) {
  const last = Math.max(...HALVINGS.map((d) => Date.parse(d)).filter((h) => h <= t));
  const months = (t - last) / DAY / 30.44;
  const v = months >= 26 && months <= 36 ? 1 : months > 36 || (months >= 22 && months < 26) ? 0.6 : months >= 12 && months <= 20 ? 0.1 : 0.4;
  return {months, v};
}

// Ostatnia znana wartość z posortowanej listy [{t, v}] nie późniejsza niż t.
function lookup(list) {
  let i = 0;
  return (t) => { while (i + 1 < list.length && list[i + 1].t <= t) i++; return list.length && list[i].t <= t ? list[i].v : null; };
}
const pctTxt = (v) => Math.round(v * 100) + '%';

/**
 * Liczy wynik dla każdego punktu serii kryptowaluty.
 * rows: [{date, price, mvrv, mcap, hr?, iss?, exs?, approx?}] rosnąco po dacie (mcap w mln $)
 * ctx: {sym, btc?: rows BTC (dla ETH/ADA), fng?: [{date, value}], stables?: [{date, value}] (mln $),
 *       funding?: {rate, source}, today?: 'YYYY-MM-DD'}
 * Zwraca {rows (z polem score), parts (wskaźniki ostatniego punktu)}.
 */
export function scoreSeries(rows, ctx = {}) {
  const isBtc = ctx.sym === 'BTC';
  const t0 = Date.parse(rows[0].date);
  const H = {z: [], ma: [], rel: [], ssr: []};
  const btcAt = ctx.btc ? lookup(ctx.btc.map((r) => ({t: Date.parse(r.date), v: r.price}))) : null;
  const stAt = ctx.stables?.length ? lookup(ctx.stables.map((r) => ({t: Date.parse(r.date), v: r.value}))) : null;
  const fng = (ctx.fng || []).map((r) => ({t: Date.parse(r.date), v: r.value}));
  const R = {ma1400: new Roll(1400), ma200: new Roll(200), ma111: new Roll(111), ma350: new Roll(350), rel: new Roll(1400),
    iss: new Roll(365), hr30: new Roll(30), hr60: new Roll(60), exs: new Roll(90), fng: new Roll(30)};
  let n = 0, s1 = 0, s2 = 0, f = 0, lastParts = [];
  const out = rows.map((r, i) => {
    const t = Date.parse(r.date);
    // MVRV Z-score: (kapitalizacja − kapitalizacja zrealizowana) / odchylenie std kapitalizacji
    n++; s1 += r.mcap; s2 += r.mcap * r.mcap;
    const sd = Math.sqrt(Math.max(0, s2 / n - (s1 / n) ** 2));
    const z = sd > 0 ? (r.mcap - r.mcap / r.mvrv) / sd : 0, nupl = 1 - 1 / r.mvrv;
    for (const k of ['ma1400', 'ma200', 'ma111', 'ma350']) R[k].add(t, r.price);
    const maR = r.price / R.ma1400.mean, mayer = r.price / R.ma200.mean, pi = R.ma111.mean / (2 * R.ma350.mean);
    let rel = null;
    if (!isBtc && btcAt) { const b = btcAt(t); if (b) { R.rel.add(t, r.price / b); rel = (r.price / b) / R.rel.mean; } }
    const st = stAt ? stAt(t) : null, ssr = st ? r.mcap / st : null;
    R.iss.add(t, r.iss); R.hr30.add(t, r.hr); R.hr60.add(t, r.hr); R.exs.add(t, r.exs);
    while (f < fng.length && fng[f].t <= t) R.fng.add(fng[f].t, fng[f++].v);
    const fAvg = R.fng.n && t - R.fng.q[R.fng.q.length - 1][0] < 5 * DAY ? R.fng.mean : null;

    let score = null;
    if (t - t0 >= MIN_DAYS * DAY) {
      const ps = [];
      const P = (group, key, label, value, pts, max, note) => ps.push({group, key, label, value, pts: pts * max, max, note});
      const g = GROUPS;
      const zp = 1 - rank(H.z, z);
      P(g[0], 'mvrvz', 'MVRV Z-score', z.toFixed(2), zp, 25, `taniej niż przez ${pctTxt(zp)} historii; realized price ≈ ${fmtUsd(r.price / r.mvrv)}` + (r.approx ? ' (dziś szacunek)' : ''));
      P(g[0], 'nupl', 'NUPL (niezrealizowany zysk)', nupl.toFixed(2), lin(nupl, 0.7, 0), 10, nupl < 0 ? 'kapitulacja: przeciętny posiadacz jest na stracie' : nupl > 0.6 ? 'euforia: przeciętny posiadacz ma duży zysk' : 'od 0 (kapitulacja) do 0,7 (euforia)');
      if (R.ma1400.span > 700) P(g[1], 'ma', 'Cena / średnia 200 tyg.', maR.toFixed(2) + '×', 1 - rank(H.ma, maR), 7, 'średnia ≈ ' + fmtUsd(R.ma1400.mean));
      if (R.ma200.span > 190) P(g[1], 'mayer', 'Mayer Multiple', mayer.toFixed(2), lin(mayer, 2.4, 0.8), 5, 'cena / średnia 200 dni; > 2,4 przegrzanie, < 0,8 okazja');
      if (R.ma350.span > 340) P(g[1], 'pi', 'Pi Cycle Top', pi.toFixed(2), lin(pi, 1, 0.45), 4, '111-dniowa / 2× 350-dniowa; 1,0 = sygnał szczytu');
      if (isBtc) { const c = cyclePhase(t); P(g[1], 'cycle', 'Faza cyklu', Math.round(c.months) + ' mies. po halvingu', c.v, 4, 'historycznie dno 26–36 mies. po halvingu'); }
      else if (rel != null && R.rel.span > 700) P(g[1], 'rel', 'Siła względem BTC', rel.toFixed(2) + '×', 1 - rank(H.rel, rel), 4, `kurs ${ctx.sym}/BTC względem średniej 200 tyg.`);
      if (fAvg != null) P(g[2], 'fng', 'Fear & Greed (30 dni)', Math.round(fAvg), lin(fAvg, 75, 20), 12, 'średnia z 30 dni; strach = okazja, chciwość = ostrożnie');
      if (i === rows.length - 1 && ctx.funding && (!ctx.today || r.date >= ctx.today)) P(g[2], 'fund', 'Funding (7 dni)', (ctx.funding.rate * 100).toFixed(4) + '%', lin(ctx.funding.rate, 0.0003, -0.0001), 8, `stawka co 8 h (${ctx.funding.source}); wysoka = tłok na dźwigni, ujemna = panika`);
      if (ssr != null && H.ssr.length > 200) P(g[3], 'ssr', 'Siła nabywcza stablecoinów', ssr.toFixed(1), 1 - rank(H.ssr, ssr), 10, 'kapitalizacja / podaż stablecoinów; nisko = dużo gotówki czeka na zakupy');
      if (isBtc && R.iss.span > 330) { const pu = R.iss.last / R.iss.mean; P(g[4], 'puell', 'Puell Multiple (górnicy)', pu.toFixed(2), lin(pu, 2.5, 0.5), 6, 'przychód górników / średnia roczna; < 0,5 kapitulacja, > 2,5 szczyt'); }
      if (isBtc && R.hr60.span > 55) { const hb = R.hr30.mean / R.hr60.mean; P(g[4], 'hash', 'Hash Ribbons', hb.toFixed(3), lin(hb, 1.03, 0.95), 4, 'hashrate 30 / 60 dni; < 1 kapitulacja górników'); }
      if (R.exs.span > 80) { const ch = R.exs.last / R.exs.first - 1; P(g[4], 'exs', 'Monety na giełdach (90 dni)', (ch >= 0 ? '+' : '') + (ch * 100).toFixed(1) + '%', lin(ch, 0.03, -0.05), 5, 'spadek = wypłaty do portfeli, akumulacja'); }
      const got = ps.reduce((a, p) => a + p.pts, 0), max = ps.reduce((a, p) => a + p.max, 0);
      score = r1(got / max * 100);
      if (i === rows.length - 1) lastParts = ps.map((p) => ({...p, pts: r1(p.pts)}));
    }
    insert(H.z, z); insert(H.ma, maR); if (rel != null) insert(H.rel, rel); if (ssr != null) insert(H.ssr, ssr);
    return {...r, score};
  });
  return {rows: out, parts: lastParts};
}

// Jedno zdanie dla początkującego: strefa, co robić i co najmocniej za tym stoi.
export function explain(name, score, parts) {
  if (score == null) return '';
  const z = zone(score);
  const ranked = parts.filter((p) => p.max >= 6).map((p) => ({...p, r: p.pts / p.max}));
  const best = [...ranked].sort((a, b) => b.r - a.r)[0], worst = [...ranked].sort((a, b) => a.r - b.r)[0];
  const why = score >= 50 ? (best ? ` Najmocniej za zakupem przemawia wskaźnik „${best.label}”.` : '') : (worst ? ` Najbardziej ostrzega wskaźnik „${worst.label}”.` : '');
  return `${name}: ${z.name.toLowerCase()} (${Math.round(score)}/100). ${z.action}${why}`;
}

/**
 * Seria kryptowaluty: historia z pliku + dane Coin Metrics z API + dzisiejsza cena.
 * hist: {date[], price[], mvrv[], mcap[]}; cm: [{date, price, mvrv, mcap}] (może być puste);
 * chart: [{date, price}] z CoinGecko (gdy API Coin Metrics nie odpowiada); price: dzisiejsza cena.
 */
export function buildSeries(hist, cm, chart, price, today) {
  const rows = hist.date.map((d, i) => ({date: d, price: hist.price[i], mvrv: hist.mvrv[i], mcap: hist.mcap[i], hr: hist.hr?.[i], iss: hist.iss?.[i], exs: hist.exs?.[i]}));
  const base = rows[rows.length - 1];
  const tail = []; // punkty dzienne po końcu historii
  const push = (p) => { const L = tail[tail.length - 1] || base; if (p.date > L.date) tail.push(p); };
  const est = (date, p) => { const L = tail[tail.length - 1] || base; return {date, price: p, mvrv: p / (L.price / L.mvrv), mcap: L.mcap * p / L.price, approx: true}; };
  for (const p of cm || []) push(p);
  if (!cm?.length) for (const p of chart || []) if (p.date > base.date) push(est(p.date, p.price)); // brak Coin Metrics: MVRV z ostatniej znanej realized price
  if (price) push(est(today, price));
  // Co 3 dni jak historia (żeby ostatnie miesiące nie ważyły więcej w percentylach); najnowszy punkt zawsze.
  let prev = base;
  tail.forEach((p, i) => {
    if (i === tail.length - 1 || Date.parse(p.date) - Date.parse(prev.date) >= 3 * DAY) { rows.push(p); prev = p; }
  });
  return rows;
}

// ---------- złoto ----------
// Łączy historię złota (średnie miesięczne) z cenami dziennymi po dacie kalibracji.
export function mergeGold(hist, live) {
  const rows = hist.date.map((d, i) => ({date: d, price: hist.price[i], score: hist.score[i]}));
  const last = hist.date[hist.date.length - 1];
  for (const p of live || []) {
    if (p.date <= last) continue;
    const prev = rows[rows.length - 1], isLast = p === live[live.length - 1];
    if (!isLast && prev.live && Date.parse(p.date) - Date.parse(prev.date) < 3 * DAY) continue;
    if (prev.live && prev.date === p.date) rows.pop();
    rows.push({date: p.date, price: p.price, score: total(goldParts(rows, p.price, p.date)), live: true});
  }
  return rows;
}
// Złoto: bez wskaźników on-chain. Wycena względem własnych średnich, spadek od szczytu i rozpęd 1 i 3 lat.
export function goldParts(rows, price, iso) {
  const t = Date.parse(iso), past = rows.filter((r) => Date.parse(r.date) < t);
  const win = (days) => { const w = past.filter((r) => t - Date.parse(r.date) <= days * DAY).map((r) => r.price); w.push(price); return w.reduce((a, b) => a + b, 0) / w.length; };
  const at = (days) => { let b = null; for (const r of past) if (Date.parse(r.date) <= t - days * DAY) b = r.price; return b || past[0].price; };
  const ma = win(1400), ma52 = win(365), ath = Math.max(price, ...past.map((r) => r.price));
  const c1 = price / at(365) - 1, c3 = price / at(1095) - 1, dd = 1 - price / ath;
  return [
    {key: 'ma', label: 'Cena / średnia 200 tyg.', value: (price / ma).toFixed(2) + '×', pts: lin(price / ma, 1.5, 0.9) * 25, max: 25, note: 'średnia ≈ ' + fmtUsd(ma)},
    {key: 'dd', label: 'Spadek od ATH', value: Math.round(dd * 100) + '%', pts: lin(dd, 0.03, 0.4) * 25, max: 25, note: 'ATH ≈ ' + fmtUsd(ath) + ' (średnie miesięczne)'},
    {key: 'c1', label: 'Zmiana 12 mies.', value: (c1 >= 0 ? '+' : '') + Math.round(c1 * 100) + '%', pts: lin(c1, 0.35, -0.15) * 20, max: 20, note: 'im mocniejszy wzrost, tym drożej'},
    {key: 'ma52', label: 'Cena / średnia 52 tyg.', value: (price / ma52).toFixed(2) + '×', pts: lin(price / ma52, 1.2, 0.92) * 15, max: 15, note: 'średnia ≈ ' + fmtUsd(ma52)},
    {key: 'c3', label: 'Zmiana 3 lata', value: (c3 >= 0 ? '+' : '') + Math.round(c3 * 100) + '%', pts: lin(c3, 0.8, -0.2) * 15, max: 15, note: 'przegrzanie w długim terminie'}
  ].map((p) => ({...p, pts: r1(p.pts)}));
}
export const total = (ps) => r1(ps.reduce((a, p) => a + p.pts, 0));

/**
 * Wszystkie monety naraz. data: {hist (coins z history.json), cm: {btc: [...]}, charts: {BTC: [...]},
 * prices: {BTC: usd}, fng: [{date, value}], stables: [{date, value}], funding: {BTC: {rate, source}}, today}
 * Zwraca {BTC: {series, parts, score, mult, price, approx}, ...}
 */
export function scoreAll(data) {
  const out = {};
  const {hist, cm = {}, charts = {}, prices = {}, fng, stables, funding = {}, today} = data;
  for (const c of COINS) {
    const h = hist[c.sym], price = prices[c.sym];
    if (c.gold) {
      const chart = charts[c.sym] || [];
      const p = price ?? chart[chart.length - 1]?.price ?? h.price[h.price.length - 1];
      const series = mergeGold(h, price ? [...chart, {date: today, price}] : chart);
      const parts = goldParts(series, p, today), score = total(parts);
      out[c.sym] = {series, parts, score, mult: mult(score), tp: null, price: p, explain: explain('Złoto', score, parts)};
      continue;
    }
    const rows = buildSeries(h, cm[c.cm], charts[c.sym], price, today);
    const {rows: series, parts} = scoreSeries(rows, {sym: c.sym, btc: out.BTC?.series, fng, stables, funding: funding[c.sym], today});
    const score = series[series.length - 1].score;
    out[c.sym] = {series, parts, score, mult: mult(score, MULT_CAP[c.sym]), tp: takeProfit(score), price: price ?? series[series.length - 1].price, approx: !cm[c.cm]?.length, explain: explain(c.name, score, parts)};
  }
  return out;
}

// ---------- plan ----------
// Plan zakupów: budżet × udział × mnożnik, łącznie najwyżej 2× budżetu.
// holdings (opcjonalnie): bieżąca wartość portfela {BTC: zł, ...}. Aktywo nadważone o ponad 10 pkt proc.
// względem udziału docelowego jest w tym tygodniu pomijane, a jego część idzie na niedoważone.
export const REBALANCE_BAND = 0.10;
export function plan(budget, weights, scores, holdings) {
  const syms = Object.keys(scores);
  const wsum = syms.reduce((a, s) => a + (weights[s] || 0), 0) || 1;
  const hsum = holdings ? syms.reduce((a, s) => a + (holdings[s] || 0), 0) : 0;
  const rows = syms.map((sym) => {
    const share = (weights[sym] || 0) / wsum, cur = hsum > 0 ? (holdings[sym] || 0) / hsum : null;
    return {sym, share, cur, over: cur != null && cur - share > REBALANCE_BAND, mult: scores[sym].mult, score: scores[sym].score};
  });
  const live = rows.filter((r) => !r.over).reduce((a, r) => a + r.share, 0) || 1;
  rows.forEach((r) => (r.amount = r.over ? 0 : budget * (r.share / live) * r.mult));
  const sum = rows.reduce((a, r) => a + r.amount, 0), cap = 2 * budget;
  if (sum > cap && sum > 0) rows.forEach((r) => (r.amount *= cap / sum));
  return {rows, total: Math.min(sum, cap), rebalanced: rows.some((r) => r.over)};
}

// ---------- backtest ----------
// Stała kwota co tydzień (złoto: co miesiąc) vs ta sama kwota × mnożnik z wyniku z danego dnia.
export function backtest(series, {sym, gold} = {}) {
  const first = series.find((r) => r.score != null);
  if (!first) return [];
  const periods = gold
    ? [['od 2000', '2000-01-01'], ['od 2015', '2015-01-01']]
    : [['od ' + first.date.slice(0, 4), first.date], ['od 2018', '2018-01-01'], ['od szczytu 2021', '2021-11-10']];
  const last = series[series.length - 1].price, cap = MULT_CAP[sym] || 3, step = gold ? 0 : 7 * DAY;
  const out = [];
  const seen = new Set();
  for (const [i, [label, from]] of periods.entries()) {
    if (seen.has(label) || (i > 0 && from < first.date)) continue;
    seen.add(label);
    // a: stała kwota; b: kwota × mnożnik; c: jak b, plus drabinka realizacji zysków (szczeble odnawiają się po powrocie wyniku powyżej 50)
    let prev = -Infinity, used = 0; const a = {inv: 0, u: 0}, b = {inv: 0, u: 0}, c = {inv: 0, u: 0, cash: 0, sold: 0};
    for (const r of series) {
      if (r.date < from || r.score == null) continue;
      if (r.score > 50) used = 0;
      const tp = takeProfit(r.score);
      if (tp && tp.step > used && c.u > 0) {
        const pct = TP_LADDER.slice(used, tp.step).reduce((x, l) => x + l.pct, 0) / 100;
        const left = 1 - TP_LADDER.slice(0, used).reduce((x, l) => x + l.pct, 0) / 100;
        const q = c.u * Math.min(1, pct / left); c.u -= q; c.cash += q * r.price; c.sold += q * r.price; used = tp.step;
      }
      const t = Date.parse(r.date);
      if (t - prev < step) continue;
      prev = t;
      a.inv += 100; a.u += 100 / r.price;
      const m = mult(r.score, cap); b.inv += 100 * m; b.u += 100 * m / r.price;
      c.inv += 100 * m; c.u += 100 * m / r.price;
      if (c.cash > 0 && r.score >= 60) { const q = c.cash * REDEPLOY; c.cash -= q; c.u += q / r.price; } // gotówka ze sprzedaży wraca na rynek w okazjach
    }
    if (!a.inv) continue;
    for (const [name, x] of [['Zwykłe DCA', a], ['DCA z mnożnikiem', b]]) out.push({period: label, strategy: name, invested: x.inv, units: x.u, avg_cost: x.inv / x.u, multiple: x.u * last / x.inv});
    if (!gold && c.sold > 0) out.push({period: label, strategy: '+ realizacja zysków', invested: c.inv, units: c.u, avg_cost: null, multiple: (c.u * last + c.cash) / c.inv, cash: c.cash});
  }
  return out;
}

// ---------- cykle ----------
export function cycles(series) {
  const H = HALVINGS.map((d) => Date.parse(d)), out = [];
  for (let i = 0; i < H.length - 1; i++) {
    const pts = series.filter((r) => { const t = Date.parse(r.date); return t >= H[i] && t < H[i + 1]; });
    if (!pts.length || Date.parse(pts[0].date) - H[i] > 60 * DAY) continue;
    const bull = pts.filter((r) => Date.parse(r.date) - H[i] <= 900 * DAY);
    const peak = bull.reduce((a, r) => (r.price > a.price ? r : a), bull[0]);
    const tp = Date.parse(peak.date);
    const after = pts.filter((r) => Date.parse(r.date) >= tp);
    const bottom = after.reduce((a, r) => (r.price < a.price ? r : a), after[0]);
    out.push({
      cycle: HALVINGS[i].slice(0, 4), halving: H[i], h0: pts[0].price, peak, bottom,
      drawdown: -(1 - bottom.price / peak.price) * 100, daysToBottom: Math.round((Date.parse(bottom.date) - tp) / DAY),
      peakDay: Math.round((tp - H[i]) / DAY), ongoing: Date.parse(pts[pts.length - 1].date) > Date.now() - 30 * DAY,
      pts: pts.map((r) => { const t = Date.parse(r.date); return {...r, dH: Math.round((t - H[i]) / DAY), dP: Math.round((t - tp) / DAY), rH: r.price / pts[0].price, rP: r.price / peak.price}; })
    });
  }
  return out;
}

export function windowChanges(series, n, now = Date.now()) {
  const H = HALVINGS.map((d) => Date.parse(d));
  const cur = Math.max(...H.filter((h) => h <= now));
  const D = Math.round((now - cur) / DAY);
  const s = series.map((r) => ({t: Date.parse(r.date), p: r.price}));
  const at = (t) => { let best = null; for (const r of s) if (Math.abs(r.t - t) <= 4 * DAY && (!best || Math.abs(r.t - t) < Math.abs(best.t - t))) best = r; return best; };
  return {day: D, rows: cycles(series).map((c) => {
    const end = Math.min(c.halving + D * DAY, now);
    const b = at(end), a = at(end - n * DAY);
    return a && b ? {cycle: c.cycle, change: (b.p / a.p - 1) * 100} : null;
  }).filter(Boolean)};
}

export function monthly(series) {
  const last = new Map();
  for (const r of series) last.set(r.date.slice(0, 7), r.price);
  const keys = [...last.keys()].sort(), out = [];
  for (let i = 1; i < keys.length; i++) out.push({year: +keys[i].slice(0, 4), month: +keys[i].slice(5, 7), change: (last.get(keys[i]) / last.get(keys[i - 1]) - 1) * 100});
  return out;
}

// ---------- formatowanie: $ i zł ----------
const dec = (v) => (v >= 1000 ? 0 : v >= 10 ? 2 : 4);
export function fmtUsd(v, d) {
  v = Number(v); d ??= dec(Math.abs(v));
  return v.toLocaleString('pl-PL', {minimumFractionDigits: d, maximumFractionDigits: d}) + ' $';
}
export function fmtPln(v, d) {
  v = Number(v); d ??= Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 10 ? 2 : 4;
  return v.toLocaleString('pl-PL', {minimumFractionDigits: d, maximumFractionDigits: d}) + ' zł';
}
// Cena w obu walutach; bez kursu tylko w $.
export const fmtBoth = (usd, rate) => (rate ? `${fmtUsd(usd)} · ${fmtPln(usd * rate)}` : fmtUsd(usd));

// Histereza alertów: alert włącza się po przekroczeniu progu, a wyłącza dopiero po powrocie o kilka punktów.
export function hysteresis(prev, value, on, off, below = false) {
  if (value == null) return !!prev;
  return below ? (prev ? value < off : value < on) : (prev ? value >= off : value >= on);
}
