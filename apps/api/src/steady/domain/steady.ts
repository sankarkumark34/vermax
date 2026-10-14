/**
 * Steady screen (pure): which stocks never fell below where they started, closed every recent month and quarter higher,
 * and are not overbought. Works for every stock:
 *   reference price = the listing-day open for a stock that listed inside the window (and inside our data),
 *                     otherwise the open of the first session of the window (6 or 12 calendar months back).
 * A month / quarter is "up" when its last close beats the previous period's last close (the first period of a new listing
 * is compared with the listing-day open). The current unfinished period is not counted.
 */
import { rsiSeries } from '../../analysis/technicals.js';
import { completedPeriods, type Bar } from '../../winners/domain/periods.js';

export interface RefWindow {
  months: number;
  ref: number;                    // reference price
  refDate: string;
  fromListing: boolean;           // true when the reference is the listing-day open
  minClosePct: number;            // lowest close since the reference, vs the reference (%)
  minLowPct: number;              // lowest intraday low (%)
  sessionsBelow: number;          // closes below the reference
  lastBelow: string | null;
}
export interface PeriodRet { period: string; ret: number }   // ret in %
export interface SteadyFacts {
  asOf: string;
  firstDate: string;
  listedInData: boolean;
  sessionsSinceFirst: number;
  close: number;
  chg1: number | null;
  rsi: number | null;
  fromHigh: number;
  windows: Record<'6' | '12', RefWindow>;
  months: PeriodRet[];            // last 12 completed, oldest first
  quarters: PeriodRet[];          // last 4 completed, oldest first
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const addMonths = (iso: string, m: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };

export function refWindow(b: Bar[], months: number, firstEver: string, listedInData: boolean): RefWindow | null {
  const last = b.length - 1;
  const cut = addMonths(b[last].date, -months);
  const listedInside = listedInData && firstEver > cut;
  let i0 = b.findIndex((x) => x.date >= (listedInside ? firstEver : cut));
  if (i0 < 0 || i0 >= last) return null;
  const ref = b[i0].open;
  if (!(ref > 0)) return null;
  let minC = Infinity, minL = Infinity, below = 0, lastBelow: string | null = null;
  for (let k = i0; k <= last; k++) {
    minC = Math.min(minC, b[k].close);
    minL = Math.min(minL, b[k].low);
    if (b[k].close < ref) { below++; lastBelow = b[k].date; }
  }
  return { months, ref: r2(ref), refDate: b[i0].date, fromListing: listedInside, minClosePct: r1((minC / ref - 1) * 100), minLowPct: r1((minL / ref - 1) * 100), sessionsBelow: below, lastBelow };
}

function periodReturns(b: Bar[], kind: 'month' | 'quarter', today: string, n: number): PeriodRet[] {
  const done = completedPeriods(b, b.length - 1, kind, today, n);
  const out = done.map((p) => {
    let ret = p.ret;
    // a brand-new listing has no close before its first period: compare with the listing-day open
    if (ret == null && p.from === b[0].date) { const to = b.find((x) => x.date === p.to); if (to && b[0].open > 0) ret = to.close / b[0].open - 1; }
    return { period: p.label, ret: ret == null ? NaN : r1(ret * 100) };
  }).filter((x) => Number.isFinite(x.ret));
  return out.reverse();
}

export function steadyFacts(b: Bar[], firstEver: string, dataStart: string, today: string): SteadyFacts | null {
  if (b.length < 40) return null;
  const last = b.length - 1;
  const listedInData = Date.parse(firstEver) - Date.parse(dataStart) > 14 * 86_400_000;   // first bar clearly after our data begins
  const w6 = refWindow(b, 6, firstEver, listedInData), w12 = refWindow(b, 12, firstEver, listedInData);
  if (!w6 || !w12) return null;
  const rsi = rsiSeries(b.map((x) => x.close)).at(-1) ?? null;
  const hi = Math.max(...b.slice(-252).map((x) => x.high));
  const prev = b[last - 1]?.close;
  return {
    asOf: b[last].date, firstDate: firstEver, listedInData, sessionsSinceFirst: b.length, close: r2(b[last].close),
    chg1: prev ? r2((b[last].close / prev - 1) * 100) : null, rsi: rsi == null ? null : r1(rsi), fromHigh: r1((b[last].close / hi - 1) * 100),
    windows: { '6': w6, '12': w12 },
    months: periodReturns(b, 'month', today, 12), quarters: periodReturns(b, 'quarter', today, 4),
  };
}

/** Loose server-side filter that decides which stocks get the (slow) fundamental analysis; the UI applies the exact rules. */
export function isCandidate(f: SteadyFacts, slackPct = 5): boolean {
  const near = (w: RefWindow) => w.minClosePct >= -slackPct;
  return (near(f.windows['6']) || near(f.windows['12'])) && f.rsi != null && f.rsi >= 30 && f.rsi <= 75;
}

/** How many of the soft price rules a stock already satisfies (0-8): used to decide who gets the slow analysis first. */
export function steadyScore(f: SteadyFacts): number {
  const up = (l: PeriodRet[], n: number) => l.slice(-n).filter((x) => x.ret > 0).length;
  return (f.windows['12'].minClosePct >= 0 ? 1 : 0) + (f.windows['6'].minClosePct >= 0 ? 1 : 0) + up(f.months, 3) + up(f.quarters, 2) + (f.rsi != null && f.rsi >= 40 && f.rsi <= 70 ? 1 : 0);
}
