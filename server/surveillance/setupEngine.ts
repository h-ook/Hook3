import { ExchangeId, MarketType, Timeframe } from '../../src/types';
import {
  BTCContextSnapshot,
  ConfluenceBreakdown,
  DensityItem,
  DetectedPattern,
  LevelZone,
  MarketPhaseState,
  MarketPhaseType,
  OISnapshot,
  SetupInstance,
  SetupStage,
  SetupType,
  ThirdTouchTracker,
  TimeframeStructure,
  TradeFlowSnapshot,
  TradingSessionName,
} from './types';

export class SetupEngine {
  private activeSetups = new Map<string, SetupInstance>();
  private previousPhase: MarketPhaseType = 'RANGE';

  public evaluateMarketPhase(params: {
    currentPrice: number;
    structures: Record<Timeframe, TimeframeStructure>;
    tradeFlow: TradeFlowSnapshot;
    oiSnapshot: OISnapshot;
    patterns: DetectedPattern[];
  }): MarketPhaseState {
    const { currentPrice, structures, tradeFlow, oiSnapshot, patterns } = params;
    const htfTrend = structures['4h']?.trend || 'RANGE';
    const ltfTrend = structures['15m']?.trend || 'RANGE';

    let phase: MarketPhaseType = 'RANGE';
    let confidence = 70;
    let nextState = 'SUPPORT_RETEST';
    let reasoning = 'Ціна рухається у встановленому діапазоні.';

    if (htfTrend === 'BULLISH') {
      if (ltfTrend === 'BEARISH' || (tradeFlow.imbalanceRatio < 0.8 && structures['15m']?.score < 0)) {
        phase = 'PULLBACK';
        confidence = 78;
        nextState = 'SUPPORT_RETEST';
        reasoning = 'Відкат на молодших таймфреймах у межах висхідного 4H тренду.';
      } else if (structures['15m']?.lastBreak?.type === 'BOS' && structures['15m'].lastBreak.direction === 'BULLISH') {
        phase = 'MARKUP';
        confidence = 82;
        nextState = 'EXPANSION';
        reasoning = 'Активна висхідна хвиля з пробоєм локальних максимумів.';
      } else {
        phase = 'EXPANSION';
        confidence = 75;
        nextState = 'PULLBACK';
        reasoning = 'Розвиток висхідного імпульсу.';
      }
    } else if (htfTrend === 'BEARISH') {
      if (ltfTrend === 'BULLISH') {
        phase = 'PULLBACK';
        confidence = 76;
        nextState = 'RESISTANCE_REJECTION';
        reasoning = 'Висхідна корекція на молодших ТФ у межах низхідного 4H тренду.';
      } else {
        phase = 'MARKDOWN';
        confidence = 80;
        nextState = 'ACCUMULATION';
        reasoning = 'Послідовні нижчі максимуми та мінімуми.';
      }
    } else {
      // Range or Transition
      const hasTriangle = patterns.some((p) => p.type.includes('Triangle') || p.compression);
      if (hasTriangle) {
        phase = 'CONTRACTION';
        confidence = 84;
        nextState = 'BREAKOUT';
        reasoning = 'Волатильність стискається, формується компресія перед імпульсом.';
      } else {
        phase = 'RANGE';
        confidence = 70;
        nextState = 'SUPPORT_RETEST';
        reasoning = 'Консолідація між межами діапазону.';
      }
    }

    const state: MarketPhaseState = {
      currentPhase: phase,
      confidence,
      previousPhase: this.previousPhase,
      nextLikelyState: nextState,
      reasoning,
    };

    this.previousPhase = phase;
    return state;
  }

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
    session?: TradingSessionName;
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
      session,
    } = params;

    const detectedSetups: SetupInstance[] = [];

    // Helper to calculate confluence breakdown
    const computeConfluence = (
      zone: LevelZone,
      direction: 'LONG' | 'SHORT',
      touchTracker?: ThirdTouchTracker
    ): ConfluenceBreakdown => {
      let htfScore = 0;
      const isLong = direction === 'LONG';

      if (isLong) {
        if (structures['4h']?.trend === 'BULLISH') htfScore = 18;
        else if (structures['1d']?.trend === 'BULLISH') htfScore = 14;
        else if (structures['4h']?.trend === 'RANGE') htfScore = 8;
      } else {
        if (structures['4h']?.trend === 'BEARISH') htfScore = 18;
        else if (structures['1d']?.trend === 'BEARISH') htfScore = 14;
        else if (structures['4h']?.trend === 'RANGE') htfScore = 8;
      }

      const levelScore = Math.min(18, Math.round((zone.strengthScore / 100) * 18));
      const reactionScore = Math.min(12, Math.round((zone.reactionRate / 100) * 12));

      // Formation
      const formationScore = patterns.length > 0 ? Math.min(8, Math.round((patterns[0].score / 100) * 8)) : 2;

      // Volume & Trade Flow
      const volumeScore = 6;
      let tradeFlowScore = 0;
      if (isLong && tradeFlow.imbalanceRatio >= 1.3) tradeFlowScore = 10;
      else if (!isLong && tradeFlow.imbalanceRatio <= 0.7) tradeFlowScore = 10;
      else tradeFlowScore = 4;

      // Orderbook & Density
      let densityScore = 0;
      const matchingDensity = densities.find(
        (d) =>
          d.side === (isLong ? 'BID' : 'ASK') &&
          Math.abs(d.price - zone.zoneCenter) / zone.zoneCenter <= 0.015
      );
      if (matchingDensity) {
        densityScore = matchingDensity.classification === 'PERSISTENT' || matchingDensity.classification === 'STRONG' ? 10 : 6;
      }

      // Open interest
      let oiScore = 0;
      if (isLong && (oiSnapshot.regime === 'PRICE_UP_OI_UP' || oiSnapshot.change15mPct >= 0.8)) oiScore = 8;
      else if (!isLong && (oiSnapshot.regime === 'PRICE_DOWN_OI_UP' || oiSnapshot.change15mPct >= 0.8)) oiScore = 8;
      else oiScore = 3;

      // BTC Context
      let btcScore = 0;
      if (isLong && (btcContext.trend1h === 'Bullish' || btcContext.trend4h === 'Bullish')) btcScore = 5;
      else if (!isLong && (btcContext.trend1h === 'Bearish' || btcContext.trend4h === 'Bearish')) btcScore = 5;
      else btcScore = 2;

      // Third touch & Compression
      let thirdTouchScore = 0;
      if (touchTracker && (touchTracker.state === 'APPROACHING' || touchTracker.state === 'ACTIVE')) {
        thirdTouchScore = touchTracker.compression ? 7 : 5;
      }

      const total =
        htfScore +
        levelScore +
        reactionScore +
        formationScore +
        volumeScore +
        tradeFlowScore +
        densityScore +
        oiScore +
        btcScore +
        thirdTouchScore;

      return {
        htfStructure: htfScore,
        levelStrength: levelScore,
        reaction: reactionScore,
        formation: formationScore,
        volume: volumeScore,
        tradeFlow: tradeFlowScore,
        orderbook: 4,
        density: densityScore,
        oi: oiScore,
        funding: 2,
        btcContext: btcScore,
        correlation: 3,
        fibonacci: 4,
        compression: touchTracker?.compression ? 5 : 0,
        thirdTouch: thirdTouchScore,
        session: session === 'London/NY Overlap' ? 3 : 2,
        totalScore: Math.min(100, Math.max(0, total)),
      };
    };

    // 1. SUPPORT RETEST Engine
    const supportZones = zones.filter((z) => z.type === 'SUPPORT' && z.strengthScore >= 35);
    for (const sup of supportZones) {
      const setupId = `${symbol}_SUPPORT_RETEST_${sup.id}`;
      let instance = this.activeSetups.get(setupId);

      const inZone = currentPrice >= sup.zoneLow && currentPrice <= sup.zoneHigh;
      const nearZone = Math.abs(currentPrice - sup.zoneCenter) / sup.zoneCenter <= 0.008;
      const belowZone = currentPrice < sup.zoneLow * 0.992;

      const touchTracker = thirdTouches.find((t) => t.levelId === sup.id);
      const confluence = computeConfluence(sup, 'LONG', touchTracker);

      // Invalidation & Multi-targets (TP1, TP2, TP3)
      const zoneWidth = sup.zoneHigh - sup.zoneLow;
      const invalidationPrice = sup.zoneLow - zoneWidth * 0.5;
      const tp1 = sup.zoneCenter * 1.018;
      const tp2 = sup.zoneCenter * 1.035;
      const tp3 = sup.zoneCenter * 1.055;
      const risk = sup.zoneCenter - invalidationPrice;
      const reward = tp2 - sup.zoneCenter;
      const rr = risk > 0 ? Number((reward / risk).toFixed(2)) : 2.0;

      if (!instance) {
        if (nearZone || inZone) {
          instance = {
            id: setupId,
            type: 'SUPPORT_RETEST',
            symbol,
            exchange,
            marketType,
            timeframe: sup.timeframe,
            stage: inZone ? 'IN_ZONE' : 'SUPPORT_APPROACH',
            direction: 'LONG',
            entryZone: { low: sup.zoneLow, high: sup.zoneHigh, center: sup.zoneCenter },
            optimalEntry: (sup.zoneLow + sup.zoneCenter) / 2,
            invalidationPrice,
            targetPrice: tp2,
            targets: { tp1, tp2, tp3 },
            riskRewardRatio: rr,
            confluenceScore: confluence.totalScore,
            confluenceBreakdown: confluence,
            confirmations: [],
            waitingFor: 'Підтвердження реакції на 15m/5m',
            evidence: {
              htfStructure: structures['4h']?.trend || 'RANGE',
              levelStrength: sup.strengthScore,
              densityPresence: 'Аналіз...',
              volumeProfile: 'Звичайний',
              oiContext: oiSnapshot.regime,
              btcContext: btcContext.trend4h,
              formationScore: patterns[0]?.score || 0,
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          this.activeSetups.set(setupId, instance);
        }
      } else {
        if (belowZone) {
          instance.stage = 'INVALIDATED';
        } else if (inZone) {
          if (instance.stage === 'SUPPORT_APPROACH') {
            instance.stage = 'IN_ZONE';
          }
        }

        const confirmations: string[] = [];
        if (confluence.htfStructure >= 14) confirmations.push('4H Bullish Trend');
        if (confluence.density >= 6) confirmations.push('Bid Density Support');
        if (confluence.tradeFlow >= 8) confirmations.push(`Aggressive Buy Flow (${tradeFlow.imbalanceRatio}x)`);
        if (structures['15m']?.lastBreak?.direction === 'BULLISH' || structures['5m']?.lastBreak?.direction === 'BULLISH') {
          confirmations.push('15m/5m Bullish Shift');
        }
        if (confluence.oi >= 6) confirmations.push('OI Accumulation');
        if (confluence.thirdTouch >= 5) confirmations.push('Third Touch Approaching');

        instance.confirmations = confirmations;
        instance.confluenceScore = confluence.totalScore;
        instance.confluenceBreakdown = confluence;
        instance.updatedAt = Date.now();

        if (confirmations.length >= 3 && instance.confluenceScore >= 70) {
          if (instance.stage === 'IN_ZONE' || instance.stage === 'REACTION_WATCH') {
            instance.stage = 'CONFIRMED';
            instance.waitingFor = 'Всі умови виконані (активний сигнал)';
          }
        } else if (inZone && confirmations.length >= 1) {
          instance.stage = 'REACTION_WATCH';
          instance.waitingFor = `Очікування підтвердження (${confirmations.length}/3)`;
        }

        detectedSetups.push(instance);
      }
    }

    // 2. RESISTANCE REJECTION Engine
    const resZones = zones.filter((z) => z.type === 'RESISTANCE' && z.strengthScore >= 35);
    for (const res of resZones) {
      const setupId = `${symbol}_RESISTANCE_REJECTION_${res.id}`;
      let instance = this.activeSetups.get(setupId);

      const inZone = currentPrice >= res.zoneLow && currentPrice <= res.zoneHigh;
      const nearZone = Math.abs(currentPrice - res.zoneCenter) / res.zoneCenter <= 0.008;
      const aboveZone = currentPrice > res.zoneHigh * 1.008;

      const touchTracker = thirdTouches.find((t) => t.levelId === res.id);
      const confluence = computeConfluence(res, 'SHORT', touchTracker);

      const zoneWidth = res.zoneHigh - res.zoneLow;
      const invalidationPrice = res.zoneHigh + zoneWidth * 0.5;
      const tp1 = res.zoneCenter * 0.982;
      const tp2 = res.zoneCenter * 0.965;
      const tp3 = res.zoneCenter * 0.945;
      const risk = invalidationPrice - res.zoneCenter;
      const reward = res.zoneCenter - tp2;
      const rr = risk > 0 ? Number((reward / risk).toFixed(2)) : 2.0;

      if (!instance && (nearZone || inZone)) {
        instance = {
          id: setupId,
          type: 'RESISTANCE_REJECTION',
          symbol,
          exchange,
          marketType,
          timeframe: res.timeframe,
          stage: inZone ? 'IN_ZONE' : 'SUPPORT_APPROACH',
          direction: 'SHORT',
          entryZone: { low: res.zoneLow, high: res.zoneHigh, center: res.zoneCenter },
          optimalEntry: (res.zoneHigh + res.zoneCenter) / 2,
          invalidationPrice,
          targetPrice: tp2,
          targets: { tp1, tp2, tp3 },
          riskRewardRatio: rr,
          confluenceScore: confluence.totalScore,
          confluenceBreakdown: confluence,
          confirmations: [],
          waitingFor: 'Опір та реакція продавця',
          evidence: {
            htfStructure: structures['4h']?.trend || 'RANGE',
            levelStrength: res.strengthScore,
            densityPresence: 'Аналіз...',
            volumeProfile: 'Звичайний',
            oiContext: oiSnapshot.regime,
            btcContext: btcContext.trend4h,
            formationScore: patterns[0]?.score || 0,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        this.activeSetups.set(setupId, instance);
      } else if (instance) {
        if (aboveZone) {
          instance.stage = 'INVALIDATED';
        }

        const confirmations: string[] = [];
        if (confluence.htfStructure >= 14) confirmations.push('4H Bearish Trend');
        if (confluence.density >= 6) confirmations.push('Ask Density Resistance');
        if (tradeFlow.imbalanceRatio <= 0.7) confirmations.push('Aggressive Sell Flow');
        if (structures['15m']?.lastBreak?.direction === 'BEARISH') confirmations.push('15m Bearish Shift');
        if (confluence.thirdTouch >= 5) confirmations.push('Third Touch Approaching');

        instance.confirmations = confirmations;
        instance.confluenceScore = confluence.totalScore;
        instance.confluenceBreakdown = confluence;
        instance.updatedAt = Date.now();

        if (confirmations.length >= 2 && instance.confluenceScore >= 70) {
          instance.stage = 'CONFIRMED';
          instance.waitingFor = 'Всі умови виконані (активний сигнал)';
        }

        detectedSetups.push(instance);
      }
    }

    return detectedSetups;
  }

  public getActiveSetups(): SetupInstance[] {
    return Array.from(this.activeSetups.values());
  }
}
