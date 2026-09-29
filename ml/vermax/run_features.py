"""Build the labelled candidate dataset -> data/research/candidates.parquet"""
from __future__ import annotations
import time, sys
import pandas as pd
from . import config
from .features import build_features
from .setups import add_setups
from .labels import simulate_trades
from .data import load_bars


def main():
    t0 = time.time()
    df = build_features()
    print("features", df.shape, f"{time.time()-t0:.0f}s", flush=True)
    df = add_setups(df)
    df.to_parquet(config.OUT_DIR / "features.parquet")
    cand = df[df.candidate == 1].copy()
    print("candidates", len(cand), cand[["brk", "pullback", "squeeze", "high52"]].sum().to_dict(), flush=True)
    bars = df[["symbol", "date", "open", "high", "low", "close"]]
    lab = simulate_trades(cand, bars)
    lab = lab[lab.filled == 1].copy()
    lab.to_parquet(config.OUT_DIR / "candidates.parquet")
    print("labelled", len(lab), f"win-rate {lab.win.mean():.3f} exp {lab.net_ret.mean()*100:.2f}% total {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
