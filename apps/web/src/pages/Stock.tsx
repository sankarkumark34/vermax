import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import PriceChart from '../components/PriceChart'
import { useParams } from 'react-router'
import { Chip, ErrorBox, Loading, Section, Stat } from '../components/ui'
import { api } from '../lib/api'
import { dateLabel, inr, pct, pctRaw, tone } from '../lib/format'

export default function Stock() {
  const { symbol = '' } = useParams()
  const [deep, setDeep] = useState(false)
  const q = useQuery({ queryKey: ['stock', symbol, deep], queryFn: () => api.stock(symbol, deep), placeholderData: (p) => p })
  const live = useQuery({ queryKey: ['quote', symbol], queryFn: () => api.quote(symbol), refetchInterval: 60_000 })
  if (q.isLoading) return <Loading what={symbol} />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data!
  const last = d.bars.at(-1)!
  const first20 = d.bars.at(-21) ?? d.bars[0]
  const ret20 = last.close / first20.close - 1
  const hi = Math.max(...d.bars.map((b) => b.high))
  const lq = live.data?.quote
  const f = d.fundamentals
  const n = d.sentiment

  return (
    <>
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{symbol}</h1>
          {d.info?.name && <span className="text-sub">{d.info.name}</span>}
          {d.info?.sector && <Chip>{d.info.sector}</Chip>}
          {lq && (
            <div className="ml-auto text-right" title="Intraday price from Yahoo Finance (may be delayed ~15 min). Display only — all analysis uses the official NSE closing price.">
              <div className="label">Live · delayed</div>
              <div className="num text-[19px] font-semibold leading-tight">₹{inr(lq.price)} <span className={`text-[14px] ${tone(lq.changePct)}`}>{pctRaw(lq.changePct, 2)}</span></div>
              {lq.time && <div className="text-xs text-mute">{new Date(lq.time).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-mute">
          All numbers below are calculated on the official NSE closing price of <b className="text-sub">{dateLabel(last.date)}</b> (bhavcopy). Today's move is only included after NSE publishes the day's closing data (~6:30 PM IST).
        </p>
        <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="NSE close" value={`₹${inr(last.close)}`} sub={dateLabel(last.date)} />
          <Stat label="20-day" value={pct(ret20, 1, true)} tone={tone(ret20)} />
          <Stat label="From 1Y high" value={pctRaw((last.close / hi - 1) * 100)} tone={tone(last.close / hi - 1)} />
          <Stat label="Model rank" value={d.model ? `#${d.model.modelRank}` : 'n/a'} sub={d.model ? `of ${d.model.of} liquid · score ${(d.model.score * 100).toFixed(1)}` : 'not in liquid universe'} />
        </div>
      </div>

      <Section title="Price">
        <PriceChart bars={d.bars} />
      </Section>

      {d.circuit && (
        <Section title="Lower-circuit history" sub="How long this stock took to get back to its pre-circuit price after hitting a lower circuit (NSE data since 2019).">
          {d.circuit.events === 0 ? (
            <div className="card p-5 text-sm text-sub">No lower-circuit days in the stored history for this stock.</div>
          ) : (
            <>
              {d.circuit.lockedNow && <div className="card mb-3 border-neg/30 bg-neg-bg p-4 text-sm font-medium text-neg">Locked at lower circuit on the latest session — avoid fresh entries until it trades freely.</div>}
              <div className="card grid grid-cols-2 gap-6 p-5 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="LC events" value={d.circuit.events} sub={`${d.circuit.recoveredCount} fully recovered`} />
                <Stat label="Median recovery" value={d.circuit.medianRecoveryDays != null ? `${d.circuit.medianRecoveryDays} d` : '-'} sub="sessions to regain price" />
                <Stat label="Half recovery" value={d.circuit.medianHalfRecoveryDays != null ? `${d.circuit.medianHalfRecoveryDays} d` : '-'} sub="median" />
                <Stat label="Within 10 days" value={d.circuit.recoveredWithin10Pct != null ? `${d.circuit.recoveredWithin10Pct}%` : '-'} sub="of events" />
                <Stat label="Within 30 days" value={d.circuit.recoveredWithin30Pct != null ? `${d.circuit.recoveredWithin30Pct}%` : '-'} sub="of events" />
                <Stat label="Further fall" value={pct(d.circuit.medianFurtherFallPct, 1)} tone="text-neg" sub="median, next 10 days" />
              </div>
              <div className="card mt-3 overflow-x-auto">
                <table className="num w-full min-w-[720px] text-sm">
                  <thead><tr className="border-b border-line text-left">
                    {['Date', 'Band', 'Locked days', 'Fall', 'Further fall (10d)', 'Half back', 'Fully back', 'Status'].map((h) => <th key={h} className="label px-3 py-2.5 font-medium">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {d.circuit.list.slice(0, 10).map((e) => (
                      <tr key={e.date} className="border-b border-line">
                        <td className="px-3 py-2">{e.date}</td>
                        <td className="px-3 py-2">{e.band}%</td>
                        <td className="px-3 py-2">{e.lockDays}</td>
                        <td className="px-3 py-2 text-neg">{pct(e.dropPct, 1)}</td>
                        <td className="px-3 py-2 text-neg">{pct(e.furtherFallPct, 1)}</td>
                        <td className="px-3 py-2">{e.halfRecoveryDays != null ? `${e.halfRecoveryDays} d` : '-'}</td>
                        <td className="px-3 py-2 font-medium">{e.recoveryDays != null ? `${e.recoveryDays} d` : '-'}</td>
                        <td className="px-3 py-2">{e.recovered ? <Chip tone="green">Recovered</Chip> : <Chip tone="red">{pct(e.currentVsRefPct, 0, true)} vs pre-LC</Chip>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>
      )}

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
