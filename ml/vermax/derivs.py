"""Derivatives data from NSE archives: participant-wise OI (FII/DII/Client/Pro) and stock-level F&O open interest.

Stored in data/derivs.sqlite (owned by Python; the market DB stays single-writer = API).
Usage:  python -m vermax.derivs backfill [from] [to]      (incremental; skips stored dates)
"""
from __future__ import annotations
import io
import sqlite3
import sys
import time
import zipfile
from pathlib import Path
import pandas as pd
import requests
from . import config
from .data import _con

DB = config.ROOT / "data" / "derivs.sqlite"
CACHE = config.ROOT / "data" / "cache"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Referer": "https://www.nseindia.com/"}
MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
UDIFF_FO_START = "2024-07-08"
_session = requests.Session()


def _db():
    c = sqlite3.connect(DB)
    c.execute("""CREATE TABLE IF NOT EXISTS participant_oi (date TEXT, client TEXT, fut_idx_long REAL, fut_idx_short REAL,
                 fut_stk_long REAL, fut_stk_short REAL, opt_idx_call_long REAL, opt_idx_put_long REAL, opt_idx_call_short REAL,
                 opt_idx_put_short REAL, total_long REAL, total_short REAL, PRIMARY KEY (date, client))""")
    c.execute("""CREATE TABLE IF NOT EXISTS fo_stock (date TEXT, symbol TEXT, fut_oi REAL, fut_contracts REAL, call_oi REAL,
                 put_oi REAL, PRIMARY KEY (date, symbol))""")
    c.execute("CREATE TABLE IF NOT EXISTS fetched (date TEXT, kind TEXT, status TEXT, PRIMARY KEY (date, kind))")
    return c


def _get(url: str, cache: Path) -> bytes | None:
    if cache.exists():
        return cache.read_bytes()
    for attempt in range(3):
        try:
            time.sleep(0.35)
            r = _session.get(url, headers=UA, timeout=30)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            if r.content[:15].lower().startswith(b"<!doctype") or b"<html" in r.content[:64].lower():
                raise RuntimeError("html instead of data")
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_bytes(r.content)
            return r.content
        except Exception:  # noqa: BLE001
            time.sleep(1.5 * (attempt + 1))
    return None


def participant(date: str) -> pd.DataFrame | None:
    y, m, d = date.split("-")
    raw = _get(f"https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_{d}{m}{y}.csv", CACHE / "participant" / f"{y}{m}{d}.csv")
    if raw is None:
        return None
    df = pd.read_csv(io.BytesIO(raw), skiprows=1)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    df = df[df["client_type"].astype(str).str.strip().isin(["Client", "DII", "FII", "Pro"])]
    out = pd.DataFrame({
        "date": date, "client": df["client_type"].str.strip(),
        "fut_idx_long": df["future_index_long"], "fut_idx_short": df["future_index_short"],
        "fut_stk_long": df["future_stock_long"], "fut_stk_short": df["future_stock_short"],
        "opt_idx_call_long": df["option_index_call_long"], "opt_idx_put_long": df["option_index_put_long"],
        "opt_idx_call_short": df["option_index_call_short"], "opt_idx_put_short": df["option_index_put_short"],
        "total_long": df["total_long_contracts"], "total_short": df["total_short_contracts"]})
    return out


def fo_stock(date: str) -> pd.DataFrame | None:
    y, m, d = date.split("-")
    if date >= UDIFF_FO_START:
        raw = _get(f"https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{y}{m}{d}_F_0000.csv.zip", CACHE / "fo" / f"{y}{m}{d}.zip")
        if raw is None:
            return None
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            df = pd.read_csv(z.open(z.namelist()[0]), usecols=["FinInstrmTp", "TckrSymb", "OptnTp", "OpnIntrst", "TtlTradgVol"])
        df = df.rename(columns={"FinInstrmTp": "inst", "TckrSymb": "symbol", "OptnTp": "opt", "OpnIntrst": "oi", "TtlTradgVol": "vol"})
        fut, opt = df.inst.eq("STF"), df.inst.eq("STO")
    else:
        raw = _get(f"https://nsearchives.nseindia.com/content/historical/DERIVATIVES/{y}/{MON[int(m) - 1]}/fo{d}{MON[int(m) - 1]}{y}bhav.csv.zip",
                   CACHE / "fo" / f"{y}{m}{d}.zip")
        if raw is None:
            return None
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            df = pd.read_csv(z.open(z.namelist()[0]))
        df.columns = [c.strip().upper() for c in df.columns]
        df = df.rename(columns={"INSTRUMENT": "inst", "SYMBOL": "symbol", "OPTION_TYP": "opt", "OPEN_INT": "oi", "CONTRACTS": "vol"})
        df["inst"] = df["inst"].astype(str).str.strip()
        fut, opt = df.inst.eq("FUTSTK"), df.inst.eq("OPTSTK")
    df["symbol"] = df["symbol"].astype(str).str.strip()
    df["opt"] = df["opt"].astype(str).str.strip()
    f = df[fut].groupby("symbol").agg(fut_oi=("oi", "sum"), fut_contracts=("vol", "sum"))
    o = df[opt]
    c_ = o[o.opt == "CE"].groupby("symbol")["oi"].sum().rename("call_oi")
    p_ = o[o.opt == "PE"].groupby("symbol")["oi"].sum().rename("put_oi")
    out = f.join([c_, p_], how="outer").reset_index()
    out.insert(0, "date", date)
    return out


