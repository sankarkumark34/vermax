/**
 * Periodic performance screen: did the stock close positive in its last completed week, month, quarter and financial
 * year, has it gained for at least N months in a row, and does it shrug off dips quickly instead of suffering a major fall?
 *
 * Pure functions over split-adjusted daily bars (oldest first). `end` lets the backtest evaluate any past date without
 * copying arrays; `today` decides which periods are complete (a period is complete once today is past its calendar end,
 * or its last weekday has a bar - so a Friday close completes the week the same evening).
 */

export interface Bar { date: string; open: number; high: number; low: number; close: number; turnover?: number | null }

export type PeriodKind = 'week' | 'month' | 'quarter' | 'fy';

export interface PeriodResult {
  kind: PeriodKind;
  label: string;          // e.g. "W/e 03 Oct", "Sep 2026", "Q2 FY27 (Jul-Sep)", "FY26"
  from: string;           // previous period's last close date
  to: string;             // this period's last close date
  ret: number | null;     // fraction; null when there is no close before the period
  ok: boolean;
}

export interface Dip { peakDate: string; troughDate: string; depthPct: number; recoveredOn: string | null; sessionsToRecover: number | null }

export interface Resilience {
  maxDrawdown3mPct: number;
  currentDrawdownPct: number;     // from the 3-month high
  worstWeekPct: number | null;
  dips: Dip[];                    // dips deeper than the threshold in the last 6 months
  ok: boolean;
  reasons: string[];
}

export interface WinnerCriteria {
  minMonthStreak: number;          // consecutive positive completed months
  maxDrawdown3mPct: number;        // e.g. 15: no fall deeper than 15% from a peak in the last 3 months
  maxCurrentDrawdownPct: number;   // e.g. 10: not more than 10% below the 3-month high today
  dipPct: number;                  // dips at least this deep must recover...
  maxRecoverySessions: number;     // ...to the prior high within this many sessions
  worstWeekPct: number;            // e.g. -10: no completed week worse than this in the last 13 weeks
  requireFy: boolean;
}

export interface ScreenResult {
  asOf: string;
  periods: Record<PeriodKind, PeriodResult | null>;
  fytd: { label: string; ret: number | null };
  monthStreak: number;
  weeksUp: { up: number; total: number };
  monthsUp: { up: number; total: number };
  ret1m: number | null; ret3m: number | null; ret6m: number | null; ret1y: number | null;
  resilience: Resilience;
  ticks: { week: boolean; month: boolean; quarter: boolean; fy: boolean; streak: boolean; resilient: boolean };
  pass: boolean;
  missing: string[];
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Calendar span [start, end] (inclusive, ISO dates) and a stable key / label of the period containing `date`. */
export function periodOf(date: string, kind: PeriodKind): { key: string; start: string; end: string; label: string } {
  const d = parse(date);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (kind === 'week') {
    const dow = (d.getUTCDay() + 6) % 7;                       // Monday = 0
    const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - dow);
    const fri = new Date(mon); fri.setUTCDate(mon.getUTCDate() + 4);
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    return { key: ymd(mon), start: ymd(mon), end: ymd(sun), label: `W/e ${String(fri.getUTCDate()).padStart(2, '0')} ${MON[fri.getUTCMonth()]}` };
  }
  if (kind === 'month') {
    return { key: `${y}-${String(m + 1).padStart(2, '0')}`, start: ymd(new Date(Date.UTC(y, m, 1))), end: ymd(new Date(Date.UTC(y, m + 1, 0))), label: `${MON[m]} ${y}` };
  }
  // Indian financial year: April-March. FY27 = Apr 2026 - Mar 2027; Q1 = Apr-Jun.
  const fyEnd = m >= 3 ? y + 1 : y;
  if (kind === 'fy') {
    return { key: `FY${fyEnd}`, start: `${fyEnd - 1}-04-01`, end: `${fyEnd}-03-31`, label: `FY${String(fyEnd).slice(2)} (Apr ${fyEnd - 1} - Mar ${fyEnd})` };
  }
  const q = Math.floor(((m + 9) % 12) / 3);                     // 0..3 within the FY
  const qStartMonth = (3 + q * 3) % 12;
  const qStartYear = qStartMonth >= 3 ? fyEnd - 1 : fyEnd;
  const start = new Date(Date.UTC(qStartYear, qStartMonth, 1));
  const end = new Date(Date.UTC(qStartYear, qStartMonth + 3, 0));
  return { key: `FY${fyEnd}Q${q + 1}`, start: ymd(start), end: ymd(end), label: `Q${q + 1} FY${String(fyEnd).slice(2)} (${MON[qStartMonth]}-${MON[(qStartMonth + 2) % 12]})` };
}

function lastWeekday(end: string): string {
  const d = parse(end);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return ymd(d);
}

/** Groups closes into periods; returns completed periods newest first with their return vs the prior period close. */
export function completedPeriods(b: Bar[], end: number, kind: PeriodKind, today: string, max = 24): PeriodResult[] {
  const out: PeriodResult[] = [];
  let i = end;
  let first = true;
  while (i >= 0 && out.length < max) {
    const p = periodOf(b[i].date, kind);
    let j = i;
    while (j - 1 >= 0 && b[j - 1].date >= p.start) j--;          // b[j..i] are this period's bars
    const complete = !first || today > p.end || b[i].date >= lastWeekday(p.end);
    first = false;
    if (complete) {
      const prev = j - 1 >= 0 ? b[j - 1] : null;
      const ret = prev && prev.close > 0 ? b[i].close / prev.close - 1 : null;
      out.push({ kind, label: p.label, from: prev?.date ?? b[j].date, to: b[i].date, ret, ok: ret != null && ret > 0 });
    }
    i = j - 1;
  }
  return out;
}

