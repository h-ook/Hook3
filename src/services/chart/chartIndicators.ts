import { MarketCandle } from '../../types';

export interface VolumeBarData {
  time: number;
  value: number;
  color: string;
  sma20: number;
  isHighVolume: boolean;
  isAbnormalVolume: boolean;
}

export function calculateVolumeSMA20(candles: MarketCandle[]): VolumeBarData[] {
  const result: VolumeBarData[] = [];
  const period = 20;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const isUp = c.close >= c.open;

    // Calculate rolling SMA 20
    const startIdx = Math.max(0, i - period + 1);
    const slice = candles.slice(startIdx, i + 1);
    const sum = slice.reduce((acc, curr) => acc + curr.volume, 0);
    const sma20 = sum / slice.length;

    const isAbnormal = sma20 > 0 && c.volume >= sma20 * 2.5;
    const isHigh = sma20 > 0 && c.volume >= sma20 * 1.5 && !isAbnormal;

    let color = isUp ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)';
    if (isAbnormal) {
      color = isUp ? '#10b981' : '#ef4444';
    } else if (isHigh) {
      color = isUp ? 'rgba(16, 185, 129, 0.75)' : 'rgba(239, 68, 68, 0.75)';
    }

    result.push({
      time: c.time,
      value: c.volume,
      color,
      sma20,
      isHighVolume: isHigh,
      isAbnormalVolume: isAbnormal,
    });
  }

  return result;
}

export function calculateATR(candles: MarketCandle[], period = 14): number {
  if (candles.length < 2) return (candles[0]?.close || 100) * 0.01;
  const trs: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }

  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function calculateFibonacciLevels(high: number, low: number): {
  ratio: number;
  label: string;
  price: number;
  isGoldenPocket?: boolean;
}[] {
  const diff = high - low;
  return [
    { ratio: 0, label: '0.0% (High)', price: high },
    { ratio: 0.382, label: '0.382', price: high - diff * 0.382 },
    { ratio: 0.5, label: '0.50 (Equilibrium)', price: high - diff * 0.5 },
    { ratio: 0.618, label: '0.618 (Golden Pocket)', price: high - diff * 0.618, isGoldenPocket: true },
    { ratio: 0.65, label: '0.65 (Golden Pocket)', price: high - diff * 0.65, isGoldenPocket: true },
    { ratio: 0.786, label: '0.786', price: high - diff * 0.786 },
    { ratio: 1, label: '1.0% (Low)', price: low },
  ];
}

export function calculateAdaptiveRoundNumbers(currentPrice: number): number[] {
  let step = 1000;
  if (currentPrice >= 10000) step = 1000;
  else if (currentPrice >= 1000) step = 100;
  else if (currentPrice >= 100) step = 10;
  else if (currentPrice >= 10) step = 1;
  else if (currentPrice >= 1) step = 0.1;
  else if (currentPrice >= 0.01) step = 0.01;
  else step = 0.001;

  const base = Math.floor(currentPrice / step) * step;
  return [base - step, base, base + step];
}
