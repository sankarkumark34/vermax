"""Company data for the 18-step selection engine (apps/api/src/selection).

Everything here is raw data; all scoring happens in the TypeScript engine so verdicts stay deterministic and testable.

  statements   annual + quarterly line items (INR crore, newest first) from Yahoo Finance (4-5 years on the free feed)
  holding      promoter holding history (last 8 quarters) and promoter pledge % from NSE corporate filings
  announcements  NSE corporate announcements of the last 120 days (title, category, link)
  peHistory    point-in-time P/E percentile of the current P/E within the available price + EPS history
  surveillance ASM (long / short term) and GSM lists from NSE, cached per day

Each part has its own cache TTL under data/company/<SYMBOL>.json.
"""
from __future__ import annotations
import json
import math
import statistics
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import pandas as pd
import requests
from . import config
from .data import _con, load_stocks

CACHE = config.ROOT / "data" / "company"
CACHE.mkdir(parents=True, exist_ok=True)
SURV_DIR = config.ROOT / "data" / "cache" / "surveillance"
SCHEMA = 1
TTL = {"statements": 5 * 24, "holding": 5 * 24, "announcements": 6}   # hours
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9"}
CR = 1e7

_session: requests.Session | None = None


def _nse() -> requests.Session:
    """NSE's JSON API needs the cookies set by a visit to the home page."""
    global _session
    if _session is None:
        s = requests.Session()
        s.headers.update(UA)
        try:
            s.get("https://www.nseindia.com/", timeout=20)
        except requests.RequestException:
            pass
        _session = s
    return _session


def _nse_json(path: str):
    for attempt in range(3):
        try:
            r = _nse().get(f"https://www.nseindia.com/api/{path}", timeout=25)
            if r.ok and r.content[:1] in (b"{", b"["):
                return r.json()
        except (requests.RequestException, ValueError):
            pass
        global _session
        _session = None          # cookies expired: start a fresh session
        time.sleep(1.5 * (attempt + 1))
    return None


def _f(x):
    try:
        v = float(str(x).strip().replace(",", ""))
        return None if (math.isnan(v) or math.isinf(v)) else v
    except (TypeError, ValueError):
        return None


def _fresh(part: dict | None, hours: float) -> bool:
    if not part or "fetchedAt" not in part:
        return False
    return datetime.fromisoformat(part["fetchedAt"]) > datetime.now(timezone.utc) - timedelta(hours=hours)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---- statements ------------------------------------------------------------------------------
ANNUAL = {
    "revenue": ("Total Revenue", "Operating Revenue"),
    "grossProfit": ("Gross Profit",),
    "ebitda": ("EBITDA", "Normalized EBITDA"),
    "ebit": ("EBIT", "Operating Income"),
    "operatingIncome": ("Operating Income",),
    "interestIncome": ("Interest Income Non Operating", "Interest Income"),
    "otherNonOperating": ("Other Non Operating Income Expenses",),
    "interestExpense": ("Interest Expense", "Interest Expense Non Operating"),
    "pbt": ("Pretax Income",),
    "pat": ("Net Income", "Net Income Common Stockholders"),
    "eps": ("Diluted EPS", "Basic EPS"),
    "netInterestIncome": ("Net Interest Income",),
}
BALANCE = {
    "totalAssets": ("Total Assets",),
    "equity": ("Stockholders Equity", "Common Stock Equity", "Total Equity Gross Minority Interest"),
    "totalDebt": ("Total Debt",),
    "currentDebt": ("Current Debt", "Current Debt And Capital Lease Obligation"),
    "cash": ("Cash Cash Equivalents And Short Term Investments", "Cash And Cash Equivalents"),
    "receivables": ("Accounts Receivable", "Receivables"),
    "inventory": ("Inventory",),
    "payables": ("Accounts Payable", "Payables"),
    "currentAssets": ("Current Assets",),
    "currentLiabilities": ("Current Liabilities",),
    "shares": ("Ordinary Shares Number", "Share Issued"),
}
CASH = {
    "cfo": ("Operating Cash Flow", "Cash Flow From Continuing Operating Activities"),
    "capex": ("Capital Expenditure",),
    "fcf": ("Free Cash Flow",),
}
QUARTER = {"revenue": ("Total Revenue", "Operating Revenue"), "pat": ("Net Income", "Net Income Common Stockholders"),
           "operatingIncome": ("Operating Income", "EBIT")}
PER_SHARE = {"eps", "shares"}


def _series(df, names: tuple[str, ...], scale: float) -> dict[str, float | None]:
    if df is None or getattr(df, "empty", True):
        return {}
    for n in names:
        if n in df.index:
            row = df.loc[n]
            out = {}
            for col, v in row.items():
                fv = _f(v)
                out[str(col)[:10]] = None if fv is None else round(fv / scale, 4)
            return out
    return {}


