"""Fundamental quality overlay (ROE / ROCE / debt / growth / cash-flow / promoter) via Yahoo Finance.

Free sources give no point-in-time history, so this is a SAFETY FILTER on live picks, not a backtested alpha factor.
"""
from __future__ import annotations
import json
import math
import time
from datetime import date, datetime, timedelta
from pathlib import Path
import numpy as np
from . import config

CACHE = config.OUT_DIR.parent / "fundamentals"
CACHE.mkdir(parents=True, exist_ok=True)
TTL_HOURS = 24 * 5
MIN_QUALITY = 30                 # below this quality score a stock is vetoed (user priority: strong fundamentals)
FIN_SECTORS = {"Financial Services"}


def _f(x):
    try:
        v = float(x)
        return None if (math.isnan(v) or math.isinf(v)) else v
    except (TypeError, ValueError):
        return None


def _row(df, *names):
    if df is None or getattr(df, "empty", True):
        return None
    for n in names:
        if n in df.index:
            return df.loc[n]
    return None


def _cagr(series):
    """series: newest-first annual values -> CAGR over available span (needs positive endpoints)."""
    vals = [v for v in (_f(x) for x in series) if v is not None]
    if len(vals) < 2 or vals[-1] <= 0 or vals[0] <= 0:
        return None
    return (vals[0] / vals[-1]) ** (1 / (len(vals) - 1)) - 1


SCHEMA = 2   # bump when fields are added; older cache entries are refetched when a caller needs the full set


def fetch(symbol: str, sector: str | None = None, force: bool = False, full: bool = False) -> dict:
    p = CACHE / f"{symbol}.json"
    if p.exists() and not force:
        d = json.loads(p.read_text())
        fresh = datetime.fromisoformat(d["fetchedAt"]) > datetime.utcnow() - timedelta(hours=TTL_HOURS)
        if fresh and (not full or d.get("schema") == SCHEMA):
            d.update(assess(d, sector))          # re-apply current rules to cached raw data
            return d
    out = {"symbol": symbol, "fetchedAt": datetime.utcnow().isoformat(), "ok": False, "schema": SCHEMA}
    try:
        import yfinance as yf
        t = yf.Ticker(f"{symbol}.NS")
        info = t.info or {}
        inc, bal, cf = t.financials, t.balance_sheet, t.cashflow
        ni = _row(inc, "Net Income", "Net Income Common Stockholders")
        rev = _row(inc, "Total Revenue", "Operating Revenue")
        ebit = _row(inc, "EBIT", "Operating Income")
        eq = _row(bal, "Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest")
        ta = _row(bal, "Total Assets")
        cl = _row(bal, "Current Liabilities", "Total Current Liabilities")
        debt = _row(bal, "Total Debt")
        ocf = _row(cf, "Operating Cash Flow", "Cash Flow From Continuing Operating Activities")
        roe_hist = []
        if ni is not None and eq is not None:
            for c in ni.index[:3]:
                if c in eq.index and _f(eq[c]) and _f(ni[c]) is not None:
                    roe_hist.append(_f(ni[c]) / _f(eq[c]))
        roce = None
        if ebit is not None and ta is not None and cl is not None:
            c0 = ebit.index[0]
            cap = (_f(ta.get(c0)) or 0) - (_f(cl.get(c0)) or 0)
            if cap > 0 and _f(ebit.get(c0)) is not None:
                roce = _f(ebit.get(c0)) / cap
        de = None
        if debt is not None and eq is not None and _f(eq.iloc[0]) and _f(debt.iloc[0]) is not None:
            de = _f(debt.iloc[0]) / _f(eq.iloc[0])
        if de is None and _f(info.get("debtToEquity")) is not None:
            de = _f(info["debtToEquity"]) / 100.0
        interest = _row(inc, "Interest Expense", "Interest Expense Non Operating")
        icov = None
        if ebit is not None and interest is not None and len(interest) and _f(interest.iloc[0]):
            iv = abs(_f(interest.iloc[0]))
            icov = (_f(ebit.iloc[0]) / iv) if iv and _f(ebit.iloc[0]) is not None else None
        earn = None
        try:
            cal = t.calendar or {}
            ed = cal.get("Earnings Date")
            if ed:
                ed = ed[0] if isinstance(ed, (list, tuple)) else ed
                earn = str(ed)[:10]
        except Exception:  # noqa: BLE001
            pass
        out.update({
            "ok": True, "name": info.get("longName") or info.get("shortName"),
            "yahooSector": info.get("sector"), "industry": info.get("industry"),
            "marketCapCr": round(info["marketCap"] / 1e7) if info.get("marketCap") else None,
            "roe": _f(info.get("returnOnEquity")) if _f(info.get("returnOnEquity")) is not None else (roe_hist[0] if roe_hist else None),
            "roe3yAvg": float(np.mean(roe_hist)) if roe_hist else None,
            "roce": roce, "debtToEquity": de,
            "salesCagr": _cagr(rev.values) if rev is not None else None,
            "profitCagr": _cagr(ni.values) if ni is not None else None,
            "revenueGrowth": _f(info.get("revenueGrowth")), "earningsGrowth": _f(info.get("earningsGrowth")),
            "profitMargin": _f(info.get("profitMargins")),
            "opCashFlowPositive": (_f(ocf.iloc[0]) or 0) > 0 if ocf is not None and len(ocf) else None,
            "cfoToPat": (_f(ocf.iloc[0]) / _f(ni.iloc[0])) if ocf is not None and ni is not None and len(ocf) and _f(ni.iloc[0]) else None,
            "insiderHolding": _f(info.get("heldPercentInsiders")), "instHolding": _f(info.get("heldPercentInstitutions")),
            "pe": _f(info.get("trailingPE")), "pb": _f(info.get("priceToBook")),
            "netIncomePositive": (_f(ni.iloc[0]) or 0) > 0 if ni is not None and len(ni) else None,
            "nextEarnings": earn,
            "operatingMargin": _f(info.get("operatingMargins")), "currentRatio": _f(info.get("currentRatio")),
            "interestCoverage": icov, "beta": _f(info.get("beta")), "dividendYield": _f(info.get("dividendYield")),
            "revenueCr": round(_f(rev.iloc[0]) / 1e7) if rev is not None and len(rev) and _f(rev.iloc[0]) else None,
            "statementYears": int(len(rev)) if rev is not None else 0,
        })
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"[:200]
    out.update(assess(out, sector))
    p.write_text(json.dumps(out))
    return out


