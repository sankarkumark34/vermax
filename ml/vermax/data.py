from __future__ import annotations
import sqlite3
import numpy as np
import pandas as pd
from . import config
from .themes import assign_sector

CANON = np.array([0.5, 1 / 3, 0.25, 0.2, 0.1, 0.05, 2 / 3, 0.75, 0.8, 0.6, 0.4, 0.125, 2, 3, 4, 5, 10])


def _con():
    return sqlite3.connect(f"file:{config.DB_PATH.as_posix()}?mode=ro", uri=True)


def load_bars(start: str = "2019-01-01", end: str | None = None) -> pd.DataFrame:
    q = ("SELECT symbol,date,open,high,low,close,prevClose AS prev_close,volume,turnover,deliveryPct AS delivery_pct "
         "FROM daily_bars WHERE date>=? " + ("AND date<=? " if end else "") + "ORDER BY symbol,date")
    with _con() as c:
        df = pd.read_sql_query(q, c, params=[start] + ([end] if end else []))
    df = df[(df.close > 0) & (df.open > 0) & (df.high > 0) & (df.low > 0)]
    df = df.drop_duplicates(["symbol", "date"]).reset_index(drop=True)
    df["date"] = pd.to_datetime(df["date"])
    return _adjust_corporate_actions(df)


def _adjust_corporate_actions(df: pd.DataFrame) -> pd.DataFrame:
    """Back-adjust OHLC for splits/bonuses: detect prev_close != previous row close at canonical ratios."""
    g = df.groupby("symbol", sort=False)
    prev_row_close = g["close"].shift(1)
    r = df["prev_close"] / prev_row_close
    off = (r - 1).abs() > 0.05
    near = np.zeros(len(df), dtype=bool)
    rv = r.to_numpy()
    for c in CANON:
        near |= np.abs(rv / c - 1) < 0.03
    ev = (off & near).fillna(False)
    factor = pd.Series(1.0, index=df.index)
    factor[ev] = r[ev]
    # Detector 2: some ex-dates arrive with an UNadjusted PREVCLOSE in the bhavcopy, so detector 1 cannot see them.
    # Recognise them when both the open and the day's extreme sit at a canonical ratio of the previous close
    # (exchange price bands make genuine one-day moves of that size practically impossible).
    pv = prev_row_close.to_numpy()
    ro, rh, rl = df["open"].to_numpy() / pv, df["high"].to_numpy() / pv, df["low"].to_numpy() / pv
    f2 = np.full(len(df), np.nan)
    for c in CANON:
        if 0.75 < c < 1.33:
            continue
        ext = rh if c < 1 else rl
        hit = (np.abs(ro / c - 1) < 0.04) & (np.abs(ext / c - 1) < 0.08) & np.isnan(f2)
        f2[hit] = c
    ev2 = pd.Series(~np.isnan(f2), index=df.index) & (r - 1).abs().le(0.05) & ~ev
    factor[ev2] = f2[ev2.to_numpy()]
    df.loc[ev2, "prev_close"] = df.loc[ev2, "prev_close"] * factor[ev2]   # make that day's own 1-day change sane
    # rows BEFORE an event are scaled by the event ratio: reverse cumulative product per symbol
    shifted = factor.groupby(df["symbol"]).shift(-1).fillna(1.0)
    rev = shifted.groupby(df["symbol"]).transform(lambda s: s[::-1].cumprod()[::-1])
    for col in ("open", "high", "low", "close", "prev_close"):
        df[col] = df[col] * rev
    df["volume"] = df["volume"] / rev
    return df


def load_index(name: str, start: str = "2019-01-01") -> pd.DataFrame:
    with _con() as c:
        df = pd.read_sql_query(
            'SELECT date,open,high,low,close FROM index_bars WHERE "indexName"=? AND date>=? ORDER BY date',
            c, params=[name, start])
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date")


def load_stocks() -> pd.DataFrame:
    with _con() as c:
        s = pd.read_sql_query("SELECT symbol,name,sector,industry FROM stocks", c)
    s["theme_sector"] = [assign_sector(a, b) for a, b in zip(s.symbol, s.sector)]
    return s
