import clsx from 'clsx'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'

export type SortValue = number | string | null | undefined
export interface SortCol<T> { h: string; get: (r: T) => SortValue; right?: boolean; title?: string }
type Sort = { i: number; dir: 'asc' | 'desc' } | null

/**
 * Click-to-sort for a table. First click: text A→Z, numbers high→low; second click reverses; third restores the
 * original order. Missing values always go last.
 */
export function useSort<T>(rows: T[], cols: SortCol<T>[]) {
  const [sort, setSort] = useState<Sort>(null)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const get = cols[sort.i].get
    const m = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b)
      if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1
      return m * (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number))
    })
  }, [rows, cols, sort])
  const toggle = (i: number) => setSort((s) => {
    if (s?.i !== i) {
      const first = rows.map(cols[i].get).find((v) => v != null)
      return { i, dir: typeof first === 'string' ? 'asc' : 'desc' }
    }
    const firstDir = typeof rows.map(cols[i].get).find((v) => v != null) === 'string' ? 'asc' : 'desc'
    return s.dir === firstDir ? { i, dir: firstDir === 'asc' ? 'desc' : 'asc' } : null
  })
  return { sorted, sort, toggle }
}

export function SortHead<T>({ cols, sort, toggle }: { cols: SortCol<T>[]; sort: Sort; toggle: (i: number) => void }) {
  return (
    <thead>
      <tr className="border-b border-line text-left">
        {cols.map((c, i) => {
          const on = sort?.i === i
          const Icon = !on ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
          return (
            <th key={c.h} className={clsx('label px-3 py-2.5 font-medium', c.right && 'text-right')} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button onClick={() => toggle(i)} title={c.title ?? `Sort by ${c.h}`}
                className={clsx('inline-flex items-center gap-1 whitespace-nowrap uppercase hover:text-ink', c.right && 'flex-row-reverse', on && 'text-brand')}>
                {c.h}<Icon className={clsx('size-3 shrink-0', !on && 'opacity-40')} />
              </button>
            </th>
          )
        })}
      </tr>
    </thead>
  )
}
