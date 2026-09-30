"""Production: train the final ranking model, score the latest session, track live picks."""
from __future__ import annotations
import json
import time
from datetime import datetime, timezone
import numpy as np
import pandas as pd
import lightgbm as lgb
from . import config
from .explain import setup_tags, top_reasons
from .features import build_features
from .labels import manage_trade
from .model import FEATURES
from .picking import select_picks
from .setups import add_setups
from .themes import is_priority_theme
from .xsection import EXTRA, add_extra, prep

MODEL_FILE = config.MODEL_DIR / "xs_model.txt"
META_FILE = config.MODEL_DIR / "xs_meta.json"
XS_PARAMS = dict(objective="regression", learning_rate=0.05, num_leaves=31, min_child_samples=500,
                 feature_fraction=0.7, bagging_fraction=0.7, bagging_freq=1, lambda_l2=50.0, max_depth=6,
                 verbose=-1, seed=11, n_jobs=6)
ALL_FEATURES = FEATURES + EXTRA
TILT = 0.03
TILT_MIN_RANK = 0.6


def _load_features(start: str) -> pd.DataFrame:
    df = build_features(start)
    df = add_setups(df)
    return add_extra(df)


def train(rounds: int = 250, embargo_days: int = 15) -> dict:
    """Fit the final model on all history (same recipe as the walk-forward study) and save it."""
    t0 = time.time()
    df = _load_features("2019-01-01")
    df.to_parquet(config.OUT_DIR / "features.parquet")
    data_to = df["date"].max()
    d = prep(df.copy())                                  # rows with a resolved 10-day forward return
    d = d[d.date < d.date.max() - pd.Timedelta(days=embargo_days)]
    d = d[d.date.dt.dayofyear % 2 == 0]                  # identical subsampling to the validated study
    m = lgb.train(XS_PARAMS, lgb.Dataset(d[ALL_FEATURES], d["y"]), rounds)
    m.save_model(str(MODEL_FILE))
    imp = sorted(zip(ALL_FEATURES, m.feature_importance("gain")), key=lambda x: -x[1])[:15]
    meta = {"trained_at": datetime.now(timezone.utc).isoformat(), "data_to": str(data_to.date()),
            "train_rows": int(len(d)), "features": ALL_FEATURES, "rounds": rounds,
            "top_importance": [(a, round(float(b), 1)) for a, b in imp], "seconds": round(time.time() - t0)}
    META_FILE.write_text(json.dumps(meta, indent=2))
    return meta


