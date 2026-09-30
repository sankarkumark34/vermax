"""Final out-of-sample report: walk-forward cross-sectional model + published trade plan.

Reads data/research/xs_oos.parquet (produced by `python -m vermax.xsection`), simulates the exact published
exit rules (stop / 50% at 1.5R + breakeven / 3R / 10-day time stop), and writes
data/research/summary.json and docs/BACKTEST.md.
"""
from __future__ import annotations
import json
import numpy as np
import pandas as pd
from . import config
from .labels import simulate_managed
from .picking import portfolio_sim, select_picks, stats
from .xsection import ic_by_year

DOCS = config.ROOT / "docs"
TILT = 0.03


def _managed(picks: pd.DataFrame, bars: pd.DataFrame) -> pd.DataFrame:
    t = simulate_managed(picks, bars)
    return t[t.filled == 1].copy()


def _port(t: pd.DataFrame, dates: pd.DatetimeIndex) -> tuple[dict, pd.Series]:
    q = portfolio_sim(t, dates)
    curve = q.pop("curve")
    return {k: (float(v) if hasattr(v, "item") else v) for k, v in q.items()}, curve


def _yearly(curve: pd.Series) -> dict:
    y = curve.resample("YE").last()
    first = curve.iloc[0]
    prev = pd.concat([pd.Series([first]), y.iloc[:-1]]).to_numpy()
    return {str(i.year): round(float(v / p - 1) * 100, 1) for i, v, p in zip(y.index, y.to_numpy(), prev)}


