/**
 * Chart technicals computed from split-adjusted daily bars (oldest first):
 *  - MACD (12, 26, 9) and RSI (14, Wilder)
 *  - swing highs / lows (fractal pivots, K bars each side) labelled HH / HL / LH / LL
 *  - market structure: BOS (break of structure, continuation) and CHoCH (change of character, reversal)
 *    on a CLOSE beyond the last confirmed swing level
 *  - Fibonacci retracement / extension of the latest major leg
 *  - fair value gaps (3-candle imbalances) that price has not yet filled
 *  - long and short trade plans at a fixed 1 : 3 risk-to-reward
 * Display/analysis only: none of these are model inputs unless the walk-forward test says so (docs/BACKTEST.md).
 */

export interface TBar { date: string; open: number; high: number; low: number; close: number }

export interface Swing { i: number; date: string; price: number; kind: 'H' | 'L'; label: 'HH' | 'LH' | 'HL' | 'LL' | null }
export interface StructureEvent { i: number; date: string; type: 'BOS' | 'CHoCH'; dir: 'up' | 'down'; level: number; swingDate: string }
export interface Fvg { i: number; date: string; dir: 'bull' | 'bear'; top: number; bottom: number; sizePct: number; touched: boolean }
export interface FibLevel { ratio: number; price: number; kind: 'retracement' | 'extension' }
export interface TradePlan { side: 'long' | 'short'; entry: number; stop: number; riskPct: number; target: number; targetPct: number; rr: number; stopBasis: string }

export interface Technicals {
  asOf: string
  series: { date: string; macd: number; signal: number; hist: number; rsi: number | null }[]
  macd: { macd: number; signal: number; hist: number; state: 'bullish' | 'bearish'; lastCross: { date: string; dir: 'up' | 'down'; sessionsAgo: number } | null; histRising: boolean }
  rsi: number | null
  swings: Swing[]
  structure: { trend: 'bullish' | 'bearish' | 'neutral'; events: StructureEvent[]; last: StructureEvent | null; lastSwingHigh: Swing | null; lastSwingLow: Swing | null }
  fib: { dir: 'up' | 'down'; from: { date: string; price: number }; to: { date: string; price: number }; levels: FibLevel[]; zone: string } | null
  fvgs: Fvg[]
  plans: { long: TradePlan; short: TradePlan }
  atrPct: number
  signals: string[]
}

export const SWING_K = 3;       // a swing high needs K lower highs on each side (confirmed K sessions later)
const FIB_LOOKBACK = 120;       // ~6 months: the major leg is the high/low range of this window
const FVG_MIN = 0.003;          // ignore gaps smaller than 0.3% of price
const FVG_LOOKBACK = 60;
const RET = [0.236, 0.382, 0.5, 0.618, 0.786];
const EXT = [1.272, 1.618, 2.0];

const r2 = (x: number) => Math.round(x * 100) / 100;

export function emaSeries(v: number[], span: number): number[] {
  const a = 2 / (span + 1);
  const out: number[] = [];
  v.forEach((x, i) => out.push(i === 0 ? x : x * a + out[i - 1] * (1 - a)));
  return out;
}

export function rsiSeries(close: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let au = 0, ad = 0;
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    const u = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i === 1) { au = u; ad = dn; } else { au = au + (u - au) / n; ad = ad + (dn - ad) / n; }
    out.push(i < n ? null : ad === 0 ? 100 : 100 - 100 / (1 + au / ad));
  }
  return out;
}

function atr(b: TBar[], n = 14): number {
  let a = 0;
  for (let i = 1; i < b.length; i++) {
    const pc = b[i - 1].close;
    const tr = Math.max(b[i].high - b[i].low, Math.abs(b[i].high - pc), Math.abs(b[i].low - pc));
    a = i === 1 ? tr : a + (tr - a) / n;
  }
  return a;
}

/** Fractal pivots, labelled against the previous pivot of the same kind. Only pivots with K bars on the right exist (no look-ahead). */
export function findSwings(b: TBar[], k = SWING_K): Swing[] {
  const out: Swing[] = [];
  for (let i = k; i < b.length - k; i++) {
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (j < i ? b[j].high >= b[i].high : b[j].high > b[i].high) isH = false;
      if (j < i ? b[j].low <= b[i].low : b[j].low < b[i].low) isL = false;
    }
    if (isH) out.push({ i, date: b[i].date, price: b[i].high, kind: 'H', label: null });
    if (isL) out.push({ i, date: b[i].date, price: b[i].low, kind: 'L', label: null });
  }
  let lastH: Swing | null = null, lastL: Swing | null = null;
  for (const s of out) {
    if (s.kind === 'H') { if (lastH) s.label = s.price > lastH.price ? 'HH' : 'LH'; lastH = s; }
    else { if (lastL) s.label = s.price > lastL.price ? 'HL' : 'LL'; lastL = s; }
  }
  return out;
}

