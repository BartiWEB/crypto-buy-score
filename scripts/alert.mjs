// Alerty i codzienny raport na Telegram. Uruchamiany co godzinę przez GitHub Actions.
// Sekrety: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID. Zmienne (opcjonalne): BUDGET (zł, np. 200), WEIGHTS (BTC,ETH,ADA,złoto w %, np. 70,25,5,0), REPORT_HOUR_UTC (domyślnie 7).
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {COINS, scoreAll, plan, fmtUsd, fmtPln, zone, hysteresis} from '../score.js';
import {fetchPrices, fetchChart, fetchFng, fetchFngHistory, fetchOnchain, fetchStables, fetchFunding, fetchUsdPln} from '../api.js';

const root = new URL('..', import.meta.url);
const STATE = new URL('state/alerts.json', root);
const env = process.env;
const budget = Number(env.BUDGET || 200);
const [wb, we, wa, wg = 0] = (env.WEIGHTS || '70,25,5,0').split(',').map(Number);
const weights = {BTC: wb, ETH: we, ADA: wa, GOLD: wg};
const reportHour = Number(env.REPORT_HOUR_UTC || 7);
const force = env.FORCE_REPORT === 'true';
const dry = !env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID;
const soft = (p) => p.catch((e) => { console.warn('Pominięto:', e.message); return null; });

const hist = JSON.parse(await readFile(new URL('data/history.json', root), 'utf8')).coins;
let state = {};
try { state = JSON.parse(await readFile(STATE, 'utf8')); } catch { /* pierwszy start */ }

const today = new Date().toISOString().slice(0, 10);
const raw = await fetchPrices(COINS.map((c) => c.id));
const [fng, fngHist, cm, stables, fx] = await Promise.all([soft(fetchFng()), soft(fetchFngHistory()), soft(fetchOnchain(['btc', 'eth', 'ada'], hist.BTC.cal.date)), soft(fetchStables()), soft(fetchUsdPln())]);
const funding = {}, charts = {}, prices = {};
for (const c of COINS) {
  prices[c.sym] = raw[c.id].usd;
  if (!c.gold) { const f = await soft(fetchFunding(c.sym)); if (f) funding[c.sym] = f; }
  if (c.gold || !cm) charts[c.sym] = (await soft(fetchChart(c.id))) || [];
}
const res = scoreAll({hist, cm: cm || {}, charts, prices, fng: fngHist || [], stables: stables || [], funding, today});
const scores = Object.fromEntries(COINS.map((c) => [c.sym, {...res[c.sym], chg: raw[c.id].usd_24h_change}]));
const rate = fx?.rate;

const pl = plan(budget, weights, scores);
const sign = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
const price = (usd) => fmtUsd(usd) + (rate ? ` / ${fmtPln(usd * rate)}` : '');
const lines = COINS.map((c) => { const s = scores[c.sym]; return `${c.gold ? 'Złoto' : c.sym} ${price(s.price)} (${sign(s.chg)}) · wynik ${Math.round(s.score)} (${zone(s.score).name.toLowerCase()}) · ${s.mult}×`; });
const planLine = pl.rows.map((r) => `${r.sym === 'GOLD' ? 'złoto' : r.sym} ${Math.round(r.amount)} zł`).join(' · ') + ` (razem ${Math.round(pl.total)} zł z budżetu ${budget} zł tyg.)`;

// Histereza: alert włącza się po przekroczeniu progu i wyłącza dopiero po wyraźnym powrocie, żeby nie przychodził co godzinę.
const btc = scores.BTC;
const now = {
  btc85: hysteresis(state.btc85, btc.score, 85, 80),
  fng10: hysteresis(state.fng10, fng?.value, 10, 15, true),
  btc20: hysteresis(state.btc20, btc.score, 20, 25, true)
};
const msgs = [];
if (now.btc85 && !state.btc85) msgs.push(`⚠ BTC: wynik ${Math.round(btc.score)} przekroczył 85, mnożnik ${btc.mult}×. ${btc.explain} Historycznie strefa okazji, ale cena może jeszcze spaść.`);
if (now.fng10 && !state.fng10) msgs.push(`⚠ Fear & Greed spadł do ${fng.value} (skrajny strach).`);
if (now.btc20 && !state.btc20) msgs.push(`⚠ BTC: wynik ${Math.round(btc.score)} poniżej 20, euforia. Nie kupuj, zrealizuj ${btc.tp?.pct ?? 10}% pozycji (drabinka w aplikacji). Pamiętaj o 19% podatku od zysku.`);

const hourUtc = new Date().getUTCHours();
if (force || (hourUtc >= reportHour && state.lastReport !== today)) {
  msgs.push(['☀ Plan dnia, Crypto Buy Score', btc.explain, ...lines, fng ? `Fear & Greed: ${fng.value} (${fng.label})` : null, rate ? `USD/PLN (NBP): ${rate.toFixed(4)}` : null,
    `Kwoty tygodniowe: ${planLine}`, 'To analiza, nie porada inwestycyjna.'].filter(Boolean).join('\n'));
  state.lastReport = today;
}
delete state.btc30; // poprzedni próg sprzedaży
Object.assign(state, now);

for (const text of msgs) {
  if (dry) { console.log('[bez Telegrama]\n' + text); continue; }
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({chat_id: env.TELEGRAM_CHAT_ID, text})
  });
  if (!r.ok) throw new Error('Telegram odpowiedział ' + r.status + ': ' + (await r.text()));
}
await mkdir(new URL('state/', root), {recursive: true});
await writeFile(STATE, JSON.stringify(state, null, 2) + '\n');
console.log(lines.join('\n'));
console.log(`Wysłano wiadomości: ${msgs.length}`);
