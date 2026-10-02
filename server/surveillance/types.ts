import { ExchangeId, MarketType, Timeframe } from '../../src/types';

export type OrderBookStatus = 'CONNECTING' | 'SYNCING' | 'LIVE' | 'STALE' | 'RESYNCING' | 'ERROR';

export type DataHealthStatus = 'LIVE' | 'SYNCING' | 'CONNECTING' | 'STALE' | 'ERROR' | 'DEGRADED';

export interface DataHealth {
  status: DataHealthStatus;
  priceFresh: boolean;
  orderbookFresh: boolean;
  tradesFresh: boolean;
  oiFresh: boolean;
  candlesFresh: boolean;
  latencyMs: number;
  lastPriceUpdate: number;
  lastOrderbookUpdate: number;
  lastTradeUpdate: number;
  lastOIUpdate: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
  notionalUsd: number;
}

export interface OrderBookState {
  symbol: string;
  exchange: ExchangeId;
  marketType: MarketType;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPct: number;
  lastUpdateId: number;
  sequence: number;
  timestamp: number;
  status: OrderBookStatus;
  lastReceivedAt: number;
}

export type DensityClassification =
  | 'NEW'
  | 'STANDARD'
  | 'PERSISTENT'
  | 'STRONG'
  | 'REMOVED'
  | 'POSSIBLE_SPOOF'
  | 'ABSORBED'
  | 'REACTED';

export interface DensityItem {
  id: string;
  price: number;
  side: 'BID' | 'ASK';
  quantity: number;
  notionalUsd: number;
  distancePct: number;
  firstSeenAt: number;
  lastSeenAt: number;
  ageSeconds: number;
  maxSizeUsd: number;
  averageSizeUsd: number;
  persistenceRatio: number;
  classification: DensityClassification;
  historicalReaction?: {
    reactionRate: number;
    averageReactionPct: number;
    medianReactionPct: number;
    maxReactionPct: number;
    sampleCount: number;
    failureRate: number;
  };
}

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  type: 'HIGH' | 'LOW';
  classification: 'STRUCTURAL_SWING' | 'MAJOR_SWING' | 'MINOR_SWING';
}

export interface StructureBreak {
  type: 'BOS' | 'CHoCH';
  direction: 'BULLISH' | 'BEARISH';
  price: number;
  brokenSwingPrice: number;
  time: number;
  timeframe: Timeframe;
  confirmed: boolean;
  volumeConfirmed: boolean;
}

export interface TimeframeStructure {
  timeframe: Timeframe;
  trend: 'BULLISH' | 'BEARISH' | 'RANGE' | 'TRANSITION';
  score: number; // -100 to +100
  recentSwings: SwingPoint[];
  lastBreak?: StructureBreak;
  higherHighsCount: number;
  lowerHighsCount: number;
  higherLowsCount: number;
  lowerLowsCount: number;
}

export interface LevelZone {
  id: string;
  timeframe: Timeframe;
  type: 'SUPPORT' | 'RESISTANCE';
  zoneLow: number;
  zoneHigh: number;
  zoneCenter: number;
  touches: number;
  confirmedTouches: number;
  reactions: number;
  strongReactions: number;
  weakReactions: number;
  failedBreaks: number;
  breakoutCount: number;
  rejectionCount: number;
  averageReactionPct: number;
  medianReactionPct: number;
  maxReactionPct: number;
  reactionRate: number;
  failureRate: number;
  strengthScore: number; // 0–100
  firstSeen: number;
  lastTouchTime: number;
  orderBookDensityUsd?: number;
}

export type ThirdTouchState =
  | 'NOT_EXPECTED'
  | 'APPROACHING'
  | 'ACTIVE'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'BROKEN'
  | 'REACTION'
  | 'BREAKOUT'
  | 'FAILED';

