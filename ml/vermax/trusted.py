"""Steady-IPO screener, price part: IPOs that never fell below their listing price and keep closing higher.

For every main-board IPO that has traded >= 3 months on NSE (split/bonus-adjusted closes) this reports
  * listing price = the listing-day open; the lowest close / lowest intraday low since listing vs that price;
  * every completed calendar month and quarter: close vs the previous period's close (the first one vs the listing price);
  * RSI(14) (Wilder), price, liquidity and delivery.
Only stocks that are cheap enough (<= max_price) and were never more than `slack` below the listing price on a close are kept:
fundamentals, news, circuit history and the Buy score are added by the API for those few candidates.
"""
from __future__ import annotations
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from . import config
from .data import _con, load_bars, load_stocks
from .ipo_quality import _periods
from .screener import _r, ipo_master, seasoned


def _rsi(close: np.ndarray, n: int = 14) -> float | None:
    if len(close) < n + 1:
        return None
    d = np.diff(close)
    au = pd.Series(np.clip(d, 0, None)).ewm(alpha=1 / n, adjust=False).mean().iloc[-1]
    ad = pd.Series(np.clip(-d, 0, None)).ewm(alpha=1 / n, adjust=False).mean().iloc[-1]
    return 100.0 if ad == 0 else float(100 - 100 / (1 + au / ad))


def trusted(max_price: float = 1500.0, slack: float = 0.05) -> dict:
    with _con() as c:
        latest = c.execute("SELECT MAX(date) FROM daily_bars").fetchone()[0]
    last_dt = pd.Timestamp(latest)
    m = ipo_master()
    m = m[m.listed <= last_dt - pd.DateOffset(months=config.MIN_LIST_MONTHS)]
    df = load_bars("2018-12-01")
    df = df[df.symbol.isin(set(m.symbol))]
    stocks = load_stocks().set_index("symbol")
    names, sectors = stocks["name"].to_dict(), stocks["theme_sector"].to_dict()
    rows, scanned, too_dear, fell = [], 0, 0, 0
    for rec in m.itertuples():
        g = df[(df.symbol == rec.symbol) & (df.date >= rec.listed)].sort_values("date")
        # the data must start at the listing (older listings have no usable listing-day price) and be current
        if g.empty or g["date"].iloc[-1] != last_dt or g["date"].iloc[0] > rec.listed + pd.Timedelta(days=7):
            continue
        if not seasoned(g["date"].iloc[0], last_dt):
            continue
        scanned += 1
        ref = float(g["open"].iloc[0])
        close = float(g["close"].iloc[-1])
        if close > max_price:
            too_dear += 1
            continue
        min_close = float(g["close"].min()) / ref - 1
        if min_close < -slack:
            fell += 1
            continue
        below = g[g["close"] < ref]
        ip = float(rec.issuePrice) if pd.notna(rec.issuePrice) else None
        hi = float(g["high"].max())
        nm = names.get(rec.symbol)
        rows.append({
            "symbol": rec.symbol, "name": nm if isinstance(nm, str) else rec.company, "sector": sectors.get(rec.symbol, "Other"),
            "listingDate": rec.listed.date().isoformat(), "sessions": int(len(g)), "issuePrice": _r(ip), "listPrice": _r(ref),
            "close": _r(close), "chg1": _r((close / g["prev_close"].iloc[-1] - 1) * 100) if g["prev_close"].iloc[-1] else None,
            "vsListing": _r((close / ref - 1) * 100), "vsIssue": _r((close / ip - 1) * 100) if ip else None,
            "minCloseVsListing": _r(min_close * 100), "minLowVsListing": _r((float(g["low"].min()) / ref - 1) * 100),
            "sessionsBelowListing": int(len(below)), "lastBelowListing": below["date"].iloc[-1].date().isoformat() if len(below) else None,
            "fromHigh": _r((close / hi - 1) * 100), "rsi": _r(_rsi(g["close"].to_numpy()), 1),
            "months": _periods(g, "M", last_dt), "quarters": _periods(g, "Q", last_dt),
            "turnoverCr": _r(g["turnover"].tail(20).mean() / 1e7, 1),
            "deliveryAvg": _r(g["delivery_pct"].tail(20).mean(), 1) if g["delivery_pct"].notna().any() else None,
        })
    rows.sort(key=lambda r: (r["minCloseVsListing"] < 0, -r["sessions"]))
    return {"asOf": latest, "generatedAt": datetime.now(timezone.utc).isoformat(), "maxPrice": max_price, "slackPct": slack * 100,
            "scanned": scanned, "tooExpensive": too_dear, "fellBelowListing": fell, "count": len(rows), "rows": rows}
