"""Human-readable reasons from LightGBM SHAP contributions + descriptive setup tags."""
from __future__ import annotations
import numpy as np
import pandas as pd

LABELS = {
    "ret1": "1-day move", "ret5": "5-day momentum", "ret10": "10-day momentum", "ret20": "20-day momentum",
    "ret60": "60-day momentum", "ret120": "6-month momentum", "mom_12_1": "12-1 month momentum",
    "d_ema20": "distance to 20-EMA", "d_ema50": "distance to 50-EMA", "d_sma200": "distance to 200-DMA",
    "ema20_slope": "20-EMA slope", "ema50_slope": "50-EMA slope", "rsi14": "RSI(14)", "adx14": "trend strength (ADX)",
    "di_diff": "directional bias (+DI/-DI)", "rs20": "20d strength vs Nifty", "rs60": "60d strength vs Nifty",
    "atr_pct": "volatility (ATR%)", "bb_width": "Bollinger width", "bb_ratio": "volatility squeeze",
    "range_pct": "day range", "rng5_20": "range contraction", "base_depth30": "30-day base depth",
    "dist_hi252": "distance to 52-week high", "dist_hi20": "distance to 20-day high",
    "vol_ratio": "volume surge", "deliv_ratio": "delivery surge", "deliv_pct": "delivery %",
    "close_pos": "close near day high", "body": "candle body", "lower_wick": "lower wick (buying tail)",
    "upper_wick": "upper wick", "gap": "opening gap", "hammer": "hammer candle", "engulf": "bullish engulfing",
    "nr7": "NR7 compression", "inside": "inside bar", "brk": "20-day breakout setup", "pullback": "pullback-to-EMA setup",
    "squeeze": "squeeze-breakout setup", "high52": "52-week-high breakout setup", "n_setups": "setups firing together",
    "nifty_ret5": "Nifty 5d trend", "nifty_ret20": "Nifty 20d trend", "nifty_ret60": "Nifty 60d trend",
    "nifty_d50": "Nifty vs 50-DMA", "nifty_d200": "Nifty vs 200-DMA", "nifty_dd": "Nifty drawdown",
    "vix": "India VIX level", "vix_chg5": "VIX change", "vix_pct": "VIX percentile",
    "breadth50": "market breadth (>50DMA)", "breadth200": "market breadth (>200DMA)", "adv_ratio": "advance ratio",
    "sec_ret5": "sector 5d move", "sec_ret20": "sector 20d move", "sec_ret60": "sector 60d move",
    "sec_rs20": "sector 20d vs Nifty", "sec_rs60": "sector 60d vs Nifty", "sec_rank": "sector strength rank",
    "sec_rank60": "sector 60d rank", "sec_breadth50": "sector breadth", "rs_in_sector": "leader within sector",
    "is_defence": "Defence theme", "is_engineering": "Engineering theme", "is_theme": "priority theme",
}


def _fmt(f: str, v: float) -> str:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return ""
    pct = {"ret1", "ret5", "ret10", "ret20", "ret60", "ret120", "mom_12_1", "d_ema20", "d_ema50", "d_sma200",
           "rs20", "rs60", "sec_ret5", "sec_ret20", "sec_ret60", "sec_rs20", "sec_rs60", "rs_in_sector",
           "dist_hi252", "dist_hi20", "atr_pct", "nifty_ret5", "nifty_ret20", "nifty_ret60", "nifty_d50",
           "nifty_d200", "nifty_dd"}
    if f in {"is_defence", "is_engineering", "is_theme", "hammer", "engulf", "nr7", "inside", "brk", "pullback", "squeeze", "high52"}:
        return "yes" if v else "no"
    if f in pct:
        return f"{v * 100:+.1f}%"
    if f in {"sec_rank", "sec_rank60", "vix_pct", "breadth50", "breadth200", "sec_breadth50", "adv_ratio", "close_pos"}:
        return f"{v * 100:.0f}th pct" if f.endswith("rank") or f.endswith("pct") or f.endswith("rank60") else f"{v * 100:.0f}%"
    if f in {"vol_ratio", "deliv_ratio", "bb_ratio", "rng5_20"}:
        return f"{v:.2f}x"
    return f"{v:.2f}"


def top_reasons(model_features: list[str], contrib_row: np.ndarray, row: pd.Series, k: int = 5) -> list[dict]:
    """contrib_row: SHAP values (len = n_features (+ bias last)). Returns the k strongest positive drivers."""
    vals = contrib_row[: len(model_features)]
    order = np.argsort(-vals)
    out = []
    for i in order:
        if vals[i] <= 0:
            break
        f = model_features[i]
        if f in ("is_defence", "is_engineering") and row.get(f, 0) == 0:
            continue
        out.append({"feature": f, "label": LABELS.get(f, f), "value": _fmt(f, row.get(f)), "impact": round(float(vals[i]), 4)})
        if len(out) >= k:
            break
    return out


def setup_tags(row: pd.Series) -> list[str]:
    tags = []
    if row.get("brk") == 1: tags.append("20D breakout")
    if row.get("pullback") == 1: tags.append("Pullback to 20-EMA")
    if row.get("squeeze") == 1: tags.append("Squeeze breakout")
    if row.get("high52") == 1: tags.append("52W-high breakout")
    if row.get("hammer") == 1: tags.append("Hammer")
    if row.get("engulf") == 1: tags.append("Bullish engulfing")
    if row.get("nr7") == 1: tags.append("NR7")
    if row.get("inside") == 1: tags.append("Inside bar")
    if row.get("vol_ratio", 0) >= 1.5: tags.append(f"Volume {row['vol_ratio']:.1f}x")
    if row.get("deliv_ratio", 0) >= 1.3: tags.append(f"Delivery {row['deliv_ratio']:.1f}x")
    if row.get("close", 0) > row.get("sma200", np.inf) and row.get("ema20", 0) > row.get("ema50", np.inf):
        tags.append("Uptrend (20>50, >200DMA)")
    return tags
