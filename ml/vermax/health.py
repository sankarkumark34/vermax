"""Model health and drift monitoring.

1. Live rank-IC: each published ranking (pick_runs.payload.ranking) vs the realised 10-session return
   (next open -> close of day 10). Only runs with 10 sessions of follow-through count.
2. Recent out-of-sample IC by month from the walk-forward predictions (xs_oos.parquet).
3. Feature drift: Population Stability Index of the most important features, last 20 sessions vs training history.
"""
from __future__ import annotations
import json
import numpy as np
import pandas as pd
from . import config
from .data import _con

H = 10


def _psi(ref: pd.Series, cur: pd.Series, bins: int = 10) -> float | None:
    ref, cur = ref.dropna(), cur.dropna()
    if len(ref) < 500 or len(cur) < 100:
        return None
    edges = np.unique(np.quantile(ref, np.linspace(0, 1, bins + 1)))
    if len(edges) < 3:
        return None
    edges[0], edges[-1] = -np.inf, np.inf
    r = np.histogram(ref, edges)[0] / len(ref) + 1e-4
    c = np.histogram(cur, edges)[0] / len(cur) + 1e-4
    return float(np.sum((c - r) * np.log(c / r)))


def live_ic() -> list[dict]:
    out = []
    with _con() as c:
        runs = c.execute("SELECT asOf, payload FROM pick_runs ORDER BY asOf").fetchall()
        dates = [r[0] for r in c.execute("SELECT DISTINCT date FROM daily_bars ORDER BY date")]
        for as_of, payload in runs:
            if as_of not in dates:
                continue
            i = dates.index(as_of)
            if i + H >= len(dates):
                continue
            ranking = json.loads(payload).get("ranking") or []
            if len(ranking) < 50:
                continue
            d_open, d_close = dates[i + 1], dates[i + H]
            px = pd.read_sql_query("SELECT symbol, date, open, close FROM daily_bars WHERE date IN (?, ?)", c, params=[d_open, d_close])
            o = px[px.date == d_open].set_index("symbol")["open"]
            cl = px[px.date == d_close].set_index("symbol")["close"]
            rk = pd.DataFrame(ranking).set_index("symbol")
            rk["fwd"] = cl / o - 1
            rk = rk.dropna(subset=["fwd"])
            if len(rk) < 50:
                continue
            ic = rk["score"].corr(rk["fwd"], method="spearman")
            top = rk.sort_values("rankScore", ascending=False).head(10)["fwd"].mean()
            out.append({"asOf": as_of, "ic": round(float(ic), 4), "n": int(len(rk)), "top10FwdPct": round(float(top) * 100, 2),
                        "allFwdPct": round(float(rk["fwd"].mean()) * 100, 2)})
    return out


def oos_monthly_ic(months: int = 12) -> list[dict]:
    p = config.OUT_DIR / "xs_oos.parquet"
    if not p.exists():
        return []
    o = pd.read_parquet(p, columns=["date", "p_all", "fwd"])
    o = o[o.date >= o.date.max() - pd.DateOffset(months=months)]
    daily = o.groupby("date").apply(lambda g: g["p_all"].corr(g["fwd"], method="spearman"))
    m = daily.groupby(daily.index.to_period("M")).mean()
    return [{"month": str(k), "ic": round(float(v), 4)} for k, v in m.items()]


def drift(top_n: int = 10) -> list[dict]:
    meta_p = config.MODEL_DIR / "xs_meta.json"
    feats_p = config.OUT_DIR / "features.parquet"
    if not (meta_p.exists() and feats_p.exists()):
        return []
    meta = json.loads(meta_p.read_text())
    feats = [f for f, _ in meta.get("top_importance", [])][:top_n]
    cols = [f for f in feats if f != "mom_12_1"] + ["date", "liquid"]
    df = pd.read_parquet(feats_p, columns=list(dict.fromkeys(cols)))
    df = df[df.liquid]
    dates = sorted(df.date.unique())
    cur = df[df.date >= dates[-20]]
    ref = df[df.date < dates[-60]]
    out = []
    for f in feats:
        if f not in df.columns:
            continue
        per_day_unique = df.groupby("date")[f].nunique().median()
        if per_day_unique <= 30:
            # market / sector context feature: one (or a few) values per day -> is today's level inside the history seen in training?
            hist = ref.groupby("date")[f].mean().dropna()
            now = float(cur[cur.date == dates[-1]][f].mean())
            if len(hist) < 200 or np.isnan(now):
                continue
            pct = float((hist < now).mean())
            level = "high" if pct < 0.01 or pct > 0.99 else "moderate" if pct < 0.05 or pct > 0.95 else "stable"
            out.append({"feature": f, "kind": "context", "percentile": round(pct, 3), "level": level})
        else:
            v = _psi(ref[f], cur[f])
            if v is not None:
                out.append({"feature": f, "kind": "cross-section", "psi": round(v, 3), "level": "high" if v > 0.25 else "moderate" if v > 0.1 else "stable"})
    return out


def health() -> dict:
    live = live_ic()
    monthly = oos_monthly_ic()
    psi = drift()
    reasons, status = [], "OK"
    live_mean = float(np.mean([x["ic"] for x in live])) if live else None
    if live and len(live) >= 20 and live_mean is not None and live_mean < 0:
        status = "ALERT"; reasons.append(f"live rank-IC averaged {live_mean:.3f} over {len(live)} published runs")
    recent = [m["ic"] for m in monthly[-3:]]
    if recent and np.mean(recent) < 0:
        status = "WATCH" if status == "OK" else status; reasons.append(f"out-of-sample IC negative over the last 3 months ({np.mean(recent):.3f})")
    high = [d["feature"] for d in psi if d["level"] == "high"]
    if high:
        status = "WATCH" if status == "OK" else status; reasons.append("feature drift: " + ", ".join(high))
    meta_p = config.MODEL_DIR / "xs_meta.json"
    meta = json.loads(meta_p.read_text()) if meta_p.exists() else {}
    return {"status": status, "reasons": reasons, "model": {"trainedTo": meta.get("data_to"), "trainedAt": meta.get("trained_at")},
            "liveIC": live, "liveICMean": round(live_mean, 4) if live_mean is not None else None, "liveRunsScored": len(live),
            "oosMonthlyIC": monthly, "drift": psi}
