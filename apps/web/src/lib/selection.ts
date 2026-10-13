/** Types and API client for the 18-step selection engine (/api/v1). Mirrors apps/api/src/selection/domain. */

export type Verdict = 'BUY' | 'WAIT' | 'AVOID'
export type Status = 'pass' | 'watch' | 'fail' | 'na'

export interface MetricResult { key: string; label: string; value: number | string | boolean | null; display: string; standard: string; weight: number; frac: number | null; status: Status; note?: string }
export interface StepResult {
  step: number; name: string; phase: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'; score: number; maxScore: number; applicable: boolean; coverage: number; gate: boolean
  status: Status; flags: string[]; details: MetricResult[]; note?: string
}
export interface RedFlag { category: string; level: 1 | 2 | 3; title: string; source: string; status: 'auto' | 'suggested' | 'confirmed' | 'resolved'; link?: string | null; date?: string | null }
export interface Zone { low: number; high: number; touches: number; kind: 'support' | 'resistance' }
export interface Technical {
  asOf: string; close: number; ema20: number; ema50: number; ema200: number | null; rsi14: number | null; atr14: number; atrPct: number
  macd: { macd: number; signal: number; hist: number }; trend: string; structure: { lastHigh: string | null; lastLow: string | null }
  support: Zone | null; resistance: Zone | null; patterns: { date: string; name: string; bullish: boolean; volumeRatio: number }[]
  breakout: { level: number; date: string; retested: boolean } | null; inFibGolden: boolean; rs: { m3: number | null; m6: number | null }; extendedPct: number
  fib: { dir: 'up' | 'down'; from: { date: string; price: number }; to: { date: string; price: number }; levels: { ratio: number; price: number; kind: string }[]; zone: string } | null
  volumeProfile: { poc: number; vah: number; val: number; hvn: number[]; lvn: number[]; lookback: number } | null
  lastStructure: { type: 'BOS' | 'CHoCH'; dir: 'up' | 'down'; date: string; level: number } | null
  orderBlock: { date: string; low: number; high: number } | null
  liquiditySweep: { date: string; level: number; low: number; close: number } | null
  targets: { price: number; basis: string; pct: number }[]
  checks: { trendOk: boolean; atLevel: boolean; triggerConfirmed: boolean; extended: boolean; rewardRisk: number; rrOk: boolean }
  levelReasons: string[]; technicalReady: boolean; reasons: string[]
  plan: { entry: number; stop: number; target: number; rewardRisk: number; riskPct: number; stopBasis: string; targetBasis: string }
  watch: { alertPrice: number; zone: string } | null
}
export interface PositionSize {
  ok: boolean; error?: string; riskBudget: number; riskPerShare: number; qtyByRisk: number; qtyByCap: number; qtyByLiquidity: number | null; qty: number
  binding: 'risk' | 'positionCap' | 'liquidity'; capPct: number; capClass: string; positionValue: number; positionPctOfCapital: number
  actualRisk: number; actualRiskPctOfCapital: number; rewardRisk: number | null; potentialGain: number | null
  liquidityCheck: { orderPctOfAdtv: number | null; exitableInOneDay: boolean | null }
}
export interface Analysis {
  runId: number; cached: boolean; symbol: string; name: string | null; sector: string | null; asOfDate: string
  template: { key: string; label: string; description: string }
  totalScore: number; rawScore: number; penalty: number; coverage: number; verdict: Verdict; gateTriggered: boolean; gates: string[]
  valuationStretched: boolean; technicalReady: boolean; reason: string; reasons: string[]; steps: StepResult[]; redFlags: RedFlag[]
  catalysts: { kind: string; title: string; date: string | null; link?: string | null }[]
  technical: Technical | null; position: PositionSize | null; watch: { alertPrice: number; zone: string } | null
  metrics: { close: number | null; adtvCr: number | null; marketCapCr: number | null; pe: number | null }; configVersion: number; dataNotes: string[]
}
export interface FlagRow { id: number; symbol: string; category: string; level: number; title: string; source: string; status: string; link: string | null; detectedOn: string | null; reviewedAt: string | null }

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) {
    let msg = `${r.status}`
    try {
      const b = await r.json()
      msg = Array.isArray(b.message) ? b.message.join('; ') : b.message ?? msg
    } catch { /* not json */ }
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}
const send = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const qs = (o: Record<string, string | number | boolean | undefined | null>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false).map(([k, v]) => [k, String(v)])).toString()

export const sel = {
  analysis: (s: string, refresh = false) => j<Analysis>(`/api/v1/stocks/${encodeURIComponent(s)}/analysis${refresh ? '?refresh=1' : ''}`),
  history: (s: string) => j<{ id: number; asOfDate: string; totalScore: number; verdict: Verdict; close: number | null }[]>(`/api/v1/stocks/${encodeURIComponent(s)}/history`),
  prices: (s: string, range = '1y') => j<{ bars: { date: string; open: number; high: number; low: number; close: number; volume: number }[] }>(`/api/v1/stocks/${encodeURIComponent(s)}/prices?range=${range}`),
  explain: (s: string, refresh = false) => j<{ text: string; model: string; grounded: boolean; cached: boolean }>(`/api/v1/stocks/${encodeURIComponent(s)}/explain${refresh ? '?refresh=1' : ''}`, send('POST')),
  flags: (status?: string, symbol?: string) => j<FlagRow[]>(`/api/v1/flags?${qs({ status, symbol })}`),
  reviewFlag: (id: number, status: 'confirmed' | 'resolved' | 'suggested') => j<unknown>(`/api/v1/flags/${id}`, send('PATCH', { status })),
}

export const VERDICT_STYLE: Record<Verdict, string> = { BUY: 'bg-pos text-white', WAIT: 'bg-amber-bg text-amber', AVOID: 'bg-neg-bg text-neg' }
export const STATUS_STYLE: Record<Status, string> = { pass: 'bg-pos', watch: 'bg-amber', fail: 'bg-neg', na: 'bg-line-strong' }
export const STATUS_TEXT: Record<Status, string> = { pass: 'Pass', watch: 'Watch', fail: 'Fail', na: 'n/a' }
export const PHASES: Record<string, string> = { A: 'Understand', B: 'Financial strength', C: 'Quality and trust', D: 'Tradability and price', E: 'Events and risk filter', F: 'Execution' }
export const DISCLAIMER = 'Educational decision support, not investment advice. Verdicts come from fixed rules on public data and can be wrong; past performance does not indicate future results. Vermax does not place orders.'
