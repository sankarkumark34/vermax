/**
 * Stock analysis checklist and Buy score.
 * Each check compares one metric with a widely used industry standard. Checks without data are "n/a" and are left out
 * of the score; groups without any data are left out and the remaining group weights are re-normalised.
 * This is a transparent rules score - it is NOT a backtested prediction.
 */

export type GroupKey = 'quality' | 'valuation' | 'trend' | 'risk' | 'sentiment' | 'ipo';

export interface Check {
  id: string;
  group: GroupKey;
  label: string;
  value: string;
  standard: string;
  pass: boolean | null; // null = not available
  note?: string;
}

export interface GroupScore {
  key: GroupKey;
  label: string;
  weight: number;
  passed: number;
  evaluated: number;
  total: number;
  score: number | null; // 0-100 or null when no data
}

export interface AnalysisScore {
  score: number | null;
  verdict: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'AVOID' | 'NOT_ENOUGH_DATA';
  label: string;
  coverage: { evaluated: number; total: number };
  redFlags: string[];
  notes: string[];
  strengths: string[];
  concerns: string[];
  groups: GroupScore[];
  checks: Check[];
}

export interface AnalysisInput {
  status: 'listed' | 'upcoming' | 'unknown';
  sector: string | null;
  price?: {
    sessions?: number | null; close: number | null; dma50: number | null; dma200: number | null; fromHigh52: number | null; rs6m: number | null; rsi14: number | null
    atrPct: number | null; turnoverCr: number | null; deliveryAvg: number | null;
  };
  fundamentals?: {
    ok?: boolean; yahooSector?: string | null; roe?: number | null; roe3yAvg?: number | null; roce?: number | null; debtToEquity?: number | null
    interestCoverage?: number | null; salesCagr?: number | null; revenueGrowth?: number | null; profitCagr?: number | null; earningsGrowth?: number | null
    operatingMargin?: number | null; profitMargin?: number | null; cfoToPat?: number | null; insiderHolding?: number | null; pe?: number | null
    netIncomePositive?: boolean | null; nextEarnings?: string | null;
  };
  industry?: { index: string; pe: number | null } | null;
  ipo?: {
    recent?: boolean; issuePrice?: number | null; listingGain?: number | null; vsIssue?: number | null
    subscription?: { qib: number | null; nii: number | null; retail: number | null; total: number | null } | null
    weeks?: { up: number; total: number };
  } | null;
  sentiment?: { score: number; headlines: number; severe: boolean } | null;
  technicals?: { macdBullish: boolean; structure: 'bullish' | 'bearish' | 'neutral'; lastEvent: string | null } | null;
  circuitEventsLast12m?: number | null;
  lockedNow?: boolean;
  today?: string; // YYYY-MM-DD, for the results-date check
}

const GROUPS: { key: GroupKey; label: string; weight: number }[] = [
  { key: 'quality', label: 'Business quality', weight: 0.3 },
  { key: 'valuation', label: 'Valuation', weight: 0.15 },
  { key: 'trend', label: 'Price trend', weight: 0.2 },
  { key: 'risk', label: 'Risk & liquidity', weight: 0.15 },
  { key: 'sentiment', label: 'News sentiment', weight: 0.1 },
  { key: 'ipo', label: 'IPO demand', weight: 0.1 },
];

