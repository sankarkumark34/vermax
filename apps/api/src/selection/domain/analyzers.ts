/**
 * Steps 1-16 of the selection framework (proposal 6.1-6.4). One analyzer per step, registered in ANALYZERS;
 * adding or removing a step does not change the engine (open-closed). Each analyzer is pure.
 */
import { STEP_NAMES } from './config.js';
import { fmt, isNum, StepBuilder } from './scoring.js';
import { cagr, col, days, mean, ratio, risingStreak, slope, std, sum, upShare, yoy, type Series } from './series.js';
import type { AnalysisContext, Phase, SharedFacts, StepAnalyzer, StepResult } from './types.js';

const PHASE_OF: Record<number, Phase> = { 1: 'A', 2: 'A', 3: 'B', 4: 'B', 5: 'B', 6: 'B', 7: 'B', 8: 'B', 9: 'B', 10: 'C', 11: 'C', 12: 'C', 13: 'D', 14: 'D', 15: 'E', 16: 'E', 17: 'F', 18: 'F' };

function analyzer(step: number, fn: (b: StepBuilder, ctx: AnalysisContext, shared: SharedFacts) => void): StepAnalyzer {
  return {
    step,
    name: STEP_NAMES[step],
    phase: PHASE_OF[step],
    analyze(ctx, shared): StepResult {
      const b = new StepBuilder(ctx, step, STEP_NAMES[step], PHASE_OF[step]);
      fn(b, ctx, shared);
      return b.build();
    },
  };
}

const annual = (ctx: AnalysisContext) => ctx.company?.statements?.annual ?? null;
const A = (ctx: AnalysisContext, key: string): Series => col(annual(ctx), key);
const years = (ctx: AnalysisContext) => annual(ctx)?.periods.length ?? 0;
const isFin = (ctx: AnalysisContext) => ctx.template.key === 'financial';
const pctOf = (x: number) => `${(x * 100).toFixed(0)}%`;
const yrs = (ctx: AnalysisContext) => `${years(ctx)}y`;

function indexReturn(points: { date: string; close: number }[], sessions: number): number | null {
  if (points.length <= sessions) return null;
  return points[points.length - 1].close / points[points.length - 1 - sessions].close - 1;
}

// ---- A. Understand -------------------------------------------------------------------------------
const business = analyzer(1, (b, ctx) => {
  const pat = A(ctx, 'pat');
  const have = pat.filter(isNum);
  const profitable = have.length ? have.filter((x) => x > 0).length / have.length : null;
  const drops = yoy(A(ctx, 'revenue')).filter(isNum);
  b.band('profitableYears', 'Profitable years', profitable, 0.5, pctOf)
    .band('revenueDrops', 'Years with revenue down > 10%', drops.length ? drops.filter((x) => x < -0.1).length : null, 0.5, (x) => `${x}`)
    .info('summary', 'Business description', ctx.company?.statements?.summary ? 'available' : null, ctx.company?.statements?.summary ? 'see business summary' : 'n/a');
  b.withNote('Proxy metrics. Segment mix, revenue model and customer concentration need the annual report (LLM business summary).');
});

const industry = analyzer(2, (b, ctx) => {
  const si = ctx.sectorIndex;
  const r12 = si ? indexReturn(si.points, 250) : null, n12 = indexReturn(ctx.benchmark, 250);
  const r3 = si ? indexReturn(si.points, 63) : null, n3 = indexReturn(ctx.benchmark, 63);
  const pts = si?.points ?? [];
  const sma200 = pts.length >= 200 ? pts.slice(-200).reduce((s, p) => s + p.close, 0) / 200 : null;
  b.band('sectorRs12m', `${si?.name ?? 'Sector index'} vs Nifty 50, 12 months`, r12 != null && n12 != null ? (r12 - n12) * 100 : null, 0.45, (x) => fmt.pp(x))
    .band('sectorRs3m', 'Sector vs Nifty 50, 3 months', r3 != null && n3 != null ? (r3 - n3) * 100 : null, 0.3, (x) => fmt.pp(x))
    .check('sectorTrend', 'Sector index above its 200-day average', sma200 == null ? null : pts[pts.length - 1].close > sma200, 0.25,
      sma200 == null ? 'n/a' : `${Math.round(pts[pts.length - 1].close)} vs ${Math.round(sma200)}`, 'above');
  if (!si) b.withNote(`No NSE sector index mapped for "${ctx.sector ?? 'unknown'}"`);
});

