import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { PageHead } from '../components/selection'
import { ErrorBox, Loading, Section } from '../components/ui'
import { sel, type SelectionConfig } from '../lib/selection'

const STEP_NAMES = ['', 'Business', 'Industry', 'Revenue', 'Profit', 'Margins', 'Cash flow', 'Debt', 'ROE / ROCE', 'Working capital', 'Promoter', 'Management', 'Moat', 'Liquidity', 'Valuation', 'Catalyst']

type Group = 'verdict' | 'gates' | 'penalties' | 'technical' | 'risk' | 'universe'
const FIELDS: Record<Group, [string, string][]> = {
  verdict: [['buyMin', 'BUY minimum score'], ['waitMin', 'WAIT minimum score'], ['minCoverageForBuy', 'Min data coverage for BUY (0-1)']],
  gates: [['interestCoverageBelow', 'Interest coverage gate (×)'], ['pledgeAbovePct', 'Pledge gate (%)'], ['minAdtvCr', 'Min traded value gate (₹ Cr)'], ['negCfoYearsWithProfit', 'Negative-CFO years with profit (gate)']],
  penalties: [['level2Points', 'Points per level-2 flag']],
  technical: [['extendedAboveEma50Pct', 'Max % above EMA50'], ['minRewardRisk', 'Min reward : risk'], ['volumeMultiple', 'Trigger volume (× 20-day avg)'], ['zoneAtrMultiple', 'Zone width (× ATR)']],
  risk: [['capitalInr', 'Capital (₹)'], ['riskPct', 'Risk per trade (%)'], ['capLargePct', 'Position cap, large cap (%)'], ['capMidSmallPct', 'Position cap, mid/small (%)'], ['liquidityPctOfAdtv', 'Max % of daily traded value'], ['largeCapMinCr', 'Large-cap threshold (₹ Cr m-cap)'], ['sectorCapPct', 'Sector exposure cap (%)'], ['totalOpenRiskPct', 'Total open risk limit (%)']],
  universe: [['minAdtvCr', 'Universe: min traded value (₹ Cr)'], ['maxStocks', 'Universe: max stocks per run']],
}
const TITLES: Record<Group, string> = { verdict: 'Verdict', gates: 'Hard gates', penalties: 'Red-flag penalty', technical: 'Technical entry', risk: 'Risk and sizing', universe: 'Nightly universe' }

