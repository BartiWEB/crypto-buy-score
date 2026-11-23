// Alerty i codzienny raport na Telegram. Uruchamiany co godzinę przez GitHub Actions.
// Sekrety: TELEGRAM_TOKEN, TELEGRAM_CHAT_ID. Zmienne (opcjonalne): BUDGET (np. 200), WEIGHTS (BTC,ETH,ADA,złoto w %, np. 70,25,5,0), REPORT_HOUR_UTC (domyślnie 7).
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {COINS, mergeSeries, liveScore, plan, fmtUsd} from '../score.js';
import {fetchPrices, fetchChart, fetchFng} from '../api.js';

const root = new URL('..', import.meta.url);
const STATE = new URL('state/alerts.json', root);
const env = process.env;
const budget = Number(env.BUDGET || 200);
const [wb, we, wa, wg = 0] = (env.WEIGHTS || '70,25,5,0').split(',').map(Number);
const weights = {BTC: wb, ETH: we, ADA: wa, GOLD: wg};
const reportHour = Number(env.REPORT_HOUR_UTC || 7);
const force = env.FORCE_REPORT === 'true';
const dry = !env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID;

const hist = JSON.parse(await readFile(new URL('data/history.json', root), 'utf8')).coins;
let state = {};
try { state = JSON.parse(await readFile(STATE, 'utf8')); } catch { /* pierwszy start */ }

const today = new Date().toISOString().slice(0, 10);
const prices = await fetchPrices(COINS.map((c) => c.id));
const fng = await fetchFng().catch(() => null);
const scores = {};
for (const c of COINS) {
  const chart = await fetchChart(c.id).catch(() => []);
  const p = prices[c.id];
  const series = mergeSeries(hist[c.sym], [...chart, {date: today, price: p.usd}]);
  scores[c.sym] = {...liveScore(hist[c.sym], series, p.usd, today), price: p.usd, chg: p.usd_24h_change};
}
const pl = plan(budget, weights, scores);
const sign = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
const lines = COINS.map((c) => { const s = scores[c.sym]; return `${c.gold ? 'Złoto' : c.sym} ${fmtUsd(s.price)} (${sign(s.chg)}) · wynik ${Math.round(s.score)} · ${s.mult}×`; });
const planLine = pl.rows.map((r) => `${r.sym} ${Math.round(r.amount)}`).join(' · ') + ` (razem ${Math.round(pl.total)} z budżetu ${budget} tyg.)`;

const msgs = [];
const now = {btc85: scores.BTC.score >= 85, fng10: fng ? fng.value < 10 : false, btc30: scores.BTC.score < 30};
if (now.btc85 && !state.btc85) msgs.push(`⚠ BTC: wynik ${Math.round(scores.BTC.score)} przekroczył 85, mnożnik 3×. Historycznie strefa okazji, ale cena może jeszcze spaść.`);
if (now.fng10 && !state.fng10) msgs.push(`⚠ Fear & Greed spadł do ${fng.value} (skrajny strach).`);
if (now.btc30 && !state.btc30) msgs.push(`⚠ BTC: wynik ${Math.round(scores.BTC.score)} poniżej 30, rynek drogi. Mnożnik 0,5×, rozważ realizację części zysków.`);

const hourUtc = new Date().getUTCHours();
if (force || (hourUtc >= reportHour && state.lastReport !== today)) {
  msgs.push(['☀ Plan dnia, Crypto Buy Score', ...lines, fng ? `Fear & Greed: ${fng.value} (${fng.label})` : null, `Kwoty tygodniowe: ${planLine}`, 'To analiza, nie porada inwestycyjna.'].filter(Boolean).join('\n'));
  state.lastReport = today;
}
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
