/** Finance-specific headline lexicon. Deliberately simple and transparent (no black-box sentiment). */

const POSITIVE: [RegExp, number][] = [
  [/\b(bags?|wins?|secures?|receives?|gets?)\b.{0,40}\b(order|contract|deal|loa)\b/i, 2],
  [/\border (book|inflow|win)s?\b/i, 1.5],
  [/\b(record|highest|all-time high|best ever)\b.{0,30}\b(profit|revenue|sales|order|quarter)\b/i, 2],
  [/\b(profit|net profit|pat|revenue|ebitda|earnings)\b.{0,25}\b(jumps?|surges?|soars?|rises?|climbs?|grows?|up)\b/i, 1.5],
  [/\b(beats?|tops?|above)\b.{0,20}\b(estimates?|expectations?|street)\b/i, 2],
  [/\b(upgrade[sd]?|initiates? coverage|buy rating|outperform|overweight|target price (raised|hiked))\b/i, 1.5],
  [/\b(buyback|bonus|special dividend|stock split)\b/i, 1],
  [/\b(strong|robust|healthy)\b.{0,15}\b(results?|numbers|growth|demand|outlook)\b/i, 1],
  [/\b(expansion|capacity addition|new plant|mou|partnership|acquires?|acquisition)\b/i, 0.5],
  [/\b(rallies|rally|surges?|zooms?|gains?)\b/i, 0.5],
];

const NEGATIVE: [RegExp, number][] = [
  [/\b(profit|net profit|pat|revenue|ebitda|earnings)\b.{0,25}\b(falls?|drops?|declines?|slumps?|plunges?|down|dips?)\b/i, -1.5],
  [/\b(misses?|below|lags?)\b.{0,20}\b(estimates?|expectations?|street)\b/i, -2],
  [/\b(downgrade[sd]?|sell rating|underperform|underweight|target price (cut|slashed|lowered))\b/i, -1.5],
  [/\b(net )?loss\b/i, -1.5],
  [/\b(plunges?|tanks?|crashes?|slumps?|sinks?|tumbles?|hits? (52-week|lower))\b/i, -1],
  [/\b(resigns?|resignation|steps? down|quits?)\b.{0,25}\b(cfo|ceo|md|chairman|auditor|director)\b/i, -1.5],
  [/\b(block deal|bulk deal)\b.{0,30}\b(sells?|sold|exits?|offloads?|stake sale)\b/i, -1],
  [/\b(promoter)\b.{0,20}\b(sells?|pledge[sd]?|offloads?|reduces? stake)\b/i, -1.5],
  [/\b(order|contract)\b.{0,20}\b(cancel(led|s)?|terminated|delay(ed)?)\b/i, -1.5],
];

/** Headlines that veto a pick outright (governance / legal / solvency events). */
const SEVERE: RegExp[] = [
  /\b(fraud|scam|forgery|embezzle\w*|money laundering)\b/i,
  /\b(sebi)\b.{0,40}\b(probe|order|ban|bars?|penalt\w+|show[- ]cause|investigation|notice)\b/i,
  /\b(ed|enforcement directorate|cbi|income[- ]tax)\b.{0,30}\b(raid|search|probe|summon\w*|arrest\w*)\b/i,
  /\b(insolvency|nclt|bankruptcy|default(s|ed)?)\b/i,
  /\b(auditor)\b.{0,30}\b(resign\w*|qualif\w+|red flag)\b/i,
  /\b(accounting irregularit\w+|misstat\w+|restate\w*)\b/i,
  /\b(trading suspended|delist\w*|asm|gsm)\b.{0,20}\b(framework|stage|list)\b/i,
];

export interface HeadlineScore {
  score: number;
  severe: boolean;
  hits: string[];
}

export function scoreHeadline(title: string): HeadlineScore {
  let s = 0;
  const hits: string[] = [];
  for (const [re, w] of POSITIVE) if (re.test(title)) { s += w; hits.push(`+${w}`); }
  for (const [re, w] of NEGATIVE) if (re.test(title)) { s += w; hits.push(`${w}`); }
  const severe = SEVERE.some((re) => re.test(title));
  if (severe) s -= 3;
  return { score: Math.max(-4, Math.min(4, s)), severe, hits };
}

/** Recency-weighted mean of headline scores, normalised to [-1, 1]. */
export function aggregate(items: { title: string; ageDays: number }[]): { score: number; severe: boolean; positives: number; negatives: number } {
  if (!items.length) return { score: 0, severe: false, positives: 0, negatives: 0 };
  let num = 0;
  let den = 0;
  let severe = false;
  let positives = 0;
  let negatives = 0;
  for (const it of items) {
    const h = scoreHeadline(it.title);
    const w = Math.exp(-it.ageDays / 4); // half-life ~3 days
    num += h.score * w;
    den += w;
    if (h.severe && it.ageDays <= 10) severe = true;
    if (h.score > 0) positives++;
    if (h.score < 0) negatives++;
  }
  const mean = den ? num / den : 0;
  return { score: Math.max(-1, Math.min(1, mean / 2.5)), severe, positives, negatives };
}
