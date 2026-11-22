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
  const j = await getJson(`${CG}/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`);
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

// Wykres ceny w wybranym zakresie (1 dzień: co 5 min, 7–90 dni: co godzinę): [{t: ms, price}]
export async function fetchRange(id, days) {
  const j = await getJson(`${CG}/coins/${id}/market_chart?vs_currency=usd&days=${days}`);
  return (j.prices || []).map(([t, price]) => ({t, price}));
}
