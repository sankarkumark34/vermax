import type { Sizing } from './types.js';

export interface SizingInput {
  capital: number;
  riskPerTrade: number; // fraction of capital risked at the stop, e.g. 0.01
  maxPositionPct: number; // cap on a single position as fraction of capital
  stopPct: number; // stop distance as fraction of entry
  price: number;
  regimeMultiplier: number; // 0.5 in a defensive regime
}

/** Fixed-fractional sizing: risk% of capital at the stop, capped by a max position weight. */
export function positionSize(i: SizingInput): Sizing {
  if (!(i.price > 0) || !(i.stopPct > 0) || !(i.capital > 0)) return { qty: 0, capitalUsed: 0, riskAmount: 0, positionPct: 0 };
  const weight = Math.min((i.riskPerTrade * i.regimeMultiplier) / i.stopPct, i.maxPositionPct);
  const qty = Math.floor((weight * i.capital) / i.price);
  const capitalUsed = qty * i.price;
  return {
    qty,
    capitalUsed: Math.round(capitalUsed),
    riskAmount: Math.round(capitalUsed * i.stopPct),
    positionPct: Math.round((capitalUsed / i.capital) * 1000) / 10,
  };
}

/** Next weekday after `date` (exchange holidays are not modelled; the UI labels it "next session"). */
export function nextSession(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}
