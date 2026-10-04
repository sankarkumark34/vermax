import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, Check, Minus, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Chip, ErrorBox, Loading } from '../components/ui'
import { inr, pctRaw, tone } from '../lib/format'

interface CheckRow { id: string; group: string; label: string; value: string; standard: string; pass: boolean | null; note?: string }
interface Group { key: string; label: string; weight: number; passed: number; evaluated: number; total: number; score: number | null }
interface Analysis {
  score: number | null; verdict: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'AVOID' | 'NOT_ENOUGH_DATA'; label: string
  coverage: { evaluated: number; total: number }; redFlags: string[]; notes: string[]; strengths: string[]; concerns: string[]; groups: Group[]; checks: CheckRow[]
}
interface Resp {
  symbol: string; name: string | null; sector: string | null; status: 'listed' | 'upcoming'
  price?: { asOf: string; close: number; chg1: number | null; ret1m: number | null; ret3m: number | null; ret1y: number | null; high52: number | null; low52: number | null }
  quote?: { price: number; changePct: number | null; time: string | null } | null
  industry?: { index: string; pe: number | null; yahooIndustry?: string | null } | null
  fundamentals?: { marketCapCr?: number | null; industry?: string | null; statementYears?: number }
  ipo?: {
    company: string; issuePrice: number | null; priceRange: string | null; ipoStart: string | null; ipoEnd: string | null; listingDate: string | null; recent?: boolean
    listingGain?: number | null; vsIssue?: number | null; subscription?: { qib: number | null; nii: number | null; retail: number | null; total: number | null } | null
  } | null
  sentiment?: { label: string; headlines: number; items: { title: string; link: string; source: string | null }[] }
  analysis: Analysis
}

const VERDICT_TONE: Record<Analysis['verdict'], string> = {
  STRONG_BUY: 'bg-pos text-white', BUY: 'bg-pos-bg text-pos', WATCH: 'bg-amber-bg text-amber', AVOID: 'bg-neg-bg text-neg', NOT_ENOUGH_DATA: 'bg-soft text-sub',
}
const RING: Record<Analysis['verdict'], string> = { STRONG_BUY: '#0a7a52', BUY: '#0a7a52', WATCH: '#b8791a', AVOID: '#b3261e', NOT_ENOUGH_DATA: '#8492a6' }

function ScoreRing({ score, verdict }: { score: number | null; verdict: Analysis['verdict'] }) {
  const r = 46, c = 2 * Math.PI * r, v = score ?? 0
  return (
    <svg viewBox="0 0 120 120" className="size-32 shrink-0">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#e4e8ef" strokeWidth="10" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={RING[verdict]} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 60 60)" />
      <text x="60" y="58" textAnchor="middle" className="fill-ink" style={{ fontSize: 30, fontWeight: 700 }}>{score ?? '–'}</text>
      <text x="60" y="78" textAnchor="middle" style={{ fontSize: 11, fill: '#8492a6' }}>out of 100</text>
    </svg>
  )
}

