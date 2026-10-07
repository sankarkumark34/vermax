/**
 * Decision engine (proposal 5.4, 6.7, 8.6): gates first, then the 100-point score, then valuation and timing.
 *
 *   AVOID  any hard gate, or score < waitMin (60)
 *   BUY    score >= buyMin (75), no gate, valuation not stretched, technical entry confirmed (incl. R:R >= 2),
 *          and enough of the framework could be evaluated (coverage)
 *   WAIT   everything else; the stock gets a watch level
 *
 * Missing data: the score is computed over the steps that had data and re-scaled to 100; `coverage` reports the share of
 * the framework's weight that was evaluated, and BUY requires minCoverageForBuy (70% by default).
 */
import { classifyAnnouncements } from './announcements.js';
import { ANALYZERS } from './analyzers.js';
import { STEP_NAMES } from './config.js';
import { fmt, StepBuilder } from './scoring.js';
import { positionSize, type PositionSize } from './risk.js';
import { technicalEntry, type TechnicalEntry } from './technical.js';
import type { AnalysisContext, Catalyst, RedFlag, SharedFacts, StepResult, Verdict } from './types.js';

export interface AnalysisResult {
  symbol: string;
  name: string | null;
  sector: string | null;
  asOfDate: string;
  template: { key: string; label: string; description: string };
  totalScore: number;
  rawScore: number;
  penalty: number;
  coverage: number;
  verdict: Verdict;
  gateTriggered: boolean;
  gates: string[];
  valuationStretched: boolean;
  technicalReady: boolean;
  reason: string;
  reasons: string[];
  steps: StepResult[];
  redFlags: RedFlag[];
  catalysts: Catalyst[];
  technical: TechnicalEntry | null;
  position: PositionSize | null;
  watch: { alertPrice: number; zone: string } | null;
  metrics: { close: number | null; adtvCr: number | null; marketCapCr: number | null; pe: number | null };
  configVersion: number;
  dataNotes: string[];
}

export interface DecisionInput {
  steps: StepResult[];
  totalScore: number;
  coverage: number;
  technicalReady: boolean;
  valuationStretched: boolean;
  buyMin: number;
  waitMin: number;
  minCoverageForBuy: number;
}

export class DecisionEngine {
  decide(i: DecisionInput): { verdict: Verdict; reasons: string[] } {
    const gates = i.steps.filter((s) => s.gate);
    if (gates.length) return { verdict: 'AVOID', reasons: gates.flatMap((s) => s.flags.filter((f) => f.startsWith('GATE: ')).map((f) => `${s.name}: ${f.slice(6)}`)) };
    if (i.totalScore < i.waitMin) return { verdict: 'AVOID', reasons: [`score ${i.totalScore} is below ${i.waitMin}`] };
    const blockers: string[] = [];
    if (i.totalScore < i.buyMin) blockers.push(`score ${i.totalScore} is below the BUY level of ${i.buyMin}`);
    if (i.valuationStretched) blockers.push('valuation is stretched');
    if (!i.technicalReady) blockers.push('technical entry is not ready');
    if (i.coverage < i.minCoverageForBuy) blockers.push(`only ${Math.round(i.coverage * 100)}% of the framework could be evaluated (needs ${Math.round(i.minCoverageForBuy * 100)}%)`);
    return blockers.length ? { verdict: 'WAIT', reasons: blockers } : { verdict: 'BUY', reasons: [`score ${i.totalScore}, no gate, fair valuation, entry trigger confirmed`] };
  }
}

/** Stored flags override auto-detected ones with the same title (so a confirmed or resolved review sticks). */
function mergeFlags(detected: RedFlag[], stored: RedFlag[]): RedFlag[] {
  const key = (f: RedFlag) => f.title.slice(0, 120);
  const out = new Map<string, RedFlag>();
  for (const f of detected) out.set(key(f), f);
  for (const f of stored) out.set(key(f), f);
  return [...out.values()];
}

