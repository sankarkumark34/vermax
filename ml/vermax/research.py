"""Walk-forward research: baseline vs ML vs theme-priority tilt. Writes data/research/*"""
from __future__ import annotations
import json
import numpy as np
import pandas as pd
from . import config
from .model import FEATURES, NO_THEME, walk_forward
from .picking import select_picks, stats, portfolio_sim


def main():
    cand = pd.read_parquet(config.OUT_DIR / "candidates.parquet").reset_index(drop=True)
    feats = pd.read_parquet(config.OUT_DIR / "features.parquet", columns=["date"])
    dates = pd.DatetimeIndex(sorted(feats.date.unique()))
    print("candidates", len(cand), flush=True)

    cand["prob_all"] = walk_forward(cand, FEATURES)
    cand["prob_notheme"] = walk_forward(cand, NO_THEME)
    oos = cand[cand.prob_all.notna()].copy()
    oos["year"] = oos.date.dt.year
    print("OOS rows", len(oos), oos.date.min().date(), oos.date.max().date())

    res = {}

    def rec(name, picks):
        st = stats(picks)
        try:
            ps = portfolio_sim(picks, dates[dates >= oos.date.min()])
            ps.pop("curve", None)
        except Exception as e:  # noqa: BLE001
            ps = {"err": str(e)}
        res[name] = {**st, **ps}
        print(f"{name:34s}", res[name], flush=True)

    rec("all candidates (no model)", oos.assign(day_rank=0))
    rec("top5 by rules (n_setups,rs60)", select_picks(oos.assign(rk=oos.n_setups + oos.rs60.fillna(0)), "rk", 5))
    rec("ML(no theme feats) top5", select_picks(oos, "prob_notheme", 5))
    rec("ML(all feats) top5", select_picks(oos, "prob_all", 5))
    for thr in (0.25, 0.30, 0.35):
        rec(f"ML(all) top5 p>={thr}", select_picks(oos, "prob_all", 5, min_score=thr))
    for tilt in (0.03, 0.06, 0.10):
        rec(f"ML(all) top5 theme-tilt {tilt}", select_picks(oos, "prob_all", 5, tilt=tilt))
    rec("ML(all) theme-only top5", select_picks(oos[oos.is_theme == 1], "prob_all", 5))
    rec("ML(all) theme-only p>=0.30", select_picks(oos[oos.is_theme == 1], "prob_all", 5, min_score=0.30))

    for name, pk in (("ML(all) top5", select_picks(oos, "prob_all", 5)),
                     ("ML(all) top5 theme-tilt 0.06", select_picks(oos, "prob_all", 5, tilt=0.06))):
        pk = pk.assign(year=pk.date.dt.year)
        print("\n", name, "by year")
        print(pk.groupby("year").apply(lambda g: pd.Series(stats(g))).to_string())
    oos["dec"] = pd.qcut(oos.prob_all, 10, labels=False, duplicates="drop")
    cal = oos.groupby("dec").agg(n=("win", "size"), p=("prob_all", "mean"), win=("win", "mean"), exp=("net_ret", "mean"))
    print("\ncalibration\n", cal.round(3).to_string())
    json.dump(res, open(config.OUT_DIR / "walkforward_results.json", "w"), indent=2, default=str)
    oos.to_parquet(config.OUT_DIR / "oos_predictions.parquet")


if __name__ == "__main__":
    main()
