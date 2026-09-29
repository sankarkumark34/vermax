import { Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { aggregate, scoreHeadline } from './lexicon.js';

export interface NewsItem {
  title: string;
  link: string;
  source: string | null;
  publishedAt: string | null;
  ageDays: number;
  score: number;
  severe: boolean;
}

export interface SentimentResult {
  symbol: string;
  score: number; // -1 .. 1
  label: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  severe: boolean;
  headlines: number;
  positives: number;
  negatives: number;
  items: NewsItem[];
  error?: string;
}

const CACHE_MS = 3 * 3600_000;

/** Google News RSS -> transparent finance lexicon. Overlay/veto only: not part of the backtested model. */
@Injectable()
export class SentimentService {
  private readonly log = new Logger(SentimentService.name);
  private readonly parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  private readonly cache = new Map<string, { at: number; value: SentimentResult }>();

  async analyse(symbol: string, companyName?: string | null): Promise<SentimentResult> {
    const key = symbol;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const q = `"${(companyName || symbol).replace(/\b(ltd|limited)\.?$/i, '').trim()}" (stock OR shares OR results OR order) when:10d`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
    let result: SentimentResult;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = this.parser.parse(await res.text());
      const raw = xml?.rss?.channel?.item;
      const list: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const now = Date.now();
      const seen = new Set<string>();
      const items: NewsItem[] = [];
      for (const it of list.slice(0, 25)) {
        const title = String(it.title ?? '').replace(/\s+-\s+[^-]+$/, '').trim();
        if (!title || seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());
        const pub = it.pubDate ? new Date(String(it.pubDate)) : null;
        const ageDays = pub && !Number.isNaN(pub.getTime()) ? Math.max(0, (now - pub.getTime()) / 86_400_000) : 5;
        const sc = scoreHeadline(title);
        const src = it.source as { '#text'?: string } | string | undefined;
        items.push({
          title,
          link: String(it.link ?? ''),
          source: typeof src === 'string' ? src : (src?.['#text'] ?? null),
          publishedAt: pub && !Number.isNaN(pub.getTime()) ? pub.toISOString() : null,
          ageDays: Math.round(ageDays * 10) / 10,
          score: sc.score,
          severe: sc.severe,
        });
      }
      const agg = aggregate(items.map((i) => ({ title: i.title, ageDays: i.ageDays })));
      result = {
        symbol,
        score: Math.round(agg.score * 100) / 100,
        label: agg.score > 0.15 ? 'POSITIVE' : agg.score < -0.15 ? 'NEGATIVE' : 'NEUTRAL',
        severe: agg.severe,
        headlines: items.length,
        positives: agg.positives,
        negatives: agg.negatives,
        items: items.slice(0, 8),
      };
    } catch (err) {
      this.log.warn(`news fetch failed for ${symbol}: ${(err as Error).message}`);
      result = { symbol, score: 0, label: 'NEUTRAL', severe: false, headlines: 0, positives: 0, negatives: 0, items: [], error: (err as Error).message };
    }
    this.cache.set(key, { at: Date.now(), value: result });
    return result;
  }
}
