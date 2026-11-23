// Dziennik transakcji, stan portfela i rozliczenie PIT-38. Wszystko liczone lokalnie, dane zostają na urządzeniu.
//
// Transakcja: {id, date, asset, type: 'buy'|'sell', qty, value, fee, cur: 'PLN'|'USD', rate?, rateDate?, table?}
// value i fee w walucie transakcji; dla USD rate to kurs NBP z dnia roboczego przed transakcją.

export const ASSETS = [
  {key: 'BTC', label: 'BTC', plan: 'BTC', crypto: true},
  {key: 'ETH', label: 'ETH', plan: 'ETH', crypto: true},
  {key: 'ADA', label: 'ADA', plan: 'ADA', crypto: true},
  {key: 'PAXG', label: 'PAXG (złoto w tokenie)', plan: 'GOLD', crypto: true},
  {key: 'GOLDP', label: 'Złoto fizyczne / ETF', plan: 'GOLD', crypto: false}
];
const A = Object.fromEntries(ASSETS.map((a) => [a.key, a]));
export const TAX = 0.19;

export const toPln = (tx, v) => (tx.cur === 'USD' ? v * (tx.rate || 0) : v);

// Stan portfela po metodzie średniej ceny (do podglądu; podatek liczony jest inaczej, patrz pit()).
export function holdings(txs) {
  const h = {};
  for (const tx of [...txs].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const x = (h[tx.asset] ||= {asset: tx.asset, qty: 0, cost: 0, costUsd: 0});
    const pln = toPln(tx, tx.value), usd = tx.cur === 'USD' ? tx.value : tx.rate ? tx.value / tx.rate : null;
    if (tx.type === 'buy') {
      x.qty += tx.qty; x.cost += pln + toPln(tx, tx.fee || 0);
      x.costUsd = x.costUsd == null || usd == null ? null : x.costUsd + usd + (tx.cur === 'USD' ? tx.fee || 0 : 0);
    } else if (x.qty > 0) {
      const part = Math.min(1, tx.qty / x.qty);
      x.cost -= x.cost * part; if (x.costUsd != null) x.costUsd -= x.costUsd * part; x.qty -= Math.min(tx.qty, x.qty);
    }
  }
  return Object.values(h).filter((x) => x.qty > 1e-12);
}

// PIT-38, kryptowaluty: przychód = sprzedaż za pieniądze, koszty = wydatki na zakup + opłaty w danym roku,
// nadwyżka kosztów nad przychodem przechodzi na kolejne lata. Wymiana krypto na krypto nie jest zdarzeniem
// podatkowym, więc takiej transakcji nie wpisuje się do dziennika. Złoto fizyczne / ETF nie wchodzi do PIT-38 za krypto.
export function pit(txs) {
  const years = new Map();
  for (const tx of txs) {
    if (!A[tx.asset]?.crypto) continue;
    const y = +tx.date.slice(0, 4);
    const r = years.get(y) || {year: y, income: 0, cost: 0};
    if (tx.type === 'sell') { r.income += toPln(tx, tx.value); r.cost += toPln(tx, tx.fee || 0); } else r.cost += toPln(tx, tx.value) + toPln(tx, tx.fee || 0);
    years.set(y, r);
  }
  let carry = 0;
  return [...years.values()].sort((a, b) => a.year - b.year).map((r) => {
    const prior = carry, base = r.income - r.cost - prior;
    const income = Math.round(Math.max(0, base));
    carry = Math.max(0, -base);
    return {...r, prior, income: r.income, gain: income, tax: Math.round(income * TAX), carryOut: carry};
  });
}

// CSV (średnik, polskie liczby) do arkusza lub dla księgowej.
export function toCsv(txs) {
  const n = (v, d = 2) => (v == null || v === '' ? '' : Number(v).toFixed(d).replace('.', ','));
  const head = ['data', 'aktywo', 'typ', 'ilość', 'wartość', 'opłata', 'waluta', 'kurs NBP', 'data kursu', 'tabela NBP', 'wartość zł', 'opłata zł'];
  const lines = [...txs].sort((a, b) => (a.date < b.date ? -1 : 1)).map((t) => [t.date, t.asset, t.type === 'buy' ? 'kupno' : 'sprzedaż', n(t.qty, 8), n(t.value), n(t.fee || 0), t.cur,
    t.cur === 'USD' ? n(t.rate, 4) : '', t.rateDate || '', t.table || '', n(toPln(t, t.value)), n(toPln(t, t.fee || 0))].join(';'));
  return '﻿' + [head.join(';'), ...lines].join('\n');
}
export function fromCsv(text) {
  const rows = text.replace(/^﻿/, '').trim().split(/\r?\n/).slice(1);
  const n = (v) => (v === '' || v == null ? null : parseFloat(String(v).replace(/\s/g, '').replace(',', '.')));
  return rows.map((l) => l.split(';')).filter((c) => c.length >= 7 && A[c[1]]).map((c) => ({
    id: Math.random().toString(36).slice(2, 10), date: c[0], asset: c[1], type: c[2] === 'sprzedaż' ? 'sell' : 'buy',
    qty: n(c[3]), value: n(c[4]), fee: n(c[5]) || 0, cur: c[6] === 'USD' ? 'USD' : 'PLN', rate: n(c[7]), rateDate: c[8] || null, table: c[9] || null
  })).filter((t) => t.date && t.qty > 0 && t.value >= 0);
}