// ---- B. Financial strength -----------------------------------------------------------------------
const revenue = analyzer(3, (b, ctx) => {
  const rev = A(ctx, 'revenue');
  const salesG = cagr(rev);
  const recG = cagr(A(ctx, 'receivables'));
  b.band('salesCagr', `Sales CAGR (${yrs(ctx)})`, salesG, 0.5, pctOf)
    .band('revenueUpYears', 'Share of years with sales growth', upShare(rev), 0.3, pctOf)
    .band('receivablesVsSales', 'Receivables growth minus sales growth', isFin(ctx) || recG == null || salesG == null ? null : recG - salesG, 0.2, (x) => fmt.pp(x * 100));
});

const profit = analyzer(4, (b, ctx) => {
  const pbt = A(ctx, 'pbt');
  const other = A(ctx, 'interestIncome').map((v, i) => (isNum(v) || isNum(A(ctx, 'otherNonOperating')[i]) ? (v ?? 0) + Math.max(0, A(ctx, 'otherNonOperating')[i] ?? 0) : null));
  const share = isFin(ctx) ? null : mean(ratio(other, pbt).filter((x) => isNum(x) && x >= 0 && x < 5));
  b.band('patCagr', `Profit (PAT) CAGR (${yrs(ctx)})`, cagr(A(ctx, 'pat')), 0.45, pctOf)
    .band('epsCagr', 'EPS CAGR', cagr(A(ctx, 'eps')), 0.25, pctOf)
    .band('otherIncomeShare', 'Other income share of PBT (avg)', share, 0.3, pctOf);
  if (share != null && share > 0.25) b.flag('profit depends heavily on other income');
});

const margins = analyzer(5, (b, ctx) => {
  const opm = ratio(A(ctx, 'operatingIncome'), A(ctx, 'revenue'));
  const gm = ratio(A(ctx, 'grossProfit'), A(ctx, 'revenue'));
  const fallingStreak = risingStreak(opm.map((x) => (isNum(x) ? -x : null)));
  b.info('opm', 'Operating margin (latest)', opm[0] ?? null, fmt.pct(opm[0], 1))
    .band('opmSlope', 'Operating margin trend (per year)', isFin(ctx) ? null : slope(opm), 0.5, (x) => fmt.pp(x * 100))
    .band('grossMarginStd', 'Gross margin stability (std dev)', std(gm), 0.3, (x) => `${(x * 100).toFixed(1)} pts`)
    .check('opmFalling3y', 'Operating margin not falling 3+ years', fallingStreak == null || isFin(ctx) ? null : fallingStreak < 3, 0.2, fallingStreak == null ? 'n/a' : `falling ${fallingStreak} yrs`, '< 3 years of decline');
  if (fallingStreak != null && fallingStreak >= 3) b.flag('operating margin has fallen for 3+ years');
});

