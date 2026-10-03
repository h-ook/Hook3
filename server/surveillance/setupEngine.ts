import { ExchangeId, MarketType, Timeframe } from '../../src/types';
import {
  BTCContextSnapshot,
  DensityItem,
  DetectedPattern,
  LevelZone,
  OISnapshot,
  SetupInstance,
  SetupStage,
  SetupType,
  ThirdTouchTracker,
  TimeframeStructure,
  TradeFlowSnapshot,
} from './types';

/**
 * Entry Intelligence Engine
 *
 * A formation is only a candidate. An entry is emitted after independent
 * confirmations agree: location -> structure/trigger -> volume/flow ->
 * order book -> OI/context -> risk/reward.
 *
 * The score is a confluence score, NOT a probability of profit.
 */
export class SetupEngine {
  private activeSetups = new Map<string, SetupInstance>();

  public evaluateSetups(params: {
    symbol: string;
    exchange: ExchangeId;
    marketType: MarketType;
    currentPrice: number;
    structures: Record<Timeframe, TimeframeStructure>;
    zones: LevelZone[];
    patterns: DetectedPattern[];
    densities: DensityItem[];
    tradeFlow: TradeFlowSnapshot;
    oiSnapshot: OISnapshot;
    btcContext: BTCContextSnapshot;
    thirdTouches: ThirdTouchTracker[];
    rvol?: number;
    orderBookImbalance?: number;
  }): SetupInstance[] {
    const {
      symbol,
      exchange,
      marketType,
      currentPrice,
      structures,
      zones,
      patterns,
      densities,
      tradeFlow,
      oiSnapshot,
      btcContext,
      thirdTouches,
      rvol = 1,
      orderBookImbalance = 0,
    } = params;

    const results: SetupInstance[] = [];
    const candidateZones = this.rankZones(zones, currentPrice).slice(0, 8);
    const bullishPatterns = patterns.filter((p) => p.bias === 'bullish');
    const bearishPatterns = patterns.filter((p) => p.bias === 'bearish');

    for (const zone of candidateZones) {
      if (zone.type === 'SUPPORT') {
        const setup = this.evaluateLongCandidate({
          symbol,
          exchange,
          marketType,
          currentPrice,
          zone,
          patterns: bullishPatterns,
          structures,
          densities,
          tradeFlow,
          oiSnapshot,
          btcContext,
          thirdTouches,
          rvol,
          orderBookImbalance,
        });
        if (setup) results.push(setup);
      } else {
        const setup = this.evaluateShortCandidate({
          symbol,
          exchange,
          marketType,
          currentPrice,
          zone,
          patterns: bearishPatterns,
          structures,
          densities,
          tradeFlow,
          oiSnapshot,
          btcContext,
          thirdTouches,
          rvol,
          orderBookImbalance,
        });
        if (setup) results.push(setup);
      }
    }

    // Formation-led breakout/retest candidates. These do not require a
    // support/resistance zone to be the primary anchor.
    for (const pattern of patterns.filter((p) => p.status !== 'INVALIDATED').slice(0, 6)) {
      const setup = this.evaluatePatternCandidate({
        symbol,
        exchange,
        marketType,
        currentPrice,
        pattern,
        structures,
        densities,
        tradeFlow,
        oiSnapshot,
        btcContext,
        rvol,
        orderBookImbalance,
      });
      if (setup) results.push(setup);
    }

    // Keep the strongest candidate per direction/anchor and expose only
    // actionable/watch states. This prevents the UI/Telegram layer from
    // receiving a flood of weak independent confirmations.
    const deduped = new Map<string, SetupInstance>();
    for (const setup of results) {
      const key = `${setup.direction}:${setup.entryZone.low.toFixed(6)}:${setup.type}`;
      const old = deduped.get(key);
      if (!old || setup.confluenceScore > old.confluenceScore) deduped.set(key, setup);
    }

    const ranked = Array.from(deduped.values())
      .sort((a, b) => b.confluenceScore - a.confluenceScore)
      .slice(0, 12);

    const activeIds = new Set(ranked.map((s) => s.id));
    for (const [id, setup] of this.activeSetups.entries()) {
      if (!activeIds.has(id) && setup.stage !== 'CONFIRMED') {
        setup.stage = 'INVALIDATED';
        setup.updatedAt = Date.now();
      }
    }

    return ranked;
  }