def backfill(start: str = "2019-01-01", end: str | None = None) -> dict:
    with _con() as mc:
        q = "SELECT DISTINCT date FROM index_bars WHERE \"indexName\"='Nifty 50' AND date>=?" + (" AND date<=?" if end else "") + " ORDER BY date"
        dates = [r[0] for r in mc.execute(q, [start] + ([end] if end else []))]
    c = _db()
    done = {(r[0], r[1]) for r in c.execute("SELECT date, kind FROM fetched WHERE status='OK'")}
    stats = {"participant": 0, "fo": 0, "missing": 0}
    t0 = time.time()
    for i, d in enumerate(dates):
        if (d, "participant") not in done:
            p = participant(d)
            if p is not None and len(p):
                c.execute("DELETE FROM participant_oi WHERE date=?", (d,))
                p.to_sql("participant_oi", c, if_exists="append", index=False)
                c.execute("INSERT OR REPLACE INTO fetched VALUES (?,?,?)", (d, "participant", "OK")); stats["participant"] += 1
            else:
                stats["missing"] += 1
        if (d, "fo") not in done:
            f = fo_stock(d)
            if f is not None and len(f):
                c.execute("DELETE FROM fo_stock WHERE date=?", (d,))
                f.to_sql("fo_stock", c, if_exists="append", index=False)
                c.execute("INSERT OR REPLACE INTO fetched VALUES (?,?,?)", (d, "fo", "OK")); stats["fo"] += 1
            else:
                stats["missing"] += 1
        c.commit()
        if i % 50 == 0:
            print(f"{d} {i + 1}/{len(dates)} {stats} {time.time() - t0:.0f}s", flush=True)
    c.close()
    return stats


def load_features() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Returns (market-level FII/Client positioning by date, stock-level F&O OI by date+symbol)."""
    if not DB.exists():
        return pd.DataFrame(), pd.DataFrame()
    c = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    p = pd.read_sql_query("SELECT * FROM participant_oi", c)
    f = pd.read_sql_query("SELECT * FROM fo_stock", c)
    c.close()
    mk = pd.DataFrame()
    if len(p):
        p["date"] = pd.to_datetime(p["date"])
        piv = p.pivot_table(index="date", columns="client", values=["fut_idx_long", "fut_idx_short", "opt_idx_put_long", "opt_idx_call_long", "fut_stk_long", "fut_stk_short"])
        mk = pd.DataFrame(index=piv.index)
        mk["fii_idx_long_ratio"] = piv[("fut_idx_long", "FII")] / (piv[("fut_idx_long", "FII")] + piv[("fut_idx_short", "FII")])
        mk["fii_idx_long_chg5"] = mk["fii_idx_long_ratio"].diff(5)
        mk["fii_stk_long_ratio"] = piv[("fut_stk_long", "FII")] / (piv[("fut_stk_long", "FII")] + piv[("fut_stk_short", "FII")])
        mk["client_idx_long_ratio"] = piv[("fut_idx_long", "Client")] / (piv[("fut_idx_long", "Client")] + piv[("fut_idx_short", "Client")])
        mk["fii_put_call_long"] = piv[("opt_idx_put_long", "FII")] / piv[("opt_idx_call_long", "FII")].replace(0, pd.NA)
    if len(f):
        f["date"] = pd.to_datetime(f["date"])
        f = f.sort_values(["symbol", "date"])
        g = f.groupby("symbol", sort=False)
        f["fut_oi_chg1"] = f["fut_oi"] / g["fut_oi"].shift(1) - 1
        f["fut_oi_chg5"] = f["fut_oi"] / g["fut_oi"].shift(5) - 1
        f["pcr_oi"] = f["put_oi"] / f["call_oi"].replace(0, pd.NA)
        f["pcr_chg5"] = f["pcr_oi"] - g["pcr_oi"].shift(5)
        f["is_fno"] = 1
        f = f[["date", "symbol", "fut_oi_chg1", "fut_oi_chg5", "pcr_oi", "pcr_chg5", "is_fno"]]
    return mk.astype(float) if len(mk) else mk, f


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "backfill":
        print(backfill(*(sys.argv[2:4])))