export function analyzeStock(ctx: AnalysisContext): AnalysisResult {
  const cfg = ctx.config;
  const fromFilings = classifyAnnouncements(ctx.company?.announcements?.items ?? []);
  const shared: SharedFacts = { redFlags: mergeFlags(fromFilings.flags, ctx.storedFlags), catalysts: [...fromFilings.catalysts], adtvCr: null, valuationStretched: false };

  // Steps 13 (liquidity) and 7/10 (gates) push auto flags that step 16 must see, so run 1-15 then 16.
  const ordered = [...ANALYZERS].sort((a, b) => (a.step === 16 ? 1 : b.step === 16 ? -1 : a.step - b.step));
  const byStep = new Map<number, StepResult>();
  for (const a of ordered) byStep.set(a.step, a.analyze(ctx, shared));

  // ---- step 17: technical entry (timing only) ------------------------------------------------
  const tech = technicalEntry(ctx.prices, ctx.benchmark, cfg.technical);
  const b17 = new StepBuilder(ctx, 17, STEP_NAMES[17], 'F');
  if (tech) {
    b17.check('trendOk', 'Trend: close > EMA200 with higher highs and lows', tech.checks.trendOk, 0, `${tech.trend} (${tech.structure.lastHigh ?? '-'} / ${tech.structure.lastLow ?? '-'})`, 'uptrend')
      .check('atLevel', 'At a level (support, EMA50, FVG, Fib confluence, breakout retest)', tech.checks.atLevel, 0, tech.levelReasons[0] ?? 'not at a level', 'at a level')
      .check('triggerConfirmed', 'Bullish candle with above-average volume', tech.checks.triggerConfirmed, 0, tech.patterns.filter((p) => p.bullish).map((p) => `${p.name} ${p.volumeRatio}×vol`).join(', ') || 'none', `volume ≥ ${cfg.technical.volumeMultiple}× average`)
      .check('notExtended', `Not extended (≤ ${cfg.technical.extendedAboveEma50Pct}% above EMA50)`, !tech.checks.extended, 0, `${tech.extendedPct}% above EMA50`, `≤ ${cfg.technical.extendedAboveEma50Pct}%`)
      .check('rewardRisk', `Reward : risk ≥ ${cfg.technical.minRewardRisk}`, tech.checks.rrOk, 0, `1 : ${tech.checks.rewardRisk}`, `≥ 1 : ${cfg.technical.minRewardRisk}`);
  } else b17.withNote('Not enough price history (needs 60 sessions)');
  // steps 16-18 carry no points; give 16 and 17 a status that reflects their outcome
  byStep.set(17, { ...b17.build(), status: tech ? (tech.technicalReady ? 'pass' : 'watch') : 'na' });
  const s16 = byStep.get(16)!;
  const activeAt = (lvl: number) => shared.redFlags.some((f) => f.level === lvl && (f.status === 'auto' || f.status === 'confirmed'));
  byStep.set(16, { ...s16, status: s16.gate || activeAt(3) ? 'fail' : activeAt(2) ? 'watch' : 'pass' });

  // ---- step 18: position size --------------------------------------------------------------
  const st = ctx.company?.statements;
  const position = tech
    ? positionSize({
      capital: cfg.risk.capitalInr, riskPct: cfg.risk.riskPct, entry: tech.plan.entry, stop: tech.plan.stop, target: tech.plan.target,
      adtvCr: shared.adtvCr, marketCapCr: st?.marketCapCr ?? null, capLargePct: cfg.risk.capLargePct, capMidSmallPct: cfg.risk.capMidSmallPct,
      largeCapMinCr: cfg.risk.largeCapMinCr, liquidityPctOfAdtv: cfg.risk.liquidityPctOfAdtv,
    })
    : null;
  const b18 = new StepBuilder(ctx, 18, STEP_NAMES[18], 'F');
  if (position?.ok) {
    b18.info('qty', 'Quantity', position.qty, `${position.qty} shares (limited by ${position.binding === 'positionCap' ? 'position cap' : position.binding})`)
      .info('positionValue', 'Position value', position.positionValue, `₹${Math.round(position.positionValue).toLocaleString('en-IN')} (${position.positionPctOfCapital}% of capital)`)
      .info('actualRisk', 'Risk at stop', position.actualRisk, `₹${Math.round(position.actualRisk).toLocaleString('en-IN')} (${position.actualRiskPctOfCapital}% of capital)`);
    b18.withNote(`Sized on ₹${cfg.risk.capitalInr.toLocaleString('en-IN')} capital at ${cfg.risk.riskPct}% risk; change both in Settings or use the Risk calculator.`);
  }
  byStep.set(18, b18.build());

  const steps = [...byStep.values()].sort((a, b) => a.step - b.step);

  // ---- score ------------------------------------------------------------------------------------
  const scored = steps.filter((s) => s.step <= 15 && s.applicable && s.maxScore > 0);
  const evaluated = scored.filter((s) => s.coverage > 0);
  const maxEval = evaluated.reduce((a, s) => a + s.maxScore, 0);
  const earned = evaluated.reduce((a, s) => a + s.score, 0);
  const rawScore = maxEval > 0 ? (earned / maxEval) * 100 : 0;
  const maxAll = scored.reduce((a, s) => a + s.maxScore, 0);
  const coverage = maxAll > 0 ? scored.reduce((a, s) => a + s.maxScore * s.coverage, 0) / maxAll : 0;
  const level2 = shared.redFlags.filter((f) => f.level === 2 && (f.status === 'auto' || f.status === 'confirmed')).length;
  const penalty = level2 * cfg.penalties.level2Points;
  const totalScore = Math.round(Math.max(0, Math.min(100, rawScore - penalty)) * 10) / 10;

  const decision = new DecisionEngine().decide({
    steps, totalScore, coverage, technicalReady: !!tech?.technicalReady, valuationStretched: shared.valuationStretched,
    buyMin: cfg.verdict.buyMin, waitMin: cfg.verdict.waitMin, minCoverageForBuy: cfg.verdict.minCoverageForBuy,
  });
  const reasons = [...decision.reasons];
  if (decision.verdict === 'WAIT' && tech && !tech.technicalReady) reasons.push(...tech.reasons.map((r) => `entry: ${r}`));
  if (penalty) reasons.push(`${level2} level-2 red flag${level2 > 1 ? 's' : ''}: −${penalty} points`);

  const gates = steps.filter((s) => s.gate).flatMap((s) => s.flags.filter((f) => f.startsWith('GATE: ')).map((f) => f.slice(6)));
  const dataNotes: string[] = [];
  if (!st?.ok) dataNotes.push('financial statements unavailable');
  else if ((st.annual?.periods.length ?? 0) < 5) dataNotes.push(`${st.annual?.periods.length ?? 0} years of statements (proposal asks for 5-10)`);
  if (!ctx.company?.holding?.ok) dataNotes.push('shareholding / pledge data unavailable');
  if (ctx.surveillance == null) dataNotes.push('surveillance list unavailable');

  return {
    symbol: ctx.symbol,
    name: ctx.name ?? st?.name ?? null,
    sector: ctx.sector,
    asOfDate: ctx.asOf,
    template: { key: ctx.template.key, label: ctx.template.label, description: ctx.template.description },
    totalScore,
    rawScore: Math.round(rawScore * 10) / 10,
    penalty,
    coverage: Math.round(coverage * 100) / 100,
    verdict: decision.verdict,
    gateTriggered: gates.length > 0,
    gates,
    valuationStretched: shared.valuationStretched,
    technicalReady: !!tech?.technicalReady,
    reason: summarise(decision.verdict, totalScore, shared.valuationStretched, tech, gates),
    reasons,
    steps,
    redFlags: shared.redFlags,
    catalysts: shared.catalysts,
    technical: tech,
    position,
    watch: decision.verdict === 'WAIT' ? tech?.watch ?? null : null,
    metrics: { close: tech?.close ?? ctx.prices.at(-1)?.close ?? null, adtvCr: shared.adtvCr == null ? null : Math.round(shared.adtvCr * 10) / 10, marketCapCr: st?.marketCapCr ?? null, pe: st?.pe ?? null },
    configVersion: cfg.version,
    dataNotes,
  };
}

function summarise(v: Verdict, score: number, stretched: boolean, tech: TechnicalEntry | null, gates: string[]): string {
  if (gates.length) return `Avoid: ${gates[0]}`;
  if (v === 'AVOID') return `Score ${score} is below the WAIT threshold`;
  if (v === 'BUY') return `Score ${score}, fair valuation and a confirmed entry at ₹${tech?.plan.entry} (stop ₹${tech?.plan.stop}, target ₹${tech?.plan.target})`;
  const parts = [score >= 75 ? 'High quality' : `Score ${score}`];
  if (stretched) parts.push('valuation stretched');
  if (tech?.checks.extended) parts.push(`price ${fmt.n(tech.extendedPct, 0)}% above EMA50`);
  else if (tech && !tech.technicalReady) parts.push('entry trigger not confirmed');
  return parts.join(', ');
}
