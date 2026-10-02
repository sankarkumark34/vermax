/**
 * Purchase rating for recent IPOs: a transparent weighted blend of five 0-100 component scores.
 * NOT backtested (fundamentals and news have no point-in-time history); it ranks and explains, it does not predict.
 */

export interface RatingInput {
  fundamentals: { verdict?: string | null; qualityScore?: number | null } | null;
  sentiment: { score: number; headlines: number; severe: boolean } | null;
  weeks: { up: number; total: number };
  months: { up: number; total: number; toDate?: number | null };
  vsIssue: number | null; // %
  fromHigh: number | null; // % (<= 0)
  listingGain: number | null; // %
  deliveryAvg: number | null; // %
  turnoverCr: number | null;
  market: { regime: string; breadth50: number | null; fiiIndexLongRatio: number | null } | null;
}

export interface RatingComponent {
  key: 'fundamentals' | 'sentiment' | 'strength' | 'demand' | 'market';
  label: string;
  weight: number;
  score: number;
  note: string;
}

export interface PurchaseRating {
  score: number;
  grade: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'AVOID';
  label: string;
  vetoes: string[];
  components: RatingComponent[];
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
/** Linear map of x from [a, b] onto [0, max]. */
const lin = (x: number | null | undefined, a: number, b: number, max: number) => (x == null || Number.isNaN(x) ? max / 2 : clamp(((x - a) / (b - a)) * max, 0, max));

export function purchaseRating(i: RatingInput): PurchaseRating {
  const vetoes: string[] = [];

  // 1. Fundamentals: the quality score; unknown counts as below average, AVOID is capped.
  const verdict = i.fundamentals?.verdict ?? 'UNKNOWN';
  let fund = i.fundamentals?.qualityScore ?? 40;
  if (verdict === 'UNKNOWN') fund = 40;
  if (verdict === 'AVOID') {
    fund = Math.min(fund, 25);
    vetoes.push('fundamentals rated AVOID');
  }

  // 2. Sentiment: news tone -1..1 -> 0..100; no news is neutral; a red-flag headline vetoes.
  let sent = 50;
  if (i.sentiment && i.sentiment.headlines > 0) sent = clamp(50 + 50 * i.sentiment.score);
  if (i.sentiment?.severe) {
    sent = 0;
    vetoes.push('governance / legal red-flag headline');
  }

  // 3. Price strength: consistency of weekly and monthly closes, performance vs issue, distance from high.
  const wk = i.weeks.total ? i.weeks.up / i.weeks.total : 0.5;
  const mo = i.months.total ? i.months.up / i.months.total : (i.months.toDate ?? 0) > 0 ? 1 : 0.5;
  const strength = clamp(wk * 35 + mo * 25 + lin(i.vsIssue, -20, 60, 25) + lin(i.fromHigh, -30, 0, 15));

  // 4. Investor demand: listing-day demand, share of real (delivery) buying, liquidity.
  const turn = i.turnoverCr && i.turnoverCr > 0 ? Math.log10(i.turnoverCr) : null; // 0.5 Cr -> -0.3, 50 Cr -> 1.7
  const demand = clamp(lin(i.listingGain, -20, 60, 40) + lin(i.deliveryAvg, 20, 70, 30) + lin(turn, -0.3, 1.7, 30));

  // 5. Market backdrop: regime, breadth, FII index-futures positioning.
  const reg = i.market?.regime === 'BULLISH' ? 50 : i.market?.regime === 'PULLBACK' ? 35 : 20;
  const market = clamp(reg + lin(i.market?.breadth50 ?? null, 0.2, 0.7, 30) + lin(i.market?.fiiIndexLongRatio ?? null, 0.1, 0.7, 20));

  const components: RatingComponent[] = [
    { key: 'fundamentals', label: 'Fundamentals', weight: 0.3, score: Math.round(fund), note: verdict === 'UNKNOWN' ? 'too little data' : `${verdict.toLowerCase()} · quality ${i.fundamentals?.qualityScore ?? '-'}/100` },
    { key: 'sentiment', label: 'News sentiment', weight: 0.15, score: Math.round(sent), note: i.sentiment?.headlines ? `${i.sentiment.headlines} headlines, tone ${i.sentiment.score.toFixed(2)}` : 'no recent news' },
    { key: 'strength', label: 'Price strength', weight: 0.2, score: Math.round(strength), note: `weeks ${i.weeks.up}/${i.weeks.total}, months ${i.months.up}/${i.months.total}, vs issue ${i.vsIssue == null ? '-' : `${i.vsIssue > 0 ? '+' : ''}${i.vsIssue.toFixed(0)}%`}` },
    { key: 'demand', label: 'Investor demand', weight: 0.2, score: Math.round(demand), note: `listing ${i.listingGain == null ? '-' : `${i.listingGain > 0 ? '+' : ''}${i.listingGain.toFixed(0)}%`}, delivery ${i.deliveryAvg ?? '-'}%, ₹${i.turnoverCr ?? '-'} Cr/day` },
    { key: 'market', label: 'Market backdrop', weight: 0.15, score: Math.round(market), note: `${(i.market?.regime ?? 'unknown').toLowerCase()} market${i.market?.fiiIndexLongRatio != null ? `, FII long ${(i.market.fiiIndexLongRatio * 100).toFixed(0)}%` : ''}` },
  ];
  let score = Math.round(components.reduce((s, c) => s + c.score * c.weight, 0));
  if (vetoes.length) score = Math.min(score, 44);
  const grade = vetoes.length || score < 45 ? 'AVOID' : score >= 75 ? 'STRONG_BUY' : score >= 60 ? 'BUY' : 'WATCH';
  const label = { STRONG_BUY: 'Strong buy', BUY: 'Buy', WATCH: 'Watch', AVOID: 'Avoid' }[grade];
  return { score, grade, label, vetoes, components };
}