const cashFlow = analyzer(6, (b, ctx, shared) => {
  const cfo = A(ctx, 'cfo'), pat = A(ctx, 'pat'), ebitda = A(ctx, 'ebitda'), fcf = A(ctx, 'fcf');
  const sp = sum(pat), sc = sum(cfo), se = sum(ebitda);
  const fcfHave = fcf.filter(isNum);
  b.band('cfoToPat', `CFO / PAT (cumulative ${yrs(ctx)})`, sp != null && sc != null && sp > 0 ? sc / sp : null, 0.5, pctOf)
    .band('cfoToEbitda', 'CFO / EBITDA (cumulative)', se != null && sc != null && se > 0 ? sc / se : null, 0.25, pctOf)
    .band('fcfPositiveYears', 'Years with positive free cash flow', fcfHave.length ? fcfHave.filter((x) => x > 0).length / fcfHave.length : null, 0.25, pctOf)
    .info('fcfLatest', 'Free cash flow (latest year)', fcf[0] ?? null, fmt.cr(fcf[0]));
  const negCfoWithProfit = cfo.filter((c, i) => isNum(c) && c < 0 && (pat[i] ?? 0) > 0).length;
  if (!isFin(ctx) && negCfoWithProfit >= ctx.config.gates.negCfoYearsWithProfit) {
    b.hardGate(`${negCfoWithProfit} years of negative operating cash flow while reporting a profit`);
    shared.redFlags.push({ category: 'accounting', level: 3, title: `Cash flow persistently below profit (${negCfoWithProfit} years of negative CFO with positive PAT)`, source: 'rule', status: 'auto' });
  }
});

const debt = analyzer(7, (b, ctx, shared) => {
  const eq = A(ctx, 'equity')[0], d = A(ctx, 'totalDebt')[0], cash = A(ctx, 'cash')[0], ebitda = A(ctx, 'ebitda')[0];
  const ebit = A(ctx, 'ebit')[0], int = A(ctx, 'interestExpense')[0];
  const de = isNum(eq) && eq > 0 && isNum(d) ? d / eq : null;
  const netDebt = isNum(d) ? d - (cash ?? 0) : null;
  const ndE = netDebt != null && isNum(ebitda) && ebitda > 0 ? Math.max(0, netDebt) / ebitda : null;
  const icr = isNum(ebit) ? (isNum(int) && Math.abs(int) > 0.01 ? ebit / Math.abs(int) : 99) : null;
  b.band('debtToEquity', 'Debt / equity', de, 0.35, (x) => x.toFixed(2))
    .band('netDebtToEbitda', 'Net debt / EBITDA', ndE, 0.3, (x) => (netDebt != null && netDebt <= 0 ? 'net cash' : x.toFixed(2)))
    .band('interestCoverage', 'Interest coverage (EBIT / interest)', icr, 0.35, (x) => fmt.x(x));
  if (isNum(eq) && eq < 0) {
    b.hardGate('negative net worth');
    shared.redFlags.push({ category: 'financial', level: 3, title: 'Negative net worth', source: 'rule', status: 'auto' });
  }
  if (icr != null && icr < ctx.config.gates.interestCoverageBelow && (de ?? 0) > 0.1) {
    b.hardGate(`interest coverage ${icr.toFixed(2)}× is below ${ctx.config.gates.interestCoverageBelow}×`);
    shared.redFlags.push({ category: 'financial', level: 3, title: `Interest coverage ${icr.toFixed(2)}× below ${ctx.config.gates.interestCoverageBelow}×`, source: 'rule', status: 'auto' });
  }
});

const returns = analyzer(8, (b, ctx) => {
  const ebit = A(ctx, 'ebit'), ta = A(ctx, 'totalAssets'), cl = A(ctx, 'currentLiabilities'), eq = A(ctx, 'equity'), pat = A(ctx, 'pat'), rev = A(ctx, 'revenue');
  const ce = ta.map((t, i) => (isNum(t) && isNum(cl[i]) ? t - cl[i]! : null));
  const roce = mean(ratio(ebit, ce).filter((x) => isNum(x) && Math.abs(x) < 3));
  const roe = mean(ratio(pat, eq).filter((x) => isNum(x) && Math.abs(x) < 3));
  const roa = mean(ratio(pat, ta));
  const em = mean(ratio(ta, eq));
  b.band('roce', `ROCE (${yrs(ctx)} average)`, roce, 0.5, pctOf)
    .band('roe', `ROE (${yrs(ctx)} average)`, roe, isFin(ctx) ? 0.5 : 0.3, pctOf)
    .band('roa', 'ROA (average)', isFin(ctx) ? roa : null, isFin(ctx) ? 0.5 : 0, (x) => fmt.pct(x, 2))
    .band('equityMultiplier', 'Leverage (assets / equity)', em, 0.2, (x) => fmt.x(x, 2));
  const margin = mean(ratio(pat, rev)), turnover = mean(ratio(rev, ta));
  b.info('dupont', 'DuPont: margin × turnover × leverage', null, `${fmt.pct(margin, 1)} × ${fmt.n(turnover, 2)} × ${fmt.n(em, 2)}`);
  if (!isFin(ctx) && roe != null && roe > 0.15 && em != null && em > 4) b.flag('ROE is leverage-driven');
});

