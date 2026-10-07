/**
 * Split / bonus back-adjustment for display (mirrors ml/vermax/data.py::_adjust_corporate_actions).
 *  1. bhavcopy PREVCLOSE differs from the previous close at a canonical ratio (exchange-adjusted ex-date);
 *  2. PREVCLOSE was NOT adjusted, but the open and the day's extreme both sit at a canonical ratio of the previous close.
 */
const CANON = [0.5, 1 / 3, 0.25, 0.2, 0.1, 0.05, 2 / 3, 0.75, 0.8, 0.6, 0.4, 0.125, 2, 3, 4, 5, 10];

export interface RawBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prevClose: number;
  deliveryPct?: number | null;
}

export function adjustBars<T extends RawBar>(bars: T[]): T[] {
  const factor = bars.map(() => 1);
  for (let i = 1; i < bars.length; i++) {
    const pc = bars[i - 1].close;
    if (!(pc > 0)) continue;
    const r = bars[i].prevClose / pc;
    if (Math.abs(r - 1) > 0.05 && CANON.some((c) => Math.abs(r / c - 1) < 0.03)) {
      factor[i] = r;
      continue;
    }
    if (Math.abs(r - 1) <= 0.05) {
      const ro = bars[i].open / pc;
      for (const c of CANON) {
        if (c > 0.75 && c < 1.33) continue;
        const ext = (c < 1 ? bars[i].high : bars[i].low) / pc;
        if (Math.abs(ro / c - 1) < 0.04 && Math.abs(ext / c - 1) < 0.08) {
          factor[i] = c;
          break;
        }
      }
    }
  }
  // every bar before an event is scaled by the product of all later event factors
  const out = bars.map((b) => ({ ...b }));
  let cum = 1;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (cum !== 1) {
      const b = out[i];
      b.open *= cum; b.high *= cum; b.low *= cum; b.close *= cum; b.prevClose *= cum; b.volume /= cum;
    }
    cum *= factor[i];
    if (factor[i] !== 1 && Math.abs(bars[i].prevClose / (bars[i - 1]?.close ?? bars[i].prevClose) - 1) <= 0.05) out[i].prevClose *= factor[i];
  }
  for (const b of out) for (const k of ['open', 'high', 'low', 'close', 'prevClose'] as const) b[k] = Math.round(b[k] * 100) / 100;
  return out;
}