function retOver(b: Bar[], end: number, sessions: number): number | null {
  const s = end - sessions;
  return s >= 0 && b[s].close > 0 ? b[end].close / b[s].close - 1 : null;
}

export function resilience(b: Bar[], end: number, c: WinnerCriteria, weeks: PeriodResult[]): Resilience {
  const from3 = Math.max(0, end - 62), from6 = Math.max(0, end - 125);
  let peak = b[from3].close, maxDd = 0;
  for (let k = from3; k <= end; k++) {
    peak = Math.max(peak, b[k].close);
    maxDd = Math.min(maxDd, b[k].close / peak - 1);
  }
  const hi3 = Math.max(...b.slice(from3, end + 1).map((x) => x.close));
  const curDd = b[end].close / hi3 - 1;

  // dip episodes in 6 months: peak -> trough deeper than dipPct -> first close back at/above the peak
  const dips: Dip[] = [];
  let pk = from6, inDip = false, trough = from6;
  for (let k = from6; k <= end; k++) {
    if (!inDip) {
      if (b[k].close >= b[pk].close) pk = k;
      else if ((b[k].close / b[pk].close - 1) * 100 <= -c.dipPct) { inDip = true; trough = k; }
    } else {
      if (b[k].close < b[trough].close) trough = k;
      if (b[k].close >= b[pk].close) {
        dips.push({ peakDate: b[pk].date, troughDate: b[trough].date, depthPct: r1((b[trough].close / b[pk].close - 1) * 100), recoveredOn: b[k].date, sessionsToRecover: k - trough });
        inDip = false; pk = k;
      }
    }
  }
  if (inDip) dips.push({ peakDate: b[pk].date, troughDate: b[trough].date, depthPct: r1((b[trough].close / b[pk].close - 1) * 100), recoveredOn: null, sessionsToRecover: null });

  const recentWeeks = weeks.slice(0, 13).map((w) => w.ret).filter((x): x is number => x != null);
  const worstWeek = recentWeeks.length ? Math.min(...recentWeeks) * 100 : null;
  const reasons: string[] = [];
  if (-maxDd * 100 > c.maxDrawdown3mPct) reasons.push(`fell ${r1(-maxDd * 100)}% from a peak in the last 3 months (limit ${c.maxDrawdown3mPct}%)`);
  if (-curDd * 100 > c.maxCurrentDrawdownPct) reasons.push(`${r1(-curDd * 100)}% below its 3-month high`);
  for (const d of dips) {
    if (d.sessionsToRecover == null) reasons.push(`has not recovered from a ${-d.depthPct}% dip since ${d.peakDate}`);
    else if (d.sessionsToRecover > c.maxRecoverySessions) reasons.push(`took ${d.sessionsToRecover} sessions to recover a ${-d.depthPct}% dip (limit ${c.maxRecoverySessions})`);
  }
  if (worstWeek != null && worstWeek < c.worstWeekPct) reasons.push(`a week of ${r1(worstWeek)}% in the last quarter (limit ${c.worstWeekPct}%)`);
  return { maxDrawdown3mPct: r1(maxDd * 100), currentDrawdownPct: r1(curDd * 100), worstWeekPct: worstWeek == null ? null : r1(worstWeek), dips, ok: reasons.length === 0, reasons };
}

export function screen(b: Bar[], end: number, today: string, c: WinnerCriteria): ScreenResult | null {
  if (end < 70) return null;
  const weeks = completedPeriods(b, end, 'week', today, 14);
  const months = completedPeriods(b, end, 'month', today, 13);
  const quarters = completedPeriods(b, end, 'quarter', today, 2);
  const fys = completedPeriods(b, end, 'fy', today, 2);
  const curFy = periodOf(b[end].date, 'fy');
  // FY-to-date: from the last close before the current FY started (if the current FY is still running)
  let fytdRet: number | null = null;
  if (!(fys[0] && fys[0].to === b[end].date)) {
    let j = end;
    while (j >= 0 && b[j].date >= curFy.start) j--;
    fytdRet = j >= 0 ? b[end].close / b[j].close - 1 : null;
  }
  let streak = 0;
  for (const m of months) { if (m.ok) streak++; else break; }
  const res = resilience(b, end, c, weeks);
  const ticks = {
    week: !!weeks[0]?.ok,
    month: !!months[0]?.ok,
    quarter: !!quarters[0]?.ok,
    fy: c.requireFy ? !!fys[0]?.ok : fys[0] ? fys[0].ok : true,
    streak: streak >= c.minMonthStreak,
    resilient: res.ok,
  };
  const names: Record<keyof typeof ticks, string> = { week: 'last week', month: 'last month', quarter: 'last quarter', fy: 'last financial year', streak: `${c.minMonthStreak} months in a row`, resilient: 'no major fall / quick recovery' };
  const missing = (Object.keys(ticks) as (keyof typeof ticks)[]).filter((k) => !ticks[k]).map((k) => names[k]);
  const last8 = weeks.slice(0, 8), last6 = months.slice(0, 6);
  return {
    asOf: b[end].date,
    periods: { week: weeks[0] ?? null, month: months[0] ?? null, quarter: quarters[0] ?? null, fy: fys[0] ?? null },
    fytd: { label: `FY${String(Number(curFy.key.slice(2))).slice(2)} so far`, ret: fytdRet },
    monthStreak: streak,
    weeksUp: { up: last8.filter((w) => w.ok).length, total: last8.length },
    monthsUp: { up: last6.filter((m) => m.ok).length, total: last6.length },
    ret1m: retOver(b, end, 21), ret3m: retOver(b, end, 63), ret6m: retOver(b, end, 126), ret1y: retOver(b, end, 250),
    resilience: res,
    ticks,
    pass: missing.length === 0,
    missing,
  };
}
