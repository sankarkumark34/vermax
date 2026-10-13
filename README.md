# Vermax — NSE swing-trading decision platform

Daily "what to buy tomorrow" list for Indian equities: **stop-loss, two targets, position size, reasons**, with a
**Defence & Engineering (incl. AI / data-centre infra) priority**, fundamentals + news overlays, IPO screeners. Holding period ≤ 10 trading days.

```
apps/api      NestJS (port 4100)  ingest NSE data · pipeline · 18-step selection engine (/api/v1) · sentiment · alerts · scheduler · serves the UI
ml/           Python (LightGBM)   features · walk-forward research · blend model · scorer · fundamentals · company data · screeners · health
services/llm  Python FastAPI      optional LLM service (port 8100): verdict explanations · filing classification · business summaries
apps/web      React + Vite        Top Picks · Verdict · IPO Stocks · IPO Screener · Stock chart
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

## 18-step analysis: BUY / WAIT / AVOID

Implements the *Stock Selection Platform* proposal on Vermax's stack (SQLite + TypeORM instead of MySQL + Prisma).
Every Top Picks survivor (and any symbol opened from the search box) runs through a fixed pipeline:

| Phase | Steps (weight) |
|---|---|
| A. Understand | 1 Business (4) · 2 Industry (6) |
| B. Financial strength | 3 Revenue (10) · 4 Profit (8) · 5 Margins (7) · 6 Cash flow (12) · 7 Debt (10) · 8 ROE/ROCE (10) · 9 Working capital (5) |
| C. Quality and trust | 10 Promoter (6) · 11 Management (4) · 12 Moat (5) |
| D. Tradability and price | 13 Liquidity (4) · 14 Valuation (7) |
| E. Events and risk | 15 Catalyst (2) · 16 Red flags (gate / −7 pts) |
| F. Execution | 17 Technical entry (timing) · 18 Risk and position size |

* **Gates → AVOID** regardless of score: traded value < ₹2 Cr, ASM/GSM surveillance, promoter pledge > 50%, interest cover < 1.5×,
  negative net worth, 3 years of negative CFO with a profit, any confirmed level-3 red flag.
* **BUY** = score ≥ 75 + no gate + valuation not stretched + technical entry ready (uptrend, at a level, bullish candle on volume,
  ≤ 20% above EMA50, reward:risk ≥ 2) + ≥ 70% of the framework had data. **WAIT** otherwise (watch level + alert), **AVOID** < 60.
* **Sector templates**: banks/NBFCs (ROA/ROE; no debt, cash-flow or working-capital steps), cyclicals, capital-intensive, loss-making.
* **Position size** = min(risk budget ÷ stop distance, 10%/5% position cap, 1% of daily traded value).
* Data: NSE bhavcopy/delivery/indices (prices, liquidity), Yahoo Finance statements (4-5 years on the free feed, not 10),
  NSE shareholding + pledge, NSE announcements (keyword classifier; flags stay *suggested* until you confirm them), NSE ASM/GSM lists.
* Thresholds, weights and templates are versioned config (Settings screen); every run stores the config version it used.
* Engine: `apps/api/src/selection/domain` (pure TypeScript, unit-tested); data layer: `ml/vermax/company.py`.

API (`/api/v1`, Swagger at `/docs`): `GET screener`, `GET stocks/:symbol/analysis|technical|prices|history`, `POST stocks/:symbol/explain`,
`POST risk/position-size`, `GET|POST|DELETE watchlist`, `portfolio/positions`, `GET portfolio/risk`, `GET|PATCH flags`,
`GET|PUT config/thresholds` (+ `versions`, `activate`), `POST selection/run`, `GET selection/state`, `GET jobs`.

## Top Picks (home screen, weekdays 19:30 IST)

1. Every liquid NSE company (≥ ₹5 Cr/day, price ≥ ₹200; ETFs / fund units excluded) on split-adjusted closes:
   closed positive in the **last completed week, month, quarter and financial year** (Apr-Mar), **≥ 2 positive months in a row**,
   and **no major fall**: ≤ 15% drawdown in 3 months, within 10% of the 3-month high, every 7%+ dip recovered within 20 sessions,
   no week worse than −10%.
2. Survivors go through the 18-step analysis below (gates, fundamentals, valuation, technical entry incl. Fibonacci retracement /
   extension, candles, support/resistance, BOS/CHoCH, order blocks, liquidity sweeps, volume profile).
3. Gated or weak-fundamental stocks are rejected; the rest ranked by 40% momentum (percentile vs the whole market),
   35% fundamentals, 25% technical setup. Each row shows a tick per check and entry / stop / target.
4. A month-end backtest (2021 →, survivorship-safe, 0.4% costs) of the price rules, rule by rule, is shown on the page.

API: `GET /api/v1/top-picks`, `POST /api/v1/top-picks/run`, `GET /api/v1/top-picks/state`, `GET|POST /api/v1/top-picks/backtest`.
Criteria live in the versioned config (`winners` section of `/api/v1/config/thresholds`).

## Screens
* **Top Picks** — the list above, with funnel, backtest and near misses.
* **Verdict** (`/verdict/:symbol`, sidebar search) — full 18-step scorecard, gates and red flags, entry plan with Fibonacci targets,
  structure tools, chart, plain-language explanation.
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
monthly out-of-sample IC, input drift).

LLM service (optional; without it the Verdict page shows a deterministic explanation built from the engine's numbers):

```bash
cd services/llm && python -m venv .venv && .venv\Scripts\pip install -e ".[dev]"
set ANTHROPIC_API_KEY=...                     # or `ant auth login`
npm run dev:llm                               # http://127.0.0.1:8100 ; tests: npm run test:llm (no network)
```

It uses Claude (`LLM_MODEL`, default `claude-opus-5-5`) for language tasks only: structured (Pydantic) output, a numeric-grounding
check (every figure must come from the engine output; retried once, then rejected), citation checks on summaries, filings treated
as untrusted data, versioned prompts, results cached by content hash. Set `LLM_SERVICE_TOKEN` on both sides to require a bearer token.

Research: `python -m vermax.xsection` → `python -m vermax.report` (docs/BACKTEST.md); `python -m vermax.experiments [derivs]`.

Config via env: `PICKS_MIN_PRICE/MAX_PRICE` (200/650), `CAPITAL`, `RISK_PER_TRADE` (0.005), `PORT`, `PYTHON_BIN`,
`DAILY_CRON`, `RETRY_CRON`, `WATCHDOG_CRON`, `RETRAIN_CRON`, `WINNERS_CRON` (`30 19 * * 1-5`), `SCHEDULER_ENABLED`, `TELEGRAM_*`,
`LLM_SERVICE_URL` (`http://127.0.0.1:8100`), `LLM_SERVICE_TOKEN`.

## Not financial advice
Statistical and rules-based decision support for personal use. Publishing these picks or verdicts to others requires SEBI Research
Analyst / Investment Adviser registration in India. Check each data source's terms before automated use beyond a personal prototype.