  private evaluateLongCandidate(args: {
    symbol: string; exchange: ExchangeId; marketType: MarketType; currentPrice: number;
    zone: LevelZone; patterns: DetectedPattern[]; structures: Record<Timeframe, TimeframeStructure>;
    densities: DensityItem[]; tradeFlow: TradeFlowSnapshot; oiSnapshot: OISnapshot;
    btcContext: BTCContextSnapshot; thirdTouches: ThirdTouchTracker[]; rvol: number; orderBookImbalance: number;
  }): SetupInstance | null {
    const { symbol, exchange, marketType, currentPrice, zone, patterns, structures, densities, tradeFlow, oiSnapshot, btcContext, thirdTouches, rvol, orderBookImbalance } = args;
    const inZone = currentPrice >= zone.zoneLow && currentPrice <= zone.zoneHigh;
    const nearZone = this.distancePct(currentPrice, zone.zoneCenter) <= 0.9;
    if (!nearZone) return null;

    const pattern = this.bestPattern(patterns, currentPrice, zone);
    const htfScore = this.htfLongScore(structures);
    const breakInfo = this.latestDirectionalBreak(structures, 'BULLISH');
    const density = this.bestDensity(densities, 'BID', zone.zoneCenter);
    const flowScore = this.longFlowScore(tradeFlow);
    const volumeScore = this.volumeScore(rvol);
    const oiScore = this.longOiScore(oiSnapshot);
    const btcScore = this.btcScore(btcContext, 'LONG');
    const levelScore = Math.min(10, Math.round(zone.strengthScore / 10));
    const patternScore = pattern?.score || 0;
    const triggerScore = this.triggerScore(breakInfo, zone.zoneCenter, currentPrice, 'LONG');
    const liquidityScore = density?.qualityScore || 0;
    const obiConfirmation = orderBookImbalance >= 0.20;
    const confirmations = this.collectLongConfirmations({ pattern, htfScore, density, flowScore, volumeScore, oiScore, btcScore, break: breakInfo, currentPrice, zone });
    if (obiConfirmation) confirmations.push(`order book imbalance +${orderBookImbalance.toFixed(2)}`);

    const hardGates = [
      pattern ? patternScore >= 55 : false,
      htfScore >= -10,
      inZone || triggerScore >= 10,
      triggerScore >= 10,
    ];
    const hardGatesPassed = hardGates.every(Boolean);

    const rawEntry = this.chooseLongEntry(currentPrice, zone, breakInfo, density);
    const invalidation = Math.min(zone.zoneLow * 0.997, rawEntry * 0.985);
    const target = rawEntry + Math.abs(rawEntry - invalidation) * 2.2;
    const rr = (target - rawEntry) / Math.max(0.00000001, rawEntry - invalidation);
    const score = this.finalScore({ patternScore, htfScore, levelScore, triggerScore, volumeScore, flowScore, liquidityScore, oiScore, btcScore, rr });
    const independent = this.independentConfirmationCount(confirmations);
    const confirmed = hardGatesPassed && independent >= 3 && score >= 78 && rr >= 2;
    const stage: SetupStage = confirmed ? 'CONFIRMED' : inZone ? (independent >= 2 ? 'CONFIRMING' : 'REACTION_WATCH') : 'SUPPORT_APPROACH';

    return this.upsert({
      id: `${symbol}_ENTRY_LONG_${zone.id}`,
      type: breakInfo ? 'BREAKOUT_RETEST' : 'SUPPORT_RETEST',
      symbol, exchange, marketType,
      timeframe: zone.timeframe,
      stage,
      direction: 'LONG',
      entryZone: { low: Math.min(rawEntry, zone.zoneHigh), high: Math.max(rawEntry, zone.zoneHigh) },
      invalidationPrice: invalidation,
      targetPrice: target,
      confluenceScore: score,
      confirmations,
      waitingFor: confirmed ? 'Підтверджений вхід: формація + структура + ≥3 незалежні підтвердження' : `Очікування: ${Math.max(0, 3 - independent)} незалежних підтверджень`,
      evidence: {
        htfStructure: this.structureSummary(structures),
        levelStrength: zone.strengthScore,
        densityPresence: density ? `BID $${(density.notionalUsd / 1e6).toFixed(2)}M, quality ${density.qualityScore}/100, ${density.classification}` : 'Немає якісної BID density',
        volumeProfile: `RVOL ${rvol.toFixed(2)}x`,
        oiContext: oiSnapshot.regime,
        btcContext: `${btcContext.trend4h}/${btcContext.trend1h}`,
        formationScore: patternScore,
      },
      entryQuality: {
        score,
        riskReward: Number(rr.toFixed(2)),
        hardGatesPassed,
        independentConfirmations: independent,
        entryType: breakInfo ? 'BOS_RETEST' : 'LIQUIDITY_REACTION',
        preferredEntry: rawEntry,
      },
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  }

  private evaluateShortCandidate(args: {
    symbol: string; exchange: ExchangeId; marketType: MarketType; currentPrice: number;
    zone: LevelZone; patterns: DetectedPattern[]; structures: Record<Timeframe, TimeframeStructure>;
    densities: DensityItem[]; tradeFlow: TradeFlowSnapshot; oiSnapshot: OISnapshot;
    btcContext: BTCContextSnapshot; thirdTouches: ThirdTouchTracker[]; rvol: number; orderBookImbalance: number;
  }): SetupInstance | null {
    const { symbol, exchange, marketType, currentPrice, zone, patterns, structures, densities, tradeFlow, oiSnapshot, btcContext, rvol, orderBookImbalance } = args;
    const inZone = currentPrice >= zone.zoneLow && currentPrice <= zone.zoneHigh;
    const nearZone = this.distancePct(currentPrice, zone.zoneCenter) <= 0.9;
    if (!nearZone) return null;

    const pattern = this.bestPattern(patterns, currentPrice, zone);
    const htfScore = this.htfShortScore(structures);
    const breakInfo = this.latestDirectionalBreak(structures, 'BEARISH');
    const density = this.bestDensity(densities, 'ASK', zone.zoneCenter);
    const flowScore = this.shortFlowScore(tradeFlow);
    const volumeScore = this.volumeScore(rvol);
    const oiScore = this.shortOiScore(oiSnapshot);
    const btcScore = this.btcScore(btcContext, 'SHORT');
    const levelScore = Math.min(10, Math.round(zone.strengthScore / 10));
    const patternScore = pattern?.score || 0;
    const triggerScore = this.triggerScore(breakInfo, zone.zoneCenter, currentPrice, 'SHORT');
    const liquidityScore = density?.qualityScore || 0;
    const obiConfirmation = orderBookImbalance <= -0.20;
    const confirmations = this.collectShortConfirmations({ pattern, htfScore, density, flowScore, volumeScore, oiScore, btcScore, break: breakInfo, currentPrice, zone });
    if (obiConfirmation) confirmations.push(`order book imbalance ${orderBookImbalance.toFixed(2)}`);

    const hardGates = [
      pattern ? patternScore >= 55 : false,
      htfScore <= 10,
      inZone || triggerScore >= 10,
      triggerScore >= 10,
    ];
    const hardGatesPassed = hardGates.every(Boolean);

    const rawEntry = this.chooseShortEntry(currentPrice, zone, breakInfo, density);
    const invalidation = Math.max(zone.zoneHigh * 1.003, rawEntry * 1.015);
    const target = rawEntry - Math.abs(invalidation - rawEntry) * 2.2;
    const rr = (rawEntry - target) / Math.max(0.00000001, invalidation - rawEntry);
    const score = this.finalScore({ patternScore, htfScore: Math.abs(htfScore), levelScore, triggerScore, volumeScore, flowScore, liquidityScore, oiScore, btcScore, rr });
    const independent = this.independentConfirmationCount(confirmations);
    const confirmed = hardGatesPassed && independent >= 3 && score >= 78 && rr >= 2;
    const stage: SetupStage = confirmed ? 'CONFIRMED' : inZone ? (independent >= 2 ? 'CONFIRMING' : 'REACTION_WATCH') : 'SUPPORT_APPROACH';

    return this.upsert({
      id: `${symbol}_ENTRY_SHORT_${zone.id}`,
      type: breakInfo ? 'BREAKOUT_RETEST' : 'RESISTANCE_REJECTION',
      symbol, exchange, marketType,
      timeframe: zone.timeframe,
      stage,
      direction: 'SHORT',
      entryZone: { low: Math.min(zone.zoneLow, rawEntry), high: Math.max(zone.zoneLow, rawEntry) },
      invalidationPrice: invalidation,
      targetPrice: target,
      confluenceScore: score,
      confirmations,
      waitingFor: confirmed ? 'Підтверджений вхід: формація + структура + ≥3 незалежні підтвердження' : `Очікування: ${Math.max(0, 3 - independent)} незалежних підтверджень`,
      evidence: {
        htfStructure: this.structureSummary(structures),
        levelStrength: zone.strengthScore,
        densityPresence: density ? `ASK $${(density.notionalUsd / 1e6).toFixed(2)}M, quality ${density.qualityScore}/100, ${density.classification}` : 'Немає якісної ASK density',
        volumeProfile: `RVOL ${rvol.toFixed(2)}x`,
        oiContext: oiSnapshot.regime,
        btcContext: `${btcContext.trend4h}/${btcContext.trend1h}`,
        formationScore: patternScore,
      },
      entryQuality: {
        score,
        riskReward: Number(rr.toFixed(2)),
        hardGatesPassed,
        independentConfirmations: independent,
        entryType: breakInfo ? 'BOS_RETEST' : 'LIQUIDITY_REACTION',
        preferredEntry: rawEntry,
      },
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  }

  private evaluatePatternCandidate(args: {
    symbol: string; exchange: ExchangeId; marketType: MarketType; currentPrice: number;
    pattern: DetectedPattern; structures: Record<Timeframe, TimeframeStructure>; densities: DensityItem[];
    tradeFlow: TradeFlowSnapshot; oiSnapshot: OISnapshot; btcContext: BTCContextSnapshot; rvol: number; orderBookImbalance: number;
  }): SetupInstance | null {
    const { symbol, exchange, marketType, currentPrice, pattern, structures, densities, tradeFlow, oiSnapshot, btcContext, rvol, orderBookImbalance } = args;
    if (pattern.bias === 'neutral') return null;

    const direction = pattern.bias === 'bullish' ? 'LONG' : 'SHORT';
    const boundary = direction === 'LONG' ? pattern.upperBoundary : pattern.lowerBoundary;
    const distance = this.distancePct(currentPrice, boundary);
    if (distance > 1.2) return null;

    const breakInfo = this.latestDirectionalBreak(structures, direction === 'LONG' ? 'BULLISH' : 'BEARISH');
    const density = this.bestDensity(densities, direction === 'LONG' ? 'BID' : 'ASK', boundary);
    const flowScore = direction === 'LONG' ? this.longFlowScore(tradeFlow) : this.shortFlowScore(tradeFlow);
    const volumeScore = this.volumeScore(rvol);
    const oiScore = direction === 'LONG' ? this.longOiScore(oiSnapshot) : this.shortOiScore(oiSnapshot);
    const btcScore = this.btcScore(btcContext, direction);
    const triggerScore = this.triggerScore(breakInfo, boundary, currentPrice, direction);
    const liquidityScore = density?.qualityScore || 0;
    const confirmations = [
      `formation ${pattern.name} (${pattern.score}/100)`,
      ...(Math.abs(this.htfScore(structures, direction)) >= 35 ? ['HTF structure aligned'] : []),
      ...(breakInfo ? [`${breakInfo.type} ${breakInfo.direction} confirmed`] : []),
      ...(volumeScore >= 7 ? [`RVOL ${rvol.toFixed(2)}x`] : []),
      ...(flowScore >= 7 ? ['aggressive flow aligned'] : []),
      ...(density && liquidityScore >= 55 ? [`${density.side} density quality ${liquidityScore}/100`] : []),
      ...(direction === 'LONG' && orderBookImbalance >= 0.20 ? [`order book imbalance +${orderBookImbalance.toFixed(2)}`] : []),
      ...(direction === 'SHORT' && orderBookImbalance <= -0.20 ? [`order book imbalance ${orderBookImbalance.toFixed(2)}`] : []),
      ...(oiScore >= 4 ? ['OI regime aligned'] : []),
      ...(btcScore >= 4 ? ['BTC context aligned'] : []),
    ];
    const independent = this.independentConfirmationCount(confirmations);
    const entry = breakInfo ? (breakInfo.price + boundary) / 2 : boundary;
    const risk = Math.abs(entry - boundary) * 1.5 + Math.max(entry * 0.003, 0.00000001);
    const target = direction === 'LONG' ? entry + risk * 2.2 : entry - risk * 2.2;
    const rr = 2.2;
    const score = this.finalScore({
      patternScore: pattern.score,
      htfScore: Math.abs(this.htfScore(structures, direction)),
      levelScore: 7,
      triggerScore,
      volumeScore,
      flowScore,
      liquidityScore,
      oiScore,
      btcScore,
      rr,
    });
    const hardGatesPassed = pattern.status !== 'INVALIDATED' && (triggerScore >= 10 || independent >= 3) && rr >= 2;
    const confirmed = hardGatesPassed && independent >= 3 && score >= 78;

    return this.upsert({
      id: `${symbol}_FORMATION_${direction}_${pattern.name.replace(/\s+/g, '_')}`,
      type: breakInfo ? 'BREAKOUT_RETEST' : 'STRUCTURE_SHIFT',
      symbol, exchange, marketType,
      timeframe: pattern.timeframe,
      stage: confirmed ? 'CONFIRMED' : independent >= 2 ? 'CONFIRMING' : 'REACTION_WATCH',
      direction,
      entryZone: { low: Math.min(entry, boundary), high: Math.max(entry, boundary) },
      invalidationPrice: direction === 'LONG' ? entry - risk : entry + risk,
      targetPrice: target,
      confluenceScore: score,
      confirmations,
      waitingFor: confirmed ? 'Підтверджений breakout/retest' : `Очікування: ${Math.max(0, 3 - independent)} незалежних підтверджень`,
      evidence: {
        htfStructure: this.structureSummary(structures),
        levelStrength: 0,
        densityPresence: density ? `${density.side} quality ${density.qualityScore}/100` : 'Немає якісної density',
        volumeProfile: `RVOL ${rvol.toFixed(2)}x`,
        oiContext: oiSnapshot.regime,
        btcContext: `${btcContext.trend4h}/${btcContext.trend1h}`,
        formationScore: pattern.score,
      },
      entryQuality: {
        score,
        riskReward: rr,
        hardGatesPassed,
        independentConfirmations: independent,
        entryType: breakInfo ? 'BREAKOUT_RETEST' : 'BOS_RETEST',
        preferredEntry: entry,
      },
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  }

  private upsert(setup: SetupInstance): SetupInstance {
    const old = this.activeSetups.get(setup.id);
    if (old) setup.createdAt = old.createdAt;
    this.activeSetups.set(setup.id, setup);
    return setup;
  }

  private rankZones(zones: LevelZone[], price: number): LevelZone[] {
    return zones
      .filter((z) => z.strengthScore >= 45)
      .map((z) => ({ z, proximity: this.distancePct(price, z.zoneCenter) }))
      .filter((x) => x.proximity <= 1.5)
      .sort((a, b) => (b.z.strengthScore - a.z.strengthScore) || (a.proximity - b.proximity))
      .map((x) => x.z);
  }

  private bestPattern(patterns: DetectedPattern[], price: number, zone: LevelZone): DetectedPattern | undefined {
    return patterns
      .filter((p) => p.status !== 'INVALIDATED')
      .sort((a, b) => this.patternFit(b, price, zone) - this.patternFit(a, price, zone))[0];
  }

  private patternFit(p: DetectedPattern, price: number, zone: LevelZone): number {
    const boundary = p.bias === 'bullish' ? p.upperBoundary : p.lowerBoundary;
    const location = Math.max(0, 10 - this.distancePct(price, boundary) * 5);
    const zoneMatch = (p.bias === 'bullish' && zone.type === 'SUPPORT') || (p.bias === 'bearish' && zone.type === 'RESISTANCE') ? 10 : 0;
    return p.score + location + zoneMatch;
  }

  private bestDensity(densities: DensityItem[], side: 'BID' | 'ASK', price: number): DensityItem | undefined {
    return densities
      .filter((d) => d.side === side && d.classification !== 'POSSIBLE_SPOOF' && this.distancePct(d.price, price) <= 0.6)
      .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))[0];
  }

  private latestDirectionalBreak(structures: Record<Timeframe, TimeframeStructure>, direction: 'BULLISH' | 'BEARISH') {
    const allowed: Timeframe[] = ['5m', '15m', '1h'];
    const now = Date.now();
    return Object.values(structures)
      .filter((s) => allowed.includes(s.timeframe) && s.lastBreak?.direction === direction && s.lastBreak.confirmed)
      .filter((s) => !!s.lastBreak && now - s.lastBreak.time <= 6 * 60 * 60 * 1000)
      .sort((a, b) => {
        const weight = (tf: Timeframe) => tf === '5m' ? 3 : tf === '15m' ? 2 : 1;
        return weight(b.timeframe) - weight(a.timeframe) || (b.lastBreak?.time || 0) - (a.lastBreak?.time || 0);
      })[0]?.lastBreak;
  }

  private triggerScore(breakInfo: TimeframeStructure['lastBreak'], level: number, price: number, direction: 'LONG' | 'SHORT'): number {
    if (!breakInfo) return 0;
    if (direction === 'LONG' && breakInfo.direction !== 'BULLISH') return 0;
    if (direction === 'SHORT' && breakInfo.direction !== 'BEARISH') return 0;
    const distance = this.distancePct(price, level);
    return Math.min(20, 10 + (breakInfo.volumeConfirmed ? 5 : 0) + (distance <= 0.8 ? 5 : 0));
  }

  private longFlowScore(flow: TradeFlowSnapshot): number {
    if (flow.imbalanceRatio >= 1.6) return 10;
    if (flow.imbalanceRatio >= 1.3) return 7;
    if (flow.imbalanceRatio >= 1.1) return 4;
    return 0;
  }

  private shortFlowScore(flow: TradeFlowSnapshot): number {
    if (flow.imbalanceRatio <= 0.625) return 10;
    if (flow.imbalanceRatio <= 0.77) return 7;
    if (flow.imbalanceRatio <= 0.91) return 4;
    return 0;
  }

  private volumeScore(rvol: number): number {
    if (rvol >= 2) return 10;
    if (rvol >= 1.5) return 8;
    if (rvol >= 1.2) return 5;
    return 0;
  }

  private longOiScore(oi: OISnapshot): number {
    if (oi.regime === 'PRICE_UP_OI_UP') return 5;
    if (oi.regime === 'PRICE_UP_OI_DOWN') return 3;
    return 0;
  }

  private shortOiScore(oi: OISnapshot): number {
    if (oi.regime === 'PRICE_DOWN_OI_UP') return 5;
    if (oi.regime === 'PRICE_DOWN_OI_DOWN') return 3;
    return 0;
  }

  private btcScore(ctx: BTCContextSnapshot, direction: 'LONG' | 'SHORT'): number {
    const trends = [ctx.trend4h, ctx.trend1h, ctx.trend15m];
    if (direction === 'LONG') return trends.filter((t) => t === 'Bullish').length * 2;
    return trends.filter((t) => t === 'Bearish').length * 2;
  }

  private htfScore(structures: Record<Timeframe, TimeframeStructure>, direction: 'LONG' | 'SHORT'): number {
    const tfs: Timeframe[] = ['1d', '4h', '1h'];
    const values = tfs.map((tf) => structures[tf]?.score || 0);
    const avg = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    return direction === 'LONG' ? avg : -avg;
  }

  private htfLongScore(structures: Record<Timeframe, TimeframeStructure>): number { return this.htfScore(structures, 'LONG'); }
  private htfShortScore(structures: Record<Timeframe, TimeframeStructure>): number { return this.htfScore(structures, 'SHORT'); }

  private collectLongConfirmations(args: {
    pattern?: DetectedPattern; htfScore: number; density?: DensityItem; flowScore: number; volumeScore: number;
    oiScore: number; btcScore: number; break?: TimeframeStructure['lastBreak']; currentPrice: number; zone: LevelZone;
  }): string[] {
    const out: string[] = [];
    if (args.pattern && args.pattern.score >= 55) out.push(`formation ${args.pattern.name} (${args.pattern.score}/100)`);
    if (args.htfScore >= 20) out.push('HTF bullish structure');
    if (args.break) out.push(`${args.break.type} bullish confirmed`);
    if (args.density && (args.density.qualityScore || 0) >= 55) out.push(`bid density quality ${args.density.qualityScore}/100`);
    if (args.flowScore >= 7) out.push('aggressive buy flow');
    if (args.volumeScore >= 7) out.push('volume expansion');
    if (args.oiScore >= 4) out.push('OI regime aligned');
    if (args.btcScore >= 4) out.push('BTC context aligned');
    if (this.distancePct(args.currentPrice, args.zone.zoneCenter) <= 0.25) out.push('price at reaction zone');
    return out;
  }

  private collectShortConfirmations(args: {
    pattern?: DetectedPattern; htfScore: number; density?: DensityItem; flowScore: number; volumeScore: number;
    oiScore: number; btcScore: number; break?: TimeframeStructure['lastBreak']; currentPrice: number; zone: LevelZone;
  }): string[] {
    const out: string[] = [];
    if (args.pattern && args.pattern.score >= 55) out.push(`formation ${args.pattern.name} (${args.pattern.score}/100)`);
    if (args.htfScore >= 20) out.push('HTF bearish structure');
    if (args.break) out.push(`${args.break.type} bearish confirmed`);
    if (args.density && (args.density.qualityScore || 0) >= 55) out.push(`ask density quality ${args.density.qualityScore}/100`);
    if (args.flowScore >= 7) out.push('aggressive sell flow');
    if (args.volumeScore >= 7) out.push('volume expansion');
    if (args.oiScore >= 4) out.push('OI regime aligned');
    if (args.btcScore >= 4) out.push('BTC context aligned');
    if (this.distancePct(args.currentPrice, args.zone.zoneCenter) <= 0.25) out.push('price at reaction zone');
    return out;
  }

  private independentConfirmationCount(confirmations: string[]): number {
    const groups = new Set<string>();
    for (const c of confirmations) {
      const x = c.toLowerCase();
      if (x.includes('formation')) groups.add('formation');
      else if (x.includes('htf')) groups.add('htf');
      else if (x.includes('bos') || x.includes('choch')) groups.add('structure');
      else if (x.includes('density')) groups.add('orderbook');
      else if (x.includes('flow')) groups.add('flow');
      else if (x.includes('volume')) groups.add('volume');
      else if (x.includes('oi')) groups.add('oi');
      else if (x.includes('btc')) groups.add('btc');
    }
    return groups.size;
  }

  private finalScore(parts: {
    patternScore: number; htfScore: number; levelScore: number; triggerScore: number;
    volumeScore: number; flowScore: number; liquidityScore: number; oiScore: number; btcScore: number; rr: number;
  }): number {
    const normalizedPattern = Math.min(15, parts.patternScore * 0.15);
    const normalizedHtf = Math.min(15, Math.max(0, parts.htfScore) * 0.15);
    const normalizedLevel = Math.min(10, parts.levelScore);
    const trigger = Math.min(20, parts.triggerScore);
    const volume = Math.min(10, parts.volumeScore);
    const flow = Math.min(10, parts.flowScore);
    const book = Math.min(10, parts.liquidityScore * 0.10);
    const oi = Math.min(5, parts.oiScore);
    const btc = Math.min(5, parts.btcScore);
    const rrBonus = parts.rr >= 3 ? 5 : parts.rr >= 2.5 ? 3 : parts.rr >= 2 ? 1 : 0;
    return Math.max(0, Math.min(100, Math.round(normalizedPattern + normalizedHtf + normalizedLevel + trigger + volume + flow + book + oi + btc + rrBonus)));
  }

  private chooseLongEntry(price: number, zone: LevelZone, breakInfo?: TimeframeStructure['lastBreak'], density?: DensityItem): number {
    if (breakInfo && breakInfo.price > zone.zoneCenter) return (breakInfo.price + zone.zoneCenter) / 2;
    if (density && density.price >= zone.zoneLow && density.price <= zone.zoneHigh) return density.price;
    return Math.min(Math.max(price, zone.zoneLow), zone.zoneHigh);
  }

  private chooseShortEntry(price: number, zone: LevelZone, breakInfo?: TimeframeStructure['lastBreak'], density?: DensityItem): number {
    if (breakInfo && breakInfo.price < zone.zoneCenter) return (breakInfo.price + zone.zoneCenter) / 2;
    if (density && density.price >= zone.zoneLow && density.price <= zone.zoneHigh) return density.price;
    return Math.min(Math.max(price, zone.zoneLow), zone.zoneHigh);
  }

  private distancePct(a: number, b: number): number {
    return Math.abs(a - b) / Math.max(Math.abs(b), 0.00000001) * 100;
  }

  private structureSummary(structures: Record<Timeframe, TimeframeStructure>): string {
    return (['1d', '4h', '1h', '15m', '5m'] as Timeframe[]).map((tf) => `${tf}:${structures[tf]?.trend || 'NA'}`).join(' | ');
  }

  public getActiveSetups(): SetupInstance[] {
    return Array.from(this.activeSetups.values()).sort((a, b) => b.confluenceScore - a.confluenceScore);
  }
}
