"""Multi-period return screener and recent-IPO screener (split/bonus-adjusted NSE closes).

Conventions (match Google Finance / NSE):
  * 1D  = vs the previous session close published by NSE (bhavcopy PREVCLOSE).
  * 1W/2W/3W/4W = 5/10/15/20 trading sessions back.
  * 1M/3M/6M/1Y = calendar months: first close on/after the same date N months ago.
Each return also ships its reference price so the UI can recompute it against a live price.
"""
from __future__ import annotations
import time
from datetime import datetime, timezone
import numpy as np
import pandas as pd
import requests
from . import config
from .data import _con, load_bars, load_stocks

SESSIONS = {"d5": 5, "d10": 10, "w3": 15, "w4": 20}
CAL_MONTHS = {"m1": 1, "q1": 3, "h1": 6, "y1": 12}
HORIZONS = {**SESSIONS, **{k: v * 21 for k, v in CAL_MONTHS.items()}}
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}


def _r(x, d=2):
    return round(float(x), d) if x is not None and pd.notna(x) else None


def _next_session(last_dt: pd.Timestamp) -> pd.Timestamp:
    """The session a live (intraday) price belongs to: today in IST if after the last stored session, else next weekday."""
    today = pd.Timestamp(datetime.now(timezone.utc) + pd.Timedelta(hours=5, minutes=30)).normalize().tz_localize(None)
    d = today if today > last_dt else last_dt + pd.Timedelta(days=1)
    while d.weekday() >= 5:
        d += pd.Timedelta(days=1)
    return d


def _period_refs(sym_df: pd.DataFrame, last_dt: pd.Timestamp, live: bool = False) -> dict[str, float | None]:
    """sym_df: one symbol's bars sorted by date (adjusted). Returns the reference close for each horizon.

    live=False: anchored at the last stored close (official numbers).
    live=True : anchored at the next (in-progress) session, so a live price compares exactly like Google does.
    """
    closes = sym_df["close"].to_numpy()
    dates = sym_df["date"].to_numpy()
    out: dict[str, float | None] = {}
    n = len(closes)
    shift = 0 if live else 1
    anchor = _next_session(last_dt) if live else last_dt
    for k, s in SESSIONS.items():
        i = n - shift - s
        out[k] = float(closes[i]) if i >= 0 else None
    for k, m in CAL_MONTHS.items():
        cut = np.datetime64(anchor - pd.DateOffset(months=m))
        if dates[0] > cut:                       # not listed / no data that far back
            out[k] = None
            continue
        idx = int(np.searchsorted(dates, cut, side="left"))
        ok = idx < n and (dates[idx] - cut) <= np.timedelta64(10, "D")
        out[k] = float(closes[idx]) if ok else None
    return out


def _rows(df: pd.DataFrame, latest: str) -> list[dict]:
    last_dt = pd.Timestamp(latest)
    stocks = load_stocks().set_index("symbol")
    names, sectors = stocks["name"].to_dict(), stocks["theme_sector"].to_dict()
    rows = []
    for sym, g in df.groupby("symbol", sort=False):
        g = g.sort_values("date")
        if g["date"].iloc[-1] != last_dt:
            continue
        last = g.iloc[-1]
        refs = _period_refs(g, last_dt)
        refs_live = _period_refs(g, last_dt, live=True)
        nm = names.get(sym)
        rec = {"symbol": sym, "name": nm if isinstance(nm, str) else None, "sector": sectors.get(sym, "Other"),
               "close": _r(last.close), "prevClose": _r(last.prev_close),
               "chg1": _r((last.close / last.prev_close - 1) * 100) if last.prev_close else None,
               "turnoverCr": _r(g["turnover"].tail(20).mean() / 1e7, 1), "bars": int(len(g)),
               "deliveryPct": _r(last.delivery_pct, 1), "refs": {k: _r(v) for k, v in refs.items()},
               "refsLive": {k: _r(v) for k, v in refs_live.items()}}
        for k, ref in refs.items():
            rec[k] = _r((last.close / ref - 1) * 100) if ref else None
        rows.append(rec)
    return rows


def screen(min_turnover_cr: float = 0.5, min_price: float = 20.0) -> dict:
    with _con() as c:
        latest = c.execute("SELECT MAX(date) FROM daily_bars").fetchone()[0]
    start = (pd.Timestamp(latest) - pd.Timedelta(days=430)).date().isoformat()
    df = load_bars(start)
    equities = set(listing_master().symbol)          # NSE equity master: excludes ETFs, liquid funds, REITs
    df = df[df.symbol.isin(equities)]
    rows = [r for r in _rows(df, latest) if r["close"] and r["close"] >= min_price and (r["turnoverCr"] or 0) >= min_turnover_cr]
    return {"asOf": latest, "liveSession": _next_session(pd.Timestamp(latest)).date().isoformat(),
            "generatedAt": datetime.now(timezone.utc).isoformat(), "count": len(rows), "horizons": HORIZONS, "rows": rows}


