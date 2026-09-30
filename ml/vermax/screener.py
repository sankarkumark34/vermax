"""Price-bucket / multi-horizon return screener (split/bonus-adjusted closes)."""
from __future__ import annotations
import json
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from . import config
from .data import _con, load_bars, load_stocks

HORIZONS = {"d5": 5, "d10": 10, "w3": 15, "m1": 21, "q1": 63, "h1": 126, "y1": 252}


def screen(min_turnover_cr: float = 0.5, min_price: float = 20.0) -> dict:
    with _con() as c:
        latest = c.execute("SELECT MAX(date) FROM daily_bars").fetchone()[0]
    start = (pd.Timestamp(latest) - pd.Timedelta(days=430)).date().isoformat()
    df = load_bars(start).sort_values(["symbol", "date"]).reset_index(drop=True)
    g = df.groupby("symbol", sort=False)
    df["bars"] = g.cumcount() + 1
    df["turnover20"] = g["turnover"].transform(lambda s: s.rolling(20, min_periods=10).mean()) / 1e7
    last = df[df.date == pd.Timestamp(latest)].copy()
    for k, n in HORIZONS.items():
        ref = g["close"].shift(n)
        last[k] = (df["close"] / ref - 1).loc[last.index]
    last["chg1"] = (df["close"] / g["close"].shift(1) - 1).loc[last.index]
    last = last[(last.close >= min_price) & (last.turnover20 >= min_turnover_cr)]
    stocks = load_stocks().set_index("symbol")
    last["name"] = last.symbol.map(stocks["name"])
    last["sector"] = last.symbol.map(stocks["theme_sector"]).fillna("Other")
    rows = []
    for r in last.itertuples():
        rec = {"symbol": r.symbol, "name": r.name if isinstance(r.name, str) else None, "sector": r.sector,
               "close": round(float(r.close), 2), "chg1": round(float(r.chg1) * 100, 2) if pd.notna(r.chg1) else None,
               "turnoverCr": round(float(r.turnover20), 1), "bars": int(r.bars),
               "deliveryPct": round(float(r.delivery_pct), 1) if pd.notna(r.delivery_pct) else None}
        for k in HORIZONS:
            v = getattr(r, k)
            rec[k] = round(float(v) * 100, 2) if pd.notna(v) else None
        rows.append(rec)
    return {"asOf": latest, "generatedAt": datetime.now(timezone.utc).isoformat(), "count": len(rows),
            "horizons": {k: n for k, n in HORIZONS.items()}, "rows": rows}
