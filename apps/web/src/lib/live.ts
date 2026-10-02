import { useQuery } from '@tanstack/react-query'
import type { LiveQuote } from './types'

/** Delayed live quotes for the rows currently on screen (display only; filters stay on the official NSE close). */
export function useLiveQuotes(symbols: string[], enabled: boolean) {
  const key = symbols.join(',')
  return useQuery({
    queryKey: ['quotes', key],
    enabled: enabled && symbols.length > 0,
    refetchInterval: enabled ? 60_000 : false,
    queryFn: async () => {
      const r = await fetch(`/api/quotes?symbols=${encodeURIComponent(key)}`)
      if (!r.ok) throw new Error(`${r.status}`)
      return (await r.json()) as Record<string, LiveQuote | null>
    },
  })
}

/** Return in % of `price` versus a reference price, or null. */
export const retVs = (price: number | null | undefined, ref: number | null | undefined) =>
  price != null && ref ? Math.round((price / ref - 1) * 10000) / 100 : null

/** IST calendar date of a quote timestamp. */
export const istDate = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : null)

/** Pick the reference set: live-anchored refs when the quote is from a newer session than the stored NSE close. */
export function refsFor(row: { refs?: Record<string, number | null>; refsLive?: Record<string, number | null> }, quoteTime: string | null | undefined, asOf: string) {
  const d = istDate(quoteTime)
  return d && d > asOf ? (row.refsLive ?? row.refs) : row.refs
}
