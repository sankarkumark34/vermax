"""Event-based setups. Each flag fires on the signal day's close; entry is the NEXT session."""
from __future__ import annotations
import numpy as np
import pandas as pd

SETUPS = ["brk", "pullback", "squeeze", "high52"]


def add_setups(df: pd.DataFrame) -> pd.DataFrame:
    c = df.close
    uptrend = (c > df.sma200) & (df.ema20 > df.ema50) & (df.ema50_slope > 0)

    # 1) Volume breakout out of a 20-day range, strong close
    df["brk"] = (uptrend & (c > df.prior_hi20) & (df.vol_ratio >= 1.5) & (df.close_pos >= 0.7)
                 & (df.d_ema20 < 0.10) & (df.rsi14 < 80)).astype(int)

    # 2) Pullback to the 20-EMA inside an uptrend with a bullish reversal candle
    touch = df.low <= df.ema20 * 1.01
    df["pullback"] = (uptrend & touch & (c >= df.ema20 * 0.99) & (df.rsi14.between(35, 58))
                      & (df.close_pos >= 0.6) & ((df.hammer == 1) | (df.engulf == 1) | (df.body > 0.3))
                      ).astype(int)

    # 3) Volatility squeeze (NR7 / inside day yesterday) then close above yesterday's high
    prev_nr7 = df.groupby("symbol", sort=False)["nr7"].shift(1).fillna(0)
    prev_inside = df.groupby("symbol", sort=False)["inside"].shift(1).fillna(0)
    df["squeeze"] = (uptrend & ((prev_nr7 == 1) | (prev_inside == 1)) & (c > df.prev_high)
                     & (df.close_pos >= 0.65) & (df.bb_ratio < 1.0)).astype(int)

    # 4) 52-week-high breakout with delivery/volume confirmation
    df["high52"] = ((df.dist_hi252 >= -0.02) & (c > df.prior_hi20) & (df.vol_ratio >= 1.2)
                    & (df.deliv_ratio.fillna(1.0) >= 1.1) & (df.close_pos >= 0.6) & (df.rsi14 < 82)).astype(int)

    df["n_setups"] = df[SETUPS].sum(axis=1)
    df["candidate"] = ((df.n_setups > 0) & df.liquid).astype(int)
    return df