export interface ThirdTouchTracker {
  levelId: string;
  levelType: 'SUPPORT' | 'RESISTANCE';
  price: number;
  touchCount: number;
  state: ThirdTouchState;
  distancePct: number;
  approachSpeed: 'SLOW' | 'NORMAL' | 'FAST';
  compression: boolean;
  higherLowsCount: number;
  lowerHighsCount: number;
  askDensityUsd?: number;
  bidDensityUsd?: number;
  volumeRatio: number;
  updatedAt: number;
}

export interface DetectedPattern {
  name: string;
  type:
    | 'Double Top'
    | 'Double Bottom'
    | 'Triple Top'
    | 'Triple Bottom'
    | 'Ascending Triangle'
    | 'Descending Triangle'
    | 'Symmetrical Triangle'
    | 'Range'
    | 'Rectangle'
    | 'Channel'
    | 'Flag'
    | 'Pennant'
    | 'Wedge'
    | 'Head & Shoulders'
    | 'Inverse Head & Shoulders'
    | 'Breakout'
    | 'Breakout Retest'
    | 'Compression'
    | 'Liquidity Sweep';
  bias: 'bullish' | 'bearish' | 'neutral';
  score: number; // 0–100
  upperBoundary: number;
  lowerBoundary: number;
  touchesUpper: number;
  touchesLower: number;
  compression: boolean;
  timeframe: Timeframe;
  status: 'FORMING' | 'READY' | 'BROKEN' | 'INVALIDATED';
  invalidationLevel?: number;
  targetLevel?: number;
}

export interface TradeFlowSnapshot {
  aggressiveBuyUsd: number;
  aggressiveSellUsd: number;
  deltaUsd: number;
  imbalanceRatio: number; // buy / sell
  largeTradeCount: number;
  totalTradeCount: number;
  averageTradeSizeUsd: number;
  isAbsorption: boolean;
  absorptionType: 'SELLER_ABSORPTION' | 'BUYER_ABSORPTION' | 'NONE';
  recentTradesWindowMs: number;
}

export interface OISnapshot {
  currentUsd: number;
  amountCoins: number;
  change1mPct: number;
  change5mPct: number;
  change15mPct: number;
  change1hPct: number;
  change4hPct: number;
  regime: 'PRICE_UP_OI_UP' | 'PRICE_UP_OI_DOWN' | 'PRICE_DOWN_OI_UP' | 'PRICE_DOWN_OI_DOWN' | 'NEUTRAL';
  isAnomaly: boolean;
  velocity: number; // rate of change
}

export interface BTCContextSnapshot {
  currentPrice: number;
  trend1d: 'Bullish' | 'Bearish' | 'Neutral';
  trend4h: 'Bullish' | 'Bearish' | 'Neutral';
  trend1h: 'Bullish' | 'Bearish' | 'Neutral';
  trend15m: 'Bullish' | 'Bearish' | 'Neutral';
  btcDominance: number | null; // null if unavailable - NEVER hardcoded
  btcDominanceRegime: 'rising' | 'falling' | 'range' | 'breakout' | 'UNAVAILABLE';
  totalMarketCapUsd: number | null; // null if unavailable - NEVER hardcoded
  totalMarketCapRegime: 'expansion' | 'contraction' | 'neutral' | 'UNAVAILABLE';
  correlationAltBtc: number; // -1 to +1
  relativeStrength: 'STRONG' | 'NEUTRAL' | 'WEAK';
  lastUpdated: number;
}

export type SetupType =
  | 'SUPPORT_RETEST'
  | 'BREAKOUT_RETEST'
  | 'STRUCTURE_SHIFT'
  | 'STRUCTURE_REVERSAL'
  | 'RESISTANCE_REJECTION'
  | 'COMPRESSION_BREAKOUT'
  | 'LIQUIDITY_REACTION';

export type SetupStage =
  | 'IDLE'
  | 'SUPPORT_APPROACH'
  | 'IN_ZONE'
  | 'REACTION_WATCH'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'INVALIDATED'
  | 'COMPLETED';

