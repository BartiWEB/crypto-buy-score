"""Buduje data/history.json z plików CSV Coin Metrics (github.com/coinmetrics/data).

Użycie: python3 scripts/build_history.py katalog_z_csv
Dla BTC, ETH, ADA zapisuje co 3 dni: cenę, MVRV i kapitalizację (mln $),
dla BTC także hashrate i emisję w $ (Puell, Hash Ribbons), dla BTC i ETH zapas monet na giełdach.
Wynik liczy się w przeglądarce, więc tu nie ma już gotowych punktów ani backtestu.
Złoto zostaje bez zmian (średnie miesięczne z datasets/gold-prices).
"""
import csv, json, sys, pathlib

src = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'history.json'
old = json.loads(out.read_text())
coins = {}
for sym in ['BTC', 'ETH', 'ADA']:
    rows = []
    with open(src / f'{sym.lower()}.csv', newline='') as f:
        for r in csv.DictReader(f):
            try:
                p, m, c = float(r['PriceUSD']), float(r['CapMVRVCur']), float(r['CapMrktCurUSD'])
            except (ValueError, KeyError):
                continue
            if p > 0 and m > 0 and c > 0:
                x = lambda k: float(r[k]) if r.get(k) else None
                rows.append((r['time'][:10], p, m, c, x('HashRate'), x('IssTotUSD'), x('SplyExNtv')))
    keep = rows[::-1][::3][::-1]  # co 3 dni, ostatni dzień zawsze
    sig = lambda v: float(f'{v:.6g}')
    coins[sym] = {
        'date': [r[0] for r in keep],
        'price': [sig(r[1]) for r in keep],
        'mvrv': [round(r[2], 4) for r in keep],
        'mcap': [round(r[3] / 1e6) for r in keep],
        **({'hr': [sig(r[4]) if r[4] else None for r in keep], 'iss': [round(r[5]) if r[5] else None for r in keep]} if sym == 'BTC' else {}),
        **({'exs': [round(r[6]) if r[6] else None for r in keep]} if sym in ('BTC', 'ETH') else {}),
        'cal': {'date': keep[-1][0], 'ath': max(r[1] for r in rows)},
    }
coins['GOLD'] = old['coins']['GOLD']
coins['GOLD'].pop('backtest', None)
data = {'source': 'Coin Metrics community data (github.com/coinmetrics/data), co 3 dni, do ' + coins['BTC']['cal']['date'] +
        '; dalej Coin Metrics Community API na żywo. Złoto: datasets/gold-prices (średnie miesięczne od 1975).', 'coins': coins}
out.write_text(json.dumps(data, separators=(',', ':')))
print({k: (len(v['date']), v['date'][0], v['date'][-1]) for k, v in coins.items()}, out.stat().st_size)
