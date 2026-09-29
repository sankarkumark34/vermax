# Vermax - out-of-sample backtest

**Window:** 2021-01-01 -> 2026-09-02 (walk-forward: model for year Y trained only on data before Y-01-01 minus a 15-day embargo).  
**Costs:** 0.40% round trip (brokerage, STT, exchange/SEBI/stamp/GST, slippage).  
**Trade plan simulated:** buy next open (skip if gap > +2.5%) - stop 1.5xATR (3-6%) - book 50% at 1.5R and move stop to breakeven - final target 3R - exit at day 10.  
**Portfolio sim:** 1% capital risked per trade, max 20% in one stock, max 5 open positions, realised-P&L equity curve.

## Headline (net of costs)

| Strategy | Trades | Positive % | Expectancy/trade | Profit factor | CAGR | Max DD | Weeks >= +5% | Weeks <= -3% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Random 5 liquid stocks/day (no model) | 6848 | 42.5% | -0.26% | 0.91 | -8.8% | -55.5% | 2.7% | 13.1% |
| Model top-5, all liquid, no theme tilt | 6834 | 46.9% | +0.30% | 1.12 | 13.9% | -29.1% | 4.4% | 11.7% |
| Model top-5 + Defence/Engineering tilt (published) | 6840 | 47.4% | +0.43% | 1.17 | 20.2% | -29.5% | 6.7% | 14.1% |
| Model top-5 + tilt, price Rs200-500 only | 6855 | 48.1% | +0.37% | 1.14 | 18.8% | -30.0% | 6.4% | 13.1% |
| Theme-only (Defence+Engineering) top-5 | 5261 | 47.5% | +0.44% | 1.16 | 26.0% | -35.5% | 8.4% | 15.1% |
| Defence-only top-3 | 2523 | 46.3% | +0.33% | 1.13 | 17.9% | -35.4% | 8.4% | 12.1% |
| Engineering-only top-3 | 2738 | 48.6% | +0.54% | 1.2 | 19.2% | -32.2% | 4.0% | 11.4% |

## Calendar-year portfolio return (published strategy)

| Year | Return |
| --- | ---: |
| 2021 | +43.9% |
| 2022 | +12.9% |
| 2023 | +50.4% |
| 2024 | +19.7% |
| 2025 | -1.0% |
| 2026 | -1.3% |

## Ranking quality: rank-IC vs 10-day forward return (all liquid stocks, out-of-sample)

| Year | Mean rank-IC | Annualised IR |
| --- | ---: | ---: |
| 2021 | 0.048 | 2.2 |
| 2022 | 0.055 | 3.5 |
| 2023 | 0.061 | 3.5 |
| 2024 | 0.088 | 4.5 |
| 2025 | 0.063 | 3.0 |
| 2026 | 0.060 | 3.3 |

## Score deciles: average 10-day forward return (gross, before costs)

| Decile (10 = top) | Avg fwd return | P(> +3%) |
| --- | ---: | ---: |
| 1 | -0.19% | 29.4% |
| 2 | +0.19% | 30.4% |
| 3 | +0.35% | 30.9% |
| 4 | +0.44% | 31.3% |
| 5 | +0.53% | 31.5% |
| 6 | +0.56% | 31.5% |
| 7 | +0.53% | 31.5% |
| 8 | +0.56% | 31.5% |
| 9 | +0.61% | 31.9% |
| 10 | +0.86% | 33.4% |

## Defence & Engineering priority - what the data says

Model top-5/day picks (no tilt), split by sector bucket:

| Bucket | Trades | Positive % | Expectancy | Profit factor |
| --- | ---: | ---: | ---: | ---: |
| Defence | 331 | 38.7% | -0.22% | 0.93 |
| Engineering | 879 | 49.1% | +0.74% | 1.26 |
| Everything else | 5624 | 47.1% | +0.26% | 1.11 |

Expectancy per trade by year:

| Bucket | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Defence | - | -0.77% | +2.83% | -0.70% | -0.22% | -0.78% |
| Engineering | +4.08% | -0.15% | +2.06% | +0.52% | -0.56% | -2.72% |
| Everything else | +0.59% | +0.23% | +0.69% | +0.43% | -0.53% | +0.13% |

Theme picks split by the sector's own point-in-time strength (Defence/Engineering basket 20-day rank among all sectors):

| Condition | Trades | Positive % | Expectancy | Profit factor |
| --- | ---: | ---: | ---: | ---: |
| sector rank < 60th pct | 2213 | 46.2% | +0.18% | 1.07 |
| sector rank >= 60th pct | 3048 | 48.5% | +0.63% | 1.24 |

## How to read this honestly

- The edge is **small but consistent in ranking** (positive IC every year) and **thin in P&L** (expectancy of a few tenths of a percent per trade after costs). It is nowhere near a reliable +5-12% every week.
- The Defence/Engineering tilt weight (0.03) was chosen after looking at these same out-of-sample results, so its benefit is optimistic. The theme membership lists are also defined with today's knowledge (survivorship / look-ahead in *which* names are 'defence'). The point-in-time sector-strength condition is the only theme filter that does not use hindsight.
- Fundamentals (ROE, debt...) and news sentiment are applied as **risk overlays on live picks only**: free sources have no point-in-time history, so they are not in this backtest.
- Recent periods (2025-26) were negative for this model; regimes change. Track the live paper journal before committing capital.