const workingCapital = analyzer(9, (b, ctx) => {
  const rev = A(ctx, 'revenue');
  const dd = days(A(ctx, 'receivables'), rev), id = days(A(ctx, 'inventory'), rev), pd = days(A(ctx, 'payables'), rev);
  const ccc = dd.map((d, i) => (isNum(d) ? d + (id[i] ?? 0) - (pd[i] ?? 0) : null));
  b.band('debtorDaysRises', 'Debtor days: consecutive years rising', risingStreak(dd), 0.4, (x) => `${x} (now ${Math.round(dd[0] ?? 0)} days)`)
    .band('inventoryDaysRises', 'Inventory days: consecutive years rising', id.some(isNum) ? risingStreak(id) : null, 0.3, (x) => `${x} (now ${Math.round(id[0] ?? 0)} days)`)
    .band('cccRises', 'Cash conversion cycle: consecutive years rising', risingStreak(ccc), 0.3, (x) => `${x} (now ${Math.round(ccc[0] ?? 0)} days)`);
  if ((risingStreak(dd) ?? 0) >= 3) b.flag('debtor days rising for 3+ years');
});

// ---- C. Quality and trust ------------------------------------------------------------------------
const promoter = analyzer(10, (b, ctx, shared) => {
  const h = ctx.company?.holding;
  const pledge = h?.pledge?.pledgedPctOfPromoter ?? null;
  const hist = (h?.promoterHistory ?? []).filter((x) => isNum(x.promoter));
  const change = hist.length >= 2 ? hist[0].promoter! - hist[hist.length - 1].promoter! : null;
  b.band('pledgePct', 'Promoter shares pledged', pledge, 0.5, (x) => `${x.toFixed(1)}%`)
    .band('promoterChange', `Promoter holding change (${hist.length} quarters)`, change, 0.5, (x) => fmt.pp(x, 2))
    .info('promoterHolding', 'Promoter holding (latest)', hist[0]?.promoter ?? null, hist[0] ? `${hist[0].promoter!.toFixed(2)}% (${hist[0].quarter})` : 'n/a');
  if (pledge != null && pledge > ctx.config.gates.pledgeAbovePct) {
    b.hardGate(`promoter pledge ${pledge.toFixed(1)}% is above ${ctx.config.gates.pledgeAbovePct}%`);
    shared.redFlags.push({ category: 'governance', level: 3, title: `Promoter pledge ${pledge.toFixed(1)}%`, source: 'rule', status: 'auto' });
  } else if (pledge != null && pledge > ctx.template.thresholds.pledgePct.bad) {
    shared.redFlags.push({ category: 'governance', level: 2, title: `Promoter pledge ${pledge.toFixed(1)}% above ${ctx.template.thresholds.pledgePct.bad}%`, source: 'rule', status: 'auto' });
  }
});

