# Crypto Buy Score (PWA + Telegram)

Wynik okazji 0–100 i tygodniowy plan DCA dla BTC, ETH, ADA i złota, z sygnałem realizacji zysków, portfelem i rozliczeniem PIT-38. Ceny w $ i zł. Działa w przeglądarce na darmowych, publicznych API bez kluczy i bez zużywania kredytów Claude. Narzędzie analityczne, nie porada inwestycyjna.

## Jak liczony jest wynik

Jedna skala w obie strony: wysoki wynik = rynek tani i przestraszony, kupuj więcej; poniżej 20 = euforia, nie kupuj i realizuj część zysków drabinką (10% / 15% / 25% pozycji przy wyniku < 20 / < 12 / < 6, gotówka wraca na rynek przy wyniku ≥ 60).

| Grupa | Pkt | Wskaźniki (źródło) |
|---|---|---|
| Wycena on-chain | 35 | MVRV Z-score, NUPL (Coin Metrics) |
| Trend i cykl | 20 | cena / średnia 200 tyg., Mayer Multiple, Pi Cycle Top, faza halvingu; ETH i ADA: siła względem BTC |
| Sentyment | 20 | Fear & Greed, średnia 30 dni (alternative.me), funding 7 dni (OKX, Bybit lub Binance) |
| Płynność | 10 | siła nabywcza stablecoinów: kapitalizacja / podaż stablecoinów (DefiLlama) |
| Zachowanie rynku | 15 | Puell Multiple i Hash Ribbons (górnicy BTC), zmiana zapasu monet na giełdach w 90 dni (Coin Metrics) |

Wskaźniki oceniane percentylem porównują dzisiejszą wartość tylko z wcześniejszą historią monety, więc backtest nie zagląda w przyszłość. Brakujący wskaźnik nie zaniża wyniku (wynik = punkty / dostępne maksimum × 100). Makro (DXY, M2, napływy do ETF) nie ma darmowego źródła dostępnego z przeglądarki, więc nie wchodzi do wyniku. Złoto ma własny model (średnie, spadek od szczytu, zmiana 1 i 3 lat) i nie ma drabinki sprzedaży.

## 1. Wgranie na GitHub

1. Utwórz puste, publiczne repozytorium, np. `crypto-buy-score`.
2. Wgraj całą zawartość tego folderu do gałęzi `main` (w katalogu głównym repo).

## 2. Strona (GitHub Pages)

1. W repo: **Settings → Pages**.
2. Source: **Deploy from a branch**, gałąź `main`, folder `/ (root)`, Save.
3. Po 1–2 minutach aplikacja będzie pod adresem `https://<twoj-login>.github.io/crypto-buy-score/`.

### Instalacja na telefonie

- **iPhone (Safari):** Udostępnij → **Dodaj do ekranu początkowego**.
- **Android (Chrome):** menu ⋮ → **Zainstaluj aplikację** / **Dodaj do ekranu głównego**.

Ceny odświeżają się co minutę, wykresy co 30 minut. Budżet i podział zapisują się na urządzeniu.

## 3. Powiadomienia na Telegram

1. W Telegramie napisz do **@BotFather**, wyślij `/newbot`, nadaj nazwę. Dostaniesz token. **Nie wklejaj go nigdzie poza ustawieniami GitHub.**
2. Napisz dowolną wiadomość do swojego nowego bota.
3. Otwórz w przeglądarce `https://api.telegram.org/bot<TOKEN>/getUpdates` i odczytaj `"chat":{"id": ...}`. To Twój chat id.
4. W repo: **Settings → Secrets and variables → Actions**:
   - zakładka **Secrets**: `TELEGRAM_TOKEN` (token) i `TELEGRAM_CHAT_ID` (chat id),
   - zakładka **Variables** (opcjonalnie): `BUDGET` w zł (np. `200`), `WEIGHTS` (BTC,ETH,ADA,złoto w %, np. `70,25,5,0`), `REPORT_HOUR_UTC` (domyślnie `7`, czyli 8:00 zimą w Polsce).
5. **Actions → Alerts → Run workflow**, zaznacz `force_report`, żeby od razu dostać próbny raport.

Workflow uruchamia się co godzinę (`.github/workflows/alerts.yml`). Wysyła:

- raz dziennie: plan zakupów (kwota i mnożnik dla każdej monety),
- natychmiast, przy zmianie stanu: wynik BTC ≥ 85, Fear & Greed < 10, wynik BTC < 20 (realizacja zysków). Alert wyłącza się dopiero po wyraźnym powrocie (85 → 80, 10 → 15, 20 → 25), żeby nie przychodził co godzinę.

Stan alertów jest w `state/alerts.json`, żeby ten sam alert nie przychodził co godzinę.

## Pliki

| Plik | Co robi |
|---|---|
| `index.html`, `style.css`, `app.js` | aplikacja (HUD) |
| `score.js` | wspólna logika wyniku, planu, backtestu i cykli (przeglądarka i Node) |
| `portfolio.js` | dziennik transakcji, portfel, PIT-38, eksport i import CSV |
| `api.js` | ceny, Fear & Greed, Coin Metrics, stablecoiny, funding, kurs NBP |
| `data/history.json` | historia Coin Metrics do 05.2026 (dalej API na żywo), złoto od 1975 |
| `scripts/build_history.py` | odtwarza `history.json` z plików CSV Coin Metrics |
| `sw.js`, `manifest.webmanifest`, `icons/` | instalacja jako aplikacja, praca offline |
| `scripts/alert.mjs` | skrypt alertów Telegram |

Uruchomienie lokalne: `npm run serve`, potem `http://localhost:8080`. Test alertów bez wysyłki: `npm run alert` (bez sekretów działa w trybie próbnym).

## Ograniczenia

- Dzisiejsze MVRV to szacunek z wczorajszej realized price (Coin Metrics publikuje dane dzienne z opóźnieniem jednego dnia). Gdy API Coin Metrics nie odpowiada, MVRV liczone jest z ostatniej znanej realized price i aplikacja to pokazuje.
- Funding nie ma historii, więc nie ma go w backteście. Fear & Greed jest od 2018 r., stablecoiny od końca 2017 r.
- Realizacja zysków w backteście: od 2018 r. wynik zbliżony do samego DCA z mnożnikiem, w całej historii BTC gorszy, bo część pozycji czekała w gotówce podczas wzrostów. To świadomy kompromis: mniejsze ryzyko kosztem części zysku.
- Dziennik transakcji jest zapisany tylko na urządzeniu. Rób kopię CSV.
- Rozliczenie PIT-38 to pomoc w wyliczeniu, nie porada podatkowa.
