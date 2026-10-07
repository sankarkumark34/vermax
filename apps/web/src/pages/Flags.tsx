import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useState } from 'react'
import { Link } from 'react-router'
import { PageHead } from '../components/selection'
import { Chip, ErrorBox, Loading } from '../components/ui'
import { sel } from '../lib/selection'

const TABS = [['suggested', 'To review'], ['confirmed', 'Confirmed'], ['resolved', 'Dismissed']] as const

export default function Flags() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('suggested')
  const q = useQuery({ queryKey: ['flags', tab], queryFn: () => sel.flags(tab) })
  const review = useMutation({ mutationFn: ({ id, status }: { id: number; status: 'confirmed' | 'resolved' | 'suggested' }) => sel.reviewFlag(id, status), onSuccess: () => qc.invalidateQueries({ queryKey: ['flags'] }) })
  const [m, setM] = useState({ symbol: '', category: 'governance', level: '2', title: '' })
  const add = useMutation({
    mutationFn: () => sel.addFlag(m.symbol.toUpperCase(), { category: m.category, level: Number(m.level), title: m.title }),
    onSuccess: () => { setM({ ...m, symbol: '', title: '' }); qc.invalidateQueries({ queryKey: ['flags'] }) },
  })
  return (
    <>
      <PageHead
        label="Stock selection"
        title="Red-flag review"
        sub="Flags read from NSE filings are only suggestions. Confirm the ones that are real: a confirmed level-3 flag forces AVOID, a level-2 flag costs points. Dismissed flags are ignored."
      />
      <div className="mb-4 flex gap-1.5">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={clsx('rounded-lg border px-3 py-1.5 text-[13px]', tab === k ? 'border-brand bg-brand-soft text-brand' : 'border-line text-sub hover:bg-soft')}>{label}</button>
        ))}
      </div>
      {q.isLoading && <Loading what="flags" />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && q.data.length === 0 && <div className="card p-8 text-center text-sm text-sub">Nothing here.</div>}
      {q.data && q.data.length > 0 && (
        <div className="card divide-y divide-line">
          {q.data.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
              <Link to={`/verdict/${f.symbol}`} className="w-28 font-semibold hover:text-brand">{f.symbol}</Link>
              <Chip tone={f.level === 3 ? 'red' : f.level === 2 ? 'gold' : 'default'}>L{f.level} {f.category}</Chip>
              <span className="min-w-0 flex-1 text-sub">{f.title}</span>
              <span className="num text-[12px] text-mute">{f.detectedOn}</span>
              {f.link && <a href={f.link} target="_blank" rel="noreferrer" className="text-[12.5px] text-brand">filing</a>}
              {tab !== 'confirmed' && <button onClick={() => review.mutate({ id: f.id, status: 'confirmed' })} className="rounded border border-line px-2 py-1 text-[12px] hover:bg-neg-bg hover:text-neg">Confirm</button>}
              {tab !== 'resolved' && <button onClick={() => review.mutate({ id: f.id, status: 'resolved' })} className="rounded border border-line px-2 py-1 text-[12px] hover:bg-soft">Dismiss</button>}
              {tab !== 'suggested' && <button onClick={() => review.mutate({ id: f.id, status: 'suggested' })} className="rounded border border-line px-2 py-1 text-[12px] hover:bg-soft">Back to review</button>}
            </div>
          ))}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); if (m.symbol && m.title) add.mutate() }} className="card mt-6 flex flex-wrap items-end gap-3 p-4">
        <div className="w-full text-[13px] font-medium">Add a flag manually (applied immediately)</div>
        <label><div className="label mb-1">Symbol</div><input value={m.symbol} onChange={(e) => setM({ ...m, symbol: e.target.value })} className="w-28 uppercase" /></label>
        <label><div className="label mb-1">Category</div>
          <select value={m.category} onChange={(e) => setM({ ...m, category: e.target.value })}>{['accounting', 'governance', 'financial', 'market', 'business'].map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label><div className="label mb-1">Level</div><select value={m.level} onChange={(e) => setM({ ...m, level: e.target.value })}><option value="1">1 record</option><option value="2">2 penalty</option><option value="3">3 gate</option></select></label>
        <label className="min-w-64 flex-1"><div className="label mb-1">What happened</div><input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} className="w-full" /></label>
        <button className="rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white" disabled={add.isPending}>Add</button>
        {add.error && <span className="text-[12.5px] text-neg">{(add.error as Error).message}</span>}
      </form>
    </>
  )
}
