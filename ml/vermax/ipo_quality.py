"""Curated recent-IPO list: listing within N months, fundamentals quality, and week-end / month-end consistency.

Week / month logic (official NSE closes, split-adjusted):
  * every completed calendar week: last close of the week vs the previous week's last close
    (the first, partial listing week compares with the listing-day open);
  * every completed calendar month: month-end close vs the previous month-end close (first month vs listing open);
  * the current, unfinished week/month is reported separately as "to date" and does not count.
"""
from __future__ import annotations
from datetime import datetime, timezone
import pandas as pd
from .data import _con, load_bars
from .fundamentals import fetch_many
from .screener import _r, _rows, ipo_master


def _periods(g: pd.DataFrame, freq: str, last_dt: pd.Timestamp) -> dict:
    s = g.set_index("date")["close"]
    ends = s.groupby(s.index.to_period(freq)).last()
    cur = last_dt.to_period(freq)
    base = float(g["open"].iloc[0])
    prev, rets = base, []
    for per, close in ends.items():
        rets.append((str(per), close / prev - 1, per != cur))
        prev = close
    done = [r for _, r, complete in rets if complete]
    to_date = next((r for p, r, complete in rets if not complete), None)
    return {"total": len(done), "up": sum(1 for r in done if r > 0), "list": [{"period": p, "ret": _r(r * 100), "complete": c} for p, r, c in rets],
            "toDate": _r(to_date * 100) if to_date is not None else None,
            "worst": _r(min(done) * 100) if done else None}


def ipo_quality(months: int = 6) -> dict:
    with _con() as c:
        latest = c.execute("SELECT MAX(date) FROM daily_bars").fetchone()[0]
    last_dt = pd.Timestamp(latest)
    m = ipo_master()
    recent = m[(m.listed >= last_dt - pd.DateOffset(months=months)) & (m.listed <= last_dt)]
    df = load_bars((last_dt - pd.DateOffset(months=months) - pd.Timedelta(days=5)).date().isoformat())
    df = df[df.symbol.isin(set(recent.symbol))]
    rows = []
    for rec in recent.itertuples():
        g = df[(df.symbol == rec.symbol) & (df.date >= rec.listed)].sort_values("date")
        if g.empty or g["date"].iloc[-1] != last_dt:
            continue
        base = _rows(g, latest)[0]
        first = g.iloc[0]
        wk, mo = _periods(g, "W-FRI", last_dt), _periods(g, "M", last_dt)
        ip = float(rec.issuePrice) if pd.notna(rec.issuePrice) else None
        base.update({"name": base["name"] or rec.company, "listingDate": rec.listed.date().isoformat(), "sessions": int(len(g)),
                     "issuePrice": _r(ip), "vsIssue": _r((base["close"] / ip - 1) * 100) if ip else None,
                     "listingGain": _r((first.open / ip - 1) * 100) if ip else None,
                     "listOpen": _r(first.open), "sinceListing": _r((base["close"] / first.open - 1) * 100) if first.open else None,
                     "highSinceListing": _r(g["high"].max()), "fromHigh": _r((base["close"] / g["high"].max() - 1) * 100),
                     "weeks": wk, "months": mo,
                     "deliveryAvg": _r(g["delivery_pct"].tail(20).mean(), 1) if g["delivery_pct"].notna().any() else None,
                     "listingDayDelivery": _r(first.delivery_pct, 1) if pd.notna(first.delivery_pct) else None})
        rows.append(base)
    # Fundamentals (Yahoo, cached 5 days). New listings often have short statement history -> UNKNOWN is common.
    fund = {f["symbol"]: f for f in fetch_many([r["symbol"] for r in rows])}
    for r in rows:
        f = fund.get(r["symbol"]) or {}
        r["fundamentals"] = {k: f.get(k) for k in ("ok", "verdict", "qualityScore", "flags", "positives", "roe", "roe3yAvg", "roce", "debtToEquity",
                                                  "salesCagr", "profitCagr", "revenueGrowth", "earningsGrowth", "profitMargin", "pe", "marketCapCr",
                                                  "netIncomePositive", "nextEarnings")}
    rows.sort(key=lambda x: x["listingDate"], reverse=True)
    return {"asOf": latest, "generatedAt": datetime.now(timezone.utc).isoformat(), "months": months, "count": len(rows), "rows": rows}
