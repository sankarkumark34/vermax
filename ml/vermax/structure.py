"""Point-in-time MACD / market-structure / Fibonacci / FVG features (mirrors apps/api/src/analysis/technicals.ts).

Every value at row t uses bars <= t only: a swing pivot at bar i is usable from bar i + K (it needs K bars on its right).
Used by experiments.structure_main() to test whether these studies add anything to the production blend.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

K = 3
FIB_N = 120
FVG_N = 60
FVG_MIN = 0.003

STRUCT_FEATURES = ["macd_n", "macd_hist_n", "macd_cross_age", "ms_trend", "bos_up_age", "choch_up_age", "dist_swing_hi", "dist_swing_lo",
                   "fib_ret", "fib_up", "fvg_bull_n", "fvg_bear_n", "in_bull_fvg"]


def _ema(x: np.ndarray, span: int) -> np.ndarray:
    a = 2 / (span + 1)
    out = np.empty_like(x)
    out[0] = x[0]
    for i in range(1, len(x)):
        out[i] = x[i] * a + out[i - 1] * (1 - a)
    return out


def _one(h: np.ndarray, l: np.ndarray, c: np.ndarray) -> dict[str, np.ndarray]:
    n = len(c)
    nan = lambda: np.full(n, np.nan)
    f = {k: nan() for k in STRUCT_FEATURES}
    m = _ema(c, 12) - _ema(c, 26)
    s = _ema(m, 9)
    hist = m - s
    f["macd_n"] = m / c
    f["macd_hist_n"] = hist / c
    sign = np.sign(hist)
    age, last = np.full(n, np.nan), None
    for i in range(1, n):
        if sign[i] != sign[i - 1] and sign[i] != 0:
            last = i
        if last is not None:
            age[i] = (i - last) * (1 if sign[i] > 0 else -1)      # +k: bullish cross k bars ago, -k: bearish
    f["macd_cross_age"] = np.clip(age, -30, 30)

    # swing pivots (strict on the right, non-strict on the left, like the TS version)
    isH = np.zeros(n, bool); isL = np.zeros(n, bool)
    if n > 2 * K:
        wh, wl = sliding_window_view(h, 2 * K + 1), sliding_window_view(l, 2 * K + 1)
        mid_h, mid_l = wh[:, K], wl[:, K]
        left_ok_h = (wh[:, :K] < mid_h[:, None]).all(1); right_ok_h = (wh[:, K + 1:] <= mid_h[:, None]).all(1)
        left_ok_l = (wl[:, :K] > mid_l[:, None]).all(1); right_ok_l = (wl[:, K + 1:] >= mid_l[:, None]).all(1)
        isH[K:n - K] = left_ok_h & right_ok_h
        isL[K:n - K] = left_ok_l & right_ok_l
    trend, hi, lo, last_hi, last_lo = 0, np.nan, np.nan, np.nan, np.nan
    bos_up = choch_up = None
    for i in range(n):
        j = i - K                      # pivot that becomes known today
        if j >= 0:
            if isH[j]: hi = last_hi = h[j]
            if isL[j]: lo = last_lo = l[j]
        if not np.isnan(hi) and c[i] > hi:
            if trend == -1: choch_up = i
            else: bos_up = i
            trend, hi = 1, np.nan
        elif not np.isnan(lo) and c[i] < lo:
            trend, lo = -1, np.nan
        f["ms_trend"][i] = trend
        f["bos_up_age"][i] = min(i - bos_up, 60) if bos_up is not None else 60
        f["choch_up_age"][i] = min(i - choch_up, 60) if choch_up is not None else 60
        f["dist_swing_hi"][i] = c[i] / last_hi - 1 if not np.isnan(last_hi) else np.nan
        f["dist_swing_lo"][i] = c[i] / last_lo - 1 if not np.isnan(last_lo) else np.nan

    # Fibonacci position inside the last FIB_N-bar leg
    if n >= FIB_N:
        wh, wl = sliding_window_view(h, FIB_N), sliding_window_view(l, FIB_N)
        ih, il = wh.argmax(1), wl.argmin(1)
        H, L = wh.max(1), wl.min(1)
        span = np.where(H - L > 0, H - L, np.nan)
        up = il < ih
        cc = c[FIB_N - 1:]
        f["fib_ret"][FIB_N - 1:] = np.where(up, (H - cc) / span, (cc - L) / span)
        f["fib_up"][FIB_N - 1:] = up.astype(float)

    # open fair value gaps
    bull: list[tuple[int, float, float]] = []; bear: list[tuple[int, float, float]] = []
    for i in range(n):
        if i >= 2:
            if l[i] > h[i - 2] and (l[i] - h[i - 2]) / c[i] >= FVG_MIN: bull.append((i, h[i - 2], l[i]))
            if h[i] < l[i - 2] and (l[i - 2] - h[i]) / c[i] >= FVG_MIN: bear.append((i, h[i], l[i - 2]))
        bull = [g for g in bull if c[i] >= g[1] and i - g[0] <= FVG_N]
        bear = [g for g in bear if c[i] <= g[2] and i - g[0] <= FVG_N]
        f["fvg_bull_n"][i] = len(bull); f["fvg_bear_n"][i] = len(bear)
        f["in_bull_fvg"][i] = float(any(g[1] <= c[i] <= g[2] for g in bull if g[0] < i))
    return f


def add_structure_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["symbol", "date"]).reset_index(drop=True)
    cols = {k: np.full(len(df), np.nan) for k in STRUCT_FEATURES}
    for _, idx in df.groupby("symbol", sort=False).indices.items():
        if len(idx) < 30:
            continue
        r = _one(df["high"].to_numpy()[idx], df["low"].to_numpy()[idx], df["close"].to_numpy()[idx])
        for k in STRUCT_FEATURES:
            cols[k][idx] = r[k]
    for k, v in cols.items():
        df[k] = v
    return df
