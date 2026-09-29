import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import PriceChart from '../components/PriceChart'
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
    const f = d.fundamentals
  const n = d.sentiment

  return (
    <>
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{symbol}</h1>
          {d.info?.name && <span className="text-sub">{d.info.name}</span>}
          {d.info?.sector && <Chip>{d.info.sector}</Chip>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Last close" value={`₹${inr(last.close)}`} sub={last.date} />
          <Stat label="20-day" value={pct(ret20, 1, true)} tone={tone(ret20)} />
          <Stat label="From 1Y high" value={pctRaw((last.close / hi - 1) * 100)} tone={tone(last.close / hi - 1)} />
          <Stat label="Model rank" value={d.model ? `#${d.model.modelRank}` : 'n/a'} sub={d.model ? `of ${d.model.of} liquid · score ${(d.model.score * 100).toFixed(1)}` : 'not in liquid universe'} />
        </div>
      </div>

      <Section title="Price">
        <PriceChart bars={d.bars} />
      </Section>

      <Section title="Fundamentals & news" right={!deep && <button onClick={() => setDeep(true)} className="rounded-lg border border-pos/30 bg-pos-bg px-3 py-1.5 text-sm text-pos hover:bg-pos-bg/70">Load deep analysis</button>}>
        {!deep ? <div className="card p-5 text-sm text-sub">Loads ROE / ROCE / debt / growth (Yahoo Finance) and the latest news sentiment. Takes a few seconds.</div> : q.isFetching && !f ? <Loading what="analysis" /> : (
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
                  {f.flags.length > 0 && <p className="mt-3 text-xs text-amber">{f.flags.join(' · ')}</p>}
                  {f.nextEarnings && <p className="mt-1 text-xs text-mute">Next results ≈ {f.nextEarnings}</p>}
                </>
              ) : <p className="text-sm text-mute">Unavailable.</p>}
            </div>
            <div className="card p-4">
              <div className="label mb-2">News</div>
              {n ? (
                <>
                  <div className="mb-3 flex gap-2"><Chip tone={n.label === 'POSITIVE' ? 'green' : n.label === 'NEGATIVE' ? 'red' : 'default'}>{n.label} · {n.score.toFixed(2)}</Chip>{n.severe && <Chip tone="red">red-flag headline</Chip>}</div>
                  <ul className="space-y-1.5 text-[13px]">
                    {n.items.slice(0, 7).map((h) => (
                      <li key={h.link}><a href={h.link} target="_blank" rel="noreferrer" className="text-sub hover:text-ink">{h.title}</a> <span className="text-mute">— {h.source ?? 'news'} · {h.ageDays}d</span></li>
                    ))}
                  </ul>
                </>
              ) : <p className="text-sm text-mute">No news loaded.</p>}
            </div>
          </div>
        )}
      </Section>
    </>
  )
}