def main() -> None:
    o = pd.read_parquet(config.OUT_DIR / "xs_oos.parquet")
    bars = pd.read_parquet(config.OUT_DIR / "features.parquet", columns=["symbol", "date", "open", "high", "low", "close"])
    dates = pd.DatetimeIndex(sorted(bars.date.unique()))
    dates = dates[dates >= o.date.min()]
    rng = np.random.default_rng(42)

    variants: dict[str, pd.DataFrame] = {}
    # random baseline: 5 random liquid stocks per day, same exits (no model)
    shuf = o.assign(_r=rng.random(len(o))).sort_values(["date", "_r"])
    rnd = shuf[shuf.groupby("date").cumcount() < 5].drop(columns="_r")
    variants["Random 5 liquid stocks/day (no model)"] = rnd.assign(day_rank=rnd.groupby("date").cumcount())
    variants["Model top-5, all liquid, no theme tilt"] = select_picks(o, "p_all", 5)
    variants["Model top-5 + tilt, no live filters"] = select_picks(o, "p_all", 5, tilt=TILT)
    live = o[o.close.between(200, 650) & (o.ret10 > 0)]
    variants["Live rules: Rs200-650, 2-week positive, tilt (published)"] = select_picks(live, "p_all", 5, tilt=TILT)
    variants["Theme-only (Defence+Engineering) top-5"] = select_picks(o[o.is_theme == 1], "p_all", 5)
    variants["Defence-only top-3"] = select_picks(o[o.is_defence == 1], "p_all", 3)
    variants["Engineering-only top-3"] = select_picks(o[o.is_engineering == 1], "p_all", 3)

    summary: dict = {"window": [str(o.date.min().date()), str(o.date.max().date())],
                     "costsRoundTripPct": config.ROUND_TRIP_COST * 100,
                     "plan": {"stop": "1.5xATR clamped 3-6%", "t1": "1.5R (book 50%, stop to breakeven)", "t2": "3R",
                              "timeStopDays": config.HORIZON, "entry": "next open, skip if gap > +2.5%"},
                     "variants": [], "ic": {}, "byYear": {}, "theme": {}}
    md = ["# Vermax - out-of-sample backtest", "",
          f"**Window:** {summary['window'][0]} -> {summary['window'][1]} (walk-forward: model for year Y trained only on data "
          "before Y-01-01 minus a 15-day embargo).  ",
          f"**Costs:** {config.ROUND_TRIP_COST * 100:.2f}% round trip (brokerage, STT, exchange/SEBI/stamp/GST, slippage).  ",
          "**Trade plan simulated:** buy next open (skip if gap > +2.5%) - stop 1.5xATR (3-6%) - book 50% at 1.5R and move stop to "
          "breakeven - final target 3R - exit at day 10.  ",
          "**Portfolio sim:** 1% capital risked per trade, max 20% in one stock, max 5 open positions, realised-P&L equity curve.", ""]
    curves = {}
    rows = []
    for name, p in variants.items():
        t = _managed(p, bars)
        port, curve = _port(t, dates)
        st = stats(t)
        st = {k: (float(v) if hasattr(v, "item") else v) for k, v in st.items()}
        curves[name] = curve
        rec = {"name": name, **st, **port, "yearly": _yearly(curve)}
        summary["variants"].append(rec)
        rows.append(rec)
        summary["byYear"][name] = {str(y): stats(g) for y, g in t.groupby(t.date.dt.year)}
        if name.startswith("Live rules"):
            main_t = t
    md += ["## Headline (net of costs)", "",
           "| Strategy | Trades | Positive % | Expectancy/trade | Profit factor | CAGR | Max DD | Weeks >= +5% | Weeks <= -3% |",
           "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for r in rows:
        md.append(f"| {r['name']} | {r['n']} | {r['pos%']}% | {r['exp%']:+.2f}% | {r['PF']} | {r['CAGR%']}% | {r['maxDD%']}% | {r['wk>=5%']}% | {r['wk<=-3%']}% |")
    md += ["", "## Calendar-year portfolio return (published strategy, live rules)", "", "| Year | Return |", "| --- | ---: |"]
    pub = next(r for r in rows if r["name"].startswith("Live rules"))
    for y, v in pub["yearly"].items():
        md.append(f"| {y} | {v:+.1f}% |")

    # information coefficient
    ic = ic_by_year(o, "p_all")
    summary["ic"] = {str(y): {"meanIC": round(float(r["mean"]), 4), "ir": round(float(r["ir"]), 2)} for y, r in ic.iterrows()}
    md += ["", "## Ranking quality: rank-IC vs 10-day forward return (all liquid stocks, out-of-sample)", "",
           "| Year | Mean rank-IC | Annualised IR |", "| --- | ---: | ---: |"]
    for y, r in ic.iterrows():
        md.append(f"| {y} | {r['mean']:.3f} | {r['ir']:.1f} |")

    # decile spread
    oo = o.copy()
    oo["b"] = oo.groupby("date")["p_all"].transform(lambda s: pd.qcut(s.rank(method="first"), 10, labels=False))
    dec = oo.groupby("b").agg(n=("fwd", "size"), fwd=("fwd", "mean"), hit3=("fwd", lambda s: (s > 0.03).mean()))
    summary["deciles"] = [{"decile": int(i) + 1, "avgFwdPct": round(float(r.fwd) * 100, 2), "hit3Pct": round(float(r.hit3) * 100, 1)} for i, r in dec.iterrows()]
    md += ["", "## Score deciles: average 10-day forward return (gross, before costs)", "", "| Decile (10 = top) | Avg fwd return | P(> +3%) |", "| --- | ---: | ---: |"]
    for r in summary["deciles"]:
        md.append(f"| {r['decile']} | {r['avgFwdPct']:+.2f}% | {r['hit3Pct']}% |")

    # theme analysis on the published picks + on all model picks
    md += ["", "## Defence & Engineering priority - what the data says", ""]
    t_all = _managed(select_picks(o, "p_all", 5, tilt=0.0), bars)
    for lab, mask in (("Defence", t_all.is_defence == 1), ("Engineering", t_all.is_engineering == 1), ("Everything else", t_all.is_theme == 0)):
        sub = t_all[mask]
        summary["theme"][lab] = {"stats": stats(sub), "byYear": {str(y): stats(g) for y, g in sub.groupby(sub.date.dt.year)}}
    md += ["Model top-5/day picks (no tilt), split by sector bucket:", "",
           "| Bucket | Trades | Positive % | Expectancy | Profit factor |", "| --- | ---: | ---: | ---: | ---: |"]
    for lab, v in summary["theme"].items():
        s = v["stats"]
        if s.get("n"):
            md.append(f"| {lab} | {s['n']} | {s['pos%']}% | {s['exp%']:+.2f}% | {s['PF']} |")
    md += ["", "Expectancy per trade by year:", "", "| Bucket | " + " | ".join(str(y) for y in sorted(t_all.date.dt.year.unique())) + " |",
           "| --- |" + " ---: |" * t_all.date.dt.year.nunique()]
    for lab, v in summary["theme"].items():
        cells = []
        for y in sorted(t_all.date.dt.year.unique()):
            s = v["byYear"].get(str(y))
            cells.append(f"{s['exp%']:+.2f}%" if s and s.get("n") else "-")
        md.append(f"| {lab} | " + " | ".join(cells) + " |")

    # sector-strength conditioning of the theme (point-in-time)
    th = o[o.is_theme == 1].copy()
    th["strong"] = np.where(th.sec_rank >= 0.6, "sector rank >= 60th pct", "sector rank < 60th pct")
    tt = _managed(select_picks(th, "p_all", 5), bars)
    cond = {}
    for k, g in tt.groupby("strong"):
        cond[k] = stats(g)
    summary["theme"]["strengthConditioned"] = cond
    md += ["", "Theme picks split by the sector's own point-in-time strength (Defence/Engineering basket 20-day rank among all sectors):", "",
           "| Condition | Trades | Positive % | Expectancy | Profit factor |", "| --- | ---: | ---: | ---: | ---: |"]
    for k, s in cond.items():
        md.append(f"| {k} | {s['n']} | {s['pos%']}% | {s['exp%']:+.2f}% | {s['PF']} |")

    # ---- Elite: weekly top-3 under strict confluence rules -----------------------------------
    w = o.copy()
    w["wk"] = w.date.dt.to_period("W-FRI")
    w = w[w.date == w.groupby("wk").date.transform("max")].copy()
    w["rs"] = w.p_all + TILT * (w.is_theme == 1)
    ok = w.close.between(200, 650) & (w.ret10 > 0) & (w.ret20 > 0) & (w.d_ema50 > 0) & (w.d_sma200 > 0) & (w.sec_rank >= 0.6)

    def elite_run(d: pd.DataFrame) -> dict:
        d = d.sort_values(["date", "rs"], ascending=[True, False])
        d = d[d.groupby("date").cumcount() < 3]
        t = simulate_managed(d, bars)
        t = t[t.filled == 1]
        wk = t.groupby("wk").agg(k=("t1_hit", "sum"), neg=("net_ret", lambda x: bool((x <= 0).all())))
        return {"trades": int(len(t)), "weeks": int(len(wk)), "t1HitPct": round(float(t.t1_hit.mean()) * 100, 1),
                "stopPct": round(float((t.exit_reason < 0).mean()) * 100, 1), "positivePct": round(float((t.net_ret > 0).mean()) * 100, 1),
                "expectancyPct": round(float(t.net_ret.mean()) * 100, 2),
                "avgWinPct": round(float(t.net_ret[t.net_ret > 0].mean()) * 100, 1), "avgLossPct": round(float(t.net_ret[t.net_ret <= 0].mean()) * 100, 1),
                "weeksAtLeast1T1Pct": round(float((wk.k >= 1).mean()) * 100), "weeksAtLeast2T1Pct": round(float((wk.k >= 2).mean()) * 100),
                "weeksAllThreeLosePct": round(float(wk.neg.mean()) * 100),
                "byYear": {str(y): {"t1HitPct": round(float(g.t1_hit.mean()) * 100, 1), "expectancyPct": round(float(g.net_ret.mean()) * 100, 2)} for y, g in t.groupby(t.date.dt.year)}}

    summary["elite"] = {"rule": "uptrend (>50-EMA, >200-DMA, 10d & 20d positive) + sector strength >= 60th pct, ranked by model score (+theme tilt), weekly top 3",
                        "elite": elite_run(w[ok]), "baselineTop3Weekly": elite_run(w[w.close.between(200, 650) & (w.ret10 > 0)].assign(rs=w.p_all))}
    e, b = summary["elite"]["elite"], summary["elite"]["baselineTop3Weekly"]
    md += ["", "## Elite weekly top-3 (backtest of the exact rule, before live fundamentals/news overlays)", "",
           "| | Trades | T1 hit | Stopped | Expectancy | >=1 of 3 hits T1 | All 3 lose |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
           f"| Elite rule | {e['trades']} | {e['t1HitPct']}% | {e['stopPct']}% | {e['expectancyPct']:+.2f}% | {e['weeksAtLeast1T1Pct']}% of weeks | {e['weeksAllThreeLosePct']}% of weeks |",
           f"| Plain model top-3 weekly | {b['trades']} | {b['t1HitPct']}% | {b['stopPct']}% | {b['expectancyPct']:+.2f}% | {b['weeksAtLeast1T1Pct']}% of weeks | {b['weeksAllThreeLosePct']}% of weeks |",
           "", "Adding more confirmation filters (volume, RSI band, delivery, candle position) did NOT raise the hit rate - it stayed near 30-36%. No rule makes a pick certain."]

    md += ["", "## How to read this honestly", "",
           "- The edge is **small but consistent in ranking** (positive IC every year) and **thin in P&L** (expectancy of a few tenths of a percent per trade after costs). "
           "It is nowhere near a reliable +5-12% every week.",
           "- The Defence/Engineering tilt weight (0.03) was chosen after looking at these same out-of-sample results, so its benefit is optimistic. "
           "The theme membership lists are also defined with today's knowledge (survivorship / look-ahead in *which* names are 'defence'). "
           "The point-in-time sector-strength condition is the only theme filter that does not use hindsight.",
           "- Fundamentals (ROE, debt...) and news sentiment are applied as **risk overlays on live picks only**: free sources have no point-in-time history, so they are not in this backtest.",
           "- Recent periods (2025-26) were negative for this model; regimes change. Track the live paper journal before committing capital.", ""]

    (DOCS).mkdir(exist_ok=True)
    (DOCS / "BACKTEST.md").write_text("\n".join(md), encoding="utf-8")
    (config.OUT_DIR / "summary.json").write_text(json.dumps(summary, indent=1, default=str))
    print("\n".join(md))


if __name__ == "__main__":
    main()
