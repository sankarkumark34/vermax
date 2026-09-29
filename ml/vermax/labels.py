"""Triple-barrier labelling with realistic next-open entry and conservative intraday ordering."""
from __future__ import annotations
import numpy as np
import pandas as pd
from . import config

EXIT_TARGET, EXIT_STOP, EXIT_TIME, EXIT_GAPSTOP = 1, -1, 0, -2


def simulate_trades(cand: pd.DataFrame, bars: pd.DataFrame, rr: float | None = None,
                    horizon: int | None = None) -> pd.DataFrame:
    """For each candidate row (signal on close of `date`) simulate: buy next open, stop/target/time exit.

    Returns candidate frame with entry, stop_pct, tgt_pct, exit_reason, gross_ret, net_ret, hold_days,
    r_mult (net return / stop distance), filled.
    """
    rr = rr or config.RR
    horizon = horizon or config.HORIZON
    out = []
    px = {s: (d["date"].to_numpy(), d["open"].to_numpy(), d["high"].to_numpy(), d["low"].to_numpy(),
              d["close"].to_numpy()) for s, d in bars.groupby("symbol", sort=False)}
    for s, grp in cand.groupby("symbol", sort=False):
        dates, O, H, L, C = px[s]
        pos = np.searchsorted(dates, grp["date"].to_numpy())
        atrp = grp["atr_pct"].to_numpy()
        n = len(grp)
        res = np.full((n, 7), np.nan)
        for k in range(n):
            i = pos[k]
            if i + 1 >= len(dates):
                continue
            entry = O[i + 1]
            if entry > C[i] * (1 + config.MAX_GAP_CHASE):
                res[k, 6] = 0  # not filled (gap chase)
                continue
            sp = float(np.clip(config.STOP_ATR_MULT * atrp[k], config.STOP_MIN, config.STOP_MAX))
            stop = entry * (1 - sp); tgt = entry * (1 + rr * sp)
            exit_px, reason, days = None, EXIT_TIME, 0
            last = min(i + horizon, len(dates) - 1)
            for j in range(i + 1, last + 1):
                days = j - i
                if O[j] <= stop:
                    exit_px, reason = O[j], EXIT_GAPSTOP; break
                if L[j] <= stop:
                    exit_px, reason = stop, EXIT_STOP; break
                if O[j] >= tgt:
                    exit_px, reason = O[j], EXIT_TARGET; break
                if H[j] >= tgt:
                    exit_px, reason = tgt, EXIT_TARGET; break
            if exit_px is None:
                if last - i < horizon:   # trade still open at data end -> unresolved
                    continue
                exit_px, reason = C[last], EXIT_TIME
            gross = exit_px / entry - 1
            net = gross - config.ROUND_TRIP_COST
            res[k] = [entry, sp, reason, gross, net, days, 1]
        out.append(pd.DataFrame(res, index=grp.index,
                                columns=["entry", "stop_pct", "exit_reason", "gross_ret", "net_ret", "hold_days", "filled"]))
    r = pd.concat(out)
    lab = cand.join(r)
    lab["tgt_pct"] = rr * lab["stop_pct"]
    lab["r_mult"] = lab["net_ret"] / lab["stop_pct"]
    lab["win"] = (lab["exit_reason"] == EXIT_TARGET).astype(float).where(lab["filled"] == 1)
    return lab


