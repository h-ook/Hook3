import { Kline, DetectedFormation } from '../types';

export function detectFormations(klines: Kline[], symbol: string): DetectedFormation[] {
  if (!klines || klines.length < 20) return [];
  return [];
}
