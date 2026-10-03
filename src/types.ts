export type ExchangeId = 'binance' | 'bybit';
export type MarketType = 'futures' | 'spot';
export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1H' | '1h' | '2H' | '4H' | '4h' | '6H' | '8H' | '12H' | '1D' | '1d' | '1W';

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime?: number;
  turnover?: number;
}

export type PatternCategory = string;
export type PatternBias = 'bullish' | 'bearish' | 'neutral';
export type PatternStatus = 'active' | 'broken' | 'testing' | 'formed' | 'forming' | 'ready_to_break' | 'breakout' | 'retest' | 'target_reached';

export interface ValidationDetails {
  confirmed: boolean;
  passed: boolean;
  score?: number;
  reasons?: string[];
  volumeSurge?: boolean;
  retestOk?: boolean;
  closedCandleOnly?: boolean;
  [key: string]: any;
}

export interface DetectedFormation {
  id: string;
  symbol: string;
  patternType: string;
  category?: PatternCategory;
  bias: PatternBias;
  status?: PatternStatus;
  support?: number;
  resistance?: number;
  targetPrice?: number;
  invalidationPrice?: number;
  confidence: number;
  validation?: ValidationDetails;
  startTime?: number;
  endTime?: number;
  startPrice?: number;
  endPrice?: number;
  description?: string;
  notes?: string;
  patternKey?: string;
  candleStartIndex?: number;
  candleEndIndex?: number;
  levels: {
    support?: number;
    resistance?: number;
    entryPrice: number;
    targetPrice: number;
    stopLoss?: number;
    stopLossPrice?: number;
    necklinePrice?: number;
    [key: string]: any;
  };
  statusLabel?: string;
  [key: string]: any;
}

export interface ScannedCoin {
  symbol: string;
  exchange: ExchangeId;
  marketType: MarketType;
  baseAsset: string;
  quoteAsset: string;
  name?: string;
  price?: number;
  change24h?: number;
  volume24h?: number;
  volumeUsd?: number;
  currentPrice: number;
  priceChange24h: number;
  volume24hUsd: number;
  highPrice24h?: number;
  lowPrice24h?: number;
  high24h?: number;
  low24h?: number;
  timeframe?: Timeframe;
  formations: DetectedFormation[];
  hasFormations?: boolean;
  bestFormation?: DetectedFormation;
  exchangeUrl?: string;
  lastUpdated?: number;
  trend?: 'up' | 'down' | 'sideways';
  score?: number;
  fundingRate?: number;
  openInterest?: number;
  [key: string]: any;
}

export interface MarketCoin extends ScannedCoin {
  price: number;
  change24h: number;
  volumeUsd: number;
  high24h: number;
  low24h: number;
  distanceToHighPct: number;
  distanceToLowPct: number;
  volatility24hPct: number;
  volatility5mPct: number;
  isNearHigh: boolean;
  isNearLow: boolean;
  isActiveCoin: boolean;
  [key: string]: any;
}

export type ScreenerPresetFilter = 'all' | 'active' | 'top_gainers' | 'top_losers' | 'near_highs' | 'near_lows' | string;
export type ScreenerSortBy = 'volume' | 'priceChange' | 'price' | 'volatility' | string;

export type ActivePageType = 'screener' | 'terminal' | 'surveillance' | 'replay' | 'patterns' | 'chart';

export interface PriceAlert {
  id: string;
  symbol: string;
  exchange: ExchangeId;
  marketType?: MarketType;
  targetPrice: number;
  direction?: 'above' | 'below';
  condition?: 'gte' | 'lte' | 'above' | 'below';
  triggered: boolean;
  createdAt: number | string;
  triggeredAt?: number;
  triggeredPrice?: number;
  note?: string;
  isActive?: boolean;
  formationName?: string;
  levelType?: string;
  userId?: string;
  [key: string]: any;
}

export interface ArchivedFormation {
  id: string;
  symbol: string;
  exchange: ExchangeId;
  marketType?: MarketType;
  baseAsset: string;
  timeframe?: Timeframe;
  savedPrice?: number;
  savedAtTimestamp?: number;
  formation: DetectedFormation;
  formationName: string;
  archivedAt?: number | string;
  notes?: string;
  tags?: string[];
  userId?: string;
  [key: string]: any;
}