def _clean(o):
    """NaN/inf are not valid JSON: turn them into null so the API never chokes on a partial data day."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, float) and not np.isfinite(o):
        return None
    return o


def _regime(day: pd.DataFrame) -> dict:
    r = day.iloc[0]
    nifty_d200, nifty_d50 = r["nifty_d200"], r["nifty_d50"]
    if nifty_d200 > 0 and nifty_d50 > 0:
        label, mult = "BULLISH", 1.0
    elif nifty_d200 > 0:
        label, mult = "PULLBACK", 1.0
    else:
        label, mult = "DEFENSIVE", 0.5
    return {"label": label, "sizeMultiplier": mult, "niftyVs50dma": round(float(nifty_d50), 4),
            "niftyVs200dma": round(float(nifty_d200), 4), "niftyRet20": round(float(r["nifty_ret20"]), 4),
            "vix": round(float(r["vix"]), 2), "vixPercentile": round(float(r["vix_pct"]), 2),
            "breadth50": round(float(r["breadth50"]), 3), "breadth200": round(float(r["breadth200"]), 3),
            "advanceRatio": round(float(r["adv_ratio"]), 3),
            "note": ("Nifty below its 200-DMA: position sizes are halved (risk-control rule, not a backtested edge)."
                     if label == "DEFENSIVE" else "Nifty above its 200-DMA: normal sizing.")}


def _plan(r: pd.Series) -> dict:
    sp = float(np.clip(config.STOP_ATR_MULT * r["atr_pct"], config.STOP_MIN, config.STOP_MAX))
    c = float(r["close"])
    return {"entryRef": round(c, 2), "maxEntry": round(c * (1 + config.MAX_GAP_CHASE), 2), "stopPct": round(sp, 4),
            "stop": round(c * (1 - sp), 2), "t1Pct": round(1.5 * sp, 4), "t1": round(c * (1 + 1.5 * sp), 2),
            "t2Pct": round(3 * sp, 4), "t2": round(c * (1 + 3 * sp), 2), "maxHoldDays": config.HORIZON,
            "bookAtT1": 0.5}


def score(shortlist: int = 15, min_price: float = 200.0, max_price: float = 650.0, sector_cap: int = 2,
          theme_watch: int = 12, lookback_days: int = 900, min_ret10: float = 0.0) -> dict:
    if not MODEL_FILE.exists():
        raise SystemExit("model missing - run `train` first")
    model = lgb.Booster(model_file=str(MODEL_FILE))
    meta = json.loads(META_FILE.read_text())
    from .data import _con
    with _con() as c:
        latest = c.execute("SELECT MAX(date) FROM daily_bars").fetchone()[0]
    start = (pd.Timestamp(latest) - pd.Timedelta(days=lookback_days)).date().isoformat()
    df = _load_features(start)
    day = df[(df.date == pd.Timestamp(latest)) & df.liquid].copy()
    if day.empty:
        raise SystemExit(f"no liquid rows for {latest}")
    X = day[meta["features"]]
    day["prob"] = model.predict(X)
    contrib = model.predict(X, pred_contrib=True)
    day["ci"] = range(len(day))
    day = day[(day.ret1.abs() < 0.19)]                                   # skip circuit-locked names
    strong = (day.is_theme == 1) & (day.sec_rank.fillna(0) >= TILT_MIN_RANK)
    day["rank_score"] = day["prob"] + TILT * strong.astype(float)
    day["date"] = pd.Timestamp(latest)
    ranking_pool = day                                                   # full ranking (stock page) ignores the filter
    day = day[day.ret10 > min_ret10]                                     # user rule: last 2 weeks (10 sessions) must be positive

    def pack(r: pd.Series, rank: int) -> dict:
        return {"rank": rank, "symbol": r["symbol"], "sector": r["sector"], "isTheme": bool(r["is_theme"]),
                "score": round(float(r["prob"]), 4), "rankScore": round(float(r["rank_score"]), 4),
                "themeBoost": bool(TILT > 0 and r["is_theme"] == 1 and (r["sec_rank"] if pd.notna(r["sec_rank"]) else 0) >= TILT_MIN_RANK),
                "close": round(float(r["close"]), 2), "changePct": round(float(r["ret1"]) * 100, 2),
                "inPriceBand": bool(min_price <= r["close"] <= max_price),
                "turnover20Cr": round(float(r["turnover20_cr"]), 1), "atrPct": round(float(r["atr_pct"]) * 100, 2),
                "rsi": round(float(r["rsi14"]), 1), "volRatio": round(float(r["vol_ratio"]), 2) if pd.notna(r["vol_ratio"]) else None,
                "delivPct": round(float(r["deliv_pct"]), 1) if pd.notna(r["deliv_pct"]) else None,
                "rs60": round(float(r["rs60"]), 4) if pd.notna(r["rs60"]) else None,
                "sectorRank": round(float(r["sec_rank"]), 2) if pd.notna(r["sec_rank"]) else None,
                "tags": setup_tags(r), "reasons": top_reasons(meta["features"], contrib[int(r["ci"])], r),
                "plan": _plan(r)}

    band = day[day.close.between(min_price, max_price)]
    ranked = select_picks(band.assign(day_rank=0), "prob", shortlist, 0.0, sector_cap, TILT, TILT_MIN_RANK)
    ranked = ranked.sort_values("rank_score", ascending=False)
    picks = [pack(r, i + 1) for i, (_, r) in enumerate(ranked.iterrows())]

    ep = day[day.close.between(min_price, max_price) & (day.d_ema50 > 0) & (day.d_sma200 > 0) & (day.ret20 > 0) & (day.sec_rank.fillna(0) >= TILT_MIN_RANK)]
    ep = select_picks(ep.assign(day_rank=0), "prob", 15, 0.0, sector_cap, TILT, TILT_MIN_RANK).sort_values("rank_score", ascending=False)
    elite = [pack(r, i + 1) for i, (_, r) in enumerate(ep.iterrows())]

    th = day[(day.is_theme == 1) & day.close.between(min_price, max_price)].sort_values("rank_score", ascending=False).head(theme_watch)
    watch = [pack(r, i + 1) for i, (_, r) in enumerate(th.iterrows())]

    sec = (ranking_pool[ranking_pool.sector != "Other"].groupby("sector")
           .agg(n=("symbol", "size"), rank=("sec_rank", "first"), ret5=("sec_ret5", "first"), ret20=("sec_ret20", "first"),
                ret60=("sec_ret60", "first"), rs20=("sec_rs20", "first"), rs60=("sec_rs60", "first"),
                breadth=("sec_breadth50", "first"), avgScore=("prob", "mean"), best=("rank_score", "max"))
           .reset_index().sort_values("rank", ascending=False))
    sectors = []
    for _, s in sec.iterrows():
        top = day[day.sector == s["sector"]].sort_values("rank_score", ascending=False).head(3)
        sectors.append({"sector": s["sector"], "isTheme": is_priority_theme(s["sector"]), "stocks": int(s["n"]),
                        "rank": round(float(s["rank"]), 2) if pd.notna(s["rank"]) else None,
                        "ret5": round(float(s["ret5"]), 4), "ret20": round(float(s["ret20"]), 4),
                        "ret60": round(float(s["ret60"]), 4), "rs20": round(float(s["rs20"]), 4),
                        "rs60": round(float(s["rs60"]), 4), "breadth50": round(float(s["breadth"]), 3),
                        "avgScore": round(float(s["avgScore"]), 4), "top": list(top["symbol"])})

    ranked_all = ranking_pool.sort_values("rank_score", ascending=False)
    ranking = [{"symbol": r.symbol, "sector": r.sector, "score": round(float(r.prob), 4), "rankScore": round(float(r.rank_score), 4),
                "close": round(float(r.close), 2), "changePct": round(float(r.ret1) * 100, 2)} for r in ranked_all.itertuples()]

    out = {"asOf": latest, "generatedAt": datetime.now(timezone.utc).isoformat(),
           "model": {"trainedTo": meta["data_to"], "trainedAt": meta["trained_at"], "rounds": meta["rounds"]},
           "universe": {"liquidStocks": int(len(day)), "priceBand": [min_price, max_price], "inBand": int(len(band))},
           "regime": _regime(day), "picks": picks, "themeWatch": watch, "elite": elite, "sectors": sectors, "ranking": ranking,
           "config": {"minRet10": min_ret10, "tilt": TILT, "tiltMinSectorRank": TILT_MIN_RANK, "sectorCap": sector_cap, "horizonDays": config.HORIZON}}
    dest = config.OUT_DIR.parent / "picks"
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"{latest}.json"
    path.write_text(json.dumps(_clean(out), indent=1, allow_nan=False))
    out["_path"] = str(path)
    return out


def track(items: list[dict]) -> list[dict]:
    """items: [{id, symbol, signalDate, stopPct, atrPct}] -> live outcome of each published plan."""
    from .data import _con
    res = []
    with _con() as c:
        for it in items:
            q = ("SELECT date,open,high,low,close FROM daily_bars WHERE symbol=? AND date>=? ORDER BY date")
            # need signal bar + everything after it; back-adjustment not needed inside a 10-day window
            bars = pd.read_sql_query(q, c, params=[it["symbol"], it["signalDate"]])
            if bars.empty or bars.iloc[0]["date"] != it["signalDate"]:
                res.append({"id": it["id"], "status": "NO_DATA"})
                continue
            O, H, L, C = (bars[k].to_numpy() for k in ("open", "high", "low", "close"))
            r = manage_trade(O, H, L, C, 0, float(it["stopPct"]), float(it["atrPct"]))
            out = {"id": it["id"], "status": r["status"]}
            if r["status"] in ("OPEN", "CLOSED"):
                out.update({"entry": round(float(r["entry"]), 2), "days": int(r["days"]), "t1Hit": bool(r["booked"]),
                            "stopNow": round(float(r["stop_now"]), 2), "lastClose": round(float(r["last_close"]), 2),
                            "netRet": round(float(r["net"]), 4), "exitReason": int(r["exit_reason"]) if r["status"] == "CLOSED" else None,
                            "exitPx": round(float(r["exit_px"]), 2) if r.get("exit_px") is not None else None})
            res.append(out)
    return res
