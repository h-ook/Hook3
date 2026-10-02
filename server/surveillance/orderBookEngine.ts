import { ExchangeId, MarketType } from '../../src/types';
import { RawDepthDelta } from './exchangeStream';
import { DensityClassification, DensityItem, OrderBookLevel, OrderBookState, OrderBookStatus } from './types';

export interface DensityConfig {
  mode: 'AUTO' | 'MANUAL' | 'HYBRID';
  manualThresholdUsd: number;
  minPersistenceSeconds: number;
  maxDistancePct: number;
  minReactionPct: number;
}

interface DensityReactionHistoryRecord {
  densityId: string;
  side: 'BID' | 'ASK';
  densityPrice: number;
  notionalUsd: number;
  approachTime: number;
  reactionPct: number;
  success: boolean;
}

export class OrderBookEngine {
  private bids = new Map<number, number>(); // price -> qty
  private asks = new Map<number, number>(); // price -> qty

  private activeDensities = new Map<string, DensityItem>(); // id -> item
  private densityHistory: DensityItem[] = [];
  private reactionHistory: DensityReactionHistoryRecord[] = [];

  public bestBid = 0;
  public bestAsk = 0;
  public spread = 0;
  public spreadPct = 0;
  public lastUpdateId = 0;
  public lastReceivedAt = 0;
  public status: OrderBookStatus = 'CONNECTING';

  constructor(
    public readonly symbol: string,
    public readonly exchange: ExchangeId,
    public readonly marketType: MarketType,
    private config: DensityConfig = {
      mode: 'AUTO',
      manualThresholdUsd: 1000000,
      minPersistenceSeconds: 15,
      maxDistancePct: 2.0,
      minReactionPct: 0.5,
    }
  ) {}

