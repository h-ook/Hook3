import { Kline, Timeframe } from '../../src/types';
import { calculateATR } from './multiTimeframeEngine';
import { DetectedPattern, LevelZone, ThirdTouchTracker } from './types';

export class LevelsAndFormationsEngine {
  private levelZones: LevelZone[] = [];
  private thirdTouchTrackers = new Map<string, ThirdTouchTracker>();

  public findSupportResistanceZones(candles1d: Kline[], candles4h: Kline[], candles1h: Kline[]): LevelZone[] {
    const zones: LevelZone[] = [];

    const analyzeCandlesForZones = (candles: Kline[], tf: Timeframe, baseWeight: number) => {
      if (candles.length < 12) return;
      const atr = calculateATR(candles);
      const zoneTolerance = atr * 0.35;

      for (let i = 2; i < candles.length - 2; i++) {
        const c = candles[i];
        const isHigh = c.high >= candles[i - 1].high && c.high >= candles[i - 2].high &&
                       c.high >= candles[i + 1].high && c.high >= candles[i + 2].high;
        const isLow = c.low <= candles[i - 1].low && c.low <= candles[i - 2].low &&
                      c.low <= candles[i + 1].low && c.low <= candles[i + 2].low;

        if (isHigh) {
          this.clusterZone(zones, candles, i, tf, 'RESISTANCE', c.high, zoneTolerance, c.time, baseWeight);
        }
        if (isLow) {
          this.clusterZone(zones, candles, i, tf, 'SUPPORT', c.low, zoneTolerance, c.time, baseWeight);
        }
      }
    };

    analyzeCandlesForZones(candles1d, '1d', 35);
    analyzeCandlesForZones(candles4h, '4h', 25);
    analyzeCandlesForZones(candles1h, '1h', 15);

    // Finalize score & empirical reaction metrics for all zones
    for (const z of zones) {
      const touchScore = Math.min(35, z.touches * 8);
      const reactionRateScore = Math.min(30, (z.reactionRate / 100) * 30);
      const tfScore = z.timeframe === '1d' ? 35 : z.timeframe === '4h' ? 25 : 15;
      z.strengthScore = Math.min(100, Math.round(touchScore + reactionRateScore + tfScore));
    }

    this.levelZones = zones.sort((a, b) => b.strengthScore - a.strengthScore);
    return this.levelZones;
  }

  private clusterZone(
    zones: LevelZone[],
    allCandles: Kline[],
    candleIdx: number,
    tf: Timeframe,
    type: 'SUPPORT' | 'RESISTANCE',
    price: number,
    tolerance: number,
    time: number,
    baseWeight: number
  ) {
    // Measure empirical reaction on candles after candleIdx
    const futureCandles = allCandles.slice(candleIdx + 1, candleIdx + 8);
    let reactionPct = 0;
    let isSuccess = false;

    if (futureCandles.length > 0) {
      if (type === 'SUPPORT') {
        const maxFutureHigh = Math.max(...futureCandles.map((c) => c.high));
        reactionPct = Math.max(0, ((maxFutureHigh - price) / price) * 100);
        isSuccess = reactionPct >= 0.5;
      } else {
        const minFutureLow = Math.min(...futureCandles.map((c) => c.low));
        reactionPct = Math.max(0, ((price - minFutureLow) / price) * 100);
        isSuccess = reactionPct >= 0.5;
      }
    }

    const existing = zones.find((z) => z.type === type && Math.abs(z.zoneCenter - price) <= tolerance);
    if (existing) {
      existing.touches += 1;
      existing.zoneLow = Math.min(existing.zoneLow, price - tolerance * 0.5);
      existing.zoneHigh = Math.max(existing.zoneHigh, price + tolerance * 0.5);
      existing.zoneCenter = (existing.zoneLow + existing.zoneHigh) / 2;
      existing.lastTouchTime = Math.max(existing.lastTouchTime, time);

      if (isSuccess) {
        existing.reactions += 1;
        existing.strongReactions += reactionPct >= 1.5 ? 1 : 0;
      } else {
        existing.failedBreaks += 1;
      }

      existing.maxReactionPct = Math.max(existing.maxReactionPct, Number(reactionPct.toFixed(2)));
      existing.averageReactionPct = Number(((existing.averageReactionPct * (existing.touches - 1) + reactionPct) / existing.touches).toFixed(2));
      existing.reactionRate = Math.round((existing.reactions / existing.touches) * 100);
      existing.failureRate = 100 - existing.reactionRate;
    } else {
      zones.push({
        id: `zone_${tf}_${type}_${Math.round(price * 100) / 100}`,
        timeframe: tf,
        type,
        zoneLow: price - tolerance * 0.5,
        zoneHigh: price + tolerance * 0.5,
        zoneCenter: price,
        touches: 1,
        confirmedTouches: 1,
        reactions: isSuccess ? 1 : 0,
        strongReactions: reactionPct >= 1.5 ? 1 : 0,
        weakReactions: isSuccess && reactionPct < 1.5 ? 1 : 0,
        failedBreaks: isSuccess ? 0 : 1,
        breakoutCount: 0,
        rejectionCount: isSuccess ? 1 : 0,
        averageReactionPct: Number(reactionPct.toFixed(2)),
        medianReactionPct: Number(reactionPct.toFixed(2)),
        maxReactionPct: Number(reactionPct.toFixed(2)),
        reactionRate: isSuccess ? 100 : 0,
        failureRate: isSuccess ? 0 : 100,
        strengthScore: baseWeight,
        firstSeen: time,
        lastTouchTime: time,
      });
    }
  }

