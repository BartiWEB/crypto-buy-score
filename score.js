// Wspólna logika wyniku 0–100 (przeglądarka i skrypt alertów).
// Te same progi co w panelu Crypto Buy Score i w score.py.

export const COINS = [
  {sym: 'BTC', id: 'bitcoin', name: 'Bitcoin'},
  {sym: 'ETH', id: 'ethereum', name: 'Ethereum'},
  {sym: 'ADA', id: 'cardano', name: 'Cardano'},
  {sym: 'GOLD', id: 'pax-gold', name: 'Złoto', gold: true} // cena z PAX Gold (1 token = 1 uncja)
];
export const HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20', '2028-04-15'];
const DAY = 86400000;

const lin = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
export const mult = (s) => (s < 30 ? 0.5 : s < 50 ? 1 : s < 70 ? 1.5 : s < 85 ? 2 : 3);
export const bucket = (s) => (s < 30 ? 'red' : s < 50 ? 'slate' : s < 70 ? 'amber' : 'green');

// Łączy historię (Coin Metrics, co 3 dni) z cenami dziennymi z CoinGecko po dacie kalibracji.
export function mergeSeries(hist, live) {
  const rows = hist.date.map((d, i) => ({date: d, price: hist.price[i], score: hist.score[i], live: false}));
  const last = hist.date[hist.date.length - 1];
  let ath = Math.max(hist.cal.ath || 0, ...hist.price);
  for (const p of live || []) {
    if (p.date <= last) continue;
    const prev = rows[rows.length - 1], isLast = p === live[live.length - 1];
    if (!isLast && prev.live && Date.parse(p.date) - Date.parse(prev.date) < 3 * DAY) continue; // ten sam krok co historia; ostatni punkt zawsze
    if (prev.live && prev.date === p.date) rows.pop();
    ath = Math.max(ath, p.price);
    const s = hist.gold ? total(goldParts(rows, p.price, p.date)) : total(parts(p.price, ma200w(rows, p.date, p.price), hist.cal.realized, ath, p.date, hist.cal.k));
    rows.push({date: p.date, price: p.price, score: s, live: true});
  }
  return rows;
}

export function ma200w(rows, iso, price) {
  const t = Date.parse(iso);
  const win = rows.filter((r) => t - Date.parse(r.date) <= 1400 * DAY).map((r) => r.price);
  if (price != null) win.push(price);
  return win.reduce((a, b) => a + b, 0) / win.length;
}

export function parts(price, ma, rp, ath, iso, k) {
  const m = price / rp, z = k * (m - 1), nupl = 1 - 1 / m, dd = 1 - price / ath;
  const t = Date.parse(iso);
  const last = Math.max(...HALVINGS.map((d) => Date.parse(d)).filter((h) => h <= t));
  const months = (t - last) / DAY / 30.44;
  const cyc = months >= 26 && months <= 36 ? 1 : months > 36 || (months >= 22 && months < 26) ? 0.6 : months >= 12 && months <= 20 ? 0.1 : 0.4;
  return [
    {key: 'mvrvz', label: 'MVRV Z-score', value: z.toFixed(2), pts: lin(z, 3, -0.3) * 25, max: 25, note: 'przybliżony z ceny / realized price'},
    {key: 'ma', label: 'Cena / średnia 200 tyg.', value: (price / ma).toFixed(2) + '×', pts: lin(price / ma, 2, 0.8) * 20, max: 20, note: 'średnia ≈ ' + fmtUsd(ma)},
    {key: 'rp', label: 'Cena / realized price', value: m.toFixed(2) + '×', pts: lin(m, 2.5, 0.9) * 20, max: 20, note: 'realized ≈ ' + fmtUsd(rp) + ' (05.2026)'},
    {key: 'nupl', label: 'NUPL', value: nupl.toFixed(2), pts: lin(nupl, 0.6, -0.1) * 12, max: 12, note: '1 − 1/MVRV'},
    {key: 'cycle', label: 'Faza cyklu', value: Math.round(months) + ' mies. po halvingu', pts: cyc * 12, max: 12, note: 'cykl halvingowy BTC'},
    {key: 'dd', label: 'Spadek od ATH', value: Math.round(dd * 100) + '%', pts: lin(dd, 0.1, 0.75) * 11, max: 11, note: 'ATH ≈ ' + fmtUsd(ath)}
  ].map((p) => ({...p, pts: Math.round(p.pts * 10) / 10}));
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
  ].map((p) => ({...p, pts: Math.round(p.pts * 10) / 10}));
}

export const total = (ps) => Math.round(ps.reduce((a, p) => a + p.pts, 0) * 10) / 10;

export function liveScore(hist, series, price, iso) {
  if (hist.gold) { const ps = goldParts(series, price, iso), s = total(ps); return {parts: ps, score: s, mult: mult(s)}; }
  const ath = Math.max(price, hist.cal.ath, ...series.map((r) => r.price));
  const ps = parts(price, ma200w(series, iso, price), hist.cal.realized, ath, iso, hist.cal.k);
  const s = total(ps);
  return {parts: ps, score: s, mult: mult(s)};
}

// Plan zakupów: budżet × udział × mnożnik, łącznie najwyżej 2× budżetu.
export function plan(budget, weights, scores) {
  const wsum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  let rows = Object.keys(scores).map((sym) => ({sym, share: (weights[sym] || 0) / wsum, mult: scores[sym].mult, score: scores[sym].score}));
  rows.forEach((r) => (r.amount = budget * r.share * r.mult));
  const sum = rows.reduce((a, r) => a + r.amount, 0), cap = 2 * budget;
  if (sum > cap && sum > 0) rows.forEach((r) => (r.amount *= cap / sum));
  return {rows, total: Math.min(sum, cap)};
}

// Cykle halvingowe jednej monety.
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

export function fmtUsd(v) {
  v = Number(v);
  const d = v >= 1000 ? 0 : v >= 10 ? 2 : 4;
  return v.toLocaleString('pl-PL', {minimumFractionDigits: d, maximumFractionDigits: d}) + ' $';
}
