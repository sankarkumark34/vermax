# Vermax — NSE swing-trading decision platform

Daily "what to buy tomorrow" list for Indian equities: **stop-loss, two targets, position size, reasons**, with a
**Defence & Engineering (incl. AI / data-centre infra) priority**, fundamentals + news overlays, IPO screeners. Holding period ≤ 10 trading days.

```
apps/api   NestJS (port 4100)  ingest NSE data · pipeline · sentiment · alerts · scheduler · REST · serves the built UI
ml/        Python (LightGBM)   features · walk-forward research · blend model · scorer · fundamentals · screeners · health
apps/web   React + Vite        Tomorrow · Stock Analysis · IPO Stocks · IPO Screener · IPO Study · Stock
scripts/   start-vermax.cmd (auto-restart supervisor) · install/uninstall-autostart.cmd · .env.example.cmd
data/      market.sqlite (NSE EOD since 2019) · derivs.sqlite (FII/F&O OI) · picks/ · models/ · research/ · screener/
docs/      BACKTEST.md (generated) · Vermax-Technical-Documentation.pdf
```

## How a pick is made (weekdays 18:45 IST, retry 20:30)

1. **Ingest** NSE bhavcopy + delivery + index closes; recent sessions whose index/delivery files arrived late are re-fetched.
2. **Derivatives**: NSE participant-wise OI (FII/DII/Client/Pro) and stock F&O open interest into `derivs.sqlite` (context only).
3. **Features** (~70 per stock-day): trend/momentum, ATR/ADX/RSI, squeeze/base, volume & delivery surge, candles, 4 event setups,
   market regime, sector strength, Defence/Engineering flags.
4. **Model**: blend of a **5-seed LightGBM regressor ensemble** and a **LightGBM LambdaRank ranker** (average of daily percentile ranks),
   target = cross-sectional rank of the 10-day forward return. Validated walk-forward (train < year Y, 15-day embargo).
5. **Selection**: ₹200–650, liquid, up over the last 10 sessions, `+0.03` tilt for Defence/Engineering while their sector is ≥ 60th pct,
   max 2 per sector; fundamentals (ROE/ROCE/D-E/growth/cash-flow) and news red-flag vetoes. **Elite 3** adds uptrend + strong sector + PASS.
6. **Trade plan**: buy next open (skip if gap > +2.5%) · stop 1.5×ATR (3–6%) · 50% at 1.5R then breakeven · rest at 3R · exit by day 10.
   Size = **0.5% risk** ÷ stop distance (max 20% per stock; halved when Nifty < 200-DMA).
7. **Publish & track**: run stored, every pick paper-traded with the same rules; Telegram summary (optional); screener/IPO caches refreshed.

## Screens
* **Screener** — stocks positive over every chosen period: 1W/2W/3W/4W (5/10/15/20 sessions), 1M/3M/6M/1Y (calendar months,
  Google convention), multi-select price ranges, max price (default ₹600), buy rank, Tomorrow rating, ETFs excluded,
  **Live prices** toggle (delayed quote with live-anchored reference prices so returns match Google intraday).
* **IPOs** — main-board listings from the NSE equity master (official listing date): listing price, since-listing return,
  every period available since listing, from-high, live prices.
* **Stock** — NSE close + delayed live price, chart (5D–1Y, EMA/DMA/volume), lower-circuit recovery history, fundamentals, news.

## Honest results (docs/BACKTEST.md — out-of-sample 2021 → Sep 2026, 0.40% costs, 0.5% risk/trade)

| | Expectancy/trade | PF | CAGR | Max DD |
|---|---:|---:|---:|---:|
| Random 5 liquid stocks/day, same exits | −0.25% | 0.91 | −1.3% | −27.2% |
| Model top-5 + tilt, no live filters | +0.43% | 1.17 | 10.5% | −12.1% |
| **Published live rules (₹200–650, 2-week positive, tilt)** | **+0.24%** | **1.09** | **13.1%** | **−14.6%** |
| Elite 3 weekly | +0.55% | — | — | 20% of weeks all 3 lose |

* Rank-IC positive every year: 0.051, 0.057, 0.068, 0.090, 0.068, 0.069 (2021 → 2026).
* Experiments: 5-seed ensemble + ranker blend beat a single regressor on IC (0.067 vs 0.063), worst year and drawdown → adopted.
  FII/F&O positioning features raised IC slightly but hurt the worst year and 2026 → **not** adopted (shown as context only).
* The edge is thin; weekly +5–12% is not realistic. Engineering list includes names known today as AI/data-centre winners (hindsight).

## Run it

```bash
npm install                                   # Python: pandas numpy lightgbm pyarrow yfinance requests reportlab
cd ml && python -m vermax.cli train           # ~10 min: features + 5 regressors + ranker -> data/models/
cd .. && npm run build -w web && npm run build -w api
scripts\start-vermax.cmd                      # one process on http://127.0.0.1:4100 (UI + API + scheduler), auto-restarts
scripts\install-autostart.cmd                 # start at Windows logon (undo: uninstall-autostart.cmd)
```

Alerts: copy `scripts/.env.example.cmd` to `scripts/.env.cmd`, set `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`, restart, then
`POST /api/system/test-alert`. You get the daily picks, pipeline failures, missing-data warnings, retrain results and model-health warnings.

Monitoring: `GET /api/system` (data freshness, next jobs, alerts) and `GET /api/model/health` (live rank-IC of published rankings,
monthly out-of-sample IC, input drift) — also shown on the Backtest page and the sidebar.

Research: `python -m vermax.xsection` → `python -m vermax.report` (docs/BACKTEST.md); `python -m vermax.experiments [derivs]`.

Config via env: `PICKS_MIN_PRICE/MAX_PRICE` (200/650), `CAPITAL`, `RISK_PER_TRADE` (0.005), `PORT`, `PYTHON_BIN`,
`DAILY_CRON`, `RETRY_CRON`, `WATCHDOG_CRON`, `RETRAIN_CRON`, `SCHEDULER_ENABLED`, `TELEGRAM_*`.

## Not financial advice
Statistical decision support. Publishing these picks to others requires SEBI Research Analyst registration in India.
