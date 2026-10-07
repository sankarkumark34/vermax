/**
 * Step 18: position sizing (proposal 6.6). Final quantity = min(risk-based, position-cap, liquidity) quantity.
 * The stop always comes from the technical structure; it is never moved to fit a desired quantity.
 */

export interface PositionInput {
  capital: number;
  riskPct: number;              // % of capital risked at the stop, e.g. 1
  entry: number;
  stop: number;
  adtvCr: number | null;        // average daily traded value, INR crore
  marketCapCr: number | null;
  capLargePct: number;          // e.g. 10
  capMidSmallPct: number;       // e.g. 5
  largeCapMinCr: number;        // market cap at or above this counts as large cap
  liquidityPctOfAdtv: number;   // e.g. 1
  target?: number | null;
}

export type Binding = 'risk' | 'positionCap' | 'liquidity';

export interface PositionSize {
  ok: boolean;
  error?: string;
  riskBudget: number;
  riskPerShare: number;
  qtyByRisk: number;
  qtyByCap: number;
  qtyByLiquidity: number | null;
  qty: number;
  binding: Binding;
  capPct: number;
  capClass: 'large' | 'mid/small';
  positionValue: number;
  positionPctOfCapital: number;
  actualRisk: number;
  actualRiskPctOfCapital: number;
  rewardRisk: number | null;
  potentialGain: number | null;
  liquidityCheck: { orderPctOfAdtv: number | null; exitableInOneDay: boolean | null };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function positionSize(i: PositionInput): PositionSize {
  const empty = { riskBudget: 0, riskPerShare: 0, qtyByRisk: 0, qtyByCap: 0, qtyByLiquidity: null, qty: 0, binding: 'risk' as Binding, capPct: 0, capClass: 'mid/small' as const, positionValue: 0, positionPctOfCapital: 0, actualRisk: 0, actualRiskPctOfCapital: 0, rewardRisk: null, potentialGain: null, liquidityCheck: { orderPctOfAdtv: null, exitableInOneDay: null } };
  if (!(i.capital > 0)) return { ok: false, error: 'capital must be positive', ...empty };
  if (!(i.entry > 0)) return { ok: false, error: 'entry must be positive', ...empty };
  if (!(i.stop > 0 && i.stop < i.entry)) return { ok: false, error: 'stop-loss must be below the entry (long positions only)', ...empty };
  if (!(i.riskPct > 0 && i.riskPct <= 5)) return { ok: false, error: 'risk per trade must be between 0 and 5%', ...empty };

  const riskBudget = (i.capital * i.riskPct) / 100;
  const riskPerShare = i.entry - i.stop;
  const qtyByRisk = Math.floor(riskBudget / riskPerShare);
  const large = i.marketCapCr != null && i.marketCapCr >= i.largeCapMinCr;
  const capPct = large ? i.capLargePct : i.capMidSmallPct;
  const qtyByCap = Math.floor((i.capital * capPct) / 100 / i.entry);
  const qtyByLiquidity = i.adtvCr != null && i.adtvCr > 0 ? Math.floor((i.adtvCr * 1e7 * i.liquidityPctOfAdtv) / 100 / i.entry) : null;

  const options: [Binding, number][] = [['risk', qtyByRisk], ['positionCap', qtyByCap]];
  if (qtyByLiquidity != null) options.push(['liquidity', qtyByLiquidity]);
  const [binding, qty] = options.reduce((m, o) => (o[1] < m[1] ? o : m));
  const positionValue = qty * i.entry;
  const actualRisk = qty * riskPerShare;
  const rewardRisk = i.target != null && i.target > i.entry ? r2((i.target - i.entry) / riskPerShare) : null;
  const orderPct = i.adtvCr ? r2((positionValue / (i.adtvCr * 1e7)) * 100) : null;
  return {
    ok: true,
    riskBudget: r2(riskBudget),
    riskPerShare: r2(riskPerShare),
    qtyByRisk,
    qtyByCap,
    qtyByLiquidity,
    qty: Math.max(0, qty),
    binding,
    capPct,
    capClass: large ? 'large' : 'mid/small',
    positionValue: r2(positionValue),
    positionPctOfCapital: r2((positionValue / i.capital) * 100),
    actualRisk: r2(actualRisk),
    actualRiskPctOfCapital: r2((actualRisk / i.capital) * 100),
    rewardRisk,
    potentialGain: i.target != null && i.target > i.entry ? r2(qty * (i.target - i.entry)) : null,
    liquidityCheck: { orderPctOfAdtv: orderPct, exitableInOneDay: orderPct == null ? null : orderPct <= i.liquidityPctOfAdtv * 2 },
  };
}

/** Portfolio limits (proposal 6.6): sector exposure cap and total open risk cap. */
export interface OpenPosition { symbol: string; sector: string | null; qty: number; entry: number; stop: number; lastPrice?: number | null }

export function portfolioRisk(positions: OpenPosition[], capital: number, sectorCapPct: number, totalOpenRiskPct: number) {
  const rows = positions.map((p) => {
    const price = p.lastPrice ?? p.entry;
    const value = p.qty * price;
    const openRisk = Math.max(0, p.qty * (price - p.stop));
    return { ...p, price, value: r2(value), openRisk: r2(openRisk) };
  });
  const bySector = new Map<string, number>();
  for (const r of rows) bySector.set(r.sector ?? 'Unclassified', (bySector.get(r.sector ?? 'Unclassified') ?? 0) + r.value);
  const sectors = [...bySector.entries()].map(([sector, value]) => ({ sector, value: r2(value), pct: r2((value / capital) * 100), overCap: (value / capital) * 100 > sectorCapPct })).sort((a, b) => b.value - a.value);
  const totalRisk = rows.reduce((s, r) => s + r.openRisk, 0);
  const invested = rows.reduce((s, r) => s + r.value, 0);
  return {
    positions: rows,
    sectors,
    invested: r2(invested),
    investedPct: r2((invested / capital) * 100),
    totalOpenRisk: r2(totalRisk),
    totalOpenRiskPct: r2((totalRisk / capital) * 100),
    limits: { sectorCapPct, totalOpenRiskPct },
    breaches: [
      ...sectors.filter((s) => s.overCap).map((s) => `${s.sector} exposure ${s.pct}% is above the ${sectorCapPct}% cap`),
      ...((totalRisk / capital) * 100 > totalOpenRiskPct ? [`total open risk ${r2((totalRisk / capital) * 100)}% is above the ${totalOpenRiskPct}% limit`] : []),
    ],
  };
}