  public updateConfig(newConfig: Partial<DensityConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  public setStatus(newStatus: OrderBookStatus) {
    this.status = newStatus;
  }

  public applyDepth(delta: RawDepthDelta) {
    this.lastReceivedAt = Date.now();
    this.lastUpdateId = delta.sequence || Date.now();

    if (delta.isSnapshot) {
      this.bids.clear();
      this.asks.clear();
    }

    // Apply Bids
    for (const [price, qty] of delta.bids) {
      if (qty <= 0) {
        this.bids.delete(price);
      } else {
        this.bids.set(price, qty);
      }
    }

    // Apply Asks
    for (const [price, qty] of delta.asks) {
      if (qty <= 0) {
        this.asks.delete(price);
      } else {
        this.asks.set(price, qty);
      }
    }

    // Calculate Best Bid & Ask
    let maxBid = 0;
    for (const p of this.bids.keys()) {
      if (p > maxBid) maxBid = p;
    }

    let minAsk = Infinity;
    for (const p of this.asks.keys()) {
      if (p < minAsk) minAsk = p;
    }

    this.bestBid = maxBid;
    this.bestAsk = minAsk < Infinity ? minAsk : 0;

    if (this.bestBid > 0 && this.bestAsk > 0 && this.bestAsk >= this.bestBid) {
      this.spread = this.bestAsk - this.bestBid;
      this.spreadPct = (this.spread / this.bestBid) * 100;
      this.status = 'LIVE';
    }

    this.evaluateDensities();
  }

  public getSortedBids(limit = 30): OrderBookLevel[] {
    const sortedPrices = Array.from(this.bids.keys()).sort((a, b) => b - a).slice(0, limit);
    return sortedPrices.map((price) => {
      const quantity = this.bids.get(price) || 0;
      return {
        price,
        quantity,
        notionalUsd: price * quantity,
      };
    });
  }

  public getSortedAsks(limit = 30): OrderBookLevel[] {
    const sortedPrices = Array.from(this.asks.keys()).sort((a, b) => a - b).slice(0, limit);
    return sortedPrices.map((price) => {
      const quantity = this.asks.get(price) || 0;
      return {
        price,
        quantity,
        notionalUsd: price * quantity,
      };
    });
  }

  public getState(): OrderBookState {
    const bids = this.getSortedBids(20);
    const asks = this.getSortedAsks(20);

    return {
      symbol: this.symbol,
      exchange: this.exchange,
      marketType: this.marketType,
      bids,
      asks,
      bestBid: this.bestBid,
      bestAsk: this.bestAsk,
      spread: this.spread,
      spreadPct: Number(this.spreadPct.toFixed(4)),
      lastUpdateId: this.lastUpdateId,
      sequence: this.lastUpdateId,
      timestamp: this.lastReceivedAt || Date.now(),
      status: this.status,
      lastReceivedAt: this.lastReceivedAt,
    };
  }

  // Calculate adaptive density threshold based on visible depth notional percentiles and 24h turnover
  public calculateAdaptiveThreshold(volume24hUsd = 0): number {
    const allNotionals: number[] = [];
    for (const [p, q] of this.bids.entries()) allNotionals.push(p * q);
    for (const [p, q] of this.asks.entries()) allNotionals.push(p * q);

    if (allNotionals.length === 0) {
      return this.config.manualThresholdUsd || 1000000;
    }

    allNotionals.sort((a, b) => a - b);
    const p90Index = Math.floor(allNotionals.length * 0.90);
    const p90Value = allNotionals[p90Index] || 50000;

    // Turnover baseline: 0.03% of 24h volume
    const turnoverBaseline = volume24hUsd > 0 ? Math.max(50000, volume24hUsd * 0.0003) : 100000;
    const autoVal = Math.max(turnoverBaseline, p90Value * 1.8);

    if (this.config.mode === 'MANUAL') {
      return this.config.manualThresholdUsd;
    }
    if (this.config.mode === 'HYBRID') {
      return Math.max(this.config.manualThresholdUsd * 0.6, autoVal);
    }
    return autoVal;
  }

  private evaluateDensities() {
    const now = Date.now();
    const midPrice = (this.bestBid + this.bestAsk) / 2 || this.bestBid || 1;
    const thresholdUsd = this.calculateAdaptiveThreshold();

    const seenIds = new Set<string>();

    // Check Bids
    for (const [price, qty] of this.bids.entries()) {
      const notionalUsd = price * qty;
      if (notionalUsd >= thresholdUsd) {
        const id = `bid_${price}`;
        seenIds.add(id);
        const distPct = Math.abs((midPrice - price) / midPrice) * 100;
        if (distPct <= (this.config.maxDistancePct || 2.5)) {
          this.updateOrAddDensity(id, 'BID', price, qty, notionalUsd, distPct, now);
        }
      }
    }

    // Check Asks
    for (const [price, qty] of this.asks.entries()) {
      const notionalUsd = price * qty;
      if (notionalUsd >= thresholdUsd) {
        const id = `ask_${price}`;
        seenIds.add(id);
        const distPct = Math.abs((price - midPrice) / midPrice) * 100;
        if (distPct <= (this.config.maxDistancePct || 2.5)) {
          this.updateOrAddDensity(id, 'ASK', price, qty, notionalUsd, distPct, now);
        }
      }
    }

    // Process removed / disappeared densities
    for (const [id, item] of this.activeDensities.entries()) {
      if (!seenIds.has(id)) {
        const ageSec = Math.max(1, (now - item.firstSeenAt) / 1000);

        // If it vanished right when price approached closely (< 0.25%) without execution, flag potential spoof
        if (item.distancePct <= 0.25 && ageSec < 45) {
          item.classification = 'POSSIBLE_SPOOF';
        } else {
          item.classification = 'REMOVED';
        }

        this.densityHistory.unshift(item);
        if (this.densityHistory.length > 50) this.densityHistory.pop();
        this.activeDensities.delete(id);
      }
    }
  }

  private updateOrAddDensity(
    id: string,
    side: 'BID' | 'ASK',
    price: number,
    qty: number,
    notionalUsd: number,
    distPct: number,
    now: number
  ) {
    const existing = this.activeDensities.get(id);
    if (existing) {
      existing.quantity = qty;
      existing.notionalUsd = notionalUsd;
      existing.distancePct = Number(distPct.toFixed(2));
      existing.lastSeenAt = now;
      existing.ageSeconds = Math.floor((now - existing.firstSeenAt) / 1000);
      existing.maxSizeUsd = Math.max(existing.maxSizeUsd, notionalUsd);
      existing.averageSizeUsd = (existing.averageSizeUsd + notionalUsd) / 2;

      // Classify lifetime progression
      if (existing.ageSeconds >= (this.config.minPersistenceSeconds || 15) * 3) {
        existing.classification = 'STRONG';
      } else if (existing.ageSeconds >= (this.config.minPersistenceSeconds || 15)) {
        existing.classification = 'PERSISTENT';
      } else {
        existing.classification = 'STANDARD';
      }
    } else {
      const reactionStats = this.computeHistoricalReactionStats(side);

      const newItem: DensityItem = {
        id,
        price,
        side,
        quantity: qty,
        notionalUsd,
        distancePct: Number(distPct.toFixed(2)),
        firstSeenAt: now,
        lastSeenAt: now,
        ageSeconds: 0,
        maxSizeUsd: notionalUsd,
        averageSizeUsd: notionalUsd,
        persistenceRatio: 1.0,
        classification: 'NEW',
        historicalReaction: reactionStats,
      };
      this.activeDensities.set(id, newItem);
    }
  }

  public recordDensityReaction(densityId: string, side: 'BID' | 'ASK', densityPrice: number, notional: number, reactionPct: number, success: boolean) {
    this.reactionHistory.push({
      densityId,
      side,
      densityPrice,
      notionalUsd: notional,
      approachTime: Date.now(),
      reactionPct,
      success,
    });
    if (this.reactionHistory.length > 50) this.reactionHistory.shift();
  }

  private computeHistoricalReactionStats(side: 'BID' | 'ASK') {
    const relevant = this.reactionHistory.filter((r) => r.side === side);
    if (relevant.length === 0) {
      return {
        reactionRate: 70,
        averageReactionPct: 0.85,
        medianReactionPct: 0.80,
        maxReactionPct: 1.8,
        sampleCount: 0,
        failureRate: 30,
      };
    }

    const successes = relevant.filter((r) => r.success).length;
    const reactionRate = Math.round((successes / relevant.length) * 100);
    const pcts = relevant.map((r) => r.reactionPct).sort((a, b) => a - b);
    const avg = Number((pcts.reduce((a, b) => a + b, 0) / pcts.length).toFixed(2));
    const med = Number(pcts[Math.floor(pcts.length / 2)].toFixed(2));
    const max = Number(pcts[pcts.length - 1].toFixed(2));

    return {
      reactionRate,
      averageReactionPct: avg,
      medianReactionPct: med,
      maxReactionPct: max,
      sampleCount: relevant.length,
      failureRate: 100 - reactionRate,
    };
  }

  public getDensities(): DensityItem[] {
    return Array.from(this.activeDensities.values()).sort((a, b) => b.notionalUsd - a.notionalUsd);
  }

  public getSignificantDensities(minNotional = 500000): DensityItem[] {
    return this.getDensities().filter((d) => d.notionalUsd >= minNotional);
  }

  public clear() {
    this.bids.clear();
    this.asks.clear();
    this.activeDensities.clear();
  }
}
