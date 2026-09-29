"""Cross-sectional ranking study over ALL liquid stock-days (not just setup candidates).

Target: cross-sectional percentile rank of the 10-day forward return (next-open entry -> close t+10).
Reports out-of-sample rank-IC by year, top-bucket returns net of costs, and theme/regime slices.
"""
from __future__ import annotations
import sys
import numpy as np
import pandas as pd
import lightgbm as lgb
from . import config
from .model import FEATURES, NO_THEME

H = 10
EXTRA = ["mom_12_1", "ret120"]


def add_extra(df: pd.DataFrame) -> pd.DataFrame:
    g = df.groupby("symbol", sort=False)
    df["mom_12_1"] = g["close"].shift(21) / g["close"].shift(252) - 1
    return df


def prep(df: pd.DataFrame | None = None) -> pd.DataFrame:
    df = pd.read_parquet(config.OUT_DIR / "features.parquet") if df is None else df
    g = df.groupby("symbol", sort=False)
    df["fwd"] = g["close"].shift(-H) / g["open"].shift(-1) - 1
    df["fwd_gap"] = g["open"].shift(-1) / df["close"] - 1
    df = add_extra(df)
    df = df[df.liquid & df.fwd.notna()].copy()
    df["y"] = df.groupby("date")["fwd"].rank(pct=True) - 0.5
    df["fwd_ex"] = df.fwd - df.groupby("date")["fwd"].transform("median")
    return df


def wf_predict(df: pd.DataFrame, feats: list[str], first_year=2021, embargo_days=15, rounds=250) -> pd.Series:
    pred = pd.Series(np.nan, index=df.index)
    params = dict(objective="regression", learning_rate=0.05, num_leaves=31, min_child_samples=500,
                  feature_fraction=0.7, bagging_fraction=0.7, bagging_freq=1, lambda_l2=50.0, max_depth=6,
                  verbose=-1, seed=11, n_jobs=6)
    for y in sorted(df.date.dt.year.unique()):
        if y < first_year:
            continue
        start = pd.Timestamp(f"{y}-01-01")
        tr = df[df.date < start - pd.Timedelta(days=embargo_days)]
        te = df[(df.date >= start) & (df.date < pd.Timestamp(f"{y + 1}-01-01"))]
        if te.empty:
            continue
        # subsample rows for speed (every 2nd date is enough; rows are highly autocorrelated)
        trs = tr[tr.date.dt.dayofyear % 2 == 0]
        m = lgb.train(params, lgb.Dataset(trs[feats], trs["y"]), rounds)
        pred.loc[te.index] = m.predict(te[feats])
        print("  trained", y, len(trs), flush=True)
    return pred


def ic_by_year(d: pd.DataFrame, col: str) -> pd.Series:
    x = d.dropna(subset=[col])
    ic = x.groupby("date").apply(lambda g: g[col].corr(g["fwd"], method="spearman"))
    return ic.groupby(ic.index.year).agg(["mean", "std", "count"]).assign(ir=lambda t: t["mean"] / t["std"] * np.sqrt(252 / H))


def bucket_table(d: pd.DataFrame, col: str, q=10) -> pd.DataFrame:
    x = d.dropna(subset=[col]).copy()
    x["b"] = x.groupby("date")[col].transform(lambda s: pd.qcut(s.rank(method="first"), q, labels=False))
    return x.groupby("b").agg(n=("fwd", "size"), fwd=("fwd", "mean"), med=("fwd", "median"),
                             ex=("fwd_ex", "mean"), hit=("fwd", lambda s: (s > 0.03).mean()))


def main():
    df = prep()
    print("rows", len(df), df.date.min().date(), df.date.max().date(), flush=True)
    feats = FEATURES + EXTRA
    df["p_all"] = wf_predict(df, feats)
    df["p_nt"] = wf_predict(df, [f for f in feats if f not in ("is_defence", "is_engineering", "is_theme")])
    oos = df[df.p_all.notna()].copy()
    oos.to_parquet(config.OUT_DIR / "xs_oos.parquet")
    for col in ("p_all", "p_nt", "mom_12_1", "rs60", "sec_rank"):
        print("\nIC by year:", col)
        print(ic_by_year(oos, col).round(4).to_string())
    print("\nbuckets p_all (10=top)")
    print(bucket_table(oos, "p_all").round(4).to_string())
    print("\nbuckets p_nt")
    print(bucket_table(oos, "p_nt").round(4).to_string())


if __name__ == "__main__":
    main()
