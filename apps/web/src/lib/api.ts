import type { LiveQuote, Journal, ScreenerResp, PipelineState, Performance, Run, StockResp } from './types'

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) {
    let msg = `${r.status}`
    try { msg = (await r.json()).message ?? msg } catch { /* not json */ }
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}

export const api = {
  latest: () => j<Run>('/api/picks/latest'),
  health: () => j<{ status: 'OK' | 'WATCH' | 'ALERT'; reasons: string[]; model: { trainedTo: string | null; trainedAt: string | null }; liveICMean: number | null; liveRunsScored: number; liveIC: { asOf: string; ic: number; top10FwdPct: number; allFwdPct: number }[]; oosMonthlyIC: { month: string; ic: number }[]; drift: { feature: string; kind: string; psi?: number; percentile?: number; level: string }[] }>('/api/model/health'),
  system: () => j<{ dataLatest: string | null; todayIst: string; publishedAsOf: string | null; alerts: { telegram: boolean; recent: { at: string; level: string; text: string }[] }; jobs: { name: string; next: string | null }[] }>('/api/system'),
  state: () => j<PipelineState>('/api/pipeline/state'),
  run: () => j<{ started: boolean; state: PipelineState }>('/api/pipeline/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
  screener: () => j<ScreenerResp>('/api/screener'),
  journal: () => j<Journal>('/api/journal'),
  journalRefresh: () => j<unknown>('/api/journal/refresh', { method: 'POST' }),
  performance: () => j<Performance>('/api/performance'),
  quote: (s: string) => j<{ quote: LiveQuote | null }>(`/api/quote/${encodeURIComponent(s)}`),
  stock: (s: string, deep = false) => j<StockResp>(`/api/stock/${encodeURIComponent(s)}${deep ? '?deep=1' : ''}`),
}