export interface ConfluenceBreakdown {
  htfStructure: number;
  levelStrength: number;
  reaction: number;
  formation: number;
  volume: number;
  tradeFlow: number;
  orderbook: number;
  density: number;
  oi: number;
  funding: number;
  btcContext: number;
  correlation: number;
  fibonacci: number;
  compression: number;
  thirdTouch: number;
  session: number;
  totalScore: number;
}

export interface SetupInstance {
  id: string;
  type: SetupType;
  symbol: string;
  exchange: ExchangeId;
  marketType: MarketType;
  timeframe: Timeframe;
  stage: SetupStage;
  direction: 'LONG' | 'SHORT';
  entryZone: { low: number; high: number; center: number };
  optimalEntry: number;
  invalidationPrice: number;
  targetPrice: number;
  targets: {
    tp1: number;
    tp2: number;
    tp3: number;
  };
  riskRewardRatio: number;
  confluenceScore: number; // 0–100
  confluenceBreakdown: ConfluenceBreakdown;
  confirmations: string[];
  waitingFor: string;
  evidence: {
    htfStructure: string;
    levelStrength: number;
    densityPresence: string;
    volumeProfile: string;
    oiContext: string;
    btcContext: string;
    formationScore: number;
  };
  createdAt: number;
  updatedAt: number;
}

export type MarketPhaseType =
  | 'ACCUMULATION'
  | 'RANGE'
  | 'MARKUP'
  | 'DISTRIBUTION'
  | 'MARKDOWN'
  | 'PULLBACK'
  | 'BREAKOUT'
  | 'RETEST'
  | 'EXPANSION'
  | 'CONTRACTION';

export interface MarketPhaseState {
  currentPhase: MarketPhaseType;
  confidence: number; // 0–100
  previousPhase: MarketPhaseType;
  nextLikelyState: string;
  reasoning: string;
}

export interface EngineAlertEvent {
  eventId: string;
  symbol: string;
  exchange: ExchangeId;
  marketType: MarketType;
  type:
    | 'LEVEL_DETECTED'
    | 'LEVEL_APPROACH'
    | 'THIRD_TOUCH_APPROACHING'
    | 'THIRD_TOUCH_ACTIVE'
    | 'THIRD_TOUCH_CONFIRMED'
    | 'THIRD_TOUCH_REACTION'
    | 'FORMATION_DETECTED'
    | 'FORMATION_INVALIDATED'
    | 'BREAKOUT_REALTIME'
    | 'BREAKOUT_CONFIRMED'
    | 'BREAKOUT_RETEST'
    | 'CHANNEL_BREAK'
    | 'SUPPORT_RETEST_WATCH'
    | 'SUPPORT_RETEST_CONFIRMED'
    | 'RESISTANCE_REJECTION'
    | 'STRUCTURE_SHIFT'
    | 'BOS'
    | 'CHoCH'
    | 'DENSITY_APPEARED'
    | 'DENSITY_PERSISTENT'
    | 'DENSITY_REMOVED'
    | 'POSSIBLE_SPOOF'
    | 'ABSORPTION'
    | 'OI_ANOMALY'
    | 'VOLUME_ANOMALY'
    | 'TRADE_FLOW_ANOMALY'
    | 'IMPULSE'
    | 'SESSION_CHANGED'
    | 'NEWS'
    | 'MARKET_CONTEXT_CHANGED'
    | 'DATA_STALE'
    | 'DATA_RECOVERED'
    | 'SUPPORT_RESISTANCE_FLIP'
    | 'PRESSURE_TO_HIGH'
    | 'PRESSURE_TO_LOW';
  title: string;
  description: string;
  price: number;
  timeframe: Timeframe;
  severity: 'INFO' | 'WATCH' | 'IMPORTANT' | 'HIGH' | 'CRITICAL';
  confluenceScore: number;
  evidence: Record<string, any>;
  timestamp: number;
}

export type TradingSessionName = 'Asia' | 'London' | 'New York' | 'London/NY Overlap' | 'Weekend';

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  publishedAt: number;
  category: string;
  relevance: 'HIGH' | 'MEDIUM' | 'LOW';
  potentialImpact: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNCLEAR';
  summary: string;
  symbols: string[];
}