export default function Settings() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['sel-config'], queryFn: sel.config })
  const versions = useQuery({ queryKey: ['sel-versions'], queryFn: sel.versions })
  const [c, setC] = useState<SelectionConfig | null>(null)
  const [note, setNote] = useState('')
  useEffect(() => { if (q.data) setC(structuredClone(q.data)) }, [q.data])
  const done = () => { qc.invalidateQueries({ queryKey: ['sel-config'] }); qc.invalidateQueries({ queryKey: ['sel-versions'] }) }
  const save = useMutation({ mutationFn: () => sel.saveConfig(c!, note), onSuccess: () => { setNote(''); done() } })
  const activate = useMutation({ mutationFn: sel.activate, onSuccess: done })

  if (q.isLoading || !c) return <Loading what="settings" />
  if (q.error) return <ErrorBox error={q.error} />
  const weightSum = Array.from({ length: 15 }, (_, i) => Number(c.weights[i + 1] ?? 0)).reduce((a, b) => a + b, 0)
  const num = (v: string) => (v === '' ? 0 : Number(v))
  const setGroup = (g: Group, k: string, v: string) => setC({ ...c, [g]: { ...(c[g] as Record<string, unknown>), [k]: num(v) } })
  const dirty = JSON.stringify(c) !== JSON.stringify(q.data)

  return (
    <>
      <PageHead
        label="Stock selection"
        title="Settings: thresholds and weights"
        sub="Every save creates a new config version; older versions are kept and can be re-activated. Each analysis run records the version it used, so past verdicts stay reproducible. Defaults are common-practice starting points, not backtested rules."
        right={
          <div className="flex items-center gap-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed?" className="w-56" />
            <button onClick={() => save.mutate()} disabled={!dirty || save.isPending || Math.abs(weightSum - 100) > 0.001} className="rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50">
              Save as v{(versions.data?.[0]?.version ?? c.version) + 1}
            </button>
          </div>
        }
      />
      {save.error && <div className="mb-4"><ErrorBox error={save.error} /></div>}

      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between font-semibold">
            Step weights <span className={clsx('num text-[13px]', Math.abs(weightSum - 100) > 0.001 ? 'text-neg' : 'text-pos')}>total {weightSum} / 100</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {STEP_NAMES.slice(1).map((name, i) => (
              <label key={name} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="text-sub">{i + 1}. {name}</span>
                <input type="number" value={c.weights[i + 1] ?? 0} onChange={(e) => setC({ ...c, weights: { ...c.weights, [i + 1]: num(e.target.value) } })} className="num w-16 !py-1" />
              </label>
            ))}
          </div>
        </div>
        {(Object.keys(FIELDS) as Group[]).map((g) => (
          <div key={g} className="card p-4">
            <div className="mb-2 font-semibold">{TITLES[g]}</div>
            <div className="space-y-1.5">
              {FIELDS[g].map(([k, label]) => (
                <label key={k} className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="text-sub">{label}</span>
                  <input type="number" step="any" value={(c[g] as Record<string, number>)[k]} onChange={(e) => setGroup(g, k, e.target.value)} className="num w-28 !py-1" />
                </label>
              ))}
              {g === 'gates' && (
                <label className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="text-sub">ASM / GSM listing is a gate</span>
                  <input type="checkbox" checked={c.gates.surveillanceIsGate} onChange={(e) => setC({ ...c, gates: { ...c.gates, surveillanceIsGate: e.target.checked } })} />
                </label>
              )}
              {g === 'verdict' && (
                <label className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="text-sub">10-year G-Sec yield (%)</span>
                  <input type="number" step="any" value={c.gSecYieldPct} onChange={(e) => setC({ ...c, gSecYieldPct: num(e.target.value) })} className="num w-28 !py-1" />
                </label>
              )}
            </div>
          </div>
        ))}
      </div>

      <Section title="Metric thresholds" sub="Linear scoring: full points at or beyond 'good', zero at or beyond 'bad'. Ratios are fractions (0.15 = 15%) unless the name says otherwise.">
        <div className="card grid gap-x-6 p-4 md:grid-cols-2 2xl:grid-cols-3">
          {Object.entries(c.thresholds).map(([k, b]) => (
            <div key={k} className="flex items-center justify-between gap-2 border-b border-line/60 py-1.5 text-[12.5px]">
              <span className="text-sub">{k}</span>
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] text-pos">good</span>
                <input type="number" step="any" value={b.good} onChange={(e) => setC({ ...c, thresholds: { ...c.thresholds, [k]: { ...b, good: num(e.target.value) } } })} className="num w-20 !py-0.5" />
                <span className="text-[11px] text-neg">bad</span>
                <input type="number" step="any" value={b.bad} onChange={(e) => setC({ ...c, thresholds: { ...c.thresholds, [k]: { ...b, bad: num(e.target.value) } } })} className="num w-20 !py-0.5" />
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Sector templates" sub="Applied automatically from the stock's sector (and to loss-making companies). Overrides replace the thresholds above for that group.">
        <div className="grid gap-4 md:grid-cols-2">
          {Object.values(c.templates).map((t) => (
            <div key={t.key} className="card p-4 text-[12.5px]">
              <div className="font-semibold text-ink">{t.label}</div>
              <p className="mt-1 text-sub">{t.description}</p>
              {t.skipSteps.length > 0 && <p className="mt-1.5 text-mute">Steps not applicable: {t.skipSteps.join(', ')}</p>}
              {t.skipMetrics.length > 0 && <p className="mt-1 text-mute">Metrics replaced: {t.skipMetrics.join(', ')}</p>}
              {Object.keys(t.overrides).length > 0 && <p className="mt-1 text-mute">Overrides: {Object.entries(t.overrides).map(([k, b]) => `${k} ${b.good}/${b.bad}`).join(', ')}</p>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Version history">
        <div className="card divide-y divide-line">
          {versions.data?.map((v) => (
            <div key={v.version} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className="num w-10 font-semibold">v{v.version}</span>
              <span className="flex-1 text-sub">{v.note || '-'}</span>
              <span className="num text-[12px] text-mute">{new Date(v.createdAt).toLocaleString('en-IN')}</span>
              {v.active ? <span className="text-[12px] font-medium text-pos">active</span> : <button onClick={() => activate.mutate(v.version)} className="rounded border border-line px-2 py-1 text-[12px] hover:bg-soft">Activate</button>}
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}
