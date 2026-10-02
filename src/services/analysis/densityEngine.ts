export interface ChartDensityItem {
  id: string;
  price: number;
  side: 'BID' | 'ASK';
  notionalUsd: number;
  distancePct: number;
  classification: 'NEW' | 'PERSISTENT' | 'STRONG' | 'REMOVED' | 'POSSIBLE_SPOOF';
}

export function calculateAdaptiveThreshold(
  orderBookLevels: { price: number; quantity: number }[],
  volume24hUsd = 0,
  mode: 'AUTO' | 'MANUAL' | 'HYBRID' = 'AUTO',
  manualThreshold = 1000000
): number {
  if (mode === 'MANUAL') return manualThreshold;

  const notionals = orderBookLevels.map((l) => l.price * l.quantity).sort((a, b) => a - b);
  if (notionals.length === 0) return manualThreshold;

  const p90 = notionals[Math.floor(notionals.length * 0.90)] || 50000;
  const turnoverBaseline = volume24hUsd > 0 ? Math.max(50000, volume24hUsd * 0.0003) : 100000;
  const autoVal = Math.max(turnoverBaseline, p90 * 1.8);

  if (mode === 'HYBRID') {
    return Math.max(manualThreshold * 0.6, autoVal);
  }
  return autoVal;
}
