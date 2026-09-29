import { describe, expect, it } from 'vitest';
import { aggregate, scoreHeadline } from './lexicon.js';

describe('headline lexicon', () => {
  it('scores order wins positively', () => {
    expect(scoreHeadline('HAL bags Rs 5,000 crore order from Ministry of Defence').score).toBeGreaterThan(0);
  });
  it('scores profit decline negatively', () => {
    expect(scoreHeadline('Company net profit falls 20% in Q1').score).toBeLessThan(0);
  });
  it('flags SEBI probe as severe', () => {
    const h = scoreHeadline('SEBI orders probe into promoter of XYZ Ltd');
    expect(h.severe).toBe(true);
    expect(h.score).toBeLessThan(0);
  });
  it('treats unrelated headlines as neutral', () => {
    const h = scoreHeadline('Company to hold analyst meet on Friday');
    expect(h.score).toBe(0);
    expect(h.severe).toBe(false);
  });
  it('recent severe news vetoes; old severe news does not', () => {
    expect(aggregate([{ title: 'ED raid at company offices', ageDays: 1 }]).severe).toBe(true);
    expect(aggregate([{ title: 'ED raid at company offices', ageDays: 30 }]).severe).toBe(false);
  });
  it('aggregate is bounded', () => {
    const a = aggregate(Array.from({ length: 10 }, () => ({ title: 'Company bags order and record profit jumps', ageDays: 0 })));
    expect(a.score).toBeLessThanOrEqual(1);
    expect(a.score).toBeGreaterThan(0);
  });
});