export interface SmartAnalysisData {
  summary: string;
  bias?: PatternBias;
  keyLevels?: { price: number; type: 'support' | 'resistance' }[];
  scenarios?: { title: string; description: string; probability: number }[];
  recommendation?: string;
  participants?: any;
  [key: string]: any;
}

export type TriggerModeType = string;

export interface FormationAIAnalysis {
  overview?: string;
  summary?: string;
  bullishCase?: string;
  bearishCase?: string;
  riskRewardRatio?: number;
  recommendedLeverage?: number;
  patternConfirmation?: any;
  targetAnalysis?: any;
  invalidationCriteria?: any;
  tradeScenario?: any;
  keyRisks?: any;
  [key: string]: any;
}

export interface MarketSentimentData {
  longShortRatio?: number;
  openInterestUsd?: number;
  fundingRate?: number;
  liquidation24hUsd?: { long: number; short: number };
  sentiment?: 'extreme_greed' | 'greed' | 'neutral' | 'fear' | 'extreme_fear' | string;
  [key: string]: any;
}

export interface ScreenerFilterState {
  exchange: ExchangeId | 'all';
  marketType: MarketType | 'all';
  minVolume24h?: number;
  minChange24h?: number;
  bias: PatternBias | 'all';
  category: PatternCategory | 'all';
  searchQuery: string;
  timeframe?: Timeframe;
  minVolumeUsd?: number;
  sortBy?: string;
  [key: string]: any;
}

export interface ChartMarkerInfo {
  id?: string;
  time?: number;
  position?: 'aboveBar' | 'belowBar' | 'inBar';
  color?: string;
  shape?: 'circle' | 'square' | 'arrowUp' | 'arrowDown';
  text?: string;
  type?: string;
  label?: string;
  price?: number;
  lineStyle?: string;
  lineWidth?: number;
  notes?: string;
  [key: string]: any;
}

export interface ChartRestoreParams {
  symbol?: string;
  exchange?: ExchangeId;
  timeframe?: Timeframe;
  visibleRange?: { from: number; to: number };
  historyLimit?: number;
  lastClosePrice?: number;
  savedAtCandleTime?: number;
  [key: string]: any;
}

export type TelegramStatus = any;

export interface AlertHistoryItem {
  id: string;
  timestamp?: number;
  triggeredAt?: number;
  symbol: string;
  message?: string;
  type?: 'info' | 'success' | 'warning' | 'error' | string;
  exchange?: ExchangeId;
  marketType?: MarketType;
  targetPrice?: number;
  condition?: string;
  formationName?: string;
  levelType?: string;
  note?: string;
  [key: string]: any;
}

export interface UserProfile {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  apiKeys?: {
    binance?: { apiKey: string; secretKey: string };
    bybit?: { apiKey: string; secretKey: string };
  };
  telegramChatId?: string;
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  metaScalpSettings?: any;
  defaultExchange?: any;
  defaultMarketType?: any;
  defaultTimeframe?: any;
  soundAlertsEnabled?: boolean;
  watchlist?: string[];
  watchlistFolders?: Record<string, string[]>;
  updatedAt?: any;
  [key: string]: any;
}

export interface RoundNumberContext {
  nearestRoundNumber?: number;
  distancePct: number;
  significance?: 'high' | 'medium' | 'low';
  detected?: boolean;
  level?: number;
  step?: number;
  strength?: number;
  densityConfirmed?: boolean;
}

export interface ExchangeApiCredentials {
  apiKey: string;
  secretKey?: string;
  apiSecret?: string;
  exchange?: ExchangeId;
  marketType?: MarketType;
  testnet?: boolean;
  isTestnet?: boolean;
  [key: string]: any;
}

export type OrderSide = 'BUY' | 'SELL' | 'buy' | 'sell';
export type OrderType = 'LIMIT' | 'MARKET' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET' | string;

export interface PlacedOrder {
  orderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType | string;
  price: number;
  quantity?: number;
  origQty?: number;
  status: 'NEW' | 'FILLED' | 'CANCELED' | 'REJECTED' | string;
  time: number;
  [key: string]: any;
}