const management = analyzer(11, (b, ctx, shared) => {
  const gov = shared.redFlags.filter((f) => (f.category === 'governance' || f.category === 'accounting') && f.source !== 'rule' && f.status !== 'resolved');
  const confirmed = gov.filter((f) => f.status === 'confirmed' && f.level >= 2);
  const suggested = gov.filter((f) => f.status === 'suggested');
  const value = confirmed.length ? 0 : suggested.length ? 0.5 : 1;
  const have = ctx.company?.announcements?.ok ? value : null;
  b.band('governance', 'Governance and auditor flags (filings, 120 days)', have, 1, () =>
    confirmed.length ? `${confirmed.length} confirmed` : suggested.length ? `${suggested.length} to review` : 'none', { band: { good: 1, bad: 0 } });
  for (const f of confirmed) b.flag(f.title);
  b.withNote('Guidance-versus-delivery from concalls needs transcripts (LLM concall analysis, later phase).');
});

const moat = analyzer(12, (b, ctx) => {
  const ce = A(ctx, 'totalAssets').map((t, i) => (isNum(t) && isNum(A(ctx, 'currentLiabilities')[i]) ? t - A(ctx, 'currentLiabilities')[i]! : null));
  const roceS = ratio(A(ctx, 'ebit'), ce).filter((x) => isNum(x) && Math.abs(x) < 3);
  const roeS = ratio(A(ctx, 'pat'), A(ctx, 'equity')).filter((x) => isNum(x) && Math.abs(x) < 3);
  const opm = ratio(A(ctx, 'operatingIncome'), A(ctx, 'revenue'));
  const base = isFin(ctx) ? roeS : roceS;
  const minRet = base.length >= 3 ? Math.min(...(base as number[])) : null;
  b.band('returnStd', isFin(ctx) ? 'ROE stability (std dev)' : 'ROCE stability (std dev)', std(base), 0.4, (x) => `${(x * 100).toFixed(1)} pts`, { band: ctx.template.thresholds.roceStd })
    .band('opmStd', 'Operating margin stability (std dev)', std(opm), 0.3, (x) => `${(x * 100).toFixed(1)} pts`)
    .band('minReturn', `Lowest ${isFin(ctx) ? 'ROE' : 'ROCE'} of the period`, minRet, 0.3, pctOf, { band: isFin(ctx) ? ctx.template.thresholds.roe : ctx.template.thresholds.roce });
  b.withNote(`Free data covers ${years(ctx)} years; the proposal asks for 10 years of stability.`);
});