function SearchBox({ initial }: { initial?: string }) {
  const [q, setQ] = useState(initial ?? '')
  const [debounced, setDebounced] = useState(q)
  const [open, setOpen] = useState(false)
  const go = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 220); return () => clearTimeout(t) }, [q])
  useEffect(() => { const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [])
  const s = useQuery({ queryKey: ['search', debounced], enabled: debounced.trim().length >= 2, queryFn: async () => (await (await fetch(`/api/search?q=${encodeURIComponent(debounced)}`)).json()) as { symbol: string; name: string; kind: 'stock' | 'ipo' }[] })
  const pick = (sym: string) => { setOpen(false); go(`/analyse/${sym}`) }
  return (
    <div ref={box} className="relative max-w-2xl">
      <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-mute" />
      <input
        value={q}
        autoFocus={!initial}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && s.data?.[0]) pick(s.data[0].symbol) }}
        placeholder="Search any NSE stock or IPO — e.g. Orient Cables, HAL, TATAPOWER"
        className="w-full !rounded-xl !py-3.5 pl-12 text-[15px] shadow-sm"
      />
      {open && s.data && s.data.length > 0 && (
        <ul className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-line-strong bg-surface shadow-lg">
          {s.data.map((r) => (
            <li key={r.symbol}>
              <button onClick={() => pick(r.symbol)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-soft">
                <span><b className="text-ink">{r.symbol}</b> <span className="text-sub">{r.name}</span></span>
                {r.kind === 'ipo' && <Chip tone="blue">IPO</Chip>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Mark({ pass }: { pass: boolean | null }) {
  if (pass === true) return <span className="grid size-5 place-items-center rounded-full bg-pos-bg text-pos"><Check className="size-3.5" strokeWidth={3} /></span>
  if (pass === false) return <span className="grid size-5 place-items-center rounded-full bg-neg-bg text-neg"><X className="size-3.5" strokeWidth={3} /></span>
  return <span className="grid size-5 place-items-center rounded-full bg-soft text-mute"><Minus className="size-3.5" strokeWidth={3} /></span>
}

export default function Analyse() {
  const { symbol } = useParams()
  const q = useQuery({ queryKey: ['analyse', symbol], enabled: !!symbol, queryFn: async () => {
    const r = await fetch(`/api/analyse/${encodeURIComponent(symbol!)}`)
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `${r.status}`)
    return (await r.json()) as Resp
  }, staleTime: 10 * 60_000 })

  return (
    <>
      <div className="label">Stock analysis</div>
      <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight">Should I buy this stock?</h1>
      <p className="mb-5 mt-1 max-w-3xl text-[13px] text-sub">Checks the few things that matter — business quality, valuation against its industry, price trend, risk, news and (for IPOs) investor demand — against common industry standards, and turns them into one score.</p>
      <SearchBox key={symbol} initial={symbol} />

      {!symbol && <div className="card mt-6 p-8 text-center text-sm text-sub">Type a company name or symbol above. Recent and upcoming IPOs are included.</div>}
      {symbol && q.isLoading && <div className="mt-6"><Loading what={`${symbol} (first time takes ~20 s)`} /></div>}
      {symbol && q.error && <div className="mt-6"><ErrorBox error={q.error} /></div>}
      {q.data && <Result d={q.data} />}
    </>
  )
}

function Result({ d }: { d: Resp }) {
  const a = d.analysis
  const listed = d.status === 'listed'
  const groups = a.groups.filter((g) => g.total > 0 && (listed || g.evaluated > 0))
  const ipo = d.ipo
  return (
    <div className="mt-6 space-y-5">
      <div className="card flex flex-wrap items-center gap-6 p-6">
        <ScoreRing score={a.score} verdict={a.verdict} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[22px] font-semibold tracking-tight">{d.name ?? d.symbol}</h2>
            <Chip>{d.symbol}</Chip>
            {d.sector && d.sector !== 'Other' && <Chip tone={d.sector === 'Defence' ? 'gold' : d.sector === 'Engineering' ? 'blue' : 'default'}>{d.sector}</Chip>}
            {!listed && <Chip tone="blue">IPO · not listed yet</Chip>}
          </div>
          <div className={clsx('mt-3 inline-block rounded-lg px-3 py-1.5 text-[15px] font-semibold', VERDICT_TONE[a.verdict])}>{a.label}</div>
          <p className="mt-2 text-[13px] text-sub">
            {a.verdict === 'NOT_ENOUGH_DATA'
              ? listed ? 'Too few metrics are available to score this stock reliably.' : 'Not listed yet: price history and fundamentals become available after listing. IPO demand is shown below.'
              : `Based on ${a.coverage.evaluated} of ${a.coverage.total} checks · Strong buy ≥ 75 · Buy ≥ 60 · Watch ≥ 45 · below is Avoid.`}
          </p>
        </div>
        {d.price && (
          <div className="text-right">
            <div className="label">NSE close · {d.price.asOf}</div>
            <div className="num text-[24px] font-semibold">₹{inr(d.price.close)}</div>
            <div className="num text-[13px]"><span className={tone(d.price.chg1)}>{pctRaw(d.price.chg1, 2)}</span> <span className="text-mute">· 1Y</span> <span className={tone(d.price.ret1y)}>{pctRaw(d.price.ret1y, 1)}</span></div>
            {d.quote && <div className="num mt-1 text-xs text-mute">Live (delayed) ₹{inr(d.quote.price)} <span className={tone(d.quote.changePct)}>{pctRaw(d.quote.changePct, 2)}</span></div>}
            <Link to={`/stock/${d.symbol}`} className="mt-2 inline-block text-[13px] font-medium text-brand hover:underline">Chart & full details →</Link>
          </div>
        )}
      </div>

      {a.redFlags.length > 0 && (
        <div className="card flex items-start gap-3 border-neg/30 bg-neg-bg p-4 text-[13.5px] text-neg">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div><b>Red flags:</b> {a.redFlags.join(' · ')}. The score is capped at Avoid.</div>
        </div>
      )}

      {a.notes.length > 0 && (
        <div className="card flex items-start gap-3 border-amber/30 bg-amber-bg p-4 text-[13.5px] text-amber">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>{a.notes.join(' · ')}.</div>
        </div>
      )}

      {(a.strengths.length > 0 || a.concerns.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-5">
            <div className="label mb-2 !text-pos">Strengths</div>
            <ul className="space-y-1.5 text-[13.5px]">{a.strengths.length ? a.strengths.map((s) => <li key={s} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-pos" />{s}</li>) : <li className="text-mute">None found.</li>}</ul>
          </div>
          <div className="card p-5">
            <div className="label mb-2 !text-neg">Concerns</div>
            <ul className="space-y-1.5 text-[13.5px]">{a.concerns.length ? a.concerns.map((s) => <li key={s} className="flex gap-2"><X className="mt-0.5 size-4 shrink-0 text-neg" />{s}</li>) : <li className="text-mute">None found.</li>}</ul>
          </div>
        </div>
      )}

      {ipo && (ipo.recent || !listed) && (
        <div className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="label">IPO details</div>
            <span className="text-xs text-mute">Source: NSE IPO data</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-[13.5px] sm:grid-cols-4">
            <div><div className="text-xs text-mute">{ipo.issuePrice ? 'Issue price' : 'Price band'}</div><div className="num font-semibold">{ipo.issuePrice ? `₹${inr(ipo.issuePrice)}` : (ipo.priceRange ?? '-')}</div></div>
            <div><div className="text-xs text-mute">Bidding</div><div className="num font-semibold">{ipo.ipoStart ?? '-'} → {ipo.ipoEnd ?? '-'}</div></div>
            <div><div className="text-xs text-mute">Listing</div><div className="num font-semibold">{ipo.listingDate ?? 'not yet'}</div></div>
            {ipo.vsIssue != null && <div><div className="text-xs text-mute">vs issue · listing gain</div><div className="num font-semibold"><span className={tone(ipo.vsIssue)}>{pctRaw(ipo.vsIssue, 1)}</span> · <span className={tone(ipo.listingGain)}>{pctRaw(ipo.listingGain ?? null, 1)}</span></div></div>}
          </div>
          {ipo.subscription && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([['Institutions (QIB)', ipo.subscription.qib], ['HNI (NII)', ipo.subscription.nii], ['Retail', ipo.subscription.retail], ['Total', ipo.subscription.total]] as const).map(([l, v]) => (
                <div key={l} className="rounded-lg bg-soft px-3 py-2.5">
                  <div className="text-xs text-mute">{l}</div>
                  <div className={clsx('num text-[18px] font-semibold', v == null ? 'text-mute' : v >= 10 ? 'text-pos' : v >= 1 ? 'text-ink' : 'text-neg')}>{v == null ? '-' : `${v.toFixed(1)}×`}</div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-mute">Subscription = times the shares on offer were applied for. Strong institutional (QIB) demand is the most watched signal; very high retail-only demand is less reliable.</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {groups.map((g) => {
          const rows = a.checks.filter((c) => c.group === g.key)
          return (
            <div key={g.key} className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <div><span className="text-[15px] font-semibold">{g.label}</span> <span className="text-xs text-mute">· weight {Math.round(g.weight * 100)}%</span></div>
                <span className="num text-[13px] font-semibold text-ink">{g.evaluated ? `${g.passed}/${g.evaluated} pass` : 'no data'}</span>
              </div>
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line"><div className={clsx('h-full rounded-full', (g.score ?? 0) >= 65 ? 'bg-pos' : (g.score ?? 0) >= 45 ? 'bg-amber' : 'bg-neg')} style={{ width: `${g.score ?? 0}%` }} /></div>
              <ul className="divide-y divide-line">
                {rows.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2 text-[13px]" title={c.note}>
                    <Mark pass={c.pass} />
                    <span className="min-w-0 flex-1 text-ink">{c.label}<span className="block text-[11.5px] text-mute">standard {c.standard}{c.note ? ` · ${c.note}` : ''}</span></span>
                    <span className={clsx('num text-right font-medium', c.pass === true ? 'text-pos' : c.pass === false ? 'text-neg' : 'text-mute')}>{c.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {d.sentiment && d.sentiment.items.length > 0 && (
        <div className="card p-5">
          <div className="label mb-2">Latest news</div>
          <ul className="space-y-1.5 text-[13px]">
            {d.sentiment.items.map((h) => <li key={h.link}><a href={h.link} target="_blank" rel="noreferrer" className="text-ink hover:text-brand">{h.title}</a> <span className="text-mute">— {h.source ?? 'news'}</span></li>)}
          </ul>
        </div>
      )}

      <p className="text-xs leading-relaxed text-mute">
        Standards are common rules of thumb used by analysts (ROE and ROCE ≥ 15%, debt/equity ≤ 0.5, interest cover ≥ 3×, growth ≥ 10% a year, P/E within 1.2× of the NSE sector index P/E
        {d.industry ? ` — here ${d.industry.index} at ${d.industry.pe}` : ''}). Fundamentals come from Yahoo Finance and may lag the latest quarter. This is a transparent checklist, not a backtested
        forecast and not investment advice.
      </p>
    </div>
  )
}
