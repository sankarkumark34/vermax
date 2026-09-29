import { describe, expect, it } from 'vitest';
import { analyseCircuits, isLowerCircuit, type CircuitBar } from './circuit.js';

const bar = (date: string, prev: number, close: number, low = close): CircuitBar => ({ date, prevClose: prev, close, low });

describe('isLowerCircuit', () => {
  it('detects a 10% lock at the low', () => expect(isLowerCircuit(bar('d', 100, 90))).toBe(0.1));
  it('ignores a 10% fall that bounced off the low', () => expect(isLowerCircuit(bar('d', 100, 90, 85))).toBeNull());
  it('ignores non-band moves', () => expect(isLowerCircuit(bar('d', 100, 93))).toBeNull());
});

describe('analyseCircuits', () => {
  it('measures recovery days to the pre-event close', () => {
    const bars = [bar('1', 100, 100), bar('2', 100, 90), bar('3', 90, 92, 91), bar('4', 92, 96), bar('5', 96, 101)];
    const s = analyseCircuits(bars);
    expect(s.events).toBe(1);
    expect(s.list[0].recovered).toBe(true);
    expect(s.list[0].recoveryDays).toBe(3); // days 3,4,5 after the lock day
    expect(s.list[0].halfRecoveryDays).toBe(2); // half of the fall = 95, first close above it is 96 on day 2
  });
  it('merges consecutive locked days into one event and reports unrecovered', () => {
    const bars = [bar('1', 100, 100), bar('2', 100, 95), bar('3', 95, 90.25), bar('4', 90.25, 91)];
    const s = analyseCircuits(bars);
    expect(s.events).toBe(1);
    expect(s.list[0].lockDays).toBe(2);
    expect(s.list[0].recovered).toBe(false);
    expect(s.medianRecoveryDays).toBeNull();
  });
  it('flags a lock on the last bar', () => {
    expect(analyseCircuits([bar('1', 100, 100), bar('2', 100, 80)]).lockedNow).toBe(true);
  });
});
