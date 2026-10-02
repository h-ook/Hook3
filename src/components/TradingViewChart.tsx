import React from 'react';
import { RealtimeFuturesChart } from './chart/RealtimeFuturesChart';
import { Kline, DetectedFormation, Timeframe, ExchangeId, MarketType, ChartMarkerInfo, ChartRestoreParams } from '../types';

export interface TradingViewChartProps {
  klines?: Kline[];
  formation?: DetectedFormation | null;
  symbol: string;
  timeframe?: string;
  exchange?: ExchangeId;
  marketType?: MarketType;
  historyLimit?: number;
  onHistoryLimitChange?: (limit: number) => void;
  onTimeframeChange?: (timeframe: Timeframe) => void;
  onLivePriceUpdate?: (price: number) => void;
  onOpenFullscreen?: () => void;
  onAddToArchive?: () => void;
  isArchived?: boolean;
  isSavingArchive?: boolean;
  customMarkers?: ChartMarkerInfo[];
  savedChartParams?: ChartRestoreParams;
  fullHeight?: boolean;
  showNavigationControls?: boolean;
  hideHeaderLiveIndicator?: boolean;
  hideHeaderFormationBadge?: boolean;
  hideSymbolAndPrice?: boolean;
  onLiveStatusChange?: (status: { isConnected: boolean; mode: 'ws' | 'rest' }) => void;
}

export const TradingViewChart: React.FC<TradingViewChartProps> = ({
  symbol,
  timeframe = '15m',
  exchange = 'binance',
  onTimeframeChange,
  onOpenFullscreen,
}) => {
  // Normalize timeframe to supported types
  const tf = (timeframe as Timeframe) || '15m';

  return (
    <div className="w-full h-full flex flex-col min-h-[380px]">
      <RealtimeFuturesChart
        initialSymbol={symbol}
        initialExchange={exchange}
        initialTimeframe={tf}
        height="100%"
        onSymbolChange={() => {}}
        onCloseFullscreen={onOpenFullscreen}
        isFullscreen={false}
      />
    </div>
  );
};
