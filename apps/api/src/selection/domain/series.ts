/** Helpers over newest-first annual series (nulls allowed). All pure. */
import { isNum } from './scoring.js';
import type { StatementTable } from './types.js';

export type Series = (number | null)[];

export function col(t: StatementTable | undefined | null, key: string): Series {
  const v = t?.[key];
  return Array.isArray(v) ? (v as Series).map((x) => (isNum(x) ? x : null)) : [];
}

/** Compound annual growth from the oldest to the newest positive value. */
export function cagr(s: Series): number | null {
  const idx = s.map((v, i) => [v, i] as const).filter(([v]) => isNum(v));
  if (idx.length < 2) return null;
  const [newest, i0] = idx[0];
  const [oldest, i1] = idx[idx.length - 1];
  if (!(newest! > 0 && oldest! > 0)) return null;
  return (newest! / oldest!) ** (1 / (i1 - i0)) - 1;
}

/** Year-on-year changes, newest first (length n-1). */
export function yoy(s: Series): Series {
  const out: Series = [];
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    out.push(isNum(a) && isNum(b) && b !== 0 ? a / Math.abs(b) - (b < 0 ? -1 : 1) : null);
  }
  return out;
}

export const ratio = (a: Series, b: Series): Series => a.map((x, i) => (isNum(x) && isNum(b[i]) && b[i] !== 0 ? x / (b[i] as number) : null));

export function mean(s: Series): number | null {
  const v = s.filter(isNum);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function std(s: Series): number | null {
  const v = s.filter(isNum);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

export const sum = (s: Series): number | null => (s.some(isNum) ? s.filter(isNum).reduce((a, b) => a + b, 0) : null);

/** Least-squares slope per year of a newest-first series (positive = rising over time). */
export function slope(s: Series): number | null {
  const pts = s.map((v, i) => [-i, v] as const).filter(([, v]) => isNum(v)) as [number, number][];
  if (pts.length < 3) return null;
  const mx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
  const my = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
  const num = pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
  const den = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  return den ? num / den : null;
}

/** Number of consecutive most-recent years in which the value rose (0 if the latest year did not rise). */
export function risingStreak(s: Series): number | null {
  const v = s.filter(isNum);
  if (v.length < 2) return null;
  let n = 0;
  for (let i = 0; i < v.length - 1 && v[i] > v[i + 1]; i++) n++;
  return n;
}

/** Share of year-on-year changes that were increases. */
export function upShare(s: Series): number | null {
  const ch = yoy(s).filter(isNum);
  return ch.length ? ch.filter((x) => x > 0).length / ch.length : null;
}

/** Days metric: balance / annual flow x 365 (e.g. receivables / revenue). */
export const days = (bal: Series, flow: Series): Series => bal.map((b, i) => (isNum(b) && isNum(flow[i]) && flow[i]! > 0 ? (b / flow[i]!) * 365 : null));
