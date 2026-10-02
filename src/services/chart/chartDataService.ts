import { MarketCandle } from '../../types';

export class ChartDataStore {
  private candles: MarketCandle[] = [];

  constructor(initialCandles: MarketCandle[] = []) {
    this.setCandles(initialCandles);
  }

  public setCandles(candles: MarketCandle[]) {
    // Sort and remove duplicates by time
    const map = new Map<number, MarketCandle>();
    for (const c of candles) {
      if (c && c.time > 0 && !isNaN(c.close)) {
        map.set(c.time, c);
      }
    }
    this.candles = Array.from(map.values()).sort((a, b) => a.time - b.time);
  }

  public getCandles(): MarketCandle[] {
    return this.candles;
  }

  public getLastCandle(): MarketCandle | null {
    return this.candles.length > 0 ? this.candles[this.candles.length - 1] : null;
  }

  public getFirstCandle(): MarketCandle | null {
    return this.candles.length > 0 ? this.candles[0] : null;
  }

  /**
   * Updates or appends a realtime candle.
   * Returns { isNewCandle: boolean, updatedCandle: MarketCandle }
   */
  public updateLiveCandle(live: MarketCandle): { isNewCandle: boolean; updatedCandle: MarketCandle } {
    if (this.candles.length === 0) {
      this.candles.push(live);
      return { isNewCandle: true, updatedCandle: live };
    }

    const last = this.candles[this.candles.length - 1];

    if (live.time === last.time) {
      // Update ongoing candle
      last.high = Math.max(last.high, live.high);
      last.low = Math.min(last.low, live.low);
      last.close = live.close;
      last.volume = live.volume;
      last.quoteVolume = live.quoteVolume;
      last.closed = live.closed;
      return { isNewCandle: false, updatedCandle: last };
    } else if (live.time > last.time) {
      // Previous candle officially ended, push new live candle
      last.closed = true;
      this.candles.push(live);
      return { isNewCandle: true, updatedCandle: live };
    } else {
      // Historical or out-of-order update, replace in map
      const idx = this.candles.findIndex((c) => c.time === live.time);
      if (idx !== -1) {
        this.candles[idx] = live;
      }
      return { isNewCandle: false, updatedCandle: live };
    }
  }

  /**
   * Prepends older historical candles (infinite scroll to past).
   * Returns count of newly prepended candles.
   */
  public prependHistory(olderCandles: MarketCandle[]): number {
    if (olderCandles.length === 0) return 0;
    const existingTimes = new Set(this.candles.map((c) => c.time));
    const newOlder = olderCandles.filter((c) => !existingTimes.has(c.time));

    if (newOlder.length > 0) {
      this.candles = [...newOlder, ...this.candles].sort((a, b) => a.time - b.time);
      return newOlder.length;
    }
    return 0;
  }
}