def assess(d: dict, sector: str | None = None) -> dict:
    """Transparent rule-based quality score. Returns {qualityScore, verdict, flags, positives}."""
    if not d.get("ok"):
        return {"qualityScore": None, "verdict": "UNKNOWN", "flags": ["fundamentals unavailable"], "positives": []}
    fin = sector in FIN_SECTORS or (d.get("yahooSector") in ("Financial Services",))
    have = sum(d.get(k) is not None for k in ("roe", "roe3yAvg", "roce", "debtToEquity", "salesCagr", "profitCagr", "revenueGrowth", "earningsGrowth"))
    if have < 3:
        return {"qualityScore": None, "verdict": "UNKNOWN", "flags": ["too little fundamental data"], "positives": []}
    pts, flags, pos = 0, [], []

    def add(cond, p, good=None, bad=None, missing_ok=True):
        nonlocal pts
        if cond is None:
            return
        if cond:
            pts += p
            if good: pos.append(good)
        elif bad:
            flags.append(bad)

    roe = d.get("roe3yAvg") if d.get("roe3yAvg") is not None else d.get("roe")
    add(None if roe is None else roe >= 0.15, 25, f"ROE {roe * 100:.0f}%" if roe is not None else None, f"low ROE {roe * 100:.0f}%" if roe is not None else None)
    if d.get("roce") is not None and not fin:
        add(d["roce"] >= 0.15, 15, f"ROCE {d['roce'] * 100:.0f}%", f"low ROCE {d['roce'] * 100:.0f}%")
    elif fin:
        pts += 15
    if d.get("debtToEquity") is not None and not fin:
        add(d["debtToEquity"] <= 0.5, 15, f"D/E {d['debtToEquity']:.2f}", f"high debt D/E {d['debtToEquity']:.2f}")
    elif fin:
        pts += 15
    g = d.get("salesCagr") if d.get("salesCagr") is not None else d.get("revenueGrowth")
    add(None if g is None else g >= 0.10, 15, f"sales growth {g * 100:.0f}%" if g is not None else None, f"weak sales growth {g * 100:.0f}%" if g is not None else None)
    pg = d.get("profitCagr") if d.get("profitCagr") is not None else d.get("earningsGrowth")
    add(None if pg is None else pg >= 0.10, 15, f"profit growth {pg * 100:.0f}%" if pg is not None else None, f"weak profit growth {pg * 100:.0f}%" if pg is not None else None)
    if not fin:
        add(d.get("opCashFlowPositive"), 10, "positive operating cash-flow", "negative operating cash-flow")
    else:
        pts += 10
    ih = d.get("insiderHolding")
    add(None if ih is None else ih >= 0.35, 5, f"promoter/insider {ih * 100:.0f}%" if ih is not None else None, None)

    severe = []
    if d.get("netIncomePositive") is False:
        severe.append("loss-making")
    if d.get("debtToEquity") is not None and d["debtToEquity"] > 2.0 and not fin:
        severe.append("very high leverage")
    if roe is not None and roe < 0.05:
        severe.append("ROE < 5%")
    ne = d.get("nextEarnings")
    if ne:
        try:
            days = (date.fromisoformat(ne) - date.today()).days
            if 0 <= days <= 7:
                severe.append(f"results in {days}d (gap risk)")
            elif 0 <= days <= 14:
                flags.append(f"results in {days}d")
        except ValueError:
            pass
    if pts < MIN_QUALITY:
        severe.append(f"weak fundamentals ({pts}/100)")
    verdict = "AVOID" if severe else ("PASS" if pts >= 60 else "WATCH")
    return {"qualityScore": pts, "verdict": verdict, "flags": severe + flags, "positives": pos}


def fetch_many(symbols: list[str], sectors: dict[str, str] | None = None) -> list[dict]:
    res = []
    for s in symbols:
        res.append(fetch(s, (sectors or {}).get(s)))
        time.sleep(0.2)
    return res
