import type { IpoResp, LiveQuote, StockResp } from './types'

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
  system: () => j<{ dataLatest: string | null; todayIst: string; publishedAsOf: string | null; alerts: { telegram: boolean; recent: { at: string; level: string; text: string }[] }; jobs: { name: string; next: string | null }[] }>('/api/system'),
  ipos: () => j<IpoResp>('/api/ipos'),
  quote: (s: string) => j<{ quote: LiveQuote | null }>(`/api/quote/${encodeURIComponent(s)}`),
  stock: (s: string, deep = false) => j<StockResp>(`/api/stock/${encodeURIComponent(s)}${deep ? '?deep=1' : ''}`),
}
