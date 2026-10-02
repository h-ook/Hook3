import { MarketCandle } from '../../types';
import { calculateATR } from '../chart/chartIndicators';

export interface ChartLevelZone {
  id: string;
  type: 'SUPPORT' | 'RESISTANCE';
  low: number;
  high: number;
  center: number;
  touches: number;
  reactions: number;
  strengthScore: number; // 0 - 100
  isThirdTouchApproaching: boolean;
}

export function detectLevelZones(candles: MarketCandle[], currentPrice: number): ChartLevelZone[] {
  if (candles.length < 20) return [];
  const atr = calculateATR(candles);
  const zoneTolerance = atr * 0.35;

  const rawLevels: { price: number; type: 'SUPPORT' | 'RESISTANCE'; time: number }[] = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    if (c.high >= candles[i - 1].high && c.high >= candles[i + 1].high) {
      rawLevels.push({ price: c.high, type: 'RESISTANCE', time: c.time });
    }
    if (c.low <= candles[i - 1].low && c.low <= candles[i + 1].low) {
      rawLevels.push({ price: c.low, type: 'SUPPORT', time: c.time });
    }
  }

  // Cluster levels into zones
  const zones: ChartLevelZone[] = [];

  for (const lvl of rawLevels) {
    const existing = zones.find(
      (z) => z.type === lvl.type && Math.abs(z.center - lvl.price) <= zoneTolerance
    );

    if (existing) {
      existing.touches += 1;
      existing.low = Math.min(existing.low, lvl.price - zoneTolerance * 0.4);
      existing.high = Math.max(existing.high, lvl.price + zoneTolerance * 0.4);
      existing.center = (existing.low + existing.high) / 2;
    } else {
      zones.push({
        id: `zone_${lvl.type}_${Math.round(lvl.price * 100)}`,
        type: lvl.type,
        low: lvl.price - zoneTolerance * 0.4,
        high: lvl.price + zoneTolerance * 0.4,
        center: lvl.price,
        touches: 1,
        reactions: 1,
        strengthScore: 40,
        isThirdTouchApproaching: false,
      });
    }
  }

  // Calculate strength score and third touch approaching
  for (const z of zones) {
    const touchScore = Math.min(50, z.touches * 15);
    z.strengthScore = Math.min(100, 30 + touchScore);

    // Third touch condition: has 2 prior touches, and price is approaching within 1.5%
    if (z.touches >= 2) {
      const distPct = Math.abs((currentPrice - z.center) / z.center) * 100;
      if (distPct <= 1.5) {
        z.isThirdTouchApproaching = true;
      }
    }
  }

  return zones.sort((a, b) => b.strengthScore - a.strengthScore).slice(0, 8);
}