def _table(frames: list[tuple[object, dict]]) -> dict:
    """{periods: [newest..oldest], <field>: [values aligned to periods]}"""
    cols: set[str] = set()
    raw: dict[str, dict] = {}
    for df, spec in frames:
        for key, names in spec.items():
            s = _series(df, names, 1 if key in PER_SHARE else CR)
            raw[key] = s
            cols.update(s.keys())
    periods = sorted(cols, reverse=True)
    out: dict = {"periods": periods}
    for key, s in raw.items():
        out[key] = [s.get(p) for p in periods]
    return out


def _statements(symbol: str) -> dict:
    import yfinance as yf
    t = yf.Ticker(f"{symbol}.NS")
    info = {}
    try:
        info = t.info or {}
    except Exception:  # noqa: BLE001
        pass
    annual = _table([(t.financials, ANNUAL), (t.balance_sheet, BALANCE), (t.cashflow, CASH)])
    # drop periods that only carry balance-sheet data (yfinance often returns one extra, older balance-sheet year)
    keep = [i for i, _ in enumerate(annual["periods"]) if annual.get("revenue", [None] * 99)[i] is not None or annual.get("pat", [None] * 99)[i] is not None]
    if keep:
        annual = {k: [v[i] for i in keep] for k, v in annual.items()}
    quarterly = _table([(t.quarterly_financials, QUARTER)])
    pick = lambda k: _f(info.get(k))  # noqa: E731
    return {
        "fetchedAt": _now(), "ok": bool(annual["periods"]),
        "name": info.get("longName") or info.get("shortName"),
        "yahooSector": info.get("sector"), "yahooIndustry": info.get("industry"),
        "summary": (info.get("longBusinessSummary") or "")[:2500] or None,
        "marketCapCr": round(pick("marketCap") / CR) if pick("marketCap") else None,
        "enterpriseValueCr": round(pick("enterpriseValue") / CR) if pick("enterpriseValue") else None,
        "pe": pick("trailingPE"), "pb": pick("priceToBook"), "evToEbitda": pick("enterpriseToEbitda"),
        "currentRatio": pick("currentRatio"), "quickRatio": pick("quickRatio"), "beta": pick("beta"),
        "dividendYield": pick("dividendYield"), "trailingEps": pick("trailingEps"),
        "annual": annual, "quarterly": quarterly,
    }


# ---- shareholding and pledge -------------------------------------------------------------------
def _holding(symbol: str) -> dict:
    hist = []
    rows = _nse_json(f"corporate-share-holdings-master?index=equities&symbol={symbol}") or []
    for r in rows[:12]:
        d = pd.to_datetime(r.get("date"), format="%d-%b-%Y", errors="coerce")
        if pd.isna(d):
            continue
        hist.append({"quarter": d.date().isoformat(), "promoter": _f(r.get("pr_and_prgrp")), "public": _f(r.get("public_val"))})
    hist = sorted({h["quarter"]: h for h in hist}.values(), key=lambda h: h["quarter"], reverse=True)[:8]
    pledge = None
    pl = _nse_json(f"corporate-pledgedata?index=equities&symbol={symbol}") or {}
    data = pl.get("data") if isinstance(pl, dict) else None
    if data:
        latest = data[0]
        pledge = {"asOf": latest.get("shp"), "pledgedPctOfPromoter": _f(latest.get("percPromoterShares")),
                  "pledgedPctOfTotal": _f(latest.get("percTotShares")), "promoterPct": _f(latest.get("percPromoterHolding"))}
    return {"fetchedAt": _now(), "ok": bool(hist) or pledge is not None, "promoterHistory": hist, "pledge": pledge}


# ---- announcements -----------------------------------------------------------------------------
def _announcements(symbol: str) -> dict:
    rows = _nse_json(f"corporate-announcements?index=equities&symbol={symbol}") or []
    cut = datetime.now() - timedelta(days=120)
    items = []
    for r in rows:
        d = pd.to_datetime(r.get("an_dt"), format="%d-%b-%Y %H:%M:%S", errors="coerce")
        if pd.isna(d) or d.to_pydatetime() < cut:
            continue
        items.append({"date": d.isoformat(), "category": (r.get("desc") or "").strip(), "text": (r.get("attchmntText") or "").strip()[:600],
                      "link": r.get("attchmntFile") or None, "id": str(r.get("seq_id") or "")})
        if len(items) >= 80:
            break
    return {"fetchedAt": _now(), "ok": rows is not None, "items": items}


