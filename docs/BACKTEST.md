# Vermax - out-of-sample backtest

**Window:** 2021-01-01 -> 2026-09-16 (walk-forward: model for year Y trained only on data before Y-01-01 minus a 15-day embargo).  
**Costs:** 0.40% round trip (brokerage, STT, exchange/SEBI/stamp/GST, slippage).  
**Trade plan simulated:** buy next open (skip if gap > +2.5%) - stop 1.5xATR (3-6%) - book 50% at 1.5R and move stop to breakeven - final target 3R - exit at day 10.  
**Portfolio sim:** 1% capital risked per trade, max 20% in one stock, max 5 open positions, realised-P&L equity curve.

## Headline (net of costs)

| Strategy | Trades | Positive % | Expectancy/trade | Profit factor | CAGR | Max DD | Weeks >= +5% | Weeks <= -3% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Random 5 liquid stocks/day (no model) | 6907 | 42.3% | -0.33% | 0.88 | -5.2% | -37.1% | 0.0% | 2.3% |
| Model top-5, all liquid, no theme tilt | 6885 | 47.3% | +0.36% | 1.14 | 6.2% | -15.7% | 0.0% | 0.7% |
| Model top-5 + tilt, no live filters | 6880 | 47.7% | +0.42% | 1.17 | 8.4% | -16.5% | 0.3% | 3.3% |
| Live rules: Rs200-650, 2-week positive, tilt (published) | 6880 | 47.5% | +0.40% | 1.16 | 15.8% | -9.2% | 0.3% | 1.7% |
| Theme-only (Defence+Engineering) top-5 | 5497 | 47.6% | +0.46% | 1.18 | 10.1% | -14.6% | 0.3% | 3.0% |
| Defence-only top-3 | 2750 | 45.6% | +0.15% | 1.05 | 1.5% | -21.3% | 0.3% | 3.0% |
| Engineering-only top-3 | 2747 | 49.6% | +0.78% | 1.31 | 6.5% | -21.5% | 0.0% | 2.7% |

## Calendar-year portfolio return (published strategy, live rules)

| Year | Return |
| --- | ---: |
| 2021 | +30.6% |
| 2022 | +10.1% |
| 2023 | +28.3% |
| 2024 | +8.1% |
| 2025 | +6.8% |
| 2026 | +9.3% |

## Ranking quality: rank-IC vs 10-day forward return (all liquid stocks, out-of-sample)

| Year | Mean rank-IC | Annualised IR |
| --- | ---: | ---: |
| 2021 | 0.053 | 2.6 |
| 2022 | 0.053 | 3.9 |
| 2023 | 0.069 | 4.4 |
| 2024 | 0.090 | 4.6 |
| 2025 | 0.074 | 3.8 |
| 2026 | 0.071 | 4.0 |

## Score deciles: average 10-day forward return (gross, before costs)

| Decile (10 = top) | Avg fwd return | P(> +3%) |
| --- | ---: | ---: |
| 1 | -0.21% | 28.7% |
| 2 | +0.20% | 29.9% |
| 3 | +0.36% | 30.4% |
| 4 | +0.46% | 30.8% |
| 5 | +0.49% | 31.1% |
| 6 | +0.56% | 31.3% |
| 7 | +0.61% | 31.4% |
| 8 | +0.66% | 31.6% |
| 9 | +0.73% | 32.2% |
| 10 | +1.08% | 34.6% |

## Defence & Engineering priority - what the data says

Model top-5/day picks (no tilt), split by sector bucket:

| Bucket | Trades | Positive % | Expectancy | Profit factor |
| --- | ---: | ---: | ---: | ---: |
| Defence | 343 | 44.3% | +0.29% | 1.1 |
| Engineering | 1379 | 50.1% | +0.91% | 1.36 |
| Everything else | 5163 | 46.7% | +0.22% | 1.09 |

Expectancy per trade by year:

| Bucket | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Defence | +3.05% | +0.91% | +1.43% | -0.39% | +0.23% | -0.13% |
| Engineering | +1.66% | +0.95% | +1.36% | +0.97% | -0.08% | +0.40% |
| Everything else | +0.61% | +0.33% | +0.92% | -0.11% | -0.67% | +0.11% |

Theme picks split by the sector's own point-in-time strength (Defence/Engineering basket 20-day rank among all sectors):

| Condition | Trades | Positive % | Expectancy | Profit factor |
| --- | ---: | ---: | ---: | ---: |
| sector rank < 60th pct | 2108 | 47.9% | +0.40% | 1.15 |
| sector rank >= 60th pct | 3389 | 47.4% | +0.51% | 1.19 |

## Elite weekly top-3 (backtest of the exact rule, before live fundamentals/news overlays)

| | Trades | T1 hit | Stopped | Expectancy | >=1 of 3 hits T1 | All 3 lose |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Elite rule | 857 | 33.5% | 46.0% | +0.37% | 67% of weeks | 22% of weeks |
| Plain model top-3 weekly | 862 | 34.9% | 45.8% | +0.64% | 67% of weeks | 22% of weeks |

Adding more confirmation filters (volume, RSI band, delivery, candle position) did NOT raise the hit rate - it stayed near 30-36%. No rule makes a pick certain.

## How to read this honestly

- The edge is **small but consistent in ranking** (positive IC every year) and **thin in P&L** (expectancy of a few tenths of a percent per trade after costs). It is nowhere near a reliable +5-12% every week.
- The Defence/Engineering tilt weight (0.03) was chosen after looking at these same out-of-sample results, so its benefit is optimistic. The theme membership lists are also defined with today's knowledge (survivorship / look-ahead in *which* names are 'defence'). The point-in-time sector-strength condition is the only theme filter that does not use hindsight.
- Fundamentals (ROE, debt...) and news sentiment are applied as **risk overlays on live picks only**: free sources have no point-in-time history, so they are not in this backtest.
- Recent periods (2025-26) were negative for this model; regimes change. Track the live paper journal before committing capital.