/**
 * Walk forward bar by bar. A swing becomes usable K bars after it formed. A close above the last unbroken swing high
 * is a break up: CHoCH if the running trend was down (reversal), otherwise BOS (continuation). Mirror for breaks down.
 */
export function marketStructure(b: TBar[], swings: Swing[], k = SWING_K) {
  const events: StructureEvent[] = [];
  let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let hi: Swing | null = null, lo: Swing | null = null;
  let si = 0;
  for (let i = 0; i < b.length; i++) {
    while (si < swings.length && swings[si].i + k <= i) {
      const s = swings[si++];
      if (s.kind === 'H') hi = s; else lo = s;
    }
    if (hi && b[i].close > hi.price) {
      events.push({ i, date: b[i].date, type: trend === 'bearish' ? 'CHoCH' : 'BOS', dir: 'up', level: hi.price, swingDate: hi.date });
      trend = 'bullish';
      hi = null;
    } else if (lo && b[i].close < lo.price) {
      events.push({ i, date: b[i].date, type: trend === 'bullish' ? 'CHoCH' : 'BOS', dir: 'down', level: lo.price, swingDate: lo.date });
      trend = 'bearish';
      lo = null;
    }
  }
  return { trend, events };
}

export function fibonacci(b: TBar[], lookback = FIB_LOOKBACK): Technicals['fib'] {
  const w = b.slice(-lookback);
  if (w.length < 20) return null;
  let hi = 0, lo = 0;
  w.forEach((x, i) => { if (x.high > w[hi].high) hi = i; if (x.low < w[lo].low) lo = i; });
  const H = w[hi].high, L = w[lo].low, span = H - L;
  if (!(span > 0)) return null;
  const up = lo < hi;                     // low came first: up-leg, retrace down from the high
  const levels: FibLevel[] = [
    ...RET.map((r) => ({ ratio: r, price: r2(up ? H - r * span : L + r * span), kind: 'retracement' as const })),
    ...EXT.map((e) => ({ ratio: e, price: r2(up ? L + e * span : H - e * span), kind: 'extension' as const })),
  ].filter((l) => l.price > 0);
  const c = b.at(-1)!.close;
  const ret = up ? (H - c) / span : (c - L) / span;   // how much of the leg has been given back
  let zone: string;
  if (ret <= 0) zone = up ? 'above the swing high (extension territory)' : 'below the swing low (extension territory)';
  else if (ret < 0.236) zone = 'shallow pullback (< 23.6%)';
  else if (ret < 0.382) zone = 'between 23.6% and 38.2%';
  else if (ret < 0.5) zone = 'between 38.2% and 50%';
  else if (ret <= 0.618) zone = 'golden zone (50% – 61.8%)';
  else if (ret <= 0.786) zone = 'deep pullback (61.8% – 78.6%)';
  else if (ret < 1) zone = 'beyond 78.6%: leg nearly erased';
  else zone = 'leg fully erased';
  return {
    dir: up ? 'up' : 'down',
    from: { date: (up ? w[lo] : w[hi]).date, price: r2(up ? L : H) },
    to: { date: (up ? w[hi] : w[lo]).date, price: r2(up ? H : L) },
    levels,
    zone: `${zone} · ${(ret * 100).toFixed(0)}% retraced`,
  };
}

/** 3-candle imbalances: bull when low[i] > high[i-2], bear when high[i] < low[i-2]. Kept while not fully filled by a later close. */
export function fairValueGaps(b: TBar[], lookback = FVG_LOOKBACK): Fvg[] {
  const out: Fvg[] = [];
  const start = Math.max(2, b.length - lookback);
  for (let i = start; i < b.length; i++) {
    const a = b[i - 2], c = b[i];
    let g: Fvg | null = null;
    if (c.low > a.high) g = { i, date: b[i - 1].date, dir: 'bull', bottom: a.high, top: c.low, sizePct: 0, touched: false };
    else if (c.high < a.low) g = { i, date: b[i - 1].date, dir: 'bear', bottom: c.high, top: a.low, sizePct: 0, touched: false };
    if (!g) continue;
    g.sizePct = r2(((g.top - g.bottom) / b[i].close) * 100);
    if (g.sizePct < FVG_MIN * 100) continue;
    let filled = false;
    for (let j = i + 1; j < b.length && !filled; j++) {
      if (g.dir === 'bull') { if (b[j].low <= g.top) g.touched = true; if (b[j].close < g.bottom) filled = true; }
      else { if (b[j].high >= g.bottom) g.touched = true; if (b[j].close > g.top) filled = true; }
    }
    if (!filled) out.push({ ...g, top: r2(g.top), bottom: r2(g.bottom) });
  }
  return out;
}

