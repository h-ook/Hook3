import { MarketCandle } from '../../types';
import { calculateATR } from '../chart/chartIndicators';

export interface StructureSwing {
  time: number;
  price: number;
  type: 'HH' | 'HL' | 'LH' | 'LL';
  swingType: 'HIGH' | 'LOW';
}

export interface MarketStructureResult {
  trend: 'BULLISH' | 'BEARISH' | 'RANGE';
  swings: StructureSwing[];
  lastBreak?: {
    type: 'BOS' | 'CHoCH';
    direction: 'BULLISH' | 'BEARISH';
    price: number;
    time: number;
  };
}

export function detectMarketStructure(candles: MarketCandle[]): MarketStructureResult {
  if (candles.length < 15) {
    return { trend: 'RANGE', swings: [] };
  }

  const atr = calculateATR(candles);
  const swings: { time: number; price: number; type: 'HIGH' | 'LOW' }[] = [];
  const neighbor = 3;

  for (let i = neighbor; i < candles.length - neighbor; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let offset = 1; offset <= neighbor; offset++) {
      if (candles[i - offset].high >= c.high || candles[i + offset].high >= c.high) isHigh = false;
      if (candles[i - offset].low <= c.low || candles[i + offset].low <= c.low) isLow = false;
    }

    if (isHigh) swings.push({ time: c.time, price: c.high, type: 'HIGH' });
    if (isLow) swings.push({ time: c.time, price: c.low, type: 'LOW' });
  }

  // Label HH, HL, LH, LL
  const structuredSwings: StructureSwing[] = [];
  const highs = swings.filter((s) => s.type === 'HIGH');
  const lows = swings.filter((s) => s.type === 'LOW');

  for (let i = 0; i < highs.length; i++) {
    const prev = highs[i - 1];
    const curr = highs[i];
    const type = prev ? (curr.price >= prev.price ? 'HH' : 'LH') : 'HH';
    structuredSwings.push({ time: curr.time, price: curr.price, type, swingType: 'HIGH' });
  }

  for (let i = 0; i < lows.length; i++) {
    const prev = lows[i - 1];
    const curr = lows[i];
    const type = prev ? (curr.price >= prev.price ? 'HL' : 'LL') : 'HL';
    structuredSwings.push({ time: curr.time, price: curr.price, type, swingType: 'LOW' });
  }

  structuredSwings.sort((a, b) => a.time - b.time);

  // Determine trend
  const recentHighs = structuredSwings.filter((s) => s.swingType === 'HIGH').slice(-3);
  const recentLows = structuredSwings.filter((s) => s.swingType === 'LOW').slice(-3);

  let trend: 'BULLISH' | 'BEARISH' | 'RANGE' = 'RANGE';
  if (recentHighs.length >= 2 && recentLows.length >= 2) {
    const hhCount = recentHighs.filter((s) => s.type === 'HH').length;
    const hlCount = recentLows.filter((s) => s.type === 'HL').length;
    const lhCount = recentHighs.filter((s) => s.type === 'LH').length;
    const llCount = recentLows.filter((s) => s.type === 'LL').length;

    if (hhCount >= 1 && hlCount >= 1) trend = 'BULLISH';
    else if (lhCount >= 1 && llCount >= 1) trend = 'BEARISH';
  }

  // Detect BOS / CHoCH
  let lastBreak: MarketStructureResult['lastBreak'] | undefined;
  const lastCandle = candles[candles.length - 1];
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];

  if (lastCandle && lastHigh && lastCandle.close > lastHigh.price) {
    lastBreak = {
      type: trend === 'BULLISH' ? 'BOS' : 'CHoCH',
      direction: 'BULLISH',
      price: lastHigh.price,
      time: lastCandle.time,
    };
  } else if (lastCandle && lastLow && lastCandle.close < lastLow.price) {
    lastBreak = {
      type: trend === 'BEARISH' ? 'BOS' : 'CHoCH',
      direction: 'BEARISH',
      price: lastLow.price,
      time: lastCandle.time,
    };
  }

  return {
    trend,
    swings: structuredSwings.slice(-10),
    lastBreak,
  };
}
