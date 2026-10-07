"""IPO journey after listing: time spent below the issue price / listing-day price, and when it recovered.

Two reference prices are used, both split/bonus-adjusted to today's share basis:
  * issue   - the IPO allotment price (IPO investor's view)
  * listing - the first traded price on listing day (an investor who bought at listing)
A session is "in loss" when its close is below the reference. "Recovered" = first close back at/above the reference
after having been below it. Also provides an all-IPO study grouped by subscription level.
"""
from __future__ import annotations
import time
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from .data import _con, load_bars
from .screener import _r, ipo_master


def _raw_first_open(symbol: str, on_or_after: str) -> float | None:
    with _con() as c:
        r = c.execute("SELECT open FROM daily_bars WHERE symbol=? AND date>=? ORDER BY date LIMIT 1", (symbol, on_or_after)).fetchone()
    return float(r[0]) if r and r[0] else None


def journey_vs(g: pd.DataFrame, ref: float) -> dict:
    """g: bars from listing day onward (adjusted, sorted). ref: reference price on the same basis."""
    close = g["close"].to_numpy()
    low = g["low"].to_numpy()
    dates = g["date"].dt.date.astype(str).to_numpy()
    below = close < ref
    n = len(close)
    # loss episodes = consecutive runs of closes below ref
    episodes, i = [], 0
    while i < n:
        if below[i]:
            j = i
            while j + 1 < n and below[j + 1]:
                j += 1
            rec = j + 1 if j + 1 < n else None
            episodes.append({"start": dates[i], "end": dates[j], "sessions": int(j - i + 1),
                             "deepest": _r((low[i:j + 1].min() / ref - 1) * 100),
                             "recoveredOn": dates[rec] if rec is not None else None})
            i = j + 1
        else:
            i += 1
    first_below = bool(below[0])
    first_rec = episodes[0]["recoveredOn"] if episodes and episodes[0]["start"] == dates[0] else None
    if not episodes:
        status = "never_below"
    elif below[-1]:
        status = "below_since_listing" if len(episodes) == 1 and first_below else "below_now"
    else:
        status = "recovered"
    sessions_to_recover = None
    days_to_recover = None
    if first_below and first_rec:
        sessions_to_recover = episodes[0]["sessions"]
        days_to_recover = int((pd.Timestamp(first_rec) - pd.Timestamp(dates[0])).days)
    return {
        "ref": _r(ref), "status": status, "listedBelow": first_below,
        "sessionsBelow": int(below.sum()), "pctSessionsBelow": _r(below.mean() * 100, 1), "sessions": n,
        "longestLossStreak": max((e["sessions"] for e in episodes), default=0),
        "currentLossStreak": episodes[-1]["sessions"] if episodes and below[-1] else 0,
        "deepest": _r((low.min() / ref - 1) * 100), "current": _r((close[-1] / ref - 1) * 100),
        "firstRecoveryOn": first_rec, "sessionsToRecover": sessions_to_recover, "daysToRecover": days_to_recover,
        "lastRecoveryOn": next((e["recoveredOn"] for e in reversed(episodes) if e["recoveredOn"]), None),
        "episodes": len(episodes), "worstEpisodes": sorted(episodes, key=lambda e: -e["sessions"])[:5],
    }


def journey_for(symbol: str, listing_date: pd.Timestamp, issue_price: float | None, g: pd.DataFrame) -> dict | None:
    """g: adjusted bars for the symbol. Returns journeys vs issue and vs listing price, or None if listing is outside the data."""
    g = g[g["date"] >= listing_date].sort_values("date")
    if g.empty or (g["date"].iloc[0] - listing_date).days > 10:
        return None                                       # listed before our price history starts
    raw0 = _raw_first_open(symbol, g["date"].iloc[0].date().isoformat())
    factor = float(g["open"].iloc[0]) / raw0 if raw0 else 1.0   # split/bonus adjustment since listing
    out = {"listingDate": listing_date.date().isoformat(), "adjFactor": _r(factor, 4),
           "vsListing": journey_vs(g, float(g["open"].iloc[0]))}
    if issue_price:
        out["vsIssue"] = journey_vs(g, issue_price * factor)
        out["issueAdj"] = _r(issue_price * factor)
    return out


def _bucket(x: float | None, edges: list[tuple[float, str]]) -> str:
    if x is None or np.isnan(x):
        return "unknown"
    for hi, label in edges:
        if x < hi:
            return label
    return edges[-1][1]


QIB_EDGES = [(10, "QIB < 10×"), (50, "QIB 10–50×"), (100, "QIB 50–100×"), (float("inf"), "QIB ≥ 100×")]
TOT_EDGES = [(5, "Total < 5×"), (25, "Total 5–25×"), (75, "Total 25–75×"), (float("inf"), "Total ≥ 75×")]


