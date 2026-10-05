# AI Baskets

Rule-based stock baskets inspired by Buffett, Lynch, Jhunjhunwala, Mayer's *100 Baggers* and CANSLIM, over the
NSE **Nifty 500** (Nifty 100 = large, Midcap 150 = mid, Smallcap 250 = small). Educational use only.

```
NSE index lists -> universe + cap tag ┐
Yahoo prices (bulk) ──────────────────┤
Yahoo statements + NSE promoter data ─┤► factors ─► 5 legend scores ─► baskets ─► value series
```

| File | Role |
|---|---|
| `universe.py` | Nifty 100/Midcap 150/Smallcap 250 from NSE (cap segment updates automatically) |
| `prices.py`, `factors.py` | daily history; momentum / trend / liquidity factors |
| `fundamentals.py` | ROE, ROCE, debt, margins, growth, FCF, quarterly YoY from Yahoo statements |
| `scoring/` | the five transparent weighted models (0-100, with positive/negative tags) |
| `definitions.py` | basket rules (add a basket = add one entry) |
| `engine.py` | eligibility, sector / bank caps, capped score weighting |
| `performance.py` | live value tracking + labelled 1-year simulation vs NIFTY 50 / FD |
| `pipeline.py` | refresh stages + scheduler (runs after market close, first run bootstraps ~10 min) |
| `api.py` | `/baskets`, `/baskets/{id}`, `/baskets/stocks/{symbol}/scores`, `/baskets/stocks/ranking` |

Run by hand: `python -c "from baskets.pipeline import run_pipeline; run_pipeline()"` (add `force=True` to rebuild).
Data lives in `india-trade-cli/data/baskets.db` (git-ignored). Config: see `config.py` (`BASKETS_*` env vars).
Tests: `pytest tests/baskets`.

**Honesty notes:** history before a basket's creation date is a *simulation* with hindsight bias (today's holdings on
past prices); live tracking replaces it after 60 days. Banks/NBFCs are scored on fewer rules and capped per basket.