/** Same stop rule as the live picks (1.5 × ATR, clamped to 3–6%), with one target at 3R. */
export function tradePlans(close: number, atrAbs: number, swingLow: number | null, swingHigh: number | null, rr = 3) {
  const riskPct = Math.min(0.06, Math.max(0.03, (1.5 * atrAbs) / close));
  const mk = (side: 'long' | 'short'): TradePlan => {
    const s = side === 'long' ? 1 : -1;
    const stop = close * (1 - s * riskPct);
    const struct = side === 'long' ? swingLow : swingHigh;
    const near = struct != null && Math.abs(struct / stop - 1) < 0.015;
    return {
      side, entry: r2(close), stop: r2(stop), riskPct: r2(riskPct * 100), target: r2(close * (1 + s * rr * riskPct)), targetPct: r2(rr * riskPct * 100), rr,
      stopBasis: `1.5 × ATR (clamped 3–6%)${near ? `, close to the last swing ${side === 'long' ? 'low' : 'high'} ₹${r2(struct!)}` : ''}`,
    };
  };
  return { long: mk('long'), short: mk('short') };
}

export function technicals(bars: TBar[]): Technicals | null {
  if (bars.length < 35) return null;
  const close = bars.map((b) => b.close);
  const e12 = emaSeries(close, 12), e26 = emaSeries(close, 26);
  const macd = close.map((_, i) => e12[i] - e26[i]);
  const sig = emaSeries(macd, 9);
  const rsi = rsiSeries(close);
  const n = bars.length;
  const series = bars.map((b, i) => ({ date: b.date, macd: r2(macd[i]), signal: r2(sig[i]), hist: r2(macd[i] - sig[i]), rsi: rsi[i] == null ? null : Math.round(rsi[i]! * 10) / 10 }));

  let lastCross: Technicals['macd']['lastCross'] = null;
  for (let i = n - 1; i > 26 && !lastCross; i--) {
    const d0 = macd[i] - sig[i], d1 = macd[i - 1] - sig[i - 1];
    if (d0 > 0 && d1 <= 0) lastCross = { date: bars[i].date, dir: 'up', sessionsAgo: n - 1 - i };
    if (d0 < 0 && d1 >= 0) lastCross = { date: bars[i].date, dir: 'down', sessionsAgo: n - 1 - i };
  }
  const h0 = macd[n - 1] - sig[n - 1], h1 = macd[n - 2] - sig[n - 2];

  const swings = findSwings(bars);
  const ms = marketStructure(bars, swings);
  const lastH = [...swings].reverse().find((s) => s.kind === 'H') ?? null;
  const lastL = [...swings].reverse().find((s) => s.kind === 'L') ?? null;
  const fib = fibonacci(bars);
  const fvgs = fairValueGaps(bars);
  const a = atr(bars);
  const c = close[n - 1];

  const signals: string[] = [];
  if (lastCross && lastCross.sessionsAgo <= 5) signals.push(`MACD ${lastCross.dir === 'up' ? 'bullish' : 'bearish'} crossover ${lastCross.sessionsAgo === 0 ? 'today' : `${lastCross.sessionsAgo} sessions ago`}`);
  const last = ms.events.at(-1) ?? null;
  if (last && n - 1 - last.i <= 10) signals.push(`${last.dir === 'up' ? 'Bullish' : 'Bearish'} ${last.type} on ${last.date} (close beyond ₹${r2(last.level)})`);
  if (fib && /golden/.test(fib.zone)) signals.push(`Price in the Fibonacci golden zone of the ${fib.dir}-leg`);
  const inFvg = fvgs.find((g) => c >= g.bottom && c <= g.top);
  if (inFvg) signals.push(`Price inside a ${inFvg.dir === 'bull' ? 'bullish' : 'bearish'} fair value gap (₹${inFvg.bottom}–${inFvg.top})`);

  return {
    asOf: bars[n - 1].date,
    series,
    macd: { macd: r2(macd[n - 1]), signal: r2(sig[n - 1]), hist: r2(h0), state: h0 >= 0 ? 'bullish' : 'bearish', lastCross, histRising: h0 > h1 },
    rsi: series[n - 1].rsi,
    swings: swings.slice(-12),
    structure: { trend: ms.trend, events: ms.events.slice(-8), last, lastSwingHigh: lastH, lastSwingLow: lastL },
    fib,
    fvgs: fvgs.slice(-6),
    plans: tradePlans(c, a, lastL?.price ?? null, lastH?.price ?? null),
    atrPct: r2((a / c) * 100),
    signals,
  };
}
