/**
 * Step 17: technical entry timing (proposal 6.5). Pure functions over split-adjusted OHLCV bars, oldest first.
 *
 *   technicalReady = trendOk && atLevel && triggerConfirmed && !extended && rewardRisk >= minRewardRisk
 *
 * Fibonacci is never a level on its own: the golden zone only counts when it coincides with a support zone or the
 * 50-day EMA (confluence), and the candle trigger with volume is always required on top.
 */
import { emaSeries, fairValueGaps, fibonacci, findSwings, rsiSeries, type Swing } from '../../analysis/technicals.js';
import type { SelectionConfig } from './config.js';
import type { IndexPoint, PriceBar } from './types.js';

export interface Zone { low: number; high: number; touches: number; kind: 'support' | 'resistance' }
export interface CandlePattern { date: string; name: string; bullish: boolean; volumeRatio: number }

export interface TradePlan { entry: number; stop: number; target: number; rewardRisk: number; riskPct: number; stopBasis: string; targetBasis: string }

export interface TechnicalEntry {
  asOf: string;
  close: number;
  ema20: number; ema50: number; ema200: number | null;
  sma20: number; sma50: number; sma200: number | null;
  rsi14: number | null;
  macd: { macd: number; signal: number; hist: number };
  atr14: number; atrPct: number;
  avgVolume20: number; lastVolume: number;
  trend: 'uptrend' | 'downtrend' | 'sideways';
  structure: { lastHigh: Swing['label']; lastLow: Swing['label'] };
  support: Zone | null;
  resistance: Zone | null;
  zones: Zone[];
  patterns: CandlePattern[];
  breakout: { level: number; date: string; retested: boolean } | null;
  fib: ReturnType<typeof fibonacci>;
  inFibGolden: boolean;
  inBullFvg: { top: number; bottom: number } | null;
  rs: { m3: number | null; m6: number | null };
  extendedPct: number;
  checks: { trendOk: boolean; atLevel: boolean; triggerConfirmed: boolean; extended: boolean; rewardRisk: number; rrOk: boolean };
  levelReasons: string[];
  technicalReady: boolean;
  plan: TradePlan;
  watch: { alertPrice: number; zone: string } | null;
  reasons: string[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function smaAt(v: number[], n: number): number | null {
  if (v.length < n) return null;
  let s = 0;
  for (let i = v.length - n; i < v.length; i++) s += v[i];
  return s / n;
}

export function atrSeries(b: PriceBar[], n = 14): number[] {
  const out: number[] = [];
  let a = 0;
  for (let i = 0; i < b.length; i++) {
    const tr = i === 0 ? b[i].high - b[i].low : Math.max(b[i].high - b[i].low, Math.abs(b[i].high - b[i - 1].close), Math.abs(b[i].low - b[i - 1].close));
    a = i === 0 ? tr : a + (tr - a) / n;
    out.push(a);
  }
  return out;
}

/** Candlestick patterns on the last `lookback` bars (proposal: hammer, engulfing, doji, morning and evening star). */
export function candlePatterns(b: PriceBar[], lookback = 3): CandlePattern[] {
  const out: CandlePattern[] = [];
  const vol20 = (i: number) => {
    const w = b.slice(Math.max(0, i - 20), i);
    return w.length ? w.reduce((s, x) => s + x.volume, 0) / w.length : b[i].volume;
  };
  for (let i = Math.max(2, b.length - lookback); i < b.length; i++) {
    const c = b[i], p = b[i - 1], pp = b[i - 2];
    const body = Math.abs(c.close - c.open), range = c.high - c.low || 1e-9;
    const upper = c.high - Math.max(c.open, c.close), lower = Math.min(c.open, c.close) - c.low;
    const fell = i >= 5 && b[i - 1].close < b[i - 5].close;
    const rose = i >= 5 && b[i - 1].close > b[i - 5].close;
    const vr = r2(c.volume / (vol20(i) || 1));
    const add = (name: string, bullish: boolean) => out.push({ date: c.date, name, bullish, volumeRatio: vr });
    if (body <= 0.1 * range) add('Doji', false);
    if (fell && lower >= 2 * body && upper <= 0.3 * range && body > 0) add('Hammer', true);
    if (p.close < p.open && c.close > c.open && c.open <= p.close && c.close >= p.open && body > Math.abs(p.close - p.open)) add('Bullish engulfing', true);
    if (p.close > p.open && c.close < c.open && c.open >= p.close && c.close <= p.open && body > Math.abs(p.close - p.open)) add('Bearish engulfing', false);
    const ppBody = Math.abs(pp.close - pp.open), pBody = Math.abs(p.close - p.open);
    if (pp.close < pp.open && pBody <= 0.35 * ppBody && c.close > c.open && c.close >= (pp.open + pp.close) / 2 && fell) add('Morning star', true);
    if (pp.close > pp.open && pBody <= 0.35 * ppBody && c.close < c.open && c.close <= (pp.open + pp.close) / 2 && rose) add('Evening star', false);
  }
  return out;
}

/** Clusters swing highs and lows within `tol` into support / resistance zones relative to the latest close. */
export function levelZones(swings: Swing[], close: number, tol: number): Zone[] {
  const prices = swings.map((s) => s.price).sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const p of prices) {
    const last = clusters.at(-1);
    if (last && p - last[last.length - 1] <= tol) last.push(p);
    else clusters.push([p]);
  }
  return clusters.map((c) => {
    const low = Math.min(...c), high = Math.max(...c);
    const pad = c.length === 1 ? tol / 2 : 0;
    const z = { low: r2(low - pad), high: r2(high + pad), touches: c.length };
    return { ...z, kind: (z.low > close ? 'resistance' : 'support') as Zone['kind'] };
  });
}

function relStrength(b: PriceBar[], idx: IndexPoint[], n: number): number | null {
  if (b.length <= n || !idx.length) return null;
  const from = b[b.length - 1 - n];
  const i0 = idx.findIndex((p) => p.date >= from.date);
  if (i0 < 0) return null;
  const sr = b[b.length - 1].close / from.close - 1;
  const ir = idx[idx.length - 1].close / idx[i0].close - 1;
  return r2((sr - ir) * 100);
}

export function technicalEntry(b: PriceBar[], benchmark: IndexPoint[], cfg: SelectionConfig['technical']): TechnicalEntry | null {
  if (b.length < 60) return null;
  const close = b.map((x) => x.close);
  const n = b.length;
  const c = close[n - 1];
  const e20 = emaSeries(close, 20), e50 = emaSeries(close, 50), e200 = emaSeries(close, 200);
  const e12 = emaSeries(close, 12), e26 = emaSeries(close, 26);
  const macdLine = close.map((_, i) => e12[i] - e26[i]);
  const sig = emaSeries(macdLine, 9);
  const rsi = rsiSeries(close).at(-1) ?? null;
  const atr = atrSeries(b).at(-1)!;
  const avgVol = b.slice(-21, -1).reduce((s, x) => s + x.volume, 0) / Math.min(20, n - 1);
  const ema200 = n >= 200 ? e200[n - 1] : null;

  const recent = b.slice(-250);
  const offset = n - recent.length;
  const swings = findSwings(recent).map((s) => ({ ...s, i: s.i + offset }));
  const lastH = [...swings].reverse().find((s) => s.kind === 'H');
  const lastL = [...swings].reverse().find((s) => s.kind === 'L');
  const tol = Math.max(cfg.zoneAtrMultiple * atr, c * 0.01);
  const zones = levelZones(swings, c, tol);
  const supports = zones.filter((z) => z.kind === 'support').sort((a, z) => z.high - a.high);
  const resistances = zones.filter((z) => z.kind === 'resistance' && z.low > c * 1.01).sort((a, z) => a.low - z.low);
  const support = supports[0] ?? null;
  const resistance = resistances[0] ?? null;

  // ---- trend ---------------------------------------------------------------------------------
  const structOk = lastH?.label === 'HH' && lastL?.label === 'HL';
  const structBad = lastH?.label === 'LH' && lastL?.label === 'LL';
  // close above the 200-day EMA (50-day when history is shorter) and HH/HL swings; without a clear swing sequence,
  // a rising stack (EMA50 above EMA200) is accepted as long as the swings are not LH/LL.
  const aboveLong = ema200 != null ? c > ema200 : c > e50[n - 1];
  const stacked = ema200 == null || e50[n - 1] > ema200;
  const trendOk = aboveLong && (structOk || (!structBad && stacked));
  const trend: TechnicalEntry['trend'] = trendOk ? 'uptrend' : structBad || (ema200 != null && c < ema200) ? 'downtrend' : 'sideways';

  // ---- levels --------------------------------------------------------------------------------
  const low3 = Math.min(...b.slice(-3).map((x) => x.low));
  const levelReasons: string[] = [];
  const inSupport = !!support && low3 <= support.high + tol * 0.5 && c >= support.low - tol * 0.5;
  if (inSupport) levelReasons.push(`tested support zone ₹${support!.low}-${support!.high} (${support!.touches} touches)`);
  const ema50 = e50[n - 1];
  const nearEma50 = low3 <= ema50 * 1.01 && c >= ema50 * 0.98;
  if (nearEma50) levelReasons.push(`pulled back to the 50-day EMA ₹${r2(ema50)}`);
  const fvg = fairValueGaps(b).filter((g) => g.dir === 'bull').find((g) => low3 <= g.top && c >= g.bottom) ?? null;
  if (fvg) levelReasons.push(`inside an unfilled bullish fair value gap ₹${fvg.bottom}-${fvg.top}`);
  const fib = fibonacci(b);
  const inFibGolden = !!fib && fib.dir === 'up' && /golden/.test(fib.zone);
  if (inFibGolden && (inSupport || nearEma50)) levelReasons.push('Fibonacci 50-61.8% zone in confluence with support');

  // breakout above a resistance zone within the last 20 sessions, then a retest that held
  let breakout: TechnicalEntry['breakout'] = null;
  const older = swings.filter((s) => s.kind === 'H' && s.i < n - 20);
  for (const s of older.slice(-6).reverse()) {
    for (let j = Math.max(1, n - 20); j < n; j++) {
      if (close[j] > s.price && close[j - 1] <= s.price) {
        const after = b.slice(j + 1);
        const retested = after.length > 0 && Math.min(...after.map((x) => x.low)) <= s.price + tol && c > s.price - tol * 0.5;
        breakout = { level: r2(s.price), date: b[j].date, retested };
        break;
      }
    }
    if (breakout) break;
  }
  if (breakout?.retested) levelReasons.push(`retest of the breakout level ₹${breakout.level} held`);
  const atLevel = inSupport || nearEma50 || !!fvg || !!breakout?.retested;

  // ---- trigger -------------------------------------------------------------------------------
  const patterns = candlePatterns(b, 3);
  const trig = patterns.filter((p) => p.bullish && p.date >= b[n - 2].date && p.volumeRatio >= cfg.volumeMultiple);
  const triggerConfirmed = trig.length > 0;

  const extendedPct = r2((c / ema50 - 1) * 100);
  const extended = extendedPct > cfg.extendedAboveEma50Pct;

  // ---- plan: stop from structure, target at the next resistance ------------------------------
  const swingLowBelow = [...swings].reverse().find((s) => s.kind === 'L' && s.price < c * 0.995);
  const candidates = [
    swingLowBelow ? { level: swingLowBelow.price, basis: `below the swing low ₹${r2(swingLowBelow.price)} (${swingLowBelow.date})` } : null,
    support && support.low < c ? { level: support.low, basis: `below the support zone ₹${support.low}-${support.high}` } : null,
  ].filter(Boolean) as { level: number; basis: string }[];
  const best = candidates.sort((a, z) => z.level - a.level)[0];
  let stop = best ? best.level - 0.25 * atr : c - 2 * atr;
  let stopBasis = best ? `${best.basis} minus 0.25 × ATR` : '2 × ATR below the close (no structure nearby)';
  if ((c - stop) / c > 0.15 || stop >= c) {
    stop = c - 2 * atr;
    stopBasis = '2 × ATR below the close (structure too far away)';
  }
  let target: number, targetBasis: string;
  if (resistance) {
    target = resistance.low;
    targetBasis = `next resistance zone ₹${resistance.low}-${resistance.high}`;
  } else {
    const ext = fib?.dir === 'up' ? fib.levels.find((l) => l.kind === 'extension' && l.price > c * 1.02) : null;
    target = ext ? ext.price : c + 3 * (c - stop);
    targetBasis = ext ? `Fibonacci ${ext.ratio} extension (no resistance overhead)` : '3R (price at highs, no resistance overhead)';
  }
  const rewardRisk = r2((target - c) / (c - stop));
  const rrOk = rewardRisk >= cfg.minRewardRisk;

  const technicalReady = trendOk && atLevel && triggerConfirmed && !extended && rrOk;
  const reasons: string[] = [];
  if (!trendOk) reasons.push(ema200 != null && c <= ema200 ? 'price is below the 200-day EMA' : 'no higher-high / higher-low structure');
  if (!atLevel) reasons.push('price is not at a support, EMA50, fair value gap or breakout-retest level');
  if (!triggerConfirmed) reasons.push(`no bullish candle trigger with volume ≥ ${cfg.volumeMultiple}× the 20-day average`);
  if (extended) reasons.push(`price is ${extendedPct}% above the 50-day EMA (limit ${cfg.extendedAboveEma50Pct}%)`);
  if (!rrOk) reasons.push(`reward : risk is 1 : ${rewardRisk} (needs 1 : ${cfg.minRewardRisk})`);

  // ---- watch level for WAIT verdicts: the closest pullback level below the price ------------
  const pull: { price: number; zone: string }[] = [];
  if (support && support.high < c) pull.push({ price: support.high, zone: `support zone ₹${support.low}-${support.high}` });
  if (ema50 < c) pull.push({ price: r2(ema50), zone: 'EMA50' });
  const g50 = fib?.dir === 'up' ? fib.levels.find((l) => l.ratio === 0.5) : null;
  const g618 = fib?.dir === 'up' ? fib.levels.find((l) => l.ratio === 0.618) : null;
  if (g50 && g50.price < c) pull.push({ price: g50.price, zone: `Fib 50-61.8% (₹${g618?.price ?? '?'}-${g50.price})` });
  pull.sort((a, z) => z.price - a.price);
  const confluent = pull.length > 1 && Math.abs(pull[0].price / pull[1].price - 1) < 0.03;
  const watch = technicalReady || !pull.length ? null : { alertPrice: pull[0].price, zone: confluent ? `${pull[0].zone} + ${pull[1].zone}` : pull[0].zone };

  return {
    asOf: b[n - 1].date,
    close: c,
    ema20: r2(e20[n - 1]), ema50: r2(ema50), ema200: ema200 == null ? null : r2(ema200),
    sma20: r2(smaAt(close, 20)!), sma50: r2(smaAt(close, 50)!), sma200: smaAt(close, 200) == null ? null : r2(smaAt(close, 200)!),
    rsi14: rsi == null ? null : r2(rsi),
    macd: { macd: r2(macdLine[n - 1]), signal: r2(sig[n - 1]), hist: r2(macdLine[n - 1] - sig[n - 1]) },
    atr14: r2(atr), atrPct: r2((atr / c) * 100),
    avgVolume20: Math.round(avgVol), lastVolume: b[n - 1].volume,
    trend,
    structure: { lastHigh: lastH?.label ?? null, lastLow: lastL?.label ?? null },
    support, resistance, zones: zones.slice(-12),
    patterns,
    breakout,
    fib, inFibGolden,
    inBullFvg: fvg ? { top: fvg.top, bottom: fvg.bottom } : null,
    rs: { m3: relStrength(b, benchmark, 63), m6: relStrength(b, benchmark, 126) },
    extendedPct,
    checks: { trendOk, atLevel, triggerConfirmed, extended, rewardRisk, rrOk },
    levelReasons,
    technicalReady,
    plan: { entry: r2(c), stop: r2(stop), target: r2(target), rewardRisk, riskPct: r2(((c - stop) / c) * 100), stopBasis, targetBasis },
    watch,
    reasons,
  };
}
