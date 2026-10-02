# Vermax - out-of-sample backtest

**Window:** 2021-01-01 -> 2026-09-15 (walk-forward: model for year Y trained only on data before Y-01-01 minus a 15-day embargo).  
**Costs:** 0.40% round trip (brokerage, STT, exchange/SEBI/stamp/GST, slippage).  
**Trade plan simulated:** buy next open (skip if gap > +2.5%) - stop 1.5xATR (3-6%) - book 50% at 1.5R and move stop to breakeven - final target 3R - exit at day 10.  
**Portfolio sim:** 1% capital risked per trade, max 20% in one stock, max 5 open positions, realised-P&L equity curve.

## Headline (net of costs)

| Strategy | Trades | Positive % | Expectancy/trade | Profit factor | CAGR | Max DD | Weeks >= +5% | Weeks <= -3% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Random 5 liquid stocks/day (no model) | 6895 | 42.1% | -0.25% | 0.91 | -1.3% | -27.2% | 0.0% | 2.7% |
| Model top-5, all liquid, no theme tilt | 6903 | 47.6% | +0.34% | 1.13 | 7.8% | -17.5% | 0.0% | 3.0% |
| Model top-5 + tilt, no live filters | 6903 | 47.5% | +0.43% | 1.17 | 10.5% | -12.1% | 0.3% | 2.3% |
| Live rules: Rs200-650, 2-week positive, tilt (published) | 6901 | 47.0% | +0.24% | 1.09 | 13.1% | -14.6% | 0.0% | 2.3% |
| Theme-only (Defence+Engineering) top-5 | 5502 | 47.5% | +0.44% | 1.17 | 7.5% | -21.5% | 0.3% | 5.3% |
| Defence-only top-3 | 2749 | 45.8% | +0.23% | 1.09 | 7.8% | -17.3% | 1.0% | 4.0% |
| Engineering-only top-3 | 2753 | 49.2% | +0.65% | 1.25 | 9.1% | -19.4% | 0.3% | 3.0% |

## Calendar-year portfolio return (published strategy, live rules)

| Year | Return |
| --- | ---: |
| 2021 | +17.4% |
| 2022 | -5.6% |
| 2023 | +23.8% |
| 2024 | +31.3% |
| 2025 | +6.8% |
| 2026 | +5.2% |

## Ranking quality: rank-IC vs 10-day forward return (all liquid stocks, out-of-sample)

| Year | Mean rank-IC | Annualised IR |
| --- | ---: | ---: |
| 2021 | 0.051 | 2.4 |
| 2022 | 0.057 | 4.0 |
| 2023 | 0.068 | 4.3 |
| 2024 | 0.090 | 4.6 |
| 2025 | 0.068 | 3.5 |
| 2026 | 0.069 | 4.3 |

## Score deciles: average 10-day forward return (gross, before costs)

| Decile (10 = top) | Avg fwd return | P(> +3%) |
| --- | ---: | ---: |
| 1 | -0.23% | 28.6% |
| 2 | +0.13% | 30.0% |
| 3 | +0.34% | 30.5% |
| 4 | +0.42% | 31.0% |
| 5 | +0.44% | 31.1% |
| 6 | +0.45% | 31.1% |
| 7 | +0.57% | 31.8% |
| 8 | +0.60% | 31.6% |
| 9 | +0.69% | 32.2% |
| 10 | +0.92% | 34.3% |

## Defence & Engineering priority - what the data says

Model top-5/day picks (no tilt), split by sector bucket:

| Bucket | Trades | Positive % | Expectancy | Profit factor |
| --- | ---: | ---: | ---: | ---: |
| Defence | 376 | 46.3% | +0.67% | 1.23 |
| Engineering | 1236 | 52.9% | +0.94% | 1.39 |
| Everything else | 5291 | 46.4% | +0.17% | 1.07 |

Expectancy per trade by year:

| Bucket | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Defence | +2.49% | -0.20% | +1.09% | -0.03% | +1.95% | -0.04% |
| Engineering | +2.16% | +0.84% | +1.12% | +1.02% | +0.24% | -0.14% |
| Everything else | +0.49% | -0.29% | +0.71% | +0.55% | -0.52% | +0.06% |

Theme picks split by the sector's own point-in-time strength (Defence/Engineering basket 20-day rank among all sectors):

| Condition | Trades | Positive % | Expectancy | Profit factor |
| --- | ---: | ---: | ---: | ---: |
| sector rank < 60th pct | 2141 | 46.5% | +0.17% | 1.06 |
| sector rank >= 60th pct | 3361 | 48.1% | +0.61% | 1.24 |

## Elite weekly top-3 (backtest of the exact rule, before live fundamentals/news overlays)

| | Trades | T1 hit | Stopped | Expectancy | >=1 of 3 hits T1 | All 3 lose |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Elite rule | 857 | 34.7% | 44.7% | +0.55% | 65% of weeks | 20% of weeks |
| Plain model top-3 weekly | 871 | 34.8% | 43.3% | +0.56% | 67% of weeks | 20% of weeks |

Adding more confirmation filters (volume, RSI band, delivery, candle position) did NOT raise the hit rate - it stayed near 30-36%. No rule makes a pick certain.

## How to read this honestly

- The edge is **small but consistent in ranking** (positive IC every year) and **thin in P&L** (expectancy of a few tenths of a percent per trade after costs). It is nowhere near a reliable +5-12% every week.
- The Defence/Engineering tilt weight (0.03) was chosen after looking at these same out-of-sample results, so its benefit is optimistic. The theme membership lists are also defined with today's knowledge (survivorship / look-ahead in *which* names are 'defence'). The point-in-time sector-strength condition is the only theme filter that does not use hindsight.
- Fundamentals (ROE, debt...) and news sentiment are applied as **risk overlays on live picks only**: free sources have no point-in-time history, so they are not in this backtest.
- Recent periods (2025-26) were negative for this model; regimes change. Track the live paper journal before committing capital.
