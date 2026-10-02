import { MarketCandle } from '../../types';
import { calculateATR } from '../chart/chartIndicators';

export interface ChartFormation {
  name: string;
  type: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  score: number;
  upperBoundary: number;
  lowerBoundary: number;
  timeframe: string;
  targetPrice?: number;
  invalidationPrice?: number;
}

export function detectFormations(candles: MarketCandle[], currentPrice: number): ChartFormation[] {
  if (candles.length < 30) return [];
  const atr = calculateATR(candles);
  const slice = candles.slice(-35);

  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const rangeHeight = maxHigh - minLow;

  const formations: ChartFormation[] = [];

  // 1. Double Top
  const highPeaks: { idx: number; price: number }[] = [];
  for (let i = 2; i < slice.length - 2; i++) {
    if (slice[i].high >= slice[i - 1].high && slice[i].high >= slice[i + 1].high && slice[i].high > maxHigh - atr * 0.4) {
      highPeaks.push({ idx: i, price: slice[i].high });
    }
  }
  if (highPeaks.length >= 2) {
    const p1 = highPeaks[highPeaks.length - 2];
    const p2 = highPeaks[highPeaks.length - 1];
    if (Math.abs(p1.price - p2.price) <= atr * 0.35 && p2.idx - p1.idx >= 4) {
      formations.push({
        name: 'Double Top',
        type: 'Double Top',
        bias: 'bearish',
        score: 84,
        upperBoundary: Math.max(p1.price, p2.price),
        lowerBoundary: minLow,
        timeframe: '15m',
        targetPrice: minLow,
        invalidationPrice: Math.max(p1.price, p2.price) + atr * 0.5,
      });
    }
  }

  // 2. Double Bottom
  const lowTroughs: { idx: number; price: number }[] = [];
  for (let i = 2; i < slice.length - 2; i++) {
    if (slice[i].low <= slice[i - 1].low && slice[i].low <= slice[i + 1].low && slice[i].low < minLow + atr * 0.4) {
      lowTroughs.push({ idx: i, price: slice[i].low });
    }
  }
  if (lowTroughs.length >= 2) {
    const p1 = lowTroughs[lowTroughs.length - 2];
    const p2 = lowTroughs[lowTroughs.length - 1];
    if (Math.abs(p1.price - p2.price) <= atr * 0.35 && p2.idx - p1.idx >= 4) {
      formations.push({
        name: 'Double Bottom',
        type: 'Double Bottom',
        bias: 'bullish',
        score: 85,
        upperBoundary: maxHigh,
        lowerBoundary: Math.min(p1.price, p2.price),
        timeframe: '15m',
        targetPrice: maxHigh,
        invalidationPrice: Math.min(p1.price, p2.price) - atr * 0.5,
      });
    }
  }

  // 3. Compression / Triangle
  const recent10Lows = slice.slice(-10).map((c) => c.low);
  let higherLowsCount = 0;
  for (let i = 1; i < recent10Lows.length; i++) {
    if (recent10Lows[i] >= recent10Lows[i - 1]) higherLowsCount++;
  }
  if (higherLowsCount >= 6 && rangeHeight > atr) {
    formations.push({
      name: 'Ascending Triangle (Compression)',
      type: 'Ascending Triangle',
      bias: 'bullish',
      score: 79,
      upperBoundary: maxHigh,
      lowerBoundary: minLow,
      timeframe: '15m',
      targetPrice: maxHigh + rangeHeight * 0.6,
      invalidationPrice: minLow,
    });
  }

  return formations;
}
