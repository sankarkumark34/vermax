"""Single-stock analysis inputs: price/trend metrics, fundamentals, industry P/E benchmark, IPO details and subscription.

The checklist and Buy score are computed in the API (apps/api/src/analysis/score.ts) from this JSON.
"""
from __future__ import annotations
import json
import sqlite3
import time
from datetime import datetime, timezone
import numpy as np
import pandas as pd
import requests
from . import config
from .data import _adjust_corporate_actions, _con, load_stocks
from .fundamentals import fetch
from .screener import UA, _r

# NSE sector index whose P/E serves as the industry benchmark.
SECTOR_INDEX = {
    "Capital Goods": "Nifty Capital Goods", "Engineering": "Nifty Capital Goods", "Defence": "Nifty India Defence",
    "Construction": "Nifty Construction", "Information Technology": "Nifty IT", "Healthcare": "Nifty Healthcare Index",
    "Automobile and Auto Components": "Nifty Auto", "Fast Moving Consumer Goods": "Nifty FMCG",
    "Financial Services": "Nifty Financial Services", "Metals & Mining": "Nifty Metal", "Oil Gas & Consumable Fuels": "Nifty Oil & Gas",
    "Power": "Nifty Power", "Realty": "Nifty Realty", "Consumer Durables": "Nifty Consumer Durables", "Chemicals": "Nifty Chemicals",
    "Telecommunication": "Nifty Telecommunications", "Media Entertainment & Publication": "Nifty Media",
    "Consumer Services": "Nifty Consumer Services", "Construction Materials": "Nifty Cement", "Services": "Nifty Services Sector",
}
YAHOO_INDEX = {
    "Industrials": "Nifty Capital Goods", "Technology": "Nifty IT", "Healthcare": "Nifty Healthcare Index",
    "Consumer Cyclical": "Nifty India Consumption", "Consumer Defensive": "Nifty FMCG", "Financial Services": "Nifty Financial Services",
    "Basic Materials": "Nifty Commodities", "Energy": "Nifty Energy", "Utilities": "Nifty Power", "Real Estate": "Nifty Realty",
    "Communication Services": "Nifty Media",
}


def _bars(symbol: str) -> pd.DataFrame:
    with _con() as c:
        df = pd.read_sql_query("SELECT symbol,date,open,high,low,close,prevClose AS prev_close,volume,turnover,deliveryPct AS delivery_pct "
                               "FROM daily_bars WHERE symbol=? ORDER BY date", c, params=[symbol])
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["date"])
    return _adjust_corporate_actions(df).reset_index(drop=True)


def _index(name: str) -> pd.DataFrame:
    with _con() as c:
        d = pd.read_sql_query('SELECT date, close, pe FROM index_bars WHERE "indexName"=? ORDER BY date', c, params=[name])
    d["date"] = pd.to_datetime(d["date"])
    return d


def _cal_ret(df: pd.DataFrame, months: int) -> float | None:
    last = df["date"].iloc[-1]
    cut = last - pd.DateOffset(months=months)
    if df["date"].iloc[0] > cut:
        return None
    after = df[df["date"] >= cut]
    return float(df["close"].iloc[-1] / after["close"].iloc[0] - 1) if len(after) else None


def _price_metrics(df: pd.DataFrame) -> dict:
    c = df["close"]
    last = df.iloc[-1]
    d = c.diff()
    au = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    ad = (-d).clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    rsi = float(100 - 100 / (1 + au.iloc[-1] / ad.iloc[-1])) if ad.iloc[-1] else 100.0
    pc = c.shift(1)
    tr = pd.concat([df.high - df.low, (df.high - pc).abs(), (df.low - pc).abs()], axis=1).max(axis=1)
    atr = float(tr.ewm(alpha=1 / 14, adjust=False).mean().iloc[-1])
    tail = df.tail(252)
    nifty = _index("Nifty 50")
    n6 = None
    if len(nifty):
        nn = nifty.set_index("date")["close"]
        cut = last.date - pd.DateOffset(months=6)
        after = nn[nn.index >= cut]
        n6 = float(nn.iloc[-1] / after.iloc[0] - 1) if len(after) else None
    r6 = _cal_ret(df, 6)
    return {
        "asOf": last.date.date().isoformat(), "sessions": int(len(df)), "close": _r(last.close), "prevClose": _r(last.prev_close),
        "chg1": _r((last.close / last.prev_close - 1) * 100) if last.prev_close else None,
        "ret1m": _r((_cal_ret(df, 1) or np.nan) * 100), "ret3m": _r((_cal_ret(df, 3) or np.nan) * 100),
        "ret6m": _r((r6 if r6 is not None else np.nan) * 100), "ret1y": _r((_cal_ret(df, 12) or np.nan) * 100),
        "dma50": _r(c.tail(50).mean()) if len(c) >= 50 else None, "dma200": _r(c.tail(200).mean()) if len(c) >= 200 else None,
        "high52": _r(tail.high.max()), "low52": _r(tail.low.min()), "fromHigh52": _r((last.close / tail.high.max() - 1) * 100),
        "rsi14": _r(rsi, 1), "atrPct": _r(atr / last.close * 100), "rs6m": _r((r6 - n6) * 100) if r6 is not None and n6 is not None else None,
        "turnoverCr": _r(df.turnover.tail(20).mean() / 1e7, 1), "deliveryAvg": _r(df.delivery_pct.tail(20).mean(), 1) if df.delivery_pct.notna().any() else None,
    }


