// Darmowe, publiczne API bez kluczy: CoinGecko (ceny) i alternative.me (Fear & Greed).
const CG = 'https://api.coingecko.com/api/v3';

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
  for (const [t, p] of j.prices || []) byDay.set(new Date(t).toISOString().slice(0, 10), p);
  return [...byDay.entries()].map(([date, price]) => ({date, price}));
}

// {value, label, week, month}
export async function fetchFng() {
  const j = await getJson('https://api.alternative.me/fng/?limit=31');
  const d = j.data || [];
  return {value: +d[0]?.value, label: d[0]?.value_classification, week: +d[7]?.value, month: +d[30]?.value};
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
