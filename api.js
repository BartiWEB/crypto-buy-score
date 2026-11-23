// Darmowe, publiczne API bez kluczy:
// CoinGecko (ceny), alternative.me (Fear & Greed), Coin Metrics Community (MVRV, kapitalizacja, górnicy, giełdy),
// DefiLlama (podaż stablecoinów),
// OKX / Bybit / Binance (funding kontraktów), NBP (kurs USD/PLN).
const CG = 'https://api.coingecko.com/api/v3';
const CM = 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics';
const NBP = 'https://api.nbp.pl/api/exchangerates/rates/a/usd';
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

async function getJson(url) {
  const r = await fetch(url, {headers: {accept: 'application/json'}});
  if (!r.ok) throw new Error(`${url.split('?')[0]} odpowiedział ${r.status}`);
  return r.json();
}

// {bitcoin: {usd, usd_24h_change}, ...}
export async function fetchPrices(ids) {
  return getJson(`${CG}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`);
}

// Ostatnie 365 dni, punkt dziennie: [{date: 'YYYY-MM-DD', price}]
export async function fetchChart(id) {
  const j = await getJson(`${CG}/coins/${id}/market_chart?vs_currency=usd&days=365`);
  const byDay = new Map();
  for (const [t, p] of j.prices || []) byDay.set(iso(t), p);
  return [...byDay.entries()].map(([date, price]) => ({date, price}));
}

// {value, label, week, month}
export async function fetchFng() {
  const j = await getJson('https://api.alternative.me/fng/?limit=31');
  const d = j.data || [];
  return {value: +d[0]?.value, label: d[0]?.value_classification, week: +d[7]?.value, month: +d[30]?.value};
}
// Cała historia Fear & Greed (od 02.2018): [{date, value}] rosnąco.
export async function fetchFngHistory() {
  const j = await getJson('https://api.alternative.me/fng/?limit=0');
  return (j.data || []).map((d) => ({date: iso(+d.timestamp * 1000), value: +d.value})).sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Jedno zapytanie dla wszystkich monet: cena, zmiana 24h i 7 dni co godzinę.
// {bitcoin: {usd, usd_24h_change, spark: [{t, price}]}, ...}
export async function fetchMarkets(ids) {
  const j = await getJson(`${CG}/coins/markets?vs_currency=usd&ids=${ids.join(',')}&sparkline=true&price_change_percentage=24h`);
  const out = {};
  for (const c of j) {
    const sp = c.sparkline_in_7d?.price || [], end = Date.parse(c.last_updated) || Date.now();
    out[c.id] = {usd: c.current_price, usd_24h_change: c.price_change_percentage_24h,
      spark: sp.map((price, i) => ({t: end - (sp.length - 1 - i) * 3600e3, price}))};
  }
  return out;
}

// Coin Metrics: dzienne MVRV, cena i kapitalizacja od podanej daty, dla BTC także hashrate i emisja w $,
// dla BTC i ETH zapas monet na giełdach. {btc: [{date, price, mvrv, mcap (mln $), hr?, iss?, exs?}], ...}
const EXTRA = {btc: 'HashRate,IssTotUSD,SplyExNtv', eth: 'SplyExNtv'};
async function cmPages(url) {
  const rows = [];
  for (let page = 0; url && page < 10; page++) { const j = await getJson(url); rows.push(...(j.data || [])); url = j.next_page_url; }
  return rows;
}
export async function fetchOnchain(assets, start) {
  const q = (a, m) => `${CM}?assets=${a}&metrics=${m}&frequency=1d&start_time=${start}&page_size=10000`;
  const base = await cmPages(q(assets.join(','), 'PriceUSD,CapMVRVCur,CapMrktCurUSD'));
  const out = Object.fromEntries(assets.map((a) => [a, []]));
  for (const r of base) {
    const p = +r.PriceUSD, m = +r.CapMVRVCur, c = +r.CapMrktCurUSD;
    if (p > 0 && m > 0 && c > 0) out[r.asset]?.push({date: r.time.slice(0, 10), price: p, mvrv: m, mcap: c / 1e6});
  }
  for (const a of assets) {
    out[a].sort((x, y) => (x.date < y.date ? -1 : 1));
    if (!EXTRA[a]) continue;
    try { // dodatkowe wskaźniki są opcjonalne
      const by = new Map((await cmPages(q(a, EXTRA[a]))).map((r) => [r.time.slice(0, 10), r]));
      for (const row of out[a]) {
        const e = by.get(row.date); if (!e) continue;
        if (e.HashRate) row.hr = +e.HashRate; if (e.IssTotUSD) row.iss = +e.IssTotUSD; if (e.SplyExNtv) row.exs = +e.SplyExNtv;
      }
    } catch { /* bez dodatkowych wskaźników */ }
  }
  return out;
}

// Łączna podaż stablecoinów (DefiLlama), co 3 dni: [{date, value (mln $)}].
export async function fetchStables() {
  const j = await getJson('https://stablecoins.llama.fi/stablecoincharts/all');
  const out = []; let prev = 0;
  for (const d of j) {
    const t = +d.date * 1000, v = d.totalCirculatingUSD?.peggedUSD;
    if (!v || (t - prev < 3 * DAY && d !== j[j.length - 1])) continue;
    out.push({date: iso(t), value: Math.round(v / 1e6)}); prev = t;
  }
  return out;
}

// Średni funding z ostatnich 7 dni (21 rozliczeń co 8 h) dla kontraktu SYM/USDT. Kolejno OKX, Bybit, Binance,
// bo giełdy blokują różne regiony. {rate, source}
export async function fetchFunding(sym) {
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const tries = [
    ['OKX', async () => (await getJson(`https://www.okx.com/api/v5/public/funding-rate-history?instId=${sym}-USDT-SWAP&limit=21`)).data.map((d) => +d.realizedRate || +d.fundingRate)],
    ['Bybit', async () => (await getJson(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${sym}USDT&limit=21`)).result.list.map((d) => +d.fundingRate)],
    ['Binance', async () => (await getJson(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}USDT&limit=21`)).map((d) => +d.fundingRate)]
  ];
  for (const [source, fn] of tries) {
    try { const a = (await fn()).filter(isFinite); if (a.length) return {rate: avg(a), source}; } catch { /* następna giełda */ }
  }
  throw new Error('funding niedostępny');
}

// Kurs średni NBP (tabela A). Bez daty: najnowszy. {rate, date}
export async function fetchUsdPln() {
  const j = await getJson(`${NBP}/?format=json`);
  return {rate: j.rates[0].mid, date: j.rates[0].effectiveDate};
}
// Kurs z ostatniego dnia roboczego PRZED datą transakcji (tak liczy się koszty i przychody do PIT-38).
export async function nbpRateBefore(date) {
  const t = Date.parse(date);
  const j = await getJson(`${NBP}/${iso(t - 10 * DAY)}/${iso(t - DAY)}/?format=json`);
  const r = j.rates[j.rates.length - 1];
  return {rate: r.mid, date: r.effectiveDate, table: r.no};
}
