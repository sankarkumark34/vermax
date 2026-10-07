from __future__ import annotations
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.environ.get("VERMAX_DB", ROOT / "data" / "market.sqlite"))
OUT_DIR = Path(os.environ.get("VERMAX_OUT", ROOT / "data" / "research"))
MODEL_DIR = Path(os.environ.get("VERMAX_MODELS", ROOT / "data" / "models"))
OUT_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# --- universe filters (point-in-time, evaluated per row) -------------------------
MIN_PRICE = 50.0
MIN_TURNOVER20_CR = 5.0          # 20-day average traded value, INR crore
MIN_HISTORY_BARS = 220
MIN_LIST_MONTHS = 3               # every list shown in the app: the stock must have traded on NSE for >= 3 calendar months

# --- trade construction ------------------------------------------------------------
HORIZON = 10                      # max holding period (trading days)
RR = 2.0                          # target = RR x stop distance
STOP_ATR_MULT = 1.5
STOP_MIN, STOP_MAX = 0.03, 0.06   # stop distance clamp (fraction of entry)
MAX_GAP_CHASE = 0.025             # skip if next open > signal close by this much
ROUND_TRIP_COST = 0.0040          # brokerage+STT+charges+slippage, round trip

# --- portfolio sim -------------------------------------------------------------------
RISK_PER_TRADE = 0.005             # 0.5% of capital at risk per trade (drawdown roughly halves vs 1%)
MAX_POSITION = 0.20
MAX_OPEN = 5
