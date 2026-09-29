# Vermax — NSE swing-trading decision platform

Daily "what to buy tomorrow" list for Indian equities: **stop-loss, two targets, position size, reasons**, with a
**Defence & Engineering priority**, fundamentals + news overlays, and a forward paper-trade journal.
Holding period ≤ 10 trading days.

```
apps/api   NestJS (port 4100)  ingest NSE bhavcopy · orchestration · sentiment · journal · scheduler · REST
ml/        Python (LightGBM)   features · walk-forward research · model · scorer · fundamentals · tracker
apps/web   React + Vite (5190) Tomorrow · Sectors · Journal · Backtest · Stock pages
data/      market.sqlite (seeded from the legacy NSE Picks DB, 2019→), picks/*.json, models/, research/
docs/      BACKTEST.md (generated out-of-sample report)
```

## How a pick is made (each evening after ~18:45 IST)

1. **Ingest** NSE end-of-day (bhavcopy + delivery % + index closes) — `DataService`.
2. **Features** per stock-day (`ml/vermax/features.py`): trend/momentum, ATR/ADX/RSI, squeeze & base structure, volume/delivery
   surge, candle shape (hammer, engulfing, NR7, inside bar), 4 event setups (20-day breakout, pullback-to-EMA, squeeze breakout,
   52-week-high breakout), **market regime** (Nifty vs 50/200-DMA, VIX, breadth), **sector strength** (equal-weight sector baskets, rank
   vs all sectors) and Defence/Engineering theme flags.
3. **Model**: LightGBM regression on the cross-sectional rank of the 10-day forward return (all ~1,000 liquid stocks), trained
   walk-forward (train < year Y, test year Y, 15-day embargo).
4. **Priority tilt**: Defence/Engineering stocks get `+0.03` on the ranking score **only while their sector ranks ≥ 60th percentile**
   among all sectors (point-in-time). Max 2 picks per sector.
5. **Overlays** (live only — free data has no point-in-time history): fundamentals via Yahoo (ROE, ROCE, debt/equity, sales & profit
   CAGR, operating cash-flow, promoter holding, results-date gap risk → PASS/WATCH/AVOID; vetoes weak/loss-making/over-levered/
   results-in-7-days) and Google-News sentiment with a transparent finance lexicon (vetoes recent fraud/SEBI/ED/insolvency headlines).
6. **Trade plan** per pick: buy next open (skip if gap > +2.5%) · stop = 1.5×ATR clamped to 3–6% · book 50% at 1.5R and move stop to
   breakeven · exit the rest at 3R · hard exit on day 10. Size = 1% risk ÷ stop distance (max 20% of capital, halved in a DEFENSIVE regime).
7. **Journal**: every published pick is paper-traded with those exact rules, so live results can confirm or refute the backtest.

## Honest results (docs/BACKTEST.md — out-of-sample 2021 → Sep 2026, 0.40% round-trip costs)

| | Expectancy/trade | Profit factor | Positive trades |
|---|---:|---:|---:|
| Random 5 liquid stocks/day, same exits | −0.26% | 0.91 | 42.5% |
| Model top-5 | +0.30% | 1.12 | 46.9% |
| **Model top-5 + Defence/Engineering tilt (published)** | **+0.43%** | **1.17** | **47.4%** |

* The ranking is better than chance every year (rank-IC 0.05–0.09), but the money edge per trade is **thin**. Portfolio sim
  ≈ +20% CAGR with ~−30% max drawdown; **2025 and 2026 YTD were flat/negative**. Weeks ≥ +5% happen in ~7% of weeks.
  **Weekly +5–12% is not a realistic target for any system**; this is a small-edge, controlled-risk tool.
* **Defence is not "always strong"**: model picks in Defence were −0.22%/trade overall (positive only in 2023), Engineering +0.74%.
  That is why the priority is *conditional on the sector's own strength*, not permanent. Theme picks made when the sector ranks ≥ 60th pct:
  +0.63%/trade; below it: +0.18%.
* Caveats: tilt weight was chosen after seeing OOS results; Defence/Engineering name lists use today's knowledge (survivorship).

## Run it

```bash
npm install                                   # once (Python deps: pandas numpy lightgbm scikit-learn pyarrow yfinance)
python ml/seed_from_legacy.py <legacy.sqlite> data/market.sqlite   # one-off, already done
cd ml && python -m vermax.cli train           # ~2 min: builds features, trains final model -> data/models/
cd .. && npm run build -w api && node apps/api/dist/main.js       # API on :4100 (Swagger at /docs)
npm run dev:web                               # UI on :5190
```

Press **Refresh picks** in the UI (or `POST /api/pipeline/run`) — ingest → score → fundamentals → news → publish (~3 min first time).
The scheduler runs it weekdays 18:45 IST and retrains on Sundays 09:00 IST. Research: `npm run ml:research` then
`cd ml && python -m vermax.report` regenerates `docs/BACKTEST.md`.

Config via env: `PICKS_MIN_PRICE/MAX_PRICE` (default 200/500), `CAPITAL`, `RISK_PER_TRADE`, `PYTHON_BIN`, `PORT`, `SCHEDULER_ENABLED`.

## Not financial advice
Statistical decision support. Publishing these picks to others requires SEBI Research Analyst registration in India.
