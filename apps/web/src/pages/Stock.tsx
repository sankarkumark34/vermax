import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useParams } from 'react-router'
import { Chip, ErrorBox, Loading, Section, Stat } from '../components/ui'
import { api } from '../lib/api'
import { inr, pct, pctRaw, tone } from '../lib/format'

export default function Stock() {
  const { symbol = '' } = useParams()
  const [deep, setDeep] = useState(false)
  const q = useQuery({ queryKey: ['stock', symbol, deep], queryFn: () => api.stock(symbol, deep), placeholderData: (p) => p })
  if (q.isLoading) return <Loading what={symbol} />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data!
  const last = d.bars.at(-1)!
  const first20 = d.bars.at(-21) ?? d.bars[0]
  const ret20 = last.close / first20.close - 1
  const hi = Math.max(...d.bars.map((b) => b.high))
  const chart = d.bars.map((b) => ({ date: b.date.slice(5), close: b.close }))
  const f = d.fundamentals
  const n = d.sentiment

  return (
    <>
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{symbol}</h1>
          {d.info?.name && <span className="text-slate-400">{d.info.name}</span>}
          {d.info?.sector && <Chip>{d.info.sector}</Chip>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Last close" value={`₹${inr(last.close)}`} sub={last.date} />
          <Stat label="20-day" value={pct(ret20, 1, true)} tone={tone(ret20)} />
          <Stat label="From 180d high" value={pctRaw((last.close / hi - 1) * 100)} tone={tone(last.close / hi - 1)} />
          <Stat label="Model rank" value={d.model ? `#${d.model.modelRank}` : 'n/a'} sub={d.model ? `of ${d.model.of} liquid · score ${(d.model.score * 100).toFixed(1)}` : 'not in liquid universe'} />
        </div>
      </div>

      <Section title="Price · last 180 sessions">
        <div className="card h-72 p-3">
          <ResponsiveContainer>
            <AreaChart data={chart}>
              <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.35} /><stop offset="100%" stopColor="#34d399" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="#1a2540" vertical={false} />
              <XAxis dataKey="date" stroke="#4b5b7c" fontSize={11} minTickGap={40} />
              <YAxis stroke="#4b5b7c" fontSize={11} domain={['auto', 'auto']} width={56} />
              <Tooltip contentStyle={{ background: '#0d1424', border: '1px solid #1e2a44', borderRadius: 8, fontSize: 12 }} />
              <Area dataKey="close" stroke="#34d399" strokeWidth={2} fill="url(#g)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Fundamentals & news" right={!deep && <button onClick={() => setDeep(true)} className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-400/20">Load deep analysis</button>}>
        {!deep ? <div className="card p-5 text-sm text-slate-400">Loads ROE / ROCE / debt / growth (Yahoo Finance) and the latest news sentiment. Takes a few seconds.</div> : q.isFetching && !f ? <Loading what="analysis" /> : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card p-4">
              <div className="label mb-2">Quality</div>
              {f?.ok ? (
                <>
                  <div className="mb-3 flex gap-2"><Chip tone={f.verdict === 'PASS' ? 'green' : f.verdict === 'AVOID' ? 'red' : 'gold'}>{f.verdict} · {f.qualityScore}/100</Chip>{f.marketCapCr && <Chip>Mcap ₹{Math.round(f.marketCapCr).toLocaleString('en-IN')} Cr</Chip>}</div>
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="ROE (3y)" value={pct(f.roe3yAvg ?? f.roe, 0)} />
                    <Stat label="ROCE" value={pct(f.roce, 0)} />
                    <Stat label="Debt/Equity" value={f.debtToEquity?.toFixed(2) ?? '-'} />
                    <Stat label="Sales CAGR" value={pct(f.salesCagr, 0)} />
                    <Stat label="Profit CAGR" value={pct(f.profitCagr, 0)} />
                    <Stat label="P/E" value={f.pe?.toFixed(1) ?? '-'} />
                  </div>
                  {f.flags.length > 0 && <p className="mt-3 text-xs text-amber-300/90">{f.flags.join(' · ')}</p>}
                  {f.nextEarnings && <p className="mt-1 text-xs text-slate-500">Next results ≈ {f.nextEarnings}</p>}
                </>
              ) : <p className="text-sm text-slate-500">Unavailable.</p>}
            </div>
            <div className="card p-4">
              <div className="label mb-2">News</div>
              {n ? (
                <>
                  <div className="mb-3 flex gap-2"><Chip tone={n.label === 'POSITIVE' ? 'green' : n.label === 'NEGATIVE' ? 'red' : 'default'}>{n.label} · {n.score.toFixed(2)}</Chip>{n.severe && <Chip tone="red">red-flag headline</Chip>}</div>
                  <ul className="space-y-1.5 text-[13px]">
                    {n.items.slice(0, 7).map((h) => (
                      <li key={h.link}><a href={h.link} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-white">{h.title}</a> <span className="text-slate-500">— {h.source ?? 'news'} · {h.ageDays}d</span></li>
                    ))}
                  </ul>
                </>
              ) : <p className="text-sm text-slate-500">No news loaded.</p>}
            </div>
          </div>
        )}
      </Section>
    </>
  )
}