# ---- P/E history -------------------------------------------------------------------------------
def _pe_history(symbol: str, annual: dict) -> dict | None:
    """Monthly P/E = split-adjusted month-end close x latest share count / the annual profit that was public by then
    (FY end + 60 days). Using today's share count with adjusted prices keeps the ratio correct across splits and bonuses.
    Returns the percentile of the current P/E within that history (free data gives ~4-5 years, not the 10 in the proposal)."""
    periods, pat, shares = annual.get("periods") or [], annual.get("pat") or [], annual.get("shares") or []
    n_sh = next((s for s in shares if s), None)
    if not n_sh:
        return None
    known = sorted(((date.fromisoformat(p) + timedelta(days=60), e * CR / n_sh) for p, e in zip(periods, pat) if e), key=lambda x: x[0])
    if not known:
        return None
    with _con() as c:
        df = pd.read_sql_query("SELECT symbol, date, open, high, low, close, prevClose AS prev_close, volume FROM daily_bars WHERE symbol=? ORDER BY date",
                               c, params=[symbol])
    if df.empty:
        return None
    from .data import _adjust_corporate_actions
    df["date"] = pd.to_datetime(df["date"])
    df = _adjust_corporate_actions(df)
    month_end = df.set_index("date")["close"].resample("ME").last().dropna()
    pes = []
    for d, close in month_end.items():
        e = next((e for avail, e in reversed(known) if avail <= d.date()), None)
        if e and e > 0:
            pes.append(close / e)
    if len(pes) < 12:
        return None
    cur = pes[-1]
    pct = sum(p <= cur for p in pes) / len(pes) * 100
    return {"months": len(pes), "current": round(cur, 2), "median": round(statistics.median(pes), 2), "percentile": round(pct, 1)}


# ---- surveillance --------------------------------------------------------------------------------
def surveillance() -> dict:
    """{asOf, symbols: {SYMBOL: [list names]}} from NSE ASM (long/short term) and GSM; cached for the day."""
    SURV_DIR.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()
    p = SURV_DIR / f"{today}.json"
    if p.exists():
        return json.loads(p.read_text())
    out: dict[str, list[str]] = {}
    ok = False
    asm = _nse_json("reportASM")
    if isinstance(asm, dict):
        ok = True
        for term in ("longterm", "shortterm"):
            for r in (asm.get(term) or {}).get("data") or []:
                sym = (r.get("symbol") or "").strip()
                if sym:
                    out.setdefault(sym, []).append(f"{'LT' if term == 'longterm' else 'ST'}-ASM {r.get('asmSurvIndicator') or ''}".strip())
    gsm = _nse_json("reportGSM")
    if isinstance(gsm, list):
        ok = True
        for r in gsm:
            sym = (r.get("symbol") or "").strip()
            if sym:
                out.setdefault(sym, []).append(f"GSM {r.get('gsmStage') or ''}".strip())
    res = {"asOf": today, "ok": ok, "count": len(out), "symbols": out}
    if ok:
        p.write_text(json.dumps(res))
    else:   # fall back to the newest cached list, flagged as stale
        files = sorted(SURV_DIR.glob("*.json"))
        if files:
            res = {**json.loads(files[-1].read_text()), "stale": True}
    return res


# ---- sector medians ----------------------------------------------------------------------------
def sector_medians() -> dict:
    """Median EV/EBITDA and P/E per sector across every cached company (valuation step 14 compares against these).
    Keyed by the NSE sector, or by the Yahoo sector for stocks NSE leaves unclassified (same rule as the API)."""
    sectors = load_stocks().set_index("symbol")["sector"].to_dict()
    groups: dict[str, dict[str, list[float]]] = {}
    for f in CACHE.glob("*.json"):
        try:
            st = json.loads(f.read_text()).get("statements") or {}
        except (ValueError, OSError):
            continue
        sec = sectors.get(f.stem)
        if not sec or sec == "Unclassified":     # stocks outside the Nifty 500 list: group by Yahoo sector instead
            sec = st.get("yahooSector")
        if not sec:
            continue
        g = groups.setdefault(sec, {"evToEbitda": [], "pe": []})
        for k in ("evToEbitda", "pe"):
            v = st.get(k)
            if v and 0 < v < 400:
                g[k].append(v)
    return {s: {k: (round(statistics.median(v), 2) if len(v) >= 3 else None) for k, v in g.items()} | {"n": len(g["pe"])} for s, g in groups.items()}


# ---- entry points --------------------------------------------------------------------------------
def company(symbol: str, force: bool = False, parts: tuple[str, ...] = ("statements", "holding", "announcements")) -> dict:
    symbol = symbol.strip().upper()
    p = CACHE / f"{symbol}.json"
    d = json.loads(p.read_text()) if p.exists() else {}
    if d.get("schema") != SCHEMA:
        d = {}
    changed = False
    fetchers = {"statements": lambda: _statements(symbol), "holding": lambda: _holding(symbol), "announcements": lambda: _announcements(symbol)}
    for part in parts:
        if force or not _fresh(d.get(part), TTL[part]):
            try:
                d[part] = fetchers[part]()
            except Exception as e:  # noqa: BLE001
                d[part] = {**(d.get(part) or {}), "error": f"{type(e).__name__}: {e}"[:200]}
            changed = True
    if changed or d.get("peHistory") is None:
        try:
            d["peHistory"] = _pe_history(symbol, (d.get("statements") or {}).get("annual") or {})
        except Exception:  # noqa: BLE001
            d["peHistory"] = None
        changed = True
    d.update({"symbol": symbol, "schema": SCHEMA})
    if changed:
        p.write_text(json.dumps(d, default=str))
    return d


def company_batch(symbols: list[str], force: bool = False) -> dict:
    out = {}
    for s in symbols:
        out[s] = company(s, force=force)
        time.sleep(0.25)
    return {"companies": out, "sectorMedians": sector_medians(), "surveillance": surveillance()}