// ---- D. Tradability and price --------------------------------------------------------------------
const liquidity = analyzer(13, (b, ctx, shared) => {
  const p = ctx.prices;
  const tv = p.slice(-50).map((x) => x.turnover).filter(isNum);
  const adtv = tv.length ? tv.reduce((s, x) => s + x, 0) / tv.length / 1e7 : null;
  shared.adtvCr = adtv;
  const dl = p.slice(-20).map((x) => x.deliveryPct).filter(isNum);
  const deliv = dl.length ? dl.reduce((s, x) => s + x, 0) / dl.length : null;
  const surv = ctx.surveillance;
  const st = ctx.company?.statements;
  const ca = A(ctx, 'currentAssets')[0], cl = A(ctx, 'currentLiabilities')[0], inv = A(ctx, 'inventory')[0];
  const cr = st?.currentRatio ?? (isNum(ca) && isNum(cl) && cl > 0 ? ca / cl : null);
  const qr = st?.quickRatio ?? (isNum(ca) && isNum(cl) && cl > 0 ? (ca - (inv ?? 0)) / cl : null);
  const cash = A(ctx, 'cash')[0], cd = A(ctx, 'currentDebt')[0];
  const cashCover = isNum(cash) ? (isNum(cd) && cd > 0.01 ? cash / cd : 99) : null;
  b.band('adtvCr', 'Average daily traded value (50 days)', adtv, 0.35, (x) => fmt.cr(x))
    .band('deliveryPct', 'Delivery % (20-day average)', deliv, 0.25, (x) => `${x.toFixed(0)}%`)
    .check('surveillance', 'Not on ASM / GSM surveillance', surv == null ? null : surv.length === 0, 0.15, surv == null ? 'list unavailable' : surv.length ? surv.join(', ') : 'not listed', 'not listed')
    .band('currentRatio', 'Current ratio', cr, 0.1, (x) => x.toFixed(2))
    .band('quickRatio', 'Quick ratio', qr, 0.1, (x) => x.toFixed(2))
    .band('cashToShortDebt', 'Cash / short-term debt', cashCover, 0.05, (x) => (x >= 99 ? 'no short-term debt' : fmt.x(x, 2)))
    .info('impactCost', 'Bid-ask spread / impact cost', null, 'n/a', 'not in the free NSE data');
  if (adtv != null && adtv < ctx.config.gates.minAdtvCr) {
    b.hardGate(`traded value ${fmt.cr(adtv)} a day is below the ${fmt.cr(ctx.config.gates.minAdtvCr)} minimum`);
    shared.redFlags.push({ category: 'market', level: 3, title: `Illiquid: ${fmt.cr(adtv)} a day`, source: 'rule', status: 'auto' });
  }
  if (surv && surv.length && ctx.config.gates.surveillanceIsGate) {
    b.hardGate(`on exchange surveillance (${surv.join(', ')})`);
    shared.redFlags.push({ category: 'market', level: 3, title: `Exchange surveillance: ${surv.join(', ')}`, source: 'rule', status: 'auto' });
  }
  // unexplained rally on low delivery (market red flag, level 2)
  if (p.length > 22) {
    const r1m = p[p.length - 1].close / p[p.length - 22].close - 1;
    if (r1m > 0.3 && deliv != null && deliv < 20) {
      shared.redFlags.push({ category: 'market', level: 2, title: `Rally of ${(r1m * 100).toFixed(0)}% in a month on ${deliv.toFixed(0)}% delivery`, source: 'rule', status: 'auto' });
    }
  }
});

const valuation = analyzer(14, (b, ctx, shared) => {
  const st = ctx.company?.statements;
  const pe = st?.pe ?? null;
  const pePct = ctx.company?.peHistory?.percentile ?? null;
  const g = cagr(A(ctx, 'pat'));
  const peg = isNum(pe) && pe > 0 && g != null && g > 0 ? pe / (g * 100) : null;
  const mcap = st?.marketCapCr ?? null;
  const fcf = mean(A(ctx, 'fcf').slice(0, 3));
  const fcfYield = isNum(mcap) && mcap > 0 && fcf != null ? fcf / mcap : null;
  const ey = isNum(pe) && pe > 0 ? 100 / pe : null;
  const evE = st?.evToEbitda ?? null;
  const med = ctx.sectorMedian?.evToEbitda ?? null;
  const evRel = isNum(evE) && evE > 0 && isNum(med) && med > 0 ? evE / med : null;
  const evSales = isNum(st?.enterpriseValueCr) && isNum(A(ctx, 'revenue')[0]) && A(ctx, 'revenue')[0]! > 0 ? st!.enterpriseValueCr! / A(ctx, 'revenue')[0]! : null;
  b.band('pePercentile', `P/E percentile vs own history (${ctx.company?.peHistory?.months ?? 0} months)`, pePct, 0.3, (x) => `${x.toFixed(0)}th (P/E ${fmt.n(pe, 1)})`)
    .band('peg', 'PEG (P/E ÷ profit growth)', peg, 0.2, (x) => x.toFixed(2))
    .band('fcfYield', 'Free-cash-flow yield (3y avg FCF)', fcfYield, 0.15, (x) => fmt.pct(x, 1))
    .band('earningsYieldSpread', `Earnings yield minus 10y G-Sec (${ctx.config.gSecYieldPct}%)`, ey == null ? null : ey - ctx.config.gSecYieldPct, 0.15, (x) => fmt.pp(x))
    .band('evEbitdaVsSector', 'EV/EBITDA vs sector median', evRel, 0.2, (x) => `${x.toFixed(2)}× (${fmt.n(evE, 1)} vs ${fmt.n(med, 1)})`);
  if (ctx.template.key === 'lossMaking') b.band('evToSales', 'EV / Sales', evSales, 0.3, (x) => fmt.x(x));
  const T = ctx.template.thresholds;
  const stretched =
    (!ctx.template.skipMetrics.includes('pePercentile') && pePct != null && pePct > T.pePercentile.bad) ||
    (evRel != null && evRel > 1.5 && (cagr(A(ctx, 'revenue')) ?? 0) < 0.15) ||
    (pePct == null && peg != null && peg > 3) ||
    (ctx.template.key === 'lossMaking' && evSales != null && evSales > T.evToSales.bad);
  shared.valuationStretched = stretched;
  b.info('valuationStretched', 'Valuation stretched', stretched ? 'yes' : 'no', stretched ? 'yes - blocks BUY' : 'no');
  if (stretched) b.flag('valuation stretched');
});

