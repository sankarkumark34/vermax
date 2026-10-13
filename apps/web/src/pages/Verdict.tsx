import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertOctagon, ArrowLeft, Bell, Check, ChevronDown, ExternalLink, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Disclaimer, ScoreBar, StatusPill, VerdictBadge } from '../components/selection'
import { Chip, ErrorBox, Loading, Section, Stat } from '../components/ui'
import { inr, inr0 } from '../lib/format'
import { PHASES, sel, type Analysis, type StepResult } from '../lib/selection'

export default function VerdictPage() {
  const { symbol = '' } = useParams()
  const [refresh, setRefresh] = useState(0)
  const q = useQuery({ queryKey: ['analysis', symbol, refresh], queryFn: () => sel.analysis(symbol, refresh > 0), staleTime: 10 * 60_000, placeholderData: (p) => p })

  if (q.isLoading) return <Loading what={`${symbol} analysis (first time fetches company data, ~20 s)`} />
  if (q.error) return <ErrorBox error={q.error} hint="Check the symbol, or that NSE price history exists for it." />
  const a = q.data!

  return (
    <>
      <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-sub hover:text-brand"><ArrowLeft className="size-3.5" /> Top Picks</Link>
      <div className="card p-5">
        <div className="flex flex-wrap items-start gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">{a.symbol}</h1>
              <VerdictBadge v={a.verdict} size="lg" />
              {a.sector && <Chip>{a.sector}</Chip>}
              <Chip tone="blue" title={a.template.description}>{a.template.label}</Chip>
            </div>
            {a.name && <div className="mt-1 text-sub">{a.name}</div>}
            <p className="mt-3 text-[15px] font-medium text-ink">{a.reason}</p>
            <ul className="mt-2 space-y-1 text-[13px] text-sub">
              {a.reasons.map((r) => <li key={r}>• {r}</li>)}
            </ul>
            {a.watch && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-bg px-3 py-1.5 text-[13px] text-amber">
                <Bell className="size-3.5" /> Watch level ₹{inr(a.watch.alertPrice)} · {a.watch.zone}
              </p>
            )}
          </div>
          <div className="w-56 shrink-0">
            <div className="flex items-end justify-between">
              <span className="label">Score</span>
              <span className="num text-[32px] font-bold leading-none">{a.totalScore}<span className="text-[14px] font-medium text-mute">/100</span></span>
            </div>
            <div className="mt-2"><ScoreBar score={a.totalScore} /></div>
            <div className="mt-2 text-[12px] text-sub">
              {Math.round(a.coverage * 100)}% of the framework evaluated{a.penalty ? ` · −${a.penalty} red-flag penalty` : ''}
            </div>
            <div className="mt-1 text-[12px] text-mute">NSE close of {a.asOfDate} · config v{a.configVersion}{a.cached ? ' · stored run' : ''}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setRefresh((x) => x + 1)} disabled={q.isFetching} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] hover:bg-soft disabled:opacity-60">
                {q.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Re-run
              </button>
              <Link to={`/stock/${a.symbol}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] hover:bg-soft">Chart <ExternalLink className="size-3" /></Link>
            </div>
          </div>
        </div>
      </div>

      <FlagsPanel a={a} />
      <Explanation symbol={a.symbol} runId={a.runId} />

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <EntryChart a={a} />
        <EntryPlan a={a} />
      </div>

      <Section title="18-step scorecard" sub="Grouped by phase. Gates are evaluated first; steps 16-18 carry no points (red flags gate or penalise, technical entry times, risk sizes).">
        <Scorecard steps={a.steps} />
      </Section>

      {a.catalysts.length > 0 && (
        <Section title="Catalysts" sub="From exchange filings, quarterly results and shareholding changes.">
          <div className="card divide-y divide-line">
            {a.catalysts.map((c, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
                <Chip tone="green">{c.kind}</Chip>
                <span className="flex-1 text-sub">{c.title}</span>
                <span className="num text-mute">{c.date}</span>
                {c.link && <a href={c.link} target="_blank" rel="noreferrer" className="text-brand"><ExternalLink className="size-3.5" /></a>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {a.dataNotes.length > 0 && <p className="mt-6 text-[12px] text-mute">Data notes: {a.dataNotes.join(' · ')}</p>}
      <History symbol={a.symbol} />
      <Disclaimer />
    </>
  )
}

function FlagsPanel({ a }: { a: Analysis }) {
  const qc = useQueryClient()
  const stored = useQuery({ queryKey: ['flags', a.symbol], queryFn: () => sel.flags(undefined, a.symbol) })
  const review = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'confirmed' | 'resolved' }) => sel.reviewFlag(id, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['flags'] }) },
  })
  const active = a.redFlags.filter((f) => f.status === 'auto' || f.status === 'confirmed')
  const suggested = (stored.data ?? []).filter((f) => f.status === 'suggested')
  if (!a.gates.length && !active.length && !suggested.length) return null
  return (
    <div className={clsx('card mt-5 p-4', a.gates.length ? 'border-neg/40' : 'border-amber/40')}>
      <div className="flex items-center gap-2 font-semibold text-ink"><AlertOctagon className={clsx('size-4', a.gates.length ? 'text-neg' : 'text-amber')} /> Gates and red flags</div>
      {a.gates.length > 0 && (
        <ul className="mt-2 space-y-1 text-[13px] text-neg">
          {a.gates.map((g) => <li key={g}>Gate: {g}</li>)}
        </ul>
      )}
      {active.filter((f) => f.level < 3).map((f) => (
        <div key={f.title} className="mt-2 text-[13px] text-amber">Level {f.level} ({f.category}): {f.title}</div>
      ))}
      {suggested.length > 0 && (
        <div className="mt-3">
          <div className="label mb-1.5">Suggested from filings: review to apply</div>
          <div className="divide-y divide-line rounded-lg border border-line">
            {suggested.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12.5px]">
                <Chip tone={f.level === 3 ? 'red' : 'gold'}>L{f.level} {f.category}</Chip>
                <span className="min-w-0 flex-1 text-sub">{f.title}</span>
                {f.link && <a href={f.link} target="_blank" rel="noreferrer" className="text-brand">filing</a>}
                <button onClick={() => review.mutate({ id: f.id, status: 'confirmed' })} className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 hover:bg-neg-bg hover:text-neg"><Check className="size-3" /> Confirm</button>
                <button onClick={() => review.mutate({ id: f.id, status: 'resolved' })} className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 hover:bg-soft"><X className="size-3" /> Dismiss</button>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-mute">Confirmed level-3 flags gate the stock and level-2 flags cost points from the next run (press Re-run to apply now).</p>
        </div>
      )}
    </div>
  )
}

function Explanation({ symbol, runId }: { symbol: string; runId: number }) {
  const [on, setOn] = useState(false)
  const q = useQuery({ queryKey: ['explain', symbol, runId], queryFn: () => sel.explain(symbol), enabled: on, staleTime: Infinity })
  return (
    <div className="card mt-5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-brand" /> Plain-language explanation</div>
        {!on && <button onClick={() => setOn(true)} className="rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-white">Explain</button>}
      </div>
      {q.isFetching && <p className="mt-2 text-[13px] text-mute">Writing explanation…</p>}
      {q.error && <p className="mt-2 text-[13px] text-neg">{(q.error as Error).message}</p>}
      {q.data && (
        <>
          <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-ink">{q.data.text}</p>
          <p className="mt-2 text-[11.5px] text-mute">{q.data.model}{q.data.grounded ? ' · every number checked against the engine output' : ''}</p>
        </>
      )}
    </div>
  )
}

function EntryChart({ a }: { a: Analysis }) {
  const q = useQuery({ queryKey: ['sel-prices', a.symbol], queryFn: () => sel.prices(a.symbol, '6m') })
  const t = a.technical
  if (!q.data) return <div className="card p-4"><Loading what="prices" /></div>
  const data = q.data.bars.map((b) => ({ date: b.date.slice(5), close: b.close }))
  const levels = [t?.plan.stop, t?.plan.target, a.watch?.alertPrice, ...q.data.bars.map((b) => b.close)].filter((x): x is number => x != null)
  const lo = Math.min(...levels) * 0.98, hi = Math.max(...levels) * 1.02
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">Price, last 6 months</span>
        <span className="flex gap-3 text-[11.5px] text-sub"><span className="text-blue">— entry</span><span className="text-neg">— stop</span><span className="text-pos">— target</span>{a.watch && <span className="text-amber">— watch</span>}</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="#eef1f5" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8492a6' }} minTickGap={40} />
          <YAxis domain={[lo, hi]} tick={{ fontSize: 11, fill: '#8492a6' }} width={56} tickFormatter={(v: number) => inr0(v)} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => [`₹${inr(Number(v))}`, 'Close']} />
          {t?.support && <ReferenceArea y1={t.support.low} y2={t.support.high} fill="#0a7a52" fillOpacity={0.08} />}
          {t?.resistance && <ReferenceArea y1={t.resistance.low} y2={t.resistance.high} fill="#b3261e" fillOpacity={0.06} />}
          <Line dataKey="close" stroke="#16345c" strokeWidth={1.8} dot={false} />
          {t && <ReferenceLine y={t.plan.entry} stroke="#1c4f94" strokeDasharray="4 3" />}
          {t && <ReferenceLine y={t.plan.stop} stroke="#b3261e" strokeDasharray="4 3" />}
          {t && <ReferenceLine y={t.plan.target} stroke="#0a7a52" strokeDasharray="4 3" />}
          {a.watch && <ReferenceLine y={a.watch.alertPrice} stroke="#b8791a" strokeDasharray="2 2" />}
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-[11.5px] text-mute">Shaded: nearest support (green) and resistance (red) zones from clustered swing points.</p>
    </div>
  )
}

function EntryPlan({ a }: { a: Analysis }) {
  const t = a.technical
  const p = a.position
  if (!t) return <div className="card p-4 text-sm text-mute">Not enough price history for a technical entry.</div>
  const checks: [string, boolean, string][] = [
    ['Trend', t.checks.trendOk, `${t.trend} (${t.structure.lastHigh ?? '-'} / ${t.structure.lastLow ?? '-'})`],
    ['At a level', t.checks.atLevel, t.levelReasons[0] ?? 'not at support / EMA50 / FVG / retest'],
    ['Candle trigger + volume', t.checks.triggerConfirmed, t.patterns.filter((x) => x.bullish).map((x) => `${x.name} ${x.volumeRatio}× vol`).join(', ') || 'none in the last 2 sessions'],
    ['Not extended', !t.checks.extended, `${t.extendedPct}% above EMA50`],
    ['Reward : risk ≥ 2', t.checks.rrOk, `1 : ${t.checks.rewardRisk}`],
  ]
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Entry plan (step 17)</span>
        <Chip tone={t.technicalReady ? 'green' : 'gold'}>{t.technicalReady ? 'Ready' : 'Not ready'}</Chip>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-3">
        <Stat label="Entry" value={`₹${inr(t.plan.entry)}`} />
        <Stat label="Stop" value={`₹${inr(t.plan.stop)}`} sub={`−${t.plan.riskPct}%`} tone="text-neg" />
        <Stat label="Target" value={`₹${inr(t.plan.target)}`} tone="text-pos" />
        <Stat label="R : R" value={`1 : ${t.plan.rewardRisk}`} />
      </div>
      <p className="mt-2 text-[11.5px] text-mute">Stop {t.plan.stopBasis}. Target: {t.plan.targetBasis}.</p>
      <ul className="mt-3 space-y-1.5">
        {checks.map(([label, ok, detail]) => (
          <li key={label} className="flex items-start gap-2 text-[12.5px]">
            <span className={clsx('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full', ok ? 'bg-pos-bg text-pos' : 'bg-neg-bg text-neg')}>{ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}</span>
            <span><b className="font-medium text-ink">{label}</b> <span className="text-sub">· {detail}</span></span>
          </li>
        ))}
      </ul>
      <Structure t={t} />
      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3 text-[12px] text-sub">
        <div>RSI 14 <b className="num text-ink">{t.rsi14 ?? '-'}</b></div>
        <div>ATR <b className="num text-ink">{t.atrPct}%</b></div>
        <div>RS vs Nifty 3m <b className="num text-ink">{t.rs.m3 ?? '-'} pts</b></div>
      </div>
      {p?.ok && (
        <div className="mt-3 rounded-lg bg-soft p-3 text-[12.5px]">
          <div className="font-medium text-ink">Position size (step 18): {p.qty} shares · ₹{inr0(p.positionValue)} ({p.positionPctOfCapital}% of capital)</div>
          <div className="mt-1 text-sub">
            Risk ₹{inr0(p.actualRisk)} ({p.actualRiskPctOfCapital}%). Limits: by risk {p.qtyByRisk}, by {p.capPct}% cap {p.qtyByCap}, by liquidity {p.qtyByLiquidity ?? 'n/a'} → binding: {p.binding === 'positionCap' ? 'position cap' : p.binding}.
          </div>
        </div>
      )}
    </div>
  )
}

/** Doc section 6.5 tools: Fibonacci retracement / extension, structure (BOS / CHoCH), order block, liquidity sweep, volume profile. */
function Structure({ t }: { t: NonNullable<Analysis['technical']> }) {
  const rows: [string, string][] = []
  if (t.fib) rows.push(['Fibonacci', `${t.fib.dir}-leg ₹${inr(t.fib.from.price)} → ₹${inr(t.fib.to.price)} · ${t.fib.zone}`])
  if (t.targets?.length) rows.push(['Targets', t.targets.slice(0, 4).map((x) => `₹${inr(x.price)} (+${x.pct}%, ${x.basis})`).join(' · ')])
  if (t.lastStructure) rows.push(['Structure', `${t.lastStructure.type} ${t.lastStructure.dir === 'up' ? 'bullish' : 'bearish'} on ${t.lastStructure.date} at ₹${inr(t.lastStructure.level)}`])
  if (t.orderBlock) rows.push(['Order block', `₹${inr(t.orderBlock.low)}-${inr(t.orderBlock.high)} (${t.orderBlock.date})`])
  if (t.liquiditySweep) rows.push(['Liquidity sweep', `wick to ₹${inr(t.liquiditySweep.low)} below ₹${inr(t.liquiditySweep.level)}, closed ₹${inr(t.liquiditySweep.close)} (${t.liquiditySweep.date})`])
  if (t.volumeProfile) rows.push(['Volume profile', `POC ₹${inr(t.volumeProfile.poc)} · value area ₹${inr(t.volumeProfile.val)}-${inr(t.volumeProfile.vah)} (${t.volumeProfile.lookback} sessions)`])
  if (t.breakout) rows.push(['Breakout', `above ₹${inr(t.breakout.level)} on ${t.breakout.date}${t.breakout.retested ? ', retest held' : ''}`])
  if (!rows.length) return null
  return (
    <div className="mt-3 space-y-1 border-t border-line pt-3 text-[12px]">
      {rows.map(([k, v]) => <div key={k} className="flex gap-2"><span className="w-28 shrink-0 text-mute">{k}</span><span className="text-sub">{v}</span></div>)}
    </div>
  )
}

function Scorecard({ steps }: { steps: StepResult[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const phases = [...new Set(steps.map((s) => s.phase))]
  return (
    <div className="space-y-4">
      {phases.map((ph) => (
        <div key={ph} className="card overflow-hidden">
          <div className="border-b border-line bg-soft px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-sub">{ph}. {PHASES[ph]}</div>
          {steps.filter((s) => s.phase === ph).map((s) => (
            <div key={s.step} className="border-b border-line/70 last:border-0">
              <button onClick={() => setOpen(open === s.step ? null : s.step)} className="grid w-full grid-cols-[28px_1fr_90px_150px_70px_20px] items-center gap-3 px-4 py-2.5 text-left hover:bg-soft">
                <span className="num text-[12px] text-mute">{s.step}</span>
                <span className="min-w-0">
                  <span className="font-medium text-ink">{s.name}</span>
                  {s.gate && <Chip tone="red">GATE</Chip>}
                  {s.flags.filter((f) => !f.startsWith('GATE')).slice(0, 1).map((f) => <span key={f} className="ml-2 text-[11.5px] text-amber">{f}</span>)}
                  {s.note && !s.applicable && <span className="ml-2 text-[11.5px] text-mute">{s.note}</span>}
                </span>
                <StatusPill s={s.status} />
                <span>{s.maxScore > 0 && s.applicable ? <><span className="num text-[12.5px]">{s.score} / {s.maxScore}</span><ScoreBar score={s.score} max={s.maxScore} /></> : <span className="text-[12px] text-mute">{s.maxScore ? '' : 'no points'}</span>}</span>
                <span className="num text-[11.5px] text-mute" title="Share of this step's metrics with data">{s.applicable && s.maxScore ? `${Math.round(s.coverage * 100)}% data` : ''}</span>
                <ChevronDown className={clsx('size-4 text-mute transition', open === s.step && 'rotate-180')} />
              </button>
              {open === s.step && (
                <div className="bg-soft/60 px-4 pb-3 pl-14">
                  <table className="w-full text-[12.5px]">
                    <tbody>
                      {s.details.map((m) => (
                        <tr key={m.key} className="border-b border-line/50 last:border-0">
                          <td className="py-1.5 pr-3 text-ink">{m.label}{m.note && <div className="text-[11px] text-mute">{m.note}</div>}</td>
                          <td className="num py-1.5 pr-3 font-medium">{m.display}</td>
                          <td className="py-1.5 pr-3 text-mute">{m.standard}</td>
                          <td className="py-1.5">{m.weight > 0 || m.frac != null ? <StatusPill s={m.status} /> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {s.flags.length > 0 && <ul className="mt-2 text-[12px] text-amber">{s.flags.map((f) => <li key={f}>• {f.replace('GATE: ', 'Gate: ')}</li>)}</ul>}
                  {s.note && <p className="mt-2 text-[11.5px] text-mute">{s.note}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function History({ symbol }: { symbol: string }) {
  const q = useQuery({ queryKey: ['sel-history', symbol], queryFn: () => sel.history(symbol) })
  if (!q.data || q.data.length < 2) return null
  return (
    <Section title="Verdict history" sub="Every stored run, with the config version it used, can be reproduced.">
      <div className="card flex flex-wrap gap-2 p-3">
        {q.data.slice(0, 30).map((h) => (
          <div key={h.id} className="rounded-lg border border-line px-2.5 py-1.5 text-[12px]">
            <div className="num text-mute">{h.asOfDate}</div>
            <div className="flex items-center gap-1.5"><VerdictBadge v={h.verdict} /><span className="num font-medium">{h.totalScore}</span></div>
          </div>
        ))}
      </div>
    </Section>
  )
}

