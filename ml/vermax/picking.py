"""Pick selection (shared by research + production) and portfolio simulation."""
from __future__ import annotations
import numpy as np
import pandas as pd
from . import config


def select_picks(df: pd.DataFrame, score: str = "prob", n: int = 5, min_score: float = 0.0,
                 sector_cap: int = 2, tilt: float = 0.0, tilt_min_rank: float = 0.6) -> pd.DataFrame:
    """Per day: rank by score (+ priority-theme tilt when the theme's sector is strong), cap per sector, take top n."""
    d = df.copy()
    strong = (d.is_theme == 1) & (d.sec_rank.fillna(0) >= tilt_min_rank)
    d["rank_score"] = d[score] + tilt * strong.astype(float)
    d = d[d[score] >= min_score].sort_values(["date", "rank_score"], ascending=[True, False])
    d["sec_pos"] = d.groupby(["date", "sector"]).cumcount()
    d = d[(d.sec_pos < sector_cap) | (d.sector == "Other")]
    d["day_rank"] = d.groupby("date").cumcount()
    return d[d.day_rank < n]


def stats(t: pd.DataFrame) -> dict:
    if len(t) == 0:
        return {"n": 0}
    w = t.net_ret[t.net_ret > 0].sum()
    l = -t.net_ret[t.net_ret < 0].sum()
    return {"n": len(t), "win%": round(t.win.mean() * 100, 1), "exp%": round(t.net_ret.mean() * 100, 2),
            "PF": round(w / l, 2) if l > 0 else np.nan, "avgR": round(t.r_mult.mean(), 3),
            "pos%": round((t.net_ret > 0).mean() * 100, 1), "hold": round(t.hold_days.mean(), 1)}


def portfolio_sim(picks: pd.DataFrame, dates: pd.DatetimeIndex, capital: float = 1.0,
                  risk: float = config.RISK_PER_TRADE, max_pos: float = config.MAX_POSITION,
                  max_open: int = config.MAX_OPEN) -> dict:
    """Event-driven, realised-P&L equity simulation. Signals from bar i-1 enter at bar i's open."""
    idx = {d: i for i, d in enumerate(dates)}
    p = picks.copy()
    p["sig_i"] = p["date"].map(idx)
    p = p.dropna(subset=["sig_i"]).sort_values(["sig_i", "day_rank"])
    rows = p.to_dict("records")
    n_days = len(dates)
    equity = np.full(n_days, np.nan)
    eq = capital
    open_list: list[dict] = []
    ptr = 0
    for i in range(n_days):
        still = []
        for pos in open_list:
            if pos["exit_i"] <= i:
                eq += pos["size"] * pos["ret"]
            else:
                still.append(pos)
        open_list = still
        while ptr < len(rows) and rows[ptr]["sig_i"] < i - 1:
            ptr += 1
        while ptr < len(rows) and rows[ptr]["sig_i"] == i - 1:
            r = rows[ptr]
            ptr += 1
            if len(open_list) >= max_open:
                continue
            size = min(risk / r["stop_pct"], max_pos) * eq
            # trade occupies bars i .. i+hold_days-1, P&L realised at the exit bar
            open_list.append({"exit_i": i + int(r["hold_days"]), "size": size, "ret": r["net_ret"]})
        equity[i] = eq
    s = pd.Series(equity, index=dates).ffill().dropna()
    wk = s.resample("W-FRI").last().pct_change().dropna()
    dd = (s / s.cummax() - 1).min()
    yrs = (s.index[-1] - s.index[0]).days / 365.25
    cagr = (s.iloc[-1] / capital) ** (1 / yrs) - 1 if yrs > 0 else np.nan
    return {"final": round(float(s.iloc[-1]), 3), "CAGR%": round(cagr * 100, 1), "maxDD%": round(dd * 100, 1),
            "wk_mean%": round(wk.mean() * 100, 2), "wk_pos%": round((wk > 0).mean() * 100, 1),
            "wk>=5%": round((wk >= 0.05).mean() * 100, 1), "wk<=-3%": round((wk <= -0.03).mean() * 100, 1),
            "curve": s}
