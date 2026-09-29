from __future__ import annotations
import numpy as np
import pandas as pd
import lightgbm as lgb

FEATURES = [
    # trend / momentum
    "ret1", "ret5", "ret10", "ret20", "ret60", "d_ema20", "d_ema50", "d_sma200", "ema20_slope", "ema50_slope",
    "rsi14", "adx14", "di_diff", "rs20", "rs60",
    # volatility / structure
    "atr_pct", "bb_width", "bb_ratio", "range_pct", "rng5_20", "base_depth30", "dist_hi252", "dist_hi20",
    # participation
    "vol_ratio", "deliv_ratio", "deliv_pct",
    # candle
    "close_pos", "body", "lower_wick", "upper_wick", "gap", "hammer", "engulf", "nr7", "inside",
    # setups
    "brk", "pullback", "squeeze", "high52", "n_setups",
    # market regime
    "nifty_ret5", "nifty_ret20", "nifty_ret60", "nifty_d50", "nifty_d200", "nifty_dd", "vix", "vix_chg5", "vix_pct",
    "breadth50", "breadth200", "adv_ratio",
    # sector / theme
    "sec_ret5", "sec_ret20", "sec_ret60", "sec_rs20", "sec_rs60", "sec_rank", "sec_rank60", "sec_breadth50",
    "rs_in_sector", "is_defence", "is_engineering", "is_theme",
]
THEME_FEATS = ("is_defence", "is_engineering", "is_theme")
NO_THEME = [f for f in FEATURES if f not in THEME_FEATS]

PARAMS = dict(objective="binary", learning_rate=0.03, num_leaves=15, min_child_samples=150,
              feature_fraction=0.7, bagging_fraction=0.8, bagging_freq=1, lambda_l2=10.0,
              max_depth=5, verbose=-1, seed=7, n_jobs=4)


def fit(train: pd.DataFrame, features: list[str], rounds: int = 400):
    """Train with a time-ordered validation tail for early stopping."""
    train = train.sort_values("date")
    cut = int(len(train) * 0.85)
    tr, va = train.iloc[:cut], train.iloc[cut:]
    dtr = lgb.Dataset(tr[features], tr["win"])
    dva = lgb.Dataset(va[features], va["win"])
    return lgb.train(PARAMS, dtr, rounds, valid_sets=[dva],
                     callbacks=[lgb.early_stopping(40, verbose=False)])


def walk_forward(df: pd.DataFrame, features: list[str], first_test_year: int = 2021,
                 embargo_days: int = 15) -> pd.Series:
    """Anchored expanding walk-forward, one model per test year, embargoed. Returns OOS probability."""
    pred = pd.Series(np.nan, index=df.index)
    for y in sorted(df.date.dt.year.unique()):
        if y < first_test_year:
            continue
        start = pd.Timestamp(f"{y}-01-01")
        tr = df[df.date < start - pd.Timedelta(days=embargo_days)]
        te = df[(df.date >= start) & (df.date < pd.Timestamp(f"{y + 1}-01-01"))]
        if len(te) == 0 or len(tr) < 3000:
            continue
        m = fit(tr, features)
        pred.loc[te.index] = m.predict(te[features], num_iteration=m.best_iteration)
    return pred