def listing_master() -> pd.DataFrame:
    """NSE equity master (EQUITY_L.csv) with official listing dates; cached for a day."""
    p = config.ROOT / "data" / "cache" / "universe" / "equity_l.csv"
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists() or time.time() - p.stat().st_mtime > 86_400:
        try:
            r = requests.get("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv", headers=UA, timeout=30)
            if r.ok and b"SYMBOL" in r.content[:200]:
                p.write_bytes(r.content)
        except Exception:  # noqa: BLE001
            pass
    m = pd.read_csv(p)
    m.columns = [c.strip().upper() for c in m.columns]
    m["SYMBOL"] = m["SYMBOL"].str.strip()
    m["listed"] = pd.to_datetime(m["DATE OF LISTING"].str.strip(), format="%d-%b-%Y", errors="coerce")
    return m[["SYMBOL", "NAME OF COMPANY", "SERIES", "listed"]].rename(columns={"SYMBOL": "symbol", "NAME OF COMPANY": "company", "SERIES": "series"})


def ipo_master() -> pd.DataFrame:
    """Genuine main-board IPOs from NSE's public past-issues feed (issue price, listing date); cached for a day.

    Excludes SME issues and companies that merely started trading on NSE (direct listings / BSE migrations)."""
    import json as _json
    p = config.ROOT / "data" / "cache" / "universe" / "ipo_past_issues.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists() or time.time() - p.stat().st_mtime > 86_400:
        try:
            r = requests.get("https://www.nseindia.com/api/public-past-issues?index=equities", headers={**UA, "Accept": "application/json"}, timeout=30)
            if r.ok and r.content[:1] == b"[":
                p.write_bytes(r.content)
        except Exception:  # noqa: BLE001
            pass
    if not p.exists():
        return pd.DataFrame(columns=["symbol", "company", "issuePrice", "listed", "priceRange"])
    d = pd.DataFrame(_json.loads(p.read_text()))
    d = d[d["securityType"].isin(["EQ", "BE"]) & (d["listingDate"] != "-")].copy()
    d["symbol"] = d["symbol"].str.strip()
    d["issuePrice"] = pd.to_numeric(d["issuePrice"].astype(str).str.replace(r"[^0-9.]", "", regex=True), errors="coerce")
    d["listed"] = pd.to_datetime(d["listingDate"], format="%d-%b-%Y", errors="coerce")
    d["company"] = d.get("companyName", d.get("company")).fillna(d.get("company"))
    return d[["symbol", "company", "issuePrice", "listed", "priceRange"]].dropna(subset=["listed"]).drop_duplicates("symbol")


def ipos(months: int = 36) -> dict:
    """Recently listed main-board stocks with returns over every period available since listing."""
    with _con() as c:
        latest = c.execute("SELECT MAX(date) FROM daily_bars").fetchone()[0]
    last_dt = pd.Timestamp(latest)
    m = ipo_master()
    cutoff = last_dt - pd.DateOffset(months=months)
    recent = m[(m.listed >= cutoff) & (m.listed <= last_dt)]
    df = load_bars((cutoff - pd.Timedelta(days=5)).date().isoformat())
    df = df[df.symbol.isin(set(recent.symbol))]
    rows = []
    for rec_l in recent.itertuples():
        g = df[(df.symbol == rec_l.symbol) & (df.date >= rec_l.listed)].sort_values("date")   # ignore pre-listing rows
        if g.empty or g["date"].iloc[-1] != last_dt:
            continue
        r = _rows(g, latest)[0]
        first = g.iloc[0]
        hi = g["high"].max()
        ip = float(rec_l.issuePrice) if pd.notna(rec_l.issuePrice) else None
        r.update({"name": r["name"] or rec_l.company, "listingDate": rec_l.listed.date().isoformat(),
                  "issuePrice": _r(ip), "vsIssue": _r((r["close"] / ip - 1) * 100) if ip else None,
                  "listingGain": _r((first.open / ip - 1) * 100) if ip else None,
                  "sessions": int(len(g)), "listOpen": _r(first.open), "listClose": _r(first.close),
                  "sinceListing": _r((r["close"] / first.open - 1) * 100) if first.open else None,
                  "highSinceListing": _r(hi), "fromHigh": _r((r["close"] / hi - 1) * 100) if hi else None,
                  "lowSinceListing": _r(g["low"].min())})
        rows.append(r)
    rows.sort(key=lambda x: x["listingDate"], reverse=True)
    return {"asOf": latest, "liveSession": _next_session(last_dt).date().isoformat(),
            "generatedAt": datetime.now(timezone.utc).isoformat(), "count": len(rows), "months": months, "rows": rows}