def manage_trade(O, H, L, C, i: int, sp: float, atr_pct: float, entry: float | None = None,
                 t1_r: float = 1.5, t2_r: float = 3.0, trail_atr: float | None = None,
                 horizon: int | None = None, book_frac: float = 0.5) -> dict:
    """State machine for the published trade plan, shared by the backtest and the live tracker.

    Signal is on bar `i`; entry is bar i+1's open. Stop is checked before targets each bar; after T1 fills the
    stop moves to breakeven starting the NEXT bar. Returns status CLOSED/OPEN/PENDING/SKIPPED.
    """
    horizon = horizon or config.HORIZON
    n = len(O)
    if i + 1 >= n:
        return {"status": "PENDING"}
    entry = O[i + 1] if entry is None else entry
    if entry > C[i] * (1 + config.MAX_GAP_CHASE):
        return {"status": "SKIPPED", "entry": entry}
    stop = entry * (1 - sp); t1 = entry * (1 + t1_r * sp); t2 = entry * (1 + t2_r * sp)
    last = min(i + horizon, n - 1)
    booked = False; r1 = 0.0; hi = entry; ex = None; code = EXIT_TIME; days = 0
    for j in range(i + 1, last + 1):
        days = j - i
        if O[j] <= stop:
            ex, code = O[j], (EXIT_GAPSTOP if not booked else EXIT_STOP); break
        if L[j] <= stop:
            ex, code = stop, EXIT_STOP; break
        if not booked:
            if O[j] >= t1 or H[j] >= t1:
                booked = True; r1 = max(O[j], t1) / entry - 1
                stop = max(stop, entry); hi = H[j]
                if O[j] >= t2 or H[j] >= t2:
                    ex, code = max(O[j], t2), EXIT_TARGET; break
            continue
        hi = max(hi, H[j])
        if trail_atr:
            stop = max(stop, hi - trail_atr * atr_pct * entry)
        if O[j] >= t2 or H[j] >= t2:
            ex, code = max(O[j], t2), EXIT_TARGET; break
    closed = ex is not None or (last - i >= horizon)
    if ex is None and closed:
        ex, code = C[last], EXIT_TIME
    mark = ex if ex is not None else C[last]
    r2 = mark / entry - 1
    gross = (book_frac * r1 + (1 - book_frac) * r2) if booked else r2
    return {"status": "CLOSED" if closed else "OPEN", "entry": entry, "exit_px": ex, "exit_reason": code,
            "gross": gross, "net": gross - config.ROUND_TRIP_COST, "days": days, "booked": booked,
            "stop_now": stop, "last_close": C[last], "t1": t1, "t2": t2}


def simulate_managed(cand: pd.DataFrame, bars: pd.DataFrame, t1_r: float = 1.5, t2_r: float = 3.0,
                     trail_atr: float | None = None, horizon: int | None = None,
                     book_frac: float = 0.5) -> pd.DataFrame:
    """Backtest of the managed trade plan (see manage_trade). Adds net_ret, hold_days, exit_reason, filled."""
    horizon = horizon or config.HORIZON
    px = {s: (d["date"].to_numpy(), d["open"].to_numpy(), d["high"].to_numpy(), d["low"].to_numpy(),
              d["close"].to_numpy()) for s, d in bars.groupby("symbol", sort=False)}
    idx_l, rows = [], []
    for s, grp in cand.groupby("symbol", sort=False):
        dates, O, H, L, C = px[s]
        pos = np.searchsorted(dates, grp["date"].to_numpy())
        atrp = grp["atr_pct"].to_numpy()
        for k in range(len(grp)):
            sp = float(np.clip(config.STOP_ATR_MULT * atrp[k], config.STOP_MIN, config.STOP_MAX))
            r = manage_trade(O, H, L, C, pos[k], sp, atrp[k], None, t1_r, t2_r, trail_atr, horizon, book_frac)
            idx_l.append(grp.index[k])
            if r["status"] == "CLOSED":
                rows.append([r["entry"], sp, r["exit_reason"], r["net"], r["days"], 1])
            else:
                rows.append([np.nan, sp, np.nan, np.nan, np.nan, 0])
    out = pd.DataFrame(rows, columns=["entry", "stop_pct", "exit_reason", "net_ret", "hold_days", "filled"], index=idx_l)
    lab = cand.join(out)
    lab["r_mult"] = lab["net_ret"] / lab["stop_pct"]
    lab["win"] = (lab["net_ret"] > 0).astype(float).where(lab["filled"] == 1)
    return lab
