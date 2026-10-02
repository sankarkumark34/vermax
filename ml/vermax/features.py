from __future__ import annotations
import numpy as np
import pandas as pd
from . import config
from .data import load_bars, load_index, load_stocks
from .themes import is_priority_theme, DEFENCE_LABEL, ENGINEERING_LABEL


def _ewm(s: pd.Series, sym: pd.Series, **kw) -> pd.Series:
    return s.groupby(sym, sort=False).transform(lambda x: x.ewm(adjust=False, **kw).mean())


def _roll(s: pd.Series, sym: pd.Series, n: int, fn: str, minp: int | None = None) -> pd.Series:
    r = s.groupby(sym, sort=False).rolling(n, min_periods=minp or n)
    return getattr(r, fn)().reset_index(level=0, drop=True).sort_index()


def build_features(start: str = "2019-01-01", end: str | None = None) -> pd.DataFrame:
    """One row per (symbol, date) with indicators, setup flags, market/sector/theme context."""
    bars = load_bars(start, end)
    stocks = load_stocks().set_index("symbol")
    med = bars.groupby("symbol")["turnover"].transform("median")
    bars = bars[med >= 1.5e7]           # drop chronically illiquid tickers (>= 1.5 Cr median daily value)
    df = bars.sort_values(["symbol", "date"]).reset_index(drop=True)
    sym = df["symbol"]
    g = df.groupby("symbol", sort=False)
    c, h, l, o, v = df.close, df.high, df.low, df.open, df.volume

    df["bars"] = g.cumcount() + 1
    for n in (1, 5, 10, 20, 60, 120):
        df[f"ret{n}"] = c / g["close"].shift(n) - 1
    df["ema20"] = _ewm(c, sym, span=20)
    df["ema50"] = _ewm(c, sym, span=50)
    df["sma200"] = _roll(c, sym, 200, "mean", 150)
    df["d_ema20"] = c / df.ema20 - 1
    df["d_ema50"] = c / df.ema50 - 1
    df["d_sma200"] = c / df.sma200 - 1
    df["ema20_slope"] = df.ema20 / g["ema20"].shift(5) - 1
    df["ema50_slope"] = df.ema50 / g["ema50"].shift(10) - 1

    # RSI (Wilder)
    d = g["close"].diff()
    au = _ewm(d.clip(lower=0), sym, alpha=1 / 14)
    ad = _ewm((-d).clip(lower=0), sym, alpha=1 / 14)
    df["rsi14"] = 100 - 100 / (1 + au / ad.replace(0, np.nan))

    # ATR / ADX
    pc = g["close"].shift(1)
    tr = pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    df["atr14"] = _ewm(tr, sym, alpha=1 / 14)
    df["atr_pct"] = df.atr14 / c
    up = h - g["high"].shift(1); dn = g["low"].shift(1) - l
    pdm = np.where((up > dn) & (up > 0), up, 0.0)
    mdm = np.where((dn > up) & (dn > 0), dn, 0.0)
    atr_s = df.atr14.replace(0, np.nan)
    pdi = 100 * _ewm(pd.Series(pdm, index=df.index), sym, alpha=1 / 14) / atr_s
    mdi = 100 * _ewm(pd.Series(mdm, index=df.index), sym, alpha=1 / 14) / atr_s
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    df["adx14"] = _ewm(dx, sym, alpha=1 / 14)
    df["di_diff"] = pdi - mdi

    # volatility / squeeze
    sd20 = _roll(c, sym, 20, "std")
    ma20 = _roll(c, sym, 20, "mean")
    df["bb_width"] = 4 * sd20 / ma20
    df["bb_ratio"] = df.bb_width / _roll(df.bb_width, sym, 120, "mean", 60)
    rng = (h - l)
    df["range_pct"] = rng / c
    df["rng5_20"] = _roll(rng, sym, 5, "mean") / _roll(rng, sym, 20, "mean")
    df["nr7"] = (rng <= _roll(rng, sym, 7, "min")).astype(int)
    df["inside"] = ((h < g["high"].shift(1)) & (l > g["low"].shift(1))).astype(int)
    hi30 = _roll(h, sym, 30, "max"); lo30 = _roll(l, sym, 30, "min")
    df["base_depth30"] = (hi30 - lo30) / c

    # volume / delivery
    vavg = _roll(v, sym, 20, "mean").groupby(sym, sort=False).shift(1)
    df["vol_ratio"] = v / vavg
    df["turnover20_cr"] = _roll(df.turnover, sym, 20, "mean") / 1e7
    dl = df.delivery_pct
    df["deliv_ratio"] = dl / _roll(dl.fillna(dl.median()), sym, 20, "mean").groupby(sym, sort=False).shift(1)
    df["deliv_pct"] = dl

    # price position
    hi252 = _roll(h, sym, 252, "max", 120)
    df["dist_hi252"] = c / hi252 - 1
    prior_hi20 = _roll(h, sym, 20, "max").groupby(sym, sort=False).shift(1)
    df["prior_hi20"] = prior_hi20
    df["dist_hi20"] = c / prior_hi20 - 1
    df["prev_high"] = g["high"].shift(1)

    # candle shape
    rng_s = rng.replace(0, np.nan)
    df["close_pos"] = (c - l) / rng_s
    df["body"] = (c - o) / rng_s
    body_hi = np.maximum(c, o); body_lo = np.minimum(c, o)
    df["lower_wick"] = (body_lo - l) / rng_s
    df["upper_wick"] = (h - body_hi) / rng_s
    df["gap"] = o / g["close"].shift(1) - 1
    prev_body_lo = g["close"].shift(1).combine(g["open"].shift(1), np.minimum)
    prev_body_hi = g["close"].shift(1).combine(g["open"].shift(1), np.maximum)
    df["hammer"] = ((df.lower_wick >= 0.55) & (df.close_pos >= 0.6) & (df.body.abs() <= 0.35)).astype(int)
    df["engulf"] = ((c > o) & (g["close"].shift(1) < g["open"].shift(1)) & (c >= prev_body_hi) & (o <= prev_body_lo)).astype(int)

    # ---- market context ------------------------------------------------------
    nifty = load_index("Nifty 50", start)
    vix = load_index("India VIX", start)
    nc = nifty["close"]
    m = pd.DataFrame(index=nc.index)
    m["nifty_ret5"] = nc.pct_change(5); m["nifty_ret20"] = nc.pct_change(20); m["nifty_ret60"] = nc.pct_change(60)
    m["nifty_d50"] = nc / nc.rolling(50).mean() - 1
    m["nifty_d200"] = nc / nc.rolling(200).mean() - 1
    m["nifty_dd"] = nc / nc.rolling(252, min_periods=60).max() - 1
    vc = vix["close"].reindex(nc.index).ffill()
    m["vix"] = vc; m["vix_chg5"] = vc / vc.shift(5) - 1
    m["vix_pct"] = vc.rolling(252, min_periods=60).rank(pct=True)
    # index files can lag the equity bhavcopy by hours: carry the last known market context forward
    m = m.reindex(sorted(set(m.index) | set(df["date"].unique()))).ffill()
    df = df.merge(m, left_on="date", right_index=True, how="left")
    # derivatives positioning (NSE participant OI + stock F&O open interest), when the backfill exists
    from .derivs import load_features as load_derivs
    dmk, dfo = load_derivs()
    if len(dmk):
        dmk = dmk.reindex(sorted(set(dmk.index) | set(df["date"].unique()))).ffill(limit=3)
        df = df.merge(dmk, left_on="date", right_index=True, how="left")
    if len(dfo):
        df = df.merge(dfo, on=["date", "symbol"], how="left")
        df["is_fno"] = df["is_fno"].fillna(0)
    df["rs20"] = df.ret20 - df.nifty_ret20
    df["rs60"] = df.ret60 - df.nifty_ret60

    # ---- liquid-universe flag (point in time) -------------------------------
    df["liquid"] = ((c >= config.MIN_PRICE) & (df.turnover20_cr >= config.MIN_TURNOVER20_CR)
                    & (df.bars >= config.MIN_HISTORY_BARS))

    # ---- sector / theme ---------------------------------------------------------
    df["sector"] = sym.map(stocks["theme_sector"]).fillna("Other")
    df["is_defence"] = (df.sector == DEFENCE_LABEL).astype(int)
    df["is_engineering"] = (df.sector == ENGINEERING_LABEL).astype(int)
    df["is_theme"] = ((df.is_defence + df.is_engineering) > 0).astype(int)
    df["above50"] = (c > df.ema50).astype(float)
    df["above200"] = (c > df.sma200).astype(float)
    liq = df[df.liquid]
    brd = liq.groupby("date").agg(breadth50=("above50", "mean"), breadth200=("above200", "mean"),
                                 adv_ratio=("ret1", lambda x: (x > 0).mean()))
    df = df.merge(brd, left_on="date", right_index=True, how="left")
    sec = (liq[liq.sector != "Other"].groupby(["date", "sector"])
           .agg(sec_ret20=("ret20", "mean"), sec_ret60=("ret60", "mean"), sec_ret5=("ret5", "mean"),
                sec_breadth50=("above50", "mean"), sec_n=("ret20", "size")).reset_index())
    sec = sec[sec.sec_n >= 3]
    sec["sec_rank"] = sec.groupby("date")["sec_ret20"].rank(pct=True)
    sec["sec_rank60"] = sec.groupby("date")["sec_ret60"].rank(pct=True)
    df = df.merge(sec.drop(columns="sec_n"), on=["date", "sector"], how="left")
    df["sec_rs20"] = df.sec_ret20 - df.nifty_ret20
    df["sec_rs60"] = df.sec_ret60 - df.nifty_ret60
    df["rs_in_sector"] = df.ret20 - df.sec_ret20
    return df
