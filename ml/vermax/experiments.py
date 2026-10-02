"""Model experiments vs the production regressor, all on the same anchored walk-forward.

Variants:  base (production regressor), ens5 (5-seed regressor average), rank (LightGBM lambdarank),
           blend (rank-average of ens5 and rank).
Usage:  python -m vermax.experiments            -> data/research/experiments.json + printed table
"""
from __future__ import annotations
import json
import time
import numpy as np
import pandas as pd
import lightgbm as lgb
from . import config
from .labels import simulate_managed
from .picking import portfolio_sim, select_picks, stats
from .production import ALL_FEATURES, XS_PARAMS
from .xsection import ic_by_year, prep

TILT = 0.03


def _years(df):
    return [y for y in sorted(df.date.dt.year.unique()) if y >= 2021]


def _split(df, y, embargo_days=15):
    start = pd.Timestamp(f"{y}-01-01")
    tr = df[df.date < start - pd.Timedelta(days=embargo_days)]
    te = df[(df.date >= start) & (df.date < pd.Timestamp(f"{y + 1}-01-01"))]
    return tr[tr.date.dt.dayofyear % 2 == 0], te


def wf_regress(df, seeds=(11,), feats=None):
    feats = feats or ALL_FEATURES
    pred = pd.Series(np.nan, index=df.index)
    for y in _years(df):
        tr, te = _split(df, y)
        p = np.zeros(len(te))
        for s in seeds:
            m = lgb.train({**XS_PARAMS, "seed": s, "bagging_seed": s, "feature_fraction_seed": s}, lgb.Dataset(tr[feats], tr["y"]), 250)
            p += m.predict(te[feats]) / len(seeds)
        pred.loc[te.index] = p
    return pred


def wf_rank(df, feats=None):
    feats = feats or ALL_FEATURES
    pred = pd.Series(np.nan, index=df.index)
    params = dict(objective="lambdarank", learning_rate=0.05, num_leaves=31, min_child_samples=500, feature_fraction=0.7,
                  bagging_fraction=0.7, bagging_freq=1, lambda_l2=50.0, max_depth=6, verbose=-1, seed=11, n_jobs=6,
                  lambdarank_truncation_level=50, label_gain=list(range(10)))
    for y in _years(df):
        tr, te = _split(df, y)
        tr = tr.sort_values("date")
        rel = (tr.groupby("date")["fwd"].rank(pct=True) * 10).clip(upper=9.999).astype(int)   # 0..9 relevance per day
        groups = tr.groupby("date", sort=True).size().to_numpy()
        m = lgb.train(params, lgb.Dataset(tr[feats], rel, group=groups), 250)
        pred.loc[te.index] = m.predict(te[feats])
    return pred


def evaluate(oos, col, bars, dates):
    ic = ic_by_year(oos, col)
    live = oos[oos.close.between(200, 650) & (oos.ret10 > 0)]
    t = simulate_managed(select_picks(live, col, 5, tilt=TILT), bars)
    t = t[t.filled == 1]
    st = stats(t)
    port = portfolio_sim(t, dates)
    port.pop("curve")
    return {"icMean": round(float(ic["mean"].mean()), 4), "icByYear": {str(k): round(float(v), 4) for k, v in ic["mean"].items()},
            "icMinYear": round(float(ic["mean"].min()), 4), "trades": st["n"], "expPct": float(st["exp%"]), "PF": float(st["PF"]),
            "CAGR": float(port["CAGR%"]), "maxDD": float(port["maxDD%"]),
            "expByYear": {str(y): round(float(g.net_ret.mean()) * 100, 2) for y, g in t.groupby(t.date.dt.year)}}


def main():
    t0 = time.time()
    df = prep()
    bars = pd.read_parquet(config.OUT_DIR / "features.parquet", columns=["symbol", "date", "open", "high", "low", "close"])
    print("rows", len(df), flush=True)
    df["base"] = wf_regress(df, (11,)); print("base done", round(time.time() - t0), flush=True)
    df["ens5"] = wf_regress(df, (11, 23, 37, 51, 77)); print("ens5 done", round(time.time() - t0), flush=True)
    df["rank"] = wf_rank(df); print("rank done", round(time.time() - t0), flush=True)
    oos = df[df.base.notna()].copy()
    for c in ("ens5", "rank"):
        oos[c + "_r"] = oos.groupby("date")[c].rank(pct=True)
    oos["blend"] = (oos["ens5_r"] + oos["rank_r"]) / 2
    dates = pd.DatetimeIndex(sorted(bars.date.unique()))
    dates = dates[dates >= oos.date.min()]
    res = {c: evaluate(oos, c, bars, dates) for c in ("base", "ens5", "rank", "blend")}
    oos[["date", "symbol", "base", "ens5", "rank", "blend"]].to_parquet(config.OUT_DIR / "experiments_oos.parquet")
    (config.OUT_DIR / "experiments.json").write_text(json.dumps(res, indent=1))
    print(f"{'variant':8s} {'IC':>7s} {'ICmin':>7s} {'exp%':>6s} {'PF':>5s} {'CAGR':>6s} {'DD':>6s}  expByYear")
    for k, v in res.items():
        print(f"{k:8s} {v['icMean']:7.4f} {v['icMinYear']:7.4f} {v['expPct']:6.2f} {v['PF']:5.2f} {v['CAGR']:6.1f} {v['maxDD']:6.1f}  {v['expByYear']}")
    print("total", round(time.time() - t0), "s")




def derivs_main():
    """A/B: production blend with vs without derivatives features (requires the derivs backfill + rebuilt features)."""
    from .model import DERIV_FEATURES
    from .production import SEEDS
    df = prep()
    bars = pd.read_parquet(config.OUT_DIR / "features.parquet", columns=["symbol", "date", "open", "high", "low", "close"])
    dates = pd.DatetimeIndex(sorted(bars.date.unique()))
    res = {}
    for name, feats in (("blend", ALL_FEATURES), ("blend+derivs", ALL_FEATURES + [f for f in DERIV_FEATURES if f in df.columns])):
        e = wf_regress(df, SEEDS, feats)
        r = wf_rank(df, feats)
        df[name] = (e.groupby(df.date).rank(pct=True) + r.groupby(df.date).rank(pct=True)) / 2
        print(name, "done", flush=True)
    oos = df[df["blend"].notna()].copy()
    d2 = dates[dates >= oos.date.min()]
    for name in ("blend", "blend+derivs"):
        res[name] = evaluate(oos, name, bars, d2)
    (config.OUT_DIR / "experiments_derivs.json").write_text(json.dumps(res, indent=1))
    for k, v in res.items():
        print(f"{k:13s} IC {v['icMean']:.4f} min {v['icMinYear']:.4f} exp {v['expPct']:.2f} PF {v['PF']:.2f} CAGR {v['CAGR']:.1f} DD {v['maxDD']:.1f} {v['expByYear']}")


if __name__ == "__main__":
    import sys
    derivs_main() if len(sys.argv) > 1 and sys.argv[1] == "derivs" else main()
