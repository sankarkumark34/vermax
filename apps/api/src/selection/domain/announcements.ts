/**
 * Deterministic first-pass classifier for NSE corporate announcements (steps 11, 15, 16).
 * Red flags found here are stored as SUGGESTED: they are shown, but only affect the score or trigger a gate after the
 * user confirms them (proposal section 7, "human-reviewable flags"). The optional LLM service refines the same queue.
 */
import type { Announcement, Catalyst, FlagCategory, FlagLevel, RedFlag } from './types.js';

interface FlagRule { re: RegExp; and?: RegExp; not?: RegExp; category: FlagCategory; level: FlagLevel; title: string }
interface CatalystRule { re: RegExp; and?: RegExp; not?: RegExp; kind: string }

const FLAG_RULES: FlagRule[] = [
  { re: /auditor/i, and: /resign|cessation|vacat|casual vacancy/i, category: 'accounting', level: 3, title: 'Auditor resignation' },
  { re: /qualified opinion|adverse opinion|disclaimer of opinion|going concern|material uncertainty/i, category: 'accounting', level: 3, title: 'Audit qualification / going-concern note' },
  { re: /restat/i, and: /financial|result|account/i, category: 'accounting', level: 2, title: 'Restatement of accounts' },
  { re: /forensic audit/i, category: 'accounting', level: 3, title: 'Forensic audit' },
  { re: /insolvency|\bnclt\b|\bcirp\b|winding up/i, not: /creditor|operational creditor.*against.*(customer|party)/i, category: 'financial', level: 3, title: 'Insolvency / NCLT proceedings' },
  { re: /default|delay in (payment|servicing|interest)|non-payment of (interest|principal)/i, not: /no default|nil default|without default/i, category: 'financial', level: 3, title: 'Payment default or delay' },
  { re: /rating/i, and: /downgrad|negative|withdraw|issuer not cooperating|\binc\b/i, not: /upgrad|reaffirm.*stable/i, category: 'financial', level: 2, title: 'Credit rating downgrade / negative watch' },
  { re: /\bsebi\b|enforcement directorate|\bcbi\b|serious fraud|\bsfio\b/i, and: /order|notice|penalt|investigat|show cause|summons|search/i, category: 'governance', level: 2, title: 'Regulatory or enforcement action' },
  { re: /\b(rbi|trai|irdai|cci|dgca|nhb|pfrda)\b|reserve bank|competition commission/i, and: /penalt|fine[ds]?\b|disincentive|show cause|monetary/i, category: 'governance', level: 2, title: 'Penalty from a sector regulator' },
  { re: /search|seizure|raid|survey/i, and: /income tax|\bgst\b|department|authorit/i, category: 'governance', level: 2, title: 'Tax search / raid' },
  { re: /resign/i, and: /chief financial officer|\bcfo\b|managing director|\bceo\b|whole[- ]time director/i, category: 'governance', level: 2, title: 'Abrupt CFO / MD resignation' },
  { re: /resign/i, and: /independent director/i, category: 'governance', level: 2, title: 'Independent director resignation' },
  { re: /warning letter|import alert|official action indicated|\boai\b/i, category: 'business', level: 2, title: 'Regulator warning letter / import alert' },
  { re: /creation of (pledge|encumbrance)|invocation of pledge/i, category: 'governance', level: 1, title: 'Promoter pledge created or invoked' },
];

const CATALYST_RULES: CatalystRule[] = [
  { re: /\b(orders?|contracts?)\b|letter of (award|intent)|\bloa\b/i, and: /receiv|bag|secur|award|win|won|worth|placed|\b(order|contract)s? (of|for|from|worth)\b/i, not: /cancel|terminat|court|tribunal|order of the|regulatory order|\bsebi\b|\bnclt\b/i, kind: 'Order win' },
  { re: /commission|commercial (production|operation)|capacity|expansion|new (plant|facility|unit)/i, not: /commission(?:er)? of income|sebi/i, kind: 'Capacity addition' },
  { re: /approval|usfda|\beir\b|licen[cs]e|clearance|accreditation/i, not: /warning|rejection|refus|shareholder|appoint|tenure|director|chairman|auditor|\bkmp\b|remuneration/i, kind: 'Regulatory approval' },
  { re: /buy[- ]?back/i, kind: 'Buyback' },
  { re: /acquisition|acquire|amalgamation|strategic (investment|partnership)/i, not: /substantial acquisition of shares/i, kind: 'Acquisition / partnership' },
];

/** Boilerplate citing the listing regulations appears in almost every filing; strip it so it does not look like SEBI action. */
const BOILERPLATE = /(regulation\s*\d+[a-z]?\s*(\(\d+\))?\s*(of|under)\s*(the\s*)?)?sebi\s*\((listing obligations|substantial acquisition|prohibition of insider|depositories)[^)]*\)(\s*regulations?,?\s*(\d{4})?)?/gi;
const text = (a: Announcement) => `${a.category} ${a.text}`.replace(BOILERPLATE, ' ');

function matches(r: { re: RegExp; and?: RegExp; not?: RegExp }, s: string) {
  return r.re.test(s) && (!r.and || r.and.test(s)) && !(r.not && r.not.test(s));
}

export function classifyAnnouncements(items: Announcement[]): { flags: RedFlag[]; catalysts: Catalyst[] } {
  const flags: RedFlag[] = [];
  const catalysts: Catalyst[] = [];
  const seenFlag = new Set<string>();
  const seenCat = new Set<string>();
  for (const a of items) {
    const s = text(a);
    for (const r of FLAG_RULES) {
      if (!matches(r, s) || seenFlag.has(r.title)) continue;
      seenFlag.add(r.title);
      flags.push({ category: r.category, level: r.level, title: `${r.title}: ${a.text.slice(0, 140)}`, source: 'announcement', status: 'suggested', link: a.link, date: a.date.slice(0, 10) });
    }
    for (const r of CATALYST_RULES) {
      if (!matches(r, s)) continue;
      const key = `${r.kind}:${a.date.slice(0, 10)}`;
      if (seenCat.has(key) || catalysts.filter((c) => c.kind === r.kind).length >= 3) continue;
      seenCat.add(key);
      catalysts.push({ kind: r.kind, title: a.text.slice(0, 160) || a.category, date: a.date.slice(0, 10), link: a.link });
    }
  }
  return { flags, catalysts };
}