// ---- E. Events and risk filter -------------------------------------------------------------------
const catalyst = analyzer(15, (b, ctx, shared) => {
  const q = ctx.company?.statements?.quarterly;
  const qp = col(q, 'pat');
  if (qp.length >= 5 && isNum(qp[0]) && isNum(qp[4]) && qp[4]! > 0 && qp[0]! / qp[4]! - 1 > 0.2) {
    shared.catalysts.push({ kind: 'Results inflection', title: `Latest quarter profit up ${((qp[0]! / qp[4]! - 1) * 100).toFixed(0)}% year on year`, date: q!.periods[0] as string });
  }
  const hist = ctx.company?.holding?.promoterHistory ?? [];
  if (hist.length >= 3 && isNum(hist[0].promoter) && isNum(hist[2].promoter) && hist[0].promoter! - hist[2].promoter! >= 0.5) {
    shared.catalysts.push({ kind: 'Promoter buying', title: `Promoter holding up ${(hist[0].promoter! - hist[2].promoter!).toFixed(2)} pts in 2 quarters`, date: hist[0].quarter });
  }
  const kinds = new Set(shared.catalysts.map((c) => c.kind));
  const p = ctx.prices;
  const r1m = p.length > 22 ? p[p.length - 1].close / p[p.length - 22].close - 1 : null;
  const priced = r1m != null && r1m > 0.15;
  const n = ctx.company?.announcements?.ok || qp.length ? Math.min(2, kinds.size) * (priced ? 0.5 : 1) : null;
  b.band('catalysts', 'Distinct catalysts (filings, results, promoter buying)', n, 1, () => (kinds.size ? [...kinds].join(', ') : 'none'), { band: { good: 2, bad: 0 } });
  if (priced && kinds.size) b.flag(`price already up ${(r1m! * 100).toFixed(0)}% in a month: catalyst may be priced in`);
});

const redFlags = analyzer(16, (b, ctx, shared) => {
  const active = shared.redFlags.filter((f) => f.status === 'auto' || f.status === 'confirmed');
  const l3 = active.filter((f) => f.level === 3);
  const l2 = active.filter((f) => f.level === 2);
  b.info('level3', 'Level 3 (gate)', l3.length, `${l3.length}`)
    .info('level2', `Level 2 (−${ctx.config.penalties.level2Points} pts each)`, l2.length, `${l2.length}`)
    .info('suggested', 'Suggested, awaiting review', shared.redFlags.filter((f) => f.status === 'suggested').length, `${shared.redFlags.filter((f) => f.status === 'suggested').length}`);
  // rule-based level-3 flags already gate in the step that detected them (7, 10, 13 ...); gate here only on reviewed filings / manual flags
  for (const f of l3.filter((x) => x.source !== 'rule')) b.hardGate(f.title);
  for (const f of l2) b.flag(f.title);
});

export const ANALYZERS: StepAnalyzer[] = [business, industry, revenue, profit, margins, cashFlow, debt, returns, workingCapital, promoter, management, moat, liquidity, valuation, catalyst, redFlags];
