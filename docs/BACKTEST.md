# Vermax - out-of-sample backtest

**Window:** 2021-01-01 -> 2026-09-15 (walk-forward: model for year Y trained only on data before Y-01-01 minus a 15-day embargo).  
**Costs:** 0.40% round trip (brokerage, STT, exchange/SEBI/stamp/GST, slippage).  
**Trade plan simulated:** buy next open (skip if gap > +2.5%) - stop 1.5xATR (3-6%) - book 50% at 1.5R and move stop to breakeven - final target 3R - exit at day 10.  
**Portfolio sim:** 1% capital risked per trade, max 20% in one stock, max 5 open positions, realised-P&L equity curve.

## Headline (net of costs)

| Strategy | Trades | Positive % | Expectancy/trade | Profit factor | CAGR | Max DD | Weeks >= +5% | Weeks <= -3% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Random 5 liquid stocks/day (no model) | 6895 | 42.1% | -0.25% | 0.91 | -3.2% | -46.9% | 2.0% | 11.7% |
| Model top-5, all liquid, no theme tilt | 6881 | 45.8% | +0.23% | 1.09 | 7.4% | -36.8% | 5.7% | 13.7% |
| Model top-5 + tilt, no live filters | 6874 | 46.8% | +0.40% | 1.16 | 14.1% | -41.2% | 5.7% | 13.0% |
| Live rules: Rs200-650, 2-week positive, tilt (published) | 6864 | 47.1% | +0.32% | 1.13 | 21.7% | -27.7% | 6.0% | 11.7% |
| Theme-only (Defence+Engineering) top-5 | 5322 | 47.3% | +0.45% | 1.17 | 14.5% | -33.1% | 8.0% | 13.7% |
| Defence-only top-3 | 2581 | 45.4% | +0.13% | 1.05 | 11.7% | -44.4% | 6.7% | 11.7% |
| Engineering-only top-3 | 2741 | 49.1% | +0.74% | 1.28 | 22.9% | -33.5% | 7.0% | 13.0% |

## Calendar-year portfolio return (published strategy, live rules)

| Year | Return |
| --- | ---: |
| 2021 | +21.7% |
| 2022 | +1.3% |
| 2023 | +28.5% |
| 2024 | +34.8% |
| 2025 | +17.1% |
| 2026 | +23.4% |

## Ranking quality: rank-IC vs 10-day forward return (all liquid stocks, out-of-sample)

| Year | Mean rank-IC | Annualised IR |
| --- | ---: | ---: |
| 2021 | 0.048 | 2.3 |
| 2022 | 0.055 | 3.7 |
| 2023 | 0.064 | 3.5 |
| 2024 | 0.086 | 4.2 |
| 2025 | 0.055 | 2.8 |
| 2026 | 0.064 | 3.6 |

## Score deciles: average 10-day forward return (gross, before costs)

| Decile (10 = top) | Avg fwd return | P(> +3%) |
| --- | ---: | ---: |
| 1 | -0.20% | 29.5% |
| 2 | +0.21% | 30.5% |
| 3 | +0.33% | 30.8% |
| 4 | +0.45% | 31.1% |
| 5 | +0.51% | 31.5% |
| 6 | +0.50% | 31.3% |
| 7 | +0.54% | 31.5% |
| 8 | +0.58% | 31.5% |
| 9 | +0.61% | 31.6% |
| 10 | +0.81% | 33.0% |

## Defence & Engineering priority - what the data says

Model top-5/day picks (no tilt), split by sector bucket:

| Bucket | Trades | Positive % | Expectancy | Profit factor |
| --- | ---: | ---: | ---: | ---: |
| Defence | 319 | 38.9% | -0.20% | 0.94 |
| Engineering | 1000 | 50.2% | +1.00% | 1.38 |
| Everything else | 5562 | 45.5% | +0.12% | 1.05 |

Expectancy per trade by year:

| Bucket | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Defence | +8.76% | +0.13% | +3.99% | -1.08% | +0.52% | -0.91% |
| Engineering | +3.25% | +0.34% | +1.78% | +0.86% | -0.10% | -0.80% |
| Everything else | +0.38% | -0.21% | +0.32% | +0.56% | -0.36% | +0.01% |

Theme picks split by the sector's own point-in-time strength (Defence/Engineering basket 20-day rank among all sectors):

| Condition | Trades | Positive % | Expectancy | Profit factor |
| --- | ---: | ---: | ---: | ---: |
| sector rank < 60th pct | 2021 | 47.0% | +0.26% | 1.1 |
| sector rank >= 60th pct | 3301 | 47.5% | +0.56% | 1.21 |

## Elite weekly top-3 (backtest of the exact rule, before live fundamentals/news overlays)

| | Trades | T1 hit | Stopped | Expectancy | >=1 of 3 hits T1 | All 3 lose |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Elite rule | 856 | 34.7% | 45.7% | +0.45% | 66% of weeks | 22% of weeks |
| Plain model top-3 weekly | 872 | 34.6% | 44.0% | +0.61% | 67% of weeks | 20% of weeks |

Adding more confirmation filters (volume, RSI band, delivery, candle position) did NOT raise the hit rate - it stayed near 30-36%. No rule makes a pick certain.

## How to read this honestly

- The edge is **small but consistent in ranking** (positive IC every year) and **thin in P&L** (expectancy of a few tenths of a percent per trade after costs). It is nowhere near a reliable +5-12% every week.
- The Defence/Engineering tilt weight (0.03) was chosen after looking at these same out-of-sample results, so its benefit is optimistic. The theme membership lists are also defined with today's knowledge (survivorship / look-ahead in *which* names are 'defence'). The point-in-time sector-strength condition is the only theme filter that does not use hindsight.
- Fundamentals (ROE, debt...) and news sentiment are applied as **risk overlays on live picks only**: free sources have no point-in-time history, so they are not in this backtest.
- Recent periods (2025-26) were negative for this model; regimes change. Track the live paper journal before committing capital.
