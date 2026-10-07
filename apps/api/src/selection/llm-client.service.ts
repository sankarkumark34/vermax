import { Injectable, Logger } from '@nestjs/common';
import type { AnalysisResult, Announcement } from './domain/index.js';

/**
 * Typed client for the Python LLM service (services/llm). Timeouts, one bounded retry and a circuit breaker on every call.
 * The LLM only explains and classifies; it never produces scores. When the service is down or not configured, callers
 * get `null` and fall back to the deterministic text.
 */
@Injectable()
export class LlmClientService {
  private readonly log = new Logger(LlmClientService.name);
  private readonly base = (process.env.LLM_SERVICE_URL ?? 'http://127.0.0.1:8100').replace(/\/$/, '');
  private readonly token = process.env.LLM_SERVICE_TOKEN ?? '';
  private failures = 0;
  private openUntil = 0;

  get circuit() {
    return { open: Date.now() < this.openUntil, failures: this.failures, url: this.base };
  }

  private async call<T>(path: string, body: unknown, timeoutMs = 45_000): Promise<T | null> {
    if (Date.now() < this.openUntil) return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${this.base}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status >= 400 && res.status < 500) {
          this.log.warn(`llm ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
          return null;                      // client errors are not retried and do not trip the breaker
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.failures = 0;
        return (await res.json()) as T;
      } catch (e) {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
        else {
          this.failures++;
          if (this.failures >= 3) {
            this.openUntil = Date.now() + 5 * 60_000;
            this.log.warn(`llm service unavailable (${(e as Error).message}); circuit open for 5 min`);
          }
        }
      }
    }
    return null;
  }

  async health(): Promise<{ ok: boolean; provider?: string; model?: string } | null> {
    try {
      const res = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? ((await res.json()) as { ok: boolean; provider?: string; model?: string }) : null;
    } catch {
      return null;
    }
  }

  explainVerdict(r: AnalysisResult) {
    return this.call<{ text: string; model: string; grounded: boolean; ungrounded: string[] }>('/v1/explain-verdict', { facts: verdictFacts(r) });
  }

  classifyAnnouncement(symbol: string, a: Announcement) {
    return this.call<{ category: string; severity: 1 | 2 | 3; isRedFlag: boolean; isCatalyst: boolean; keywords: string[]; rationale: string }>(
      '/v1/classify-announcement', { symbol, date: a.date, category: a.category, text: a.text, link: a.link });
  }

  businessSummary(symbol: string, name: string | null, text: string) {
    return this.call<{ summary: string; segments: string[]; revenueModel: string; concentrationNotes: string; model: string }>(
      '/v1/business-summary', { symbol, name, text }, 60_000);
  }
}

/** The compact, numbers-only JSON the LLM is allowed to talk about (the grounding validator checks against it). */
export function verdictFacts(r: AnalysisResult) {
  return {
    symbol: r.symbol, name: r.name, sector: r.sector, asOfDate: r.asOfDate, verdict: r.verdict, totalScore: r.totalScore, coverage: r.coverage,
    gates: r.gates, valuationStretched: r.valuationStretched, technicalReady: r.technicalReady, reasons: r.reasons, template: r.template.label,
    steps: r.steps.filter((s) => s.step <= 15).map((s) => ({
      step: s.step, name: s.name, score: s.score, maxScore: s.maxScore, status: s.status, flags: s.flags,
      metrics: s.details.filter((d) => d.weight > 0 && d.frac != null).map((d) => ({ label: d.label, value: d.display, standard: d.standard, status: d.status })),
    })),
    entry: r.technical ? { ...r.technical.plan, checks: r.technical.checks, levelReasons: r.technical.levelReasons, reasonsNotReady: r.technical.reasons } : null,
    watch: r.watch,
    position: r.position?.ok ? { qty: r.position.qty, positionValue: r.position.positionValue, actualRisk: r.position.actualRisk, binding: r.position.binding } : null,
    redFlags: r.redFlags.filter((f) => f.status !== 'resolved').map((f) => ({ title: f.title, level: f.level, status: f.status })),
    catalysts: r.catalysts.map((c) => `${c.kind}: ${c.title}`),
  };
}

/** Deterministic explanation used when the LLM service is unavailable. Every number comes from the engine output. */
export function templateExplanation(r: AnalysisResult): string {
  const lines: string[] = [];
  const strong = r.steps.filter((s) => s.step <= 15 && s.applicable && s.maxScore > 0 && s.coverage > 0 && s.score / s.maxScore >= 0.75).map((s) => s.name);
  const weak = r.steps.filter((s) => s.step <= 15 && s.applicable && s.maxScore > 0 && s.coverage > 0 && s.score / s.maxScore < 0.4).map((s) => s.name);
  lines.push(`${r.symbol} is rated ${r.verdict} with a score of ${r.totalScore}/100 (${Math.round(r.coverage * 100)}% of the framework evaluated, ${r.template.label} template).`);
  if (r.gates.length) lines.push(`A hard gate was triggered: ${r.gates.join('; ')}. Gates override the score.`);
  if (strong.length) lines.push(`Strongest areas: ${strong.join(', ')}.`);
  if (weak.length) lines.push(`Weakest areas: ${weak.join(', ')}.`);
  if (r.valuationStretched) lines.push('Valuation is stretched, which blocks a BUY even with a high score.');
  if (r.technical) {
    const t = r.technical;
    lines.push(t.technicalReady
      ? `The entry is confirmed: entry ₹${t.plan.entry}, stop-loss ₹${t.plan.stop} (${t.plan.stopBasis}), target ₹${t.plan.target}, reward to risk 1:${t.plan.rewardRisk}.`
      : `The entry is not ready: ${t.reasons.join('; ')}.`);
  }
  if (r.watch) lines.push(`Watch level: ₹${r.watch.alertPrice} (${r.watch.zone}).`);
  if (r.position?.ok && r.verdict === 'BUY') lines.push(`Suggested size: ${r.position.qty} shares (₹${Math.round(r.position.positionValue).toLocaleString('en-IN')}), risking ₹${Math.round(r.position.actualRisk).toLocaleString('en-IN')}.`);
  return lines.join(' ');
}