export interface AccountBalanceInfo {
  asset?: string;
  free?: number;
  locked?: number;
  total?: number;
  usdValue?: number;
  exchange?: ExchangeId | string;
  marketType?: MarketType | string;
  totalWalletBalance?: number;
  availableBalance?: number;
  unrealizedPnl?: number;
  marginBalance?: number;
  currency?: string;
  isTestnet?: boolean;
  [key: string]: any;
}

export type ReplayOrderType = 'MARKET' | 'LIMIT' | 'STOP' | string;

export interface ReplayPosition {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT' | 'long' | 'short';
  entryPrice: number;
  size: number;
  leverage: number;
  margin: number;
  marginUsd: number;
  sizeUsd: number;
  liquidationPrice: number;
  slPrice?: number;
  tpPrice?: number;
  pnl: number;
  pnlPercentage: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  openedAt: number;
  closedAt?: number;
  exitPrice?: number;
  status: 'OPEN' | 'CLOSED' | string;
  [key: string]: any;
}

export interface ReplayPendingOrder {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT' | 'BUY' | 'SELL' | 'buy' | 'sell';
  type?: ReplayOrderType;
  orderType?: ReplayOrderType;
  price: number;
  size?: number;
  sizeUsd?: number;
  leverage: number;
  [key: string]: any;
}

export interface ReplayTradeJournalItem {
  id: string;
  positionId?: string;
  symbol: string;
  side: 'LONG' | 'SHORT' | 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  tpPrice?: number;
  pnl?: number;
  pnlPercentage?: number;
  pnlUsd: number;
  pnlPct: number;
  tag?: string;
  screenshotUrl?: string;
  timeframe?: Timeframe;
  notes?: string;
  rating?: number;
  timestamp?: number;
  createdAt?: number;
  exitReason?: string;
  [key: string]: any;
}

export interface ReplaySimulationSettings {
  initialBalance?: number;
  balance?: number;
  availableBalance?: number;
  defaultLeverage?: number;
  commissionRate?: number;
  commissionPct: number;
  spreadPct: number;
  slippagePct: number;
  autoSlPct?: number;
  autoTpPct?: number;
  leverage?: number;
  positionSizeUsd?: number;
  [key: string]: any;
}

export interface TerminalWorkspaceConfig {
  id?: string;
  name?: string;
  layout?: 'grid' | 'single' | string;
  autoFitScreen?: boolean;
  blockHeight?: 'compact' | 'medium' | 'large' | string | number;
  [key: string]: any;
}

export type TerminalBlockMode = 'chart' | 'dom' | 'orderbook' | 'trades' | 'ai' | 'combined' | 'tradingview' | string;

export interface TerminalChartBlock {
  id: string;
  symbol: string;
  exchange: ExchangeId;
  marketType: MarketType;
  timeframe: Timeframe;
  mode: TerminalBlockMode;
  [key: string]: any;
}

export interface SurveillanceCoin {
  id: string;
  userId: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  exchange: ExchangeId;
  marketType: MarketType;
  isActive: boolean;
  createdAt: string | number;
  updatedAt: string | number;
  lastNotifiedAt?: string | number;
  lastCheckedAt?: string | number;
  config?: any;
  state?: any;
  [key: string]: any;
}

export interface SurveillanceConfig {
  [key: string]: any;
}

export interface SurveillanceState {
  [key: string]: any;
}

export interface SurveillanceEvent {
  id: string;
  symbol?: string;
  type: string;
  title: string;
  description: string;
  price: number;
  timestamp: number;
  severity: 'info' | 'warning' | 'critical' | string;
  details?: any;
  [key: string]: any;
}

export type ExtremeApproach = 'NEUTRAL' | 'REJECTING' | 'TESTING' | 'APPROACHING' | 'MOVING_AWAY' | 'BREAKING' | 'aggressive' | 'conservative' | 'balanced' | string;

export interface ExtremeContext {
  role: ExtremeRole;
  referencePrice: number;
  distancePct: number;
  rangePositionPct: number;
  approach: ExtremeApproach;
  approachStrength: number;
  barsToExtreme: number;
  velocityPct: number;
  rejectionStrength: number;
  sweepDetected: boolean;
  testsCount: number;
  aligned: boolean;
  reason: string;
  [key: string]: any;
}

export type ExtremeRole = 'UPPER_EXTREME' | 'LOWER_EXTREME' | 'maker' | 'taker' | 'observer' | string;