  public trackThirdTouch(currentPrice: number, candles1h: Kline[]): ThirdTouchTracker[] {
    const activeTrackers: ThirdTouchTracker[] = [];
    if (candles1h.length < 10) return [];
    const atr = calculateATR(candles1h);

    for (const zone of this.levelZones) {
      if (zone.touches < 2) continue; // Need at least 2 verified prior touches

      const dist = Math.abs(currentPrice - zone.zoneCenter);
      const distPct = (dist / zone.zoneCenter) * 100;
      const approachThresholdPct = (atr / zone.zoneCenter) * 100 * 1.6;

      let tracker = this.thirdTouchTrackers.get(zone.id);
      if (!tracker) {
        tracker = {
          levelId: zone.id,
          levelType: zone.type,
          price: zone.zoneCenter,
          touchCount: zone.touches,
          state: 'NOT_EXPECTED',
          distancePct: Number(distPct.toFixed(3)),
          approachSpeed: 'NORMAL',
          compression: false,
          higherLowsCount: 0,
          lowerHighsCount: 0,
          volumeRatio: 1.0,
          updatedAt: Date.now(),
        };
        this.thirdTouchTrackers.set(zone.id, tracker);
      }

      tracker.distancePct = Number(distPct.toFixed(3));
      tracker.touchCount = zone.touches;

      // Check compression into level
      const recent10 = candles1h.slice(-10);
      let hlCount = 0;
      let lhCount = 0;
      for (let i = 1; i < recent10.length; i++) {
        if (recent10[i].low > recent10[i - 1].low) hlCount++;
        if (recent10[i].high < recent10[i - 1].high) lhCount++;
      }
      tracker.higherLowsCount = hlCount;
      tracker.lowerHighsCount = lhCount;
      tracker.compression = (zone.type === 'RESISTANCE' && hlCount >= 3) || (zone.type === 'SUPPORT' && lhCount >= 3);

      // Determine state
      if (distPct <= approachThresholdPct) {
        if (currentPrice >= zone.zoneLow && currentPrice <= zone.zoneHigh) {
          tracker.state = 'ACTIVE';
        } else {
          tracker.state = 'APPROACHING';
        }
      } else {
        tracker.state = 'NOT_EXPECTED';
      }

      tracker.updatedAt = Date.now();
      if (tracker.state === 'APPROACHING' || tracker.state === 'ACTIVE') {
        activeTrackers.push(tracker);
      }
    }

    return activeTrackers;
  }

  public detectFormations(candles: Kline[], currentPrice: number): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    if (candles.length < 25) return [];

    const atr = calculateATR(candles);
    const slice = candles.slice(-30);
    const highs = slice.map((c) => c.high);
    const lows = slice.map((c) => c.low);

    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const rangeHeight = maxHigh - minLow;

