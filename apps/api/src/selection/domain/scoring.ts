import type { Band } from './config.js';
import type { AnalysisContext, MetricResult, Phase, Status, StepResult } from './types.js';

/** Proposal 8.6: full points at or beyond `good`, zero at or beyond `bad`, linear in between. */
export const scoreHigher = (v: number, good: number, bad: number, max: number) =>
  v >= good ? max : v <= bad ? 0 : (max * (v - bad)) / (good - bad);
export const scoreLower = (v: number, good: number, bad: number, max: number) =>
  v <= good ? max : v >= bad ? 0 : (max * (bad - v)) / (bad - good);

/** Fraction (0-1) earned on a band; direction is inferred from the band (good > bad means higher is better). */
export function bandFrac(v: number, b: Band): number {
  return b.good >= b.bad ? scoreHigher(v, b.good, b.bad, 1) : scoreLower(v, b.good, b.bad, 1);
}

export const statusOf = (frac: number | null): Status => (frac == null ? 'na' : frac >= 0.75 ? 'pass' : frac > 0.25 ? 'watch' : 'fail');

export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export const fmt = {
  pct: (x: number | null | undefined, d = 0) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : 'n/a'),
  pp: (x: number | null | undefined, d = 1) => (isNum(x) ? `${x > 0 ? '+' : ''}${x.toFixed(d)} pts` : 'n/a'),
  x: (x: number | null | undefined, d = 1) => (isNum(x) ? `${Math.min(x, 999).toFixed(d)}×` : 'n/a'),
  n: (x: number | null | undefined, d = 1, suffix = '') => (isNum(x) ? `${x.toFixed(d)}${suffix}` : 'n/a'),
  cr: (x: number | null | undefined) => (isNum(x) ? `₹${x >= 100 ? Math.round(x).toLocaleString('en-IN') : x.toFixed(1)} Cr` : 'n/a'),
};

const bandText = (b: Band, show: (x: number) => string) =>
  b.good >= b.bad ? `good ≥ ${show(b.good)}, bad ≤ ${show(b.bad)}` : `good ≤ ${show(b.good)}, bad ≥ ${show(b.bad)}`;

/**
 * Collects metrics for one step, then converts them into a StepResult.
 * Metrics without data are kept for display but excluded; the step score is re-normalised over the weight that had data,
 * and `coverage` records how much of the step could be evaluated.
 */
export class StepBuilder {
  private readonly details: MetricResult[] = [];
  private readonly flags: string[] = [];
  private gate = false;
  private note: string | undefined;

  constructor(
    private readonly ctx: AnalysisContext,
    private readonly step: number,
    private readonly name: string,
    private readonly phase: Phase,
  ) {}

  /** Adds a banded metric. `key` must match a threshold key unless `band` is passed explicitly. */
  band(key: string, label: string, value: number | null | undefined, weight: number, show: (x: number) => string, opts: { band?: Band; note?: string } = {}) {
    if (this.ctx.template.skipMetrics.includes(key)) return this;
    const b = opts.band ?? (this.ctx.template.thresholds as unknown as Record<string, Band>)[key];
    const v = isNum(value) ? value : null;
    const frac = v == null ? null : bandFrac(v, b);
    this.details.push({ key, label, value: v, display: v == null ? 'n/a' : show(v), standard: bandText(b, show), weight, frac, status: statusOf(frac), note: opts.note });
    return this;
  }

  /** Adds a pass/fail metric (true = full points). */
  check(key: string, label: string, ok: boolean | null, weight: number, display: string, standard: string, note?: string) {
    if (this.ctx.template.skipMetrics.includes(key)) return this;
    const frac = ok == null ? null : ok ? 1 : 0;
    this.details.push({ key, label, value: ok, display, standard, weight, frac, status: statusOf(frac), note });
    return this;
  }

  /** Display-only metric (no points). */
  info(key: string, label: string, value: number | string | null, display: string, note?: string) {
    this.details.push({ key, label, value, display, standard: '', weight: 0, frac: null, status: 'na', note });
    return this;
  }

  flag(text: string) {
    this.flags.push(text);
    return this;
  }

  hardGate(text: string) {
    this.gate = true;
    this.flags.push(`GATE: ${text}`);
    return this;
  }

  withNote(n: string) {
    this.note = n;
    return this;
  }

  build(): StepResult {
    const max = this.ctx.config.weights[this.step] ?? 0;
    const applicable = !this.ctx.template.skipSteps.includes(this.step);
    const scored = this.details.filter((d) => d.weight > 0);
    const totalW = scored.reduce((s, d) => s + d.weight, 0);
    const have = scored.filter((d) => d.frac != null);
    const haveW = have.reduce((s, d) => s + d.weight, 0);
    const frac = haveW > 0 ? have.reduce((s, d) => s + d.weight * (d.frac as number), 0) / haveW : null;
    const coverage = !applicable ? 0 : totalW > 0 ? haveW / totalW : max === 0 ? 1 : 0;
    const score = applicable && frac != null ? Math.round(max * frac * 100) / 100 : 0;
    const metrics: StepResult['metrics'] = {};
    for (const d of this.details) metrics[d.key] = typeof d.value === 'number' ? Math.round(d.value * 10000) / 10000 : d.value;
    return {
      step: this.step,
      name: this.name,
      phase: this.phase,
      score,
      maxScore: max,
      applicable,
      coverage: Math.round(coverage * 100) / 100,
      gate: this.gate,
      status: this.gate ? 'fail' : !applicable ? 'na' : statusOf(frac),
      flags: this.flags,
      metrics,
      details: this.details,
      note: !applicable ? `Not applicable for ${this.ctx.template.label}` : this.note,
    };
  }
}
