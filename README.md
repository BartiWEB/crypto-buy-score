# Crypto Buy Score (PWA + Telegram)

Wynik okazji zakupowej 0–100 i tygodniowy plan DCA dla BTC, ETH i ADA. Działa w przeglądarce na darmowych, publicznych API (CoinGecko, alternative.me), bez kluczy i bez zużywania kredytów Claude. Narzędzie analityczne, nie porada inwestycyjna.

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
   - zakładka **Variables** (opcjonalnie): `BUDGET` (np. `200`), `WEIGHTS` (BTC,ETH,ADA w %, np. `70,25,5`), `REPORT_HOUR_UTC` (domyślnie `7`, czyli 8:00 zimą w Polsce).
5. **Actions → Alerts → Run workflow**, zaznacz `force_report`, żeby od razu dostać próbny raport.

Workflow uruchamia się co godzinę (`.github/workflows/alerts.yml`). Wysyła:

- raz dziennie: plan zakupów (kwota i mnożnik dla każdej monety),
- natychmiast, przy zmianie stanu: wynik BTC ≥ 85, Fear & Greed < 10, wynik BTC < 30.

Stan alertów jest w `state/alerts.json`, żeby ten sam alert nie przychodził co godzinę.

## Pliki

| Plik | Co robi |
|---|---|
| `index.html`, `style.css`, `app.js` | aplikacja (HUD) |
| `score.js` | wspólna logika wyniku, planu i cykli (przeglądarka i Node) |
| `api.js` | pobieranie cen i Fear & Greed |
| `data/history.json` | historia Coin Metrics do 05.2026 z kalibracją |
| `sw.js`, `manifest.webmanifest`, `icons/` | instalacja jako aplikacja, praca offline |
| `scripts/alert.mjs` | skrypt alertów Telegram |

Uruchomienie lokalne: `npm run serve`, potem `http://localhost:8080`. Test alertów bez wysyłki: `npm run alert` (bez sekretów działa w trybie próbnym).

## Ograniczenia

Realized price i MVRV po maju 2026 są przybliżone (zamrożona realized price z maja). Dla ADA zawyża to bieżący wynik. Model był najmocniejszy w backteście dla BTC.