def _ipo_record(symbol: str) -> dict | None:
    p = config.ROOT / "data" / "cache" / "universe" / "ipo_past_issues.json"
    if not p.exists() or time.time() - p.stat().st_mtime > 86_400:
        try:
            r = requests.get("https://www.nseindia.com/api/public-past-issues?index=equities", headers={**UA, "Accept": "application/json"}, timeout=30)
            if r.ok and r.content[:1] == b"[":
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(r.content)
        except Exception:  # noqa: BLE001
            pass
    if not p.exists():
        return None
    rec = next((x for x in json.loads(p.read_text()) if (x.get("symbol") or "").strip() == symbol and x.get("securityType") in ("EQ", "BE")), None)
    if not rec:
        return None
    ip = pd.to_numeric(str(rec.get("issuePrice", "")).strip().replace(",", ""), errors="coerce")
    return {"company": rec.get("companyName") or rec.get("company"), "issuePrice": None if pd.isna(ip) else float(ip),
            "priceRange": rec.get("priceRange"), "ipoStart": rec.get("ipoStartDate"), "ipoEnd": rec.get("ipoEndDate"),
            "listingDate": None if rec.get("listingDate") in (None, "-") else rec.get("listingDate")}


def _subscription(symbol: str, listed: bool) -> dict | None:
    """Final IPO subscription (times) by investor category from NSE's IPO detail feed; cached."""
    p = config.ROOT / "data" / "cache" / "ipo_detail" / f"{symbol}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists() or (not listed and time.time() - p.stat().st_mtime > 6 * 3600):
        try:
            r = requests.get(f"https://www.nseindia.com/api/ipo-detail?symbol={symbol}&series=EQ", headers={**UA, "Accept": "application/json"}, timeout=30)
            if r.ok and r.content[:1] == b"{":
                p.write_bytes(r.content)
        except Exception:  # noqa: BLE001
            pass
    if not p.exists():
        return None
    d = json.loads(p.read_text())
    rows = (d.get("activeCat") or {}).get("dataList") or []
    key = "noOfTotalMeant"
    if len(rows) <= 1:
        rows, key = d.get("bidDetails") or [], "noOfTime"

    def pick(prefix: str):
        for r in rows:
            if str(r.get("category", "")).startswith(prefix):
                v = pd.to_numeric(r.get(key), errors="coerce")
                return None if pd.isna(v) else round(float(v), 2)
        return None
    out = {"qib": pick("Qualified Institutional"), "nii": pick("Non Institutional Investors"), "retail": pick("Retail Individual"), "total": pick("Total")}
    if out["total"] is None and any(v is not None for v in out.values()):
        out["total"] = None
    return out if any(v is not None for v in out.values()) else None


def _periods(df: pd.DataFrame, freq: str, base: float) -> dict:
    s = df.set_index("date")["close"]
    ends = s.groupby(s.index.to_period(freq)).last()
    cur = df["date"].iloc[-1].to_period(freq)
    prev, up, total = base, 0, 0
    for per, close in ends.items():
        if per != cur:
            total += 1
            up += int(close > prev)
        prev = close
    return {"up": up, "total": total}


def analyse(symbol: str) -> dict:
    symbol = symbol.strip().upper()
    stocks = load_stocks().set_index("symbol")
    df = _bars(symbol)
    ipo = _ipo_record(symbol)
    name = stocks["name"].get(symbol) if symbol in stocks.index else None
    sector = stocks["theme_sector"].get(symbol) if symbol in stocks.index else None
    status = "listed" if not df.empty else ("upcoming" if ipo else "unknown")
    out: dict = {"symbol": symbol, "name": name if isinstance(name, str) else (ipo or {}).get("company"), "sector": sector,
                 "status": status, "generatedAt": datetime.now(timezone.utc).isoformat()}
    if status == "unknown":
        return out
    if not df.empty:
        out["price"] = _price_metrics(df)
    f = fetch(symbol, sector, full=True) if status == "listed" else {"ok": False}
    out["fundamentals"] = {k: v for k, v in f.items() if k not in ("fetchedAt",)}
    # industry P/E benchmark from the NSE sector index
    idx = SECTOR_INDEX.get(sector or "") or YAHOO_INDEX.get(f.get("yahooSector") or "") or "Nifty 500"
    try:
        pe_series = _index(idx).dropna(subset=["pe"])
        if pe_series.empty:
            idx, pe_series = "Nifty 500", _index("Nifty 500").dropna(subset=["pe"])
        out["industry"] = {"index": idx, "pe": _r(pe_series["pe"].iloc[-1]), "yahooIndustry": f.get("industry")}
    except Exception:  # noqa: BLE001
        out["industry"] = None
    if ipo:
        listed = status == "listed"
        info = {**ipo, "subscription": _subscription(symbol, listed)}
        listed_on = pd.to_datetime(ipo.get("listingDate"), format="%d-%b-%Y", errors="coerce") if ipo.get("listingDate") else None
        recent = listed_on is not None and pd.notna(listed_on) and listed_on >= df["date"].iloc[-1] - pd.DateOffset(months=24)             and abs((df["date"].iloc[0] - listed_on).days) <= 10 if listed else False
        info["recent"] = bool(recent) or not listed
        if listed and recent and ipo.get("issuePrice"):
            first = df.iloc[0]
            info.update({"listingGain": _r((first.open / ipo["issuePrice"] - 1) * 100), "vsIssue": _r((df.close.iloc[-1] / ipo["issuePrice"] - 1) * 100),
                         "listOpen": _r(first.open)})
            if len(df) <= 260:
                info["weeks"], info["months"] = _periods(df, "W-FRI", float(first.open)), _periods(df, "M", float(first.open))
        out["ipo"] = info
    return out
