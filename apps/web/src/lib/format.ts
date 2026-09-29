export const inr = (n: number | null | undefined, d = 2) =>
  n == null ? '-' : n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
export const inr0 = (n: number | null | undefined) => (n == null ? '-' : Math.round(n).toLocaleString('en-IN'))
export const pct = (n: number | null | undefined, d = 1, sign = false) =>
  n == null ? '-' : `${sign && n > 0 ? '+' : ''}${(n * 100).toFixed(d)}%`
export const pctRaw = (n: number | null | undefined, d = 1, sign = true) =>
  n == null ? '-' : `${sign && n > 0 ? '+' : ''}${n.toFixed(d)}%`
export const tone = (n: number | null | undefined) => (n == null ? 'text-slate-400' : n > 0 ? 'text-emerald-400' : n < 0 ? 'text-rose-400' : 'text-slate-300')
export const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
export const cr = (n: number | null | undefined) => (n == null ? '-' : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L Cr` : `${inr0(n)} Cr`)
export function sizeFor(capital: number, riskPct: number, mult: number, stopPct: number, price: number, maxPos = 0.2) {
  if (!(price > 0 && stopPct > 0 && capital > 0)) return { qty: 0, used: 0, risk: 0, weight: 0 }
  const w = Math.min((riskPct * mult) / stopPct, maxPos)
  const qty = Math.floor((w * capital) / price)
  return { qty, used: qty * price, risk: qty * price * stopPct, weight: (qty * price) / capital }
}