    // 1. Double Top
    const highIndices: number[] = [];
    for (let i = 2; i < slice.length - 2; i++) {
      if (slice[i].high >= slice[i - 1].high && slice[i].high >= slice[i + 1].high && slice[i].high > maxHigh - atr * 0.5) {
        highIndices.push(i);
      }
    }
    if (highIndices.length >= 2) {
      const idx1 = highIndices[highIndices.length - 2];
      const idx2 = highIndices[highIndices.length - 1];
      const diff = Math.abs(slice[idx1].high - slice[idx2].high);
      if (diff <= atr * 0.35 && idx2 - idx1 >= 4) {
        patterns.push({
          name: 'Double Top',
          type: 'Double Top',
          bias: 'bearish',
          score: 82,
          upperBoundary: Math.max(slice[idx1].high, slice[idx2].high),
          lowerBoundary: minLow,
          touchesUpper: 2,
          touchesLower: 1,
          compression: false,
          timeframe: '1h',
          status: currentPrice < slice[idx2].high ? 'READY' : 'FORMING',
          invalidationLevel: Math.max(slice[idx1].high, slice[idx2].high) + atr * 0.5,
          targetLevel: minLow,
        });
      }
    }

    // 2. Double Bottom
    const lowIndices: number[] = [];
    for (let i = 2; i < slice.length - 2; i++) {
      if (slice[i].low <= slice[i - 1].low && slice[i].low <= slice[i + 1].low && slice[i].low < minLow + atr * 0.5) {
        lowIndices.push(i);
      }
    }
    if (lowIndices.length >= 2) {
      const idx1 = lowIndices[lowIndices.length - 2];
      const idx2 = lowIndices[lowIndices.length - 1];
      const diff = Math.abs(slice[idx1].low - slice[idx2].low);
      if (diff <= atr * 0.35 && idx2 - idx1 >= 4) {
        patterns.push({
          name: 'Double Bottom',
          type: 'Double Bottom',
          bias: 'bullish',
          score: 84,
          upperBoundary: maxHigh,
          lowerBoundary: Math.min(slice[idx1].low, slice[idx2].low),
          touchesUpper: 1,
          touchesLower: 2,
          compression: false,
          timeframe: '1h',
          status: currentPrice > slice[idx2].low ? 'READY' : 'FORMING',
          invalidationLevel: Math.min(slice[idx1].low, slice[idx2].low) - atr * 0.5,
          targetLevel: maxHigh,
        });
      }
    }

    // 3. Ascending Triangle (Higher lows into flat resistance)
    const recentLows = slice.slice(-15).map((c) => c.low);
    let higherLowsInRow = 0;
    for (let i = 1; i < recentLows.length; i++) {
      if (recentLows[i] >= recentLows[i - 1]) higherLowsInRow++;
    }
    if (higherLowsInRow >= 7 && rangeHeight > atr * 1.5) {
      patterns.push({
        name: 'Ascending Triangle',
        type: 'Ascending Triangle',
        bias: 'bullish',
        score: 78,
        upperBoundary: maxHigh,
        lowerBoundary: minLow,
        touchesUpper: 2,
        touchesLower: 3,
        compression: true,
        timeframe: '1h',
        status: 'FORMING',
        invalidationLevel: minLow,
        targetLevel: maxHigh + rangeHeight * 0.6,
      });
    }

    // 4. Descending Triangle (Lower highs into flat support)
    const recentHighs = slice.slice(-15).map((c) => c.high);
    let lowerHighsInRow = 0;
    for (let i = 1; i < recentHighs.length; i++) {
      if (recentHighs[i] <= recentHighs[i - 1]) lowerHighsInRow++;
    }
    if (lowerHighsInRow >= 7 && rangeHeight > atr * 1.5) {
      patterns.push({
        name: 'Descending Triangle',
        type: 'Descending Triangle',
        bias: 'bearish',
        score: 78,
        upperBoundary: maxHigh,
        lowerBoundary: minLow,
        touchesUpper: 3,
        touchesLower: 2,
        compression: true,
        timeframe: '1h',
        status: 'FORMING',
        invalidationLevel: maxHigh,
        targetLevel: minLow - rangeHeight * 0.6,
      });
    }

    return patterns;
  }

  // Fibonacci Levels
  public calculateFibonacci(high: number, low: number): Record<string, number> {
    const diff = high - low;
    return {
      '0': high,
      '0.382': Number((high - diff * 0.382).toFixed(4)),
      '0.5': Number((high - diff * 0.5).toFixed(4)),
      '0.618': Number((high - diff * 0.618).toFixed(4)),
      '0.65': Number((high - diff * 0.65).toFixed(4)),
      '0.786': Number((high - diff * 0.786).toFixed(4)),
      '1': low,
    };
  }

  // Adaptive Round Numbers Step
  public calculateRoundNumbers(currentPrice: number): number[] {
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
}
