/** Lower-circuit (LC) detection and recovery statistics from end-of-day bars. */

export interface CircuitBar {
  date: string;
  low: number;
  close: number;
  prevClose: number;
}

export interface CircuitEvent {
  date: string; // first locked day
  endDate: string; // last consecutive locked day
  band: number; // 5 / 10 / 20 (% band that was hit)
  lockDays: number;
  refPrice: number; // close before the first LC day (level to recover)
  lockClose: number;
  dropPct: number; // total fall from refPrice to the last locked close
  recovered: boolean;
  recoveryDays: number | null; // trading days from the last locked day to close >= refPrice
  halfRecoveryDays: number | null; // days to regain half of the fall
  furtherFallPct: number; // worst close within 10 sessions after the lock vs lock close (<= 0)
  daysSince: number; // trading days from the last locked day to the last bar
  currentVsRefPct: number; // last close vs refPrice
}

export interface CircuitSummary {
  events: number;
  recoveredCount: number;
  medianRecoveryDays: number | null;
  meanRecoveryDays: number | null;
  medianHalfRecoveryDays: number | null;
  recoveredWithin10Pct: number | null; // % of events recovered within 10 sessions
  recoveredWithin30Pct: number | null;
  medianFurtherFallPct: number | null;
  lastEventDate: string | null;
  lockedNow: boolean; // the last bar itself is an LC day
  recentDays: number | null; // sessions since the last event ended
  list: CircuitEvent[];
}

const BANDS = [0.05, 0.1, 0.2];
const TOL = 0.006;

function bandHit(pct: number): number | null {
  for (const b of BANDS) if (Math.abs(pct + b) <= TOL) return b;
  return null;
}

/** An LC day closes at (or on) the day's low, at a standard exchange price band below the previous close. */
export function isLowerCircuit(b: CircuitBar): number | null {
  if (!(b.prevClose > 0) || !(b.close > 0)) return null;
  if (b.close > b.low * 1.0005) return null;
  return bandHit(b.close / b.prevClose - 1);
}

const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function analyseCircuits(bars: CircuitBar[]): CircuitSummary {
  const list: CircuitEvent[] = [];
  const n = bars.length;
  let i = 0;
  while (i < n) {
    const band = isLowerCircuit(bars[i]);
    if (band === null) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < n && isLowerCircuit(bars[end + 1]) !== null) end++;
    const ref = bars[i].prevClose;
    const lockClose = bars[end].close;
    const half = lockClose + (ref - lockClose) / 2;
    let recoveryDays: number | null = null;
    let halfDays: number | null = null;
    for (let j = end + 1; j < n; j++) {
      if (halfDays === null && bars[j].close >= half) halfDays = j - end;
      if (bars[j].close >= ref) {
        recoveryDays = j - end;
        break;
      }
    }
    let worst = 0;
    for (let j = end + 1; j <= Math.min(n - 1, end + 10); j++) worst = Math.min(worst, bars[j].close / lockClose - 1);
    list.push({
      date: bars[i].date,
      endDate: bars[end].date,
      band: Math.round(band * 100),
      lockDays: end - i + 1,
      refPrice: ref,
      lockClose,
      dropPct: lockClose / ref - 1,
      recovered: recoveryDays !== null,
      recoveryDays,
      halfRecoveryDays: halfDays,
      furtherFallPct: worst,
      daysSince: n - 1 - end,
      currentVsRefPct: bars[n - 1].close / ref - 1,
    });
    i = end + 1;
  }
  const rec = list.filter((e) => e.recovered);
  const days = rec.map((e) => e.recoveryDays as number);
  // Events too recent to judge a 10/30-day window are excluded from those rates.
  const w = (k: number) => {
    const eligible = list.filter((e) => e.recovered || e.daysSince >= k);
    return eligible.length ? Math.round((eligible.filter((e) => e.recovered && (e.recoveryDays as number) <= k).length / eligible.length) * 100) : null;
  };
  const last = list.at(-1);
  return {
    events: list.length,
    recoveredCount: rec.length,
    medianRecoveryDays: median(days),
    meanRecoveryDays: days.length ? Math.round((days.reduce((s, x) => s + x, 0) / days.length) * 10) / 10 : null,
    medianHalfRecoveryDays: median(list.filter((e) => e.halfRecoveryDays !== null).map((e) => e.halfRecoveryDays as number)),
    recoveredWithin10Pct: w(10),
    recoveredWithin30Pct: w(30),
    medianFurtherFallPct: median(list.map((e) => e.furtherFallPct)),
    lastEventDate: last?.endDate ?? null,
    lockedNow: !!last && last.daysSince === 0,
    recentDays: last ? last.daysSince : null,
    list: [...list].reverse(),
  };
}
