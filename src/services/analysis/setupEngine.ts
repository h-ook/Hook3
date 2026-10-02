import { ChartLevelZone } from './levelEngine';
import { MarketStructureResult } from './structureEngine';
import { ChartFormation } from './formationEngine';

export interface ChartTradingSetup {
  id: string;
  type: 'SUPPORT_RETEST' | 'RESISTANCE_REJECTION' | 'BREAKOUT_RETEST' | 'THIRD_TOUCH';
  direction: 'LONG' | 'SHORT';
  entryZone: { low: number; high: number; center: number };
  invalidation: number;
  targets: { tp1: number; tp2: number; tp3: number };
  confluenceScore: number; // 0 - 100
  status: 'WATCH' | 'CONFIRMED' | 'INVALIDATED';
  title: string;
}

export function evaluateChartSetups(params: {
  currentPrice: number;
  zones: ChartLevelZone[];
  structure: MarketStructureResult;
  formations: ChartFormation[];
}): ChartTradingSetup[] {
  const { currentPrice, zones, structure, formations } = params;
  const setups: ChartTradingSetup[] = [];

  // Support Retest (Long)
  const supportZone = zones.find((z) => z.type === 'SUPPORT' && z.strengthScore >= 40);
  if (supportZone) {
    const distPct = Math.abs((currentPrice - supportZone.center) / supportZone.center) * 100;
    if (distPct <= 2.0) {
      const zoneWidth = supportZone.high - supportZone.low;
      const invalidation = supportZone.low - zoneWidth * 0.6;
      const tp1 = supportZone.center * 1.02;
      const tp2 = supportZone.center * 1.04;
      const tp3 = supportZone.center * 1.065;

      let score = 55;
      if (structure.trend === 'BULLISH') score += 20;
      if (supportZone.touches >= 2) score += 15;
      if (formations.some((f) => f.bias === 'bullish')) score += 10;

      const isConfirmed = score >= 75 && currentPrice >= supportZone.low && currentPrice <= supportZone.high;

      setups.push({
        id: `setup_sup_${supportZone.id}`,
        type: 'SUPPORT_RETEST',
        direction: 'LONG',
        entryZone: { low: supportZone.low, high: supportZone.high, center: supportZone.center },
        invalidation,
        targets: { tp1, tp2, tp3 },
        confluenceScore: Math.min(100, score),
        status: isConfirmed ? 'CONFIRMED' : 'WATCH',
        title: isConfirmed ? 'SUPPORT RETEST (CONFIRMED)' : 'SUPPORT RETEST (WATCH)',
      });
    }
  }

  // Resistance Rejection (Short)
  const resZone = zones.find((z) => z.type === 'RESISTANCE' && z.strengthScore >= 40);
  if (resZone) {
    const distPct = Math.abs((currentPrice - resZone.center) / resZone.center) * 100;
    if (distPct <= 2.0) {
      const zoneWidth = resZone.high - resZone.low;
      const invalidation = resZone.high + zoneWidth * 0.6;
      const tp1 = resZone.center * 0.98;
      const tp2 = resZone.center * 0.96;
      const tp3 = resZone.center * 0.935;

      let score = 55;
      if (structure.trend === 'BEARISH') score += 20;
      if (resZone.touches >= 2) score += 15;
      if (formations.some((f) => f.bias === 'bearish')) score += 10;

      const isConfirmed = score >= 75 && currentPrice >= resZone.low && currentPrice <= resZone.high;

      setups.push({
        id: `setup_res_${resZone.id}`,
        type: 'RESISTANCE_REJECTION',
        direction: 'SHORT',
        entryZone: { low: resZone.low, high: resZone.high, center: resZone.center },
        invalidation,
        targets: { tp1, tp2, tp3 },
        confluenceScore: Math.min(100, score),
        status: isConfirmed ? 'CONFIRMED' : 'WATCH',
        title: isConfirmed ? 'RESISTANCE REJECTION (CONFIRMED)' : 'RESISTANCE REJECTION (WATCH)',
      });
    }
  }

  return setups;
}