def _agg(rows: list[dict], basis: str) -> dict:
    js = [r[basis] for r in rows if r.get(basis)]
    if not js:
        return {"n": 0}
    went_below = [j for j in js if j["episodes"] > 0]
    listed_below = [j for j in js if j["listedBelow"]]
    rec = [j for j in listed_below if j["sessionsToRecover"] is not None]

    def within(days):
        el = [j for j in listed_below if j["daysToRecover"] is not None or j["sessions"] >= days * 0.69]
        return _r(100 * sum(1 for j in el if j["daysToRecover"] is not None and j["daysToRecover"] <= days) / len(el), 0) if el else None
    return {
        "n": len(js), "pctListedBelow": _r(100 * len(listed_below) / len(js), 0),
        "pctEverBelow": _r(100 * len(went_below) / len(js), 0),
        "pctBelowNow": _r(100 * sum(1 for j in js if j["current"] is not None and j["current"] < 0) / len(js), 0),
        "pctStillBelowSinceListing": _r(100 * sum(1 for j in js if j["status"] == "below_since_listing") / len(js), 0),
        "medianSessionsToRecover": _r(float(np.median([j["sessionsToRecover"] for j in rec])), 0) if rec else None,
        "medianDaysToRecover": _r(float(np.median([j["daysToRecover"] for j in rec])), 0) if rec else None,
        "recoveredWithin30d": within(30), "recoveredWithin90d": within(90), "recoveredWithin365d": within(365),
        "medianPctSessionsBelow": _r(float(np.median([j["pctSessionsBelow"] for j in js])), 0),
        "medianDeepest": _r(float(np.median([j["deepest"] for j in js])), 1),
        "medianCurrent": _r(float(np.median([j["current"] for j in js])), 1),
    }


def ipo_study() -> dict:
    """All main-board IPOs listed inside our price history (2019+), grouped by subscription and year."""
    from .analyse import _subscription
    with _con() as c:
        latest = c.execute("SELECT MAX(date) FROM daily_bars").fetchone()[0]
        first_day = c.execute("SELECT MIN(date) FROM daily_bars").fetchone()[0]
    m = ipo_master()
    m = m[(m.listed >= pd.Timestamp(first_day) + pd.Timedelta(days=5)) & (m.listed <= pd.Timestamp(latest))]
    df = load_bars(first_day)
    df = df[df.symbol.isin(set(m.symbol))]
    rows = []
    for rec in m.itertuples():
        g = df[df.symbol == rec.symbol]
        if g.empty:
            continue
        j = journey_for(rec.symbol, rec.listed, float(rec.issuePrice) if pd.notna(rec.issuePrice) else None, g)
        if not j:
            continue
        sub = _subscription(rec.symbol, listed=True)
        time.sleep(0.15)
        first = g[g.date >= rec.listed].iloc[0]
        row = {"symbol": rec.symbol, "name": rec.company, "listingDate": j["listingDate"], "year": rec.listed.year,
               "issuePrice": _r(rec.issuePrice), "issueAdj": j.get("issueAdj"), "listOpen": _r(first.open), "close": _r(g.close.iloc[-1]),
               "listingGain": _r((float(first.open) / j["issueAdj"] - 1) * 100) if j.get("issueAdj") else None,
               "subscription": sub, "qibBucket": _bucket((sub or {}).get("qib"), QIB_EDGES), "totalBucket": _bucket((sub or {}).get("total"), TOT_EDGES),
               "vsIssue": j.get("vsIssue"), "vsListing": j["vsListing"]}
        for basis in ("vsIssue", "vsListing"):
            if row[basis]:
                row[basis] = {k: v for k, v in row[basis].items() if k != "worstEpisodes"}
        rows.append(row)
    groups = {}
    for basis in ("vsIssue", "vsListing"):
        groups[basis] = {
            "overall": _agg(rows, basis),
            "byQib": {b: _agg([r for r in rows if r["qibBucket"] == b], basis) for _, b in QIB_EDGES + [(0, "unknown")]},
            "byTotal": {b: _agg([r for r in rows if r["totalBucket"] == b], basis) for _, b in TOT_EDGES + [(0, "unknown")]},
            "byYear": {str(y): _agg([r for r in rows if r["year"] == y], basis) for y in sorted({r["year"] for r in rows})},
        }
    return {"asOf": latest, "generatedAt": datetime.now(timezone.utc).isoformat(), "count": len(rows),
            "qibBuckets": [b for _, b in QIB_EDGES], "totalBuckets": [b for _, b in TOT_EDGES], "groups": groups,
            "rows": sorted(rows, key=lambda r: r["listingDate"], reverse=True)}