const pct = (x: number | null | undefined, d = 0) => (x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`);
const num = (x: number | null | undefined, d = 1, suffix = '') => (x == null ? 'n/a' : `${x.toFixed(d)}${suffix}`);
const has = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function analyse(i: AnalysisInput): AnalysisScore {
  const f = i.fundamentals ?? {};
  const p = i.price;
  const fin = i.sector === 'Financial Services' || f.yahooSector === 'Financial Services';
  const finNote = 'not meaningful for banks / NBFCs';
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  // ---- Business quality -------------------------------------------------------------
  const roe = f.roe3yAvg ?? f.roe ?? null;
  add({ id: 'roe', group: 'quality', label: 'Return on equity (ROE)', value: pct(roe), standard: '≥ 15%', pass: has(roe) ? roe >= 0.15 : null });
  add({ id: 'roce', group: 'quality', label: 'Return on capital (ROCE)', value: pct(f.roce), standard: '≥ 15%', pass: fin ? null : has(f.roce) ? f.roce >= 0.15 : null, note: fin ? finNote : undefined });
  add({ id: 'de', group: 'quality', label: 'Debt / equity', value: num(f.debtToEquity, 2), standard: '≤ 0.5', pass: fin ? null : has(f.debtToEquity) ? f.debtToEquity <= 0.5 : null, note: fin ? finNote : undefined });
  add({ id: 'icov', group: 'quality', label: 'Interest coverage', value: has(f.interestCoverage) ? `${Math.min(f.interestCoverage, 999).toFixed(1)}×` : 'n/a', standard: '≥ 3×', pass: fin ? null : has(f.interestCoverage) ? f.interestCoverage >= 3 : null, note: fin ? finNote : undefined });
  const sales = f.salesCagr ?? f.revenueGrowth ?? null;
  add({ id: 'sales', group: 'quality', label: 'Sales growth (3-yr)', value: pct(sales), standard: '≥ 10% a year', pass: has(sales) ? sales >= 0.1 : null });
  const profit = f.profitCagr ?? f.earningsGrowth ?? null;
  add({ id: 'profit', group: 'quality', label: 'Profit growth (3-yr)', value: pct(profit), standard: '≥ 10% a year', pass: has(profit) ? profit >= 0.1 : null });
  const margin = f.operatingMargin ?? f.profitMargin ?? null;
  add({ id: 'margin', group: 'quality', label: 'Operating margin', value: pct(margin), standard: '≥ 10%', pass: has(margin) ? margin >= 0.1 : null });
  add({ id: 'cfo', group: 'quality', label: 'Cash conversion (CFO / profit)', value: num(f.cfoToPat, 2), standard: '≥ 0.8', pass: fin ? null : has(f.cfoToPat) ? f.cfoToPat >= 0.8 : null, note: fin ? finNote : undefined });
  add({ id: 'promoter', group: 'quality', label: 'Promoter / insider holding', value: pct(f.insiderHolding), standard: '≥ 40%', pass: has(f.insiderHolding) ? f.insiderHolding >= 0.4 : null });

  // ---- Valuation ----------------------------------------------------------------------
  const ind = i.industry?.pe ?? null;
  add({ id: 'pe', group: 'valuation', label: `P/E vs industry (${i.industry?.index ?? 'n/a'})`, value: has(f.pe) && has(ind) ? `${f.pe.toFixed(1)} vs ${ind.toFixed(1)}` : num(f.pe), standard: '≤ 1.2 × industry P/E', pass: has(f.pe) && has(ind) ? f.pe > 0 && f.pe <= ind * 1.2 : null });
  const peg = has(f.pe) && has(profit) && profit > 0 ? f.pe / (profit * 100) : null;
  add({ id: 'peg', group: 'valuation', label: 'PEG (P/E ÷ profit growth)', value: num(peg, 2), standard: '≤ 1.5', pass: has(peg) ? peg <= 1.5 : null });

  // ---- Price trend --------------------------------------------------------------------
  const above = (a: number | null | undefined, b: number | null | undefined) => (has(a) && has(b) ? a > b : null);
  add({ id: 'dma200', group: 'trend', label: 'Above 200-day average', value: has(p?.dma200) ? `₹${p!.close} vs ₹${p!.dma200}` : 'n/a', standard: 'price > 200-DMA', pass: above(p?.close, p?.dma200) });
  add({ id: 'dma50', group: 'trend', label: 'Above 50-day average', value: has(p?.dma50) ? `₹${p!.close} vs ₹${p!.dma50}` : 'n/a', standard: 'price > 50-DMA', pass: above(p?.close, p?.dma50) });
  add({ id: 'high52', group: 'trend', label: 'Near 52-week high', value: has(p?.fromHigh52) ? `${p!.fromHigh52.toFixed(1)}%` : 'n/a', standard: 'within 20% of high', pass: has(p?.fromHigh52) ? p!.fromHigh52 >= -20 : null });
  add({ id: 'rs', group: 'trend', label: 'Beating Nifty (6 months)', value: has(p?.rs6m) ? `${p!.rs6m > 0 ? '+' : ''}${p!.rs6m.toFixed(1)} pts` : 'n/a', standard: '> 0', pass: has(p?.rs6m) ? p!.rs6m > 0 : null });
  add({ id: 'rsi', group: 'trend', label: 'RSI (14) in healthy zone', value: num(p?.rsi14, 0), standard: '40 – 70', pass: has(p?.rsi14) ? p!.rsi14 >= 40 && p!.rsi14 <= 70 : null });
  const t = i.technicals;
  add({ id: 'macd', group: 'trend', label: 'MACD above signal line', value: t ? (t.macdBullish ? 'bullish' : 'bearish') : 'n/a', standard: 'MACD > signal (12, 26, 9)', pass: t ? t.macdBullish : null });
  add({ id: 'structure', group: 'trend', label: 'Market structure (swing highs / lows)', value: t ? `${t.structure}${t.lastEvent ? ` · last ${t.lastEvent}` : ''}` : 'n/a', standard: 'bullish: last break of structure was up', pass: t && t.structure !== 'neutral' ? t.structure === 'bullish' : null });

  // ---- Risk & liquidity ---------------------------------------------------------------
  add({ id: 'liq', group: 'risk', label: 'Liquidity (avg daily value)', value: has(p?.turnoverCr) ? `₹${p!.turnoverCr} Cr` : 'n/a', standard: '≥ ₹5 Cr / day', pass: has(p?.turnoverCr) ? p!.turnoverCr >= 5 : null });
  add({ id: 'vol', group: 'risk', label: 'Daily volatility (ATR)', value: has(p?.atrPct) ? `${p!.atrPct.toFixed(1)}%` : 'n/a', standard: '≤ 4%', pass: has(p?.atrPct) ? p!.atrPct <= 4 : null });
  add({ id: 'deliv', group: 'risk', label: 'Delivery (real buying)', value: has(p?.deliveryAvg) ? `${p!.deliveryAvg.toFixed(0)}%` : 'n/a', standard: '≥ 35%', pass: has(p?.deliveryAvg) ? p!.deliveryAvg >= 35 : null });
  add({ id: 'lc', group: 'risk', label: 'No lower circuit (12 months)', value: i.circuitEventsLast12m == null ? 'n/a' : `${i.circuitEventsLast12m} events`, standard: '0 events', pass: i.circuitEventsLast12m == null || i.status !== 'listed' ? null : i.circuitEventsLast12m === 0 });
  let resultsSoon: number | null = null;
  if (f.nextEarnings && i.today) {
    const days = Math.round((Date.parse(f.nextEarnings) - Date.parse(i.today)) / 86_400_000);
    resultsSoon = Number.isFinite(days) ? days : null;
  }
  add({ id: 'results', group: 'risk', label: 'No results in next 7 days', value: resultsSoon == null ? 'n/a' : resultsSoon < 0 ? 'reported' : `in ${resultsSoon} days`, standard: '> 7 days away', pass: resultsSoon == null ? null : !(resultsSoon >= 0 && resultsSoon <= 7) });

  // ---- Sentiment ---------------------------------------------------------------------
  const s = i.sentiment;
  add({ id: 'news', group: 'sentiment', label: 'News tone (10 days)', value: s && s.headlines ? `${s.score.toFixed(2)} · ${s.headlines} headlines` : 'no news', standard: 'not negative', pass: s && s.headlines ? s.score > -0.15 : null });
  add({ id: 'flags', group: 'sentiment', label: 'No red-flag headlines', value: s ? (s.severe ? 'red flag found' : 'none') : 'n/a', standard: 'none (fraud, SEBI, raid…)', pass: s ? !s.severe : null });

  // ---- IPO demand (recent or upcoming IPOs only) --------------------------------------
  const ipo = i.ipo?.recent ? i.ipo : null;
  if (ipo) {
    const sub = ipo.subscription;
    add({ id: 'qib', group: 'ipo', label: 'Institutional (QIB) subscription', value: has(sub?.qib) ? `${sub!.qib.toFixed(1)}×` : 'n/a', standard: '≥ 10×', pass: has(sub?.qib) ? sub!.qib >= 10 : null });
    add({ id: 'subtotal', group: 'ipo', label: 'Total subscription', value: has(sub?.total) ? `${sub!.total.toFixed(1)}×` : 'n/a', standard: '≥ 10×', pass: has(sub?.total) ? sub!.total >= 10 : null });
    add({ id: 'vsissue', group: 'ipo', label: 'Trading above issue price', value: has(ipo.vsIssue) ? `${ipo.vsIssue > 0 ? '+' : ''}${ipo.vsIssue.toFixed(1)}%` : 'n/a', standard: '> issue price', pass: has(ipo.vsIssue) ? ipo.vsIssue > 0 : null });
    add({ id: 'listgain', group: 'ipo', label: 'Listing-day gain', value: has(ipo.listingGain) ? `${ipo.listingGain > 0 ? '+' : ''}${ipo.listingGain.toFixed(1)}%` : 'n/a', standard: '> 0%', pass: has(ipo.listingGain) ? ipo.listingGain > 0 : null });
    const wk = ipo.weeks;
    add({ id: 'weeks', group: 'ipo', label: 'Weeks closed higher', value: wk && wk.total ? `${wk.up} of ${wk.total}` : 'n/a', standard: '≥ 60% of weeks', pass: wk && wk.total >= 3 ? wk.up / wk.total >= 0.6 : null });
  }

  // ---- Scoring -------------------------------------------------------------------------
  const groups: GroupScore[] = GROUPS.map((g) => {
    const cs = checks.filter((c) => c.group === g.key);
    const ev = cs.filter((c) => c.pass !== null);
    const passed = ev.filter((c) => c.pass).length;
    return { key: g.key, label: g.label, weight: g.weight, passed, evaluated: ev.length, total: cs.length, score: ev.length ? Math.round((passed / ev.length) * 100) : null };
  }).filter((g) => g.total > 0);
  const live = groups.filter((g) => g.score !== null);
  const wsum = live.reduce((a, g) => a + g.weight, 0);
  let score = live.length ? Math.round(live.reduce((a, g) => a + g.weight * (g.score as number), 0) / wsum) : null;
  const evaluated = checks.filter((c) => c.pass !== null).length;

  const redFlags: string[] = [];
  if (f.netIncomePositive === false) redFlags.push('company is loss-making');
  if (!fin && has(f.debtToEquity) && f.debtToEquity > 2) redFlags.push('very high debt (D/E > 2)');
  if (s?.severe) redFlags.push('recent governance / legal red-flag headline');
  if (i.lockedNow) redFlags.push('locked at lower circuit on the latest session');

  const notes: string[] = [];
  let verdict: AnalysisScore['verdict'];
  if (score === null || evaluated < 6) {
    verdict = 'NOT_ENOUGH_DATA';
    score = null;
  } else {
    if (redFlags.length) score = Math.min(score, 44);
    verdict = score >= 75 ? 'STRONG_BUY' : score >= 60 ? 'BUY' : score >= 45 ? 'WATCH' : 'AVOID';
    if (verdict !== 'AVOID' && resultsSoon !== null && resultsSoon >= 0 && resultsSoon <= 7) {
      verdict = 'WATCH';
      notes.push(`results due in ${resultsSoon} days: capped at Watch (gap risk)`);
    }
    if (verdict === 'STRONG_BUY' && has(p?.sessions) && p!.sessions < 60) {
      verdict = 'BUY';
      notes.push(`only ${p!.sessions} sessions of trading history: capped at Buy until the price trend can be judged`);
    }
  }
  const label = { STRONG_BUY: 'Strong buy', BUY: 'Buy', WATCH: 'Watch', AVOID: 'Avoid', NOT_ENOUGH_DATA: 'Not enough data' }[verdict];
  const order: GroupKey[] = ['quality', 'ipo', 'valuation', 'trend', 'risk', 'sentiment'];
  const sorted = [...checks].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  return {
    score, verdict, label,
    coverage: { evaluated, total: checks.length },
    redFlags,
    notes,
    strengths: sorted.filter((c) => c.pass === true).slice(0, 4).map((c) => `${c.label}: ${c.value}`),
    concerns: sorted.filter((c) => c.pass === false).slice(0, 4).map((c) => `${c.label}: ${c.value} (standard ${c.standard})`),
    groups,
    checks,
  };
}
