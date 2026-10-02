import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  CrosshairMode,
  ColorType,
} from 'lightweight-charts';
import { ExchangeId, MarketCandle, Timeframe } from '../../types';
import { fetchBinanceFuturesHistory, fetchBinanceFuturesStats } from '../../services/market/binanceMarketData';
import { fetchBybitFuturesHistory, fetchBybitFuturesStats } from '../../services/market/bybitMarketData';
import { RealtimeMarketStream } from '../../services/market/marketWebSocket';
import { ChartDataStore } from '../../services/chart/chartDataService';
import { calculateVolumeSMA20, calculateFibonacciLevels } from '../../services/chart/chartIndicators';
import { detectMarketStructure, MarketStructureResult } from '../../services/analysis/structureEngine';
import { detectLevelZones, ChartLevelZone } from '../../services/analysis/levelEngine';
import { detectFormations, ChartFormation } from '../../services/analysis/formationEngine';
import { evaluateChartSetups, ChartTradingSetup } from '../../services/analysis/setupEngine';
import {
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Activity,
  Layers,
  ZoomIn,
  ZoomOut,
  Target,
  Shield,
  Zap,
  TrendingUp,
  TrendingDown,
  Check,
  ChevronDown,
} from 'lucide-react';

export interface RealtimeFuturesChartProps {
  initialSymbol?: string;
  initialExchange?: ExchangeId;
  initialTimeframe?: Timeframe;
  height?: number | string;
  onSymbolChange?: (symbol: string) => void;
  onCloseFullscreen?: () => void;
  isFullscreen?: boolean;
}

const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: '1m', label: '1m' },
  { id: '3m', label: '3m' },
  { id: '5m', label: '5m' },
  { id: '15m', label: '15m' },
  { id: '30m', label: '30m' },
  { id: '1h', label: '1H' },
  { id: '2h', label: '2H' },
  { id: '4h', label: '4H' },
  { id: '6h', label: '6H' },
  { id: '12h', label: '12H' },
  { id: '1d', label: '1D' },
  { id: '1w', label: '1W' },
];

const POPULAR_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT', 'XRPUSDT', 'AVAXUSDT'];

export const RealtimeFuturesChart: React.FC<RealtimeFuturesChartProps> = ({
  initialSymbol = 'BTCUSDT',
  initialExchange = 'binance',
  initialTimeframe = '15m',
  height = '100%',
  onSymbolChange,
  onCloseFullscreen,
  isFullscreen = false,
}) => {
  // Navigation & Market selection state
  const [symbol, setSymbol] = useState<string>(initialSymbol.toUpperCase().trim());
  const [exchange, setExchange] = useState<ExchangeId>(initialExchange);
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const [symbolSearchInput, setSymbolSearchInput] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Real-time market stats
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | 'neutral'>('neutral');
  const [change24h, setChange24h] = useState<number>(0);
  const [volume24hUsd, setVolume24hUsd] = useState<number>(0);
  const [high24h, setHigh24h] = useState<number>(0);
  const [low24h, setLow24h] = useState<number>(0);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [openInterestUsd, setOpenInterestUsd] = useState<number | null>(null);

  // Stream status & latency
  const [streamStatus, setStreamStatus] = useState<'LIVE' | 'RECONNECTING' | 'OFFLINE'>('RECONNECTING');
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [lastTickTime, setLastTickTime] = useState<string>('');

  // Crosshair legend state
  const [crosshairData, setCrosshairData] = useState<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    changePct: number;
  } | null>(null);

  // Loading & history states
  const [isLoading, setIsLoading] = useState(true);
  const [isBackfilling, setIsBackfilling] = useState(false);

  // Layers visibility state (Section 56)
  const [layers, setLayers] = useState({
    structure: true,
    levels: true,
    thirdTouch: true,
    setups: true,
    fibonacci: false,
    volume: true,
  });
  const [isLayersMenuOpen, setIsLayersMenuOpen] = useState(false);

  // Analysis results state
  const [structure, setStructure] = useState<MarketStructureResult>({ trend: 'RANGE', swings: [] });
  const [levelZones, setLevelZones] = useState<ChartLevelZone[]>([]);
  const [formations, setFormations] = useState<ChartFormation[]>([]);
  const [setups, setSetups] = useState<ChartTradingSetup[]>([]);

  // Chart DOM refs
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const volumeSmaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Overlay price lines refs to avoid DOM recreation
  const overlayLinesRef = useRef<any[]>([]);

  // Data Store & Stream refs
  const dataStoreRef = useRef<ChartDataStore>(new ChartDataStore());
  const streamRef = useRef<RealtimeMarketStream | null>(null);

  // Helper formatting
  const formatPrice = useCallback((val: number): string => {
    if (!val && val !== 0) return '0.00';
    if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (val >= 1) return val.toFixed(4);
    if (val >= 0.0001) return val.toFixed(6);
    return val.toFixed(8);
  }, []);

  const formatNotional = (val?: number | null): string => {
    if (!val) return '$0';
    if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
    return `$${Math.round(val)}`;
  };

  // Re-run analysis on candles
  const runAnalysis = useCallback((candles: MarketCandle[], curPrice: number) => {
    if (candles.length < 15) return;
    const struct = detectMarketStructure(candles);
    const zones = detectLevelZones(candles, curPrice);
    const forms = detectFormations(candles, curPrice);
    const activeSetups = evaluateChartSetups({
      currentPrice: curPrice,
      zones,
      structure: struct,
      formations: forms,
    });

    setStructure(struct);
    setLevelZones(zones);
    setFormations(forms);
    setSetups(activeSetups);
  }, []);

  // Update chart overlay lines (Zones, BOS, TP/SL, Fibonacci)
  const renderOverlayLines = useCallback(() => {
    if (!candleSeriesRef.current) return;

    // Clear old lines
    for (const line of overlayLinesRef.current) {
      try {
        candleSeriesRef.current.removePriceLine(line);
      } catch {}
    }
    overlayLinesRef.current = [];

    const series = candleSeriesRef.current;

    // 1. Support & Resistance Zones
    if (layers.levels) {
      for (const zone of levelZones) {
        const isSupport = zone.type === 'SUPPORT';
        const color = isSupport ? '#10b981' : '#f43f5e';
        const line = series.createPriceLine({
          price: zone.center,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${zone.type} (${zone.strengthScore})`,
        });
        overlayLinesRef.current.push(line);
      }
    }

    // 2. Active Setups (Entry, Invalidation SL, Targets TP1, TP2)
    if (layers.setups) {
      for (const s of setups) {
        if (s.status === 'CONFIRMED' || s.status === 'WATCH') {
          // Entry
          const entryLine = series.createPriceLine({
            price: s.entryZone.center,
            color: '#38bdf8',
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: `ENTRY (${s.confluenceScore})`,
          });
          // Invalidation (SL)
          const slLine = series.createPriceLine({
            price: s.invalidation,
            color: '#ef4444',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: 'SL (Invalidation)',
          });
          // TP1
          const tpLine = series.createPriceLine({
            price: s.targets.tp2,
            color: '#10b981',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: 'TP (Target)',
          });
          overlayLinesRef.current.push(entryLine, slLine, tpLine);
        }
      }
    }

    // 3. Fibonacci Golden Pocket
    if (layers.fibonacci && structure.swings.length >= 2) {
      const highs = structure.swings.filter((s) => s.swingType === 'HIGH');
      const lows = structure.swings.filter((s) => s.swingType === 'LOW');
      if (highs.length > 0 && lows.length > 0) {
        const maxH = highs[highs.length - 1].price;
        const minL = lows[lows.length - 1].price;
        const fibs = calculateFibonacciLevels(maxH, minL);
        for (const f of fibs) {
          if (f.isGoldenPocket || f.ratio === 0.5) {
            const fibLine = series.createPriceLine({
              price: f.price,
              color: f.isGoldenPocket ? '#fbbf24' : '#94a3b8',
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: f.label,
            });
            overlayLinesRef.current.push(fibLine);
          }
        }
      }
    }
  }, [layers, levelZones, setups, structure, formations]);

  // Load initial candles & stats
  const loadMarketData = useCallback(async () => {
    setIsLoading(true);

    try {
      const [history, stats] = await Promise.all([
        exchange === 'binance'
          ? fetchBinanceFuturesHistory(symbol, timeframe, 1000)
          : fetchBybitFuturesHistory(symbol, timeframe, 1000),
        exchange === 'binance'
          ? fetchBinanceFuturesStats(symbol)
          : fetchBybitFuturesStats(symbol),
      ]);

      if (history.length > 0) {
        dataStoreRef.current.setCandles(history);

        const lastC = history[history.length - 1];
        const curP = stats.price > 0 ? stats.price : lastC.close;
        setCurrentPrice(curP);
        setChange24h(stats.change24h);
        setVolume24hUsd(stats.volumeUsd);
        setHigh24h(stats.high24h);
        setLow24h(stats.low24h);
        setFundingRate(stats.fundingRate);
        setOpenInterestUsd(stats.openInterestUsd);

        // Update Lightweight Charts Series
        if (candleSeriesRef.current) {
          candleSeriesRef.current.setData(
            history.map((c) => ({
              time: c.time as any,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            }))
          );
        }

        if (volumeSeriesRef.current) {
          const volData = calculateVolumeSMA20(history);
          volumeSeriesRef.current.setData(
            volData.map((v) => ({
              time: v.time as any,
              value: v.value,
              color: v.color,
            }))
          );
          if (volumeSmaSeriesRef.current) {
            volumeSmaSeriesRef.current.setData(
              volData.map((v) => ({
                time: v.time as any,
                value: v.sma20,
              }))
            );
          }
        }

        // Run technical analysis
        runAnalysis(history, curP);

        // Auto-fit content on initial load
        if (chartInstanceRef.current) {
          chartInstanceRef.current.timeScale().fitContent();
        }
      }
    } catch (e) {
      console.error('[RealtimeFuturesChart] Error loading history:', e);
    } finally {
      setIsLoading(false);
    }
  }, [exchange, symbol, timeframe, runAnalysis]);

  // Connect Realtime WebSocket Stream
  useEffect(() => {
    // Teardown previous stream
    if (streamRef.current) {
      streamRef.current.destroy();
      streamRef.current = null;
    }

    loadMarketData();

    // Start WebSocket Stream
    streamRef.current = new RealtimeMarketStream(exchange, symbol, timeframe, {
      onCandle: (candle) => {
        const { isNewCandle, updatedCandle } = dataStoreRef.current.updateLiveCandle(candle);

        // Update live price line and direction
        setCurrentPrice((prev) => {
          if (updatedCandle.close > prev) setPriceDirection('up');
          else if (updatedCandle.close < prev) setPriceDirection('down');
          return updatedCandle.close;
        });

        // Fast path incremental update to series without re-rendering whole chart (Section 6)
        if (candleSeriesRef.current) {
          candleSeriesRef.current.update({
            time: updatedCandle.time as any,
            open: updatedCandle.open,
            high: updatedCandle.high,
            low: updatedCandle.low,
            close: updatedCandle.close,
          });
        }

        if (volumeSeriesRef.current) {
          const isUp = updatedCandle.close >= updatedCandle.open;
          volumeSeriesRef.current.update({
            time: updatedCandle.time as any,
            value: updatedCandle.volume,
            color: isUp ? 'rgba(16, 185, 129, 0.65)' : 'rgba(239, 68, 68, 0.65)',
          });
        }

        // When a new candle completes, update analysis
        if (isNewCandle) {
          runAnalysis(dataStoreRef.current.getCandles(), updatedCandle.close);
        }
      },
      onTick: (data) => {
        if (data.price > 0) {
          setCurrentPrice(data.price);
        }
        if (data.high24h > 0) setHigh24h(data.high24h);
        if (data.low24h > 0) setLow24h(data.low24h);
        if (data.change24h !== undefined) setChange24h(Number(data.change24h.toFixed(2)));
        if (data.volumeUsd > 0) setVolume24hUsd(data.volumeUsd);
      },
      onStatus: (status, latency) => {
        setStreamStatus(status);
        setLatencyMs(latency);
        setLastTickTime(new Date().toLocaleTimeString());
      },
      onReconnect: () => {
        // Backfill missed candles upon reconnect recovery (Section 4)
        const last = dataStoreRef.current.getLastCandle();
        if (last) {
          (exchange === 'binance'
            ? fetchBinanceFuturesHistory(symbol, timeframe, 50)
            : fetchBybitFuturesHistory(symbol, timeframe, 50)
          ).then((recent) => {
            if (recent.length > 0) {
              for (const c of recent) {
                dataStoreRef.current.updateLiveCandle(c);
              }
            }
          });
        }
      },
    });

    return () => {
      if (streamRef.current) {
        streamRef.current.destroy();
        streamRef.current = null;
      }
    };
  }, [exchange, symbol, timeframe, loadMarketData, runAnalysis]);

  // Update overlay lines whenever analysis or layer toggles change
  useEffect(() => {
    renderOverlayLines();
  }, [renderOverlayLines]);

  // Infinite history backfill on scroll left (Section 7)
  const handleVisibleLogicalRangeChange = useCallback(
    async (newRange: any) => {
      if (!newRange || isBackfilling) return;
      // When user scrolled within 15 bars of the oldest loaded candle
      if (newRange.from < 15) {
        const first = dataStoreRef.current.getFirstCandle();
        if (!first) return;

        setIsBackfilling(true);
        try {
          const older =
            exchange === 'binance'
              ? await fetchBinanceFuturesHistory(symbol, timeframe, 300, first.time - 1)
              : await fetchBybitFuturesHistory(symbol, timeframe, 300, first.time - 1);

          if (older.length > 0) {
            const added = dataStoreRef.current.prependHistory(older);
            if (added > 0 && candleSeriesRef.current) {
              const all = dataStoreRef.current.getCandles();
              candleSeriesRef.current.setData(
                all.map((c) => ({
                  time: c.time as any,
                  open: c.open,
                  high: c.high,
                  low: c.low,
                  close: c.close,
                }))
              );
              if (volumeSeriesRef.current) {
                const volData = calculateVolumeSMA20(all);
                volumeSeriesRef.current.setData(
                  volData.map((v) => ({
                    time: v.time as any,
                    value: v.value,
                    color: v.color,
                  }))
                );
              }
            }
          }
        } finally {
          setIsBackfilling(false);
        }
      }
    },
    [exchange, symbol, timeframe, isBackfilling]
  );

  // Initialize Lightweight Charts Instance
  useEffect(() => {
    if (!chartContainerRef.current) return;

    chartContainerRef.current.innerHTML = '';

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#090d16' },
        textColor: '#94a3b8',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace, -apple-system, BlinkMacSystemFont',
      },
      grid: {
        vertLines: { color: 'rgba(30, 41, 59, 0.45)', style: LineStyle.Dotted },
        horzLines: { color: 'rgba(30, 41, 59, 0.45)', style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#38bdf8',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#0284c7',
        },
        horzLine: {
          color: '#38bdf8',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#0284c7',
        },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        scaleMargins: { top: 0.08, bottom: 0.22 },
        autoScale: true,
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 9,
        minBarSpacing: 3,
        rightOffset: 8,
      },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    });

    chartInstanceRef.current = chart;

    // Candlestick Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    // Volume Histogram Series (Bottom pane)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    volumeSeriesRef.current = volumeSeries;

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0.0 },
    });

    // Volume SMA Line Series
    const volumeSmaSeries = chart.addSeries(LineSeries, {
      color: '#38bdf8',
      lineWidth: 1,
      priceScaleId: 'volume',
      lineStyle: LineStyle.Dotted,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSmaSeriesRef.current = volumeSmaSeries;

    // Crosshair move handler
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        setCrosshairData(null);
        return;
      }

      const candleData: any = param.seriesData.get(candleSeries);
      const volData: any = param.seriesData.get(volumeSeries);

      if (candleData) {
        const timeStr = typeof param.time === 'number'
          ? new Date(param.time * 1000).toLocaleString()
          : String(param.time);

        const open = candleData.open || 0;
        const close = candleData.close || 0;
        const changePct = open > 0 ? ((close - open) / open) * 100 : 0;

        setCrosshairData({
          time: timeStr,
          open,
          high: candleData.high || 0,
          low: candleData.low || 0,
          close,
          volume: volData?.value || 0,
          changePct: Number(changePct.toFixed(2)),
        });
      }
    });

    // Infinite scroll range change subscription
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);

    // Auto-resize on container size change
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0] && chartInstanceRef.current && chartContainerRef.current) {
        const { width, height: h } = entries[0].contentRect;
        if (width > 0 && h > 0) {
          chartInstanceRef.current.resize(width, h);
        }
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartInstanceRef.current = null;
    };
  }, [handleVisibleLogicalRangeChange]);

  // Chart Controls
  const handleFitContent = () => chartInstanceRef.current?.timeScale().fitContent();
  const handleResetZoom = () => chartInstanceRef.current?.timeScale().resetTimeScale();
  const handleZoomIn = () => {
    const ts = chartInstanceRef.current?.timeScale();
    if (ts) {
      const cur = (ts as any).options?.barSpacing || 9;
      ts.applyOptions({ barSpacing: cur * 1.25 });
    }
  };
  const handleZoomOut = () => {
    const ts = chartInstanceRef.current?.timeScale();
    if (ts) {
      const cur = (ts as any).options?.barSpacing || 9;
      ts.applyOptions({ barSpacing: Math.max(3, cur * 0.8) });
    }
  };

  const handleSelectSymbol = (sym: string) => {
    const clean = sym.toUpperCase().trim();
    setSymbol(clean);
    setIsSearchOpen(false);
    onSymbolChange?.(clean);
  };

  return (
    <div className="w-full h-full flex flex-col bg-slate-950 text-slate-100 font-sans select-none overflow-hidden rounded-2xl border border-slate-800 shadow-2xl">
      {/* 1. TOP HEADER & REALTIME STATS BAR (Section 10) */}
      <div className="p-3 border-b border-slate-800/80 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Symbol & Exchange Selector */}
        <div className="flex items-center gap-2.5">
          {/* Symbol button with dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsSearchOpen((prev) => !prev)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-mono font-black text-sm flex items-center gap-2 border border-slate-700 shadow-sm cursor-pointer"
            >
              <span>{symbol}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {isSearchOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-64 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-2 z-50 animate-in fade-in">
                <div className="relative mb-2">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Пошук монети (BTC, ETH...)"
                    value={symbolSearchInput}
                    onChange={(e) => setSymbolSearchInput(e.target.value.toUpperCase())}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2 py-1.5 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-cyan-500"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-xs">
                  {POPULAR_SYMBOLS.filter((s) => s.includes(symbolSearchInput)).map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSelectSymbol(s)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between hover:bg-slate-800 transition-colors cursor-pointer ${
                        s === symbol ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-300'
                      }`}
                    >
                      <span>{s}</span>
                      {s === symbol && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </button>
                  ))}
                  {symbolSearchInput && !POPULAR_SYMBOLS.includes(symbolSearchInput) && (
                    <button
                      onClick={() => handleSelectSymbol(symbolSearchInput)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 font-bold flex items-center justify-between"
                    >
                      <span>Обрати #{symbolSearchInput}</span>
                      <span>+</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Exchange Switcher (Binance / Bybit) */}
          <div className="flex rounded-lg bg-slate-950 border border-slate-800 p-0.5 font-mono text-xs">
            <button
              onClick={() => setExchange('binance')}
              className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                exchange === 'binance'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Binance
            </button>
            <button
              onClick={() => setExchange('bybit')}
              className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                exchange === 'bybit'
                  ? 'bg-orange-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Bybit
            </button>
          </div>

          {/* Market Badge */}
          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-mono font-bold uppercase border border-slate-700">
            Perp Futures
          </span>

          {/* Live stream status & latency */}
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border flex items-center gap-1.5 ${
              streamStatus === 'LIVE'
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : streamStatus === 'RECONNECTING'
                ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 animate-pulse'
                : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                streamStatus === 'LIVE' ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'
              }`}
            />
            {streamStatus} {latencyMs > 0 ? `(${latencyMs}ms)` : ''}
          </span>
        </div>

        {/* Center: Live Price & Key Metrics */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Ціна:</span>
            <span
              className={`text-base font-black tracking-tight transition-colors ${
                priceDirection === 'up'
                  ? 'text-emerald-400'
                  : priceDirection === 'down'
                  ? 'text-rose-400'
                  : 'text-white'
              }`}
            >
              ${formatPrice(currentPrice)}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                change24h >= 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
              }`}
            >
              {change24h >= 0 ? '+' : ''}
              {change24h}%
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-3 text-slate-400 text-[11px]">
            <span>24h Обсяг: <strong className="text-white">{formatNotional(volume24hUsd)}</strong></span>
            <span>24h High: <strong className="text-emerald-400">${formatPrice(high24h)}</strong></span>
            <span>24h Low: <strong className="text-rose-400">${formatPrice(low24h)}</strong></span>
            {openInterestUsd && (
              <span>OI: <strong className="text-cyan-300">{formatNotional(openInterestUsd)}</strong></span>
            )}
            {fundingRate !== null && (
              <span>Funding: <strong className="text-amber-300">{fundingRate > 0 ? '+' : ''}{fundingRate}%</strong></span>
            )}
          </div>
        </div>

        {/* Right: Controls & Layer Toggles */}
        <div className="flex items-center gap-1.5">
          {/* Layers Toggle Dropdown (Section 56) */}
          <div className="relative">
            <button
              onClick={() => setIsLayersMenuOpen((prev) => !prev)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1 text-xs font-bold border border-slate-700 cursor-pointer"
              title="Накладання шарів аналітики"
            >
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden md:inline">Шари</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {isLayersMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-2 z-50 text-xs font-mono space-y-1 animate-in fade-in">
                <div className="text-[10px] text-slate-400 uppercase font-bold px-2 py-1">Шари аналізу:</div>
                <label className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-800 cursor-pointer">
                  <span>Рівні S/R</span>
                  <input
                    type="checkbox"
                    checked={layers.levels}
                    onChange={(e) => setLayers((l) => ({ ...l, levels: e.target.checked }))}
                    className="rounded text-cyan-500"
                  />
                </label>
                <label className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-800 cursor-pointer">
                  <span>Структура (BOS/CHoCH)</span>
                  <input
                    type="checkbox"
                    checked={layers.structure}
                    onChange={(e) => setLayers((l) => ({ ...l, structure: e.target.checked }))}
                    className="rounded text-cyan-500"
                  />
                </label>
                <label className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-800 cursor-pointer">
                  <span>Сетапи (Entry/SL/TP)</span>
                  <input
                    type="checkbox"
                    checked={layers.setups}
                    onChange={(e) => setLayers((l) => ({ ...l, setups: e.target.checked }))}
                    className="rounded text-cyan-500"
                  />
                </label>
                <label className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-800 cursor-pointer">
                  <span>Fibonacci</span>
                  <input
                    type="checkbox"
                    checked={layers.fibonacci}
                    onChange={(e) => setLayers((l) => ({ ...l, fibonacci: e.target.checked }))}
                    className="rounded text-cyan-500"
                  />
                </label>
                <label className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-800 cursor-pointer">
                  <span>Обсяг &amp; SMA 20</span>
                  <input
                    type="checkbox"
                    checked={layers.volume}
                    onChange={(e) => setLayers((l) => ({ ...l, volume: e.target.checked }))}
                    className="rounded text-cyan-500"
                  />
                </label>
              </div>
            )}
          </div>

          <button
            onClick={handleZoomIn}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleFitContent}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
            title="Авто-масштаб (Fit Content)"
          >
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
          </button>
          <button
            onClick={loadMarketData}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
            title="Оновити дані"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          {onCloseFullscreen && (
            <button
              onClick={onCloseFullscreen}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-400 transition-colors cursor-pointer"
              title="Закрити графік"
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* 2. TIMEFRAME SELECTION BAR (Section 11) */}
      <div className="px-3 py-1.5 border-b border-slate-800/60 bg-slate-950 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-1 overflow-x-auto py-0.5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              onClick={() => setTimeframe(tf.id)}
              className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                timeframe === tf.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60 border border-transparent'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Crosshair Tooltip Legend Bar (Section 13) */}
        {crosshairData ? (
          <div className="flex items-center gap-3 text-[11px] text-slate-300 overflow-hidden">
            <span className="text-slate-500">{crosshairData.time}</span>
            <span>O: <strong className="text-white">${formatPrice(crosshairData.open)}</strong></span>
            <span>H: <strong className="text-emerald-400">${formatPrice(crosshairData.high)}</strong></span>
            <span>L: <strong className="text-rose-400">${formatPrice(crosshairData.low)}</strong></span>
            <span>C: <strong className="text-white">${formatPrice(crosshairData.close)}</strong></span>
            <span>Vol: <strong className="text-cyan-300">{Math.round(crosshairData.volume)}</strong></span>
            <span
              className={`font-bold ${
                crosshairData.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {crosshairData.changePct >= 0 ? '+' : ''}{crosshairData.changePct}%
            </span>
          </div>
        ) : (
          <div className="text-[11px] text-slate-500 italic hidden sm:block">
            Наведіть курсор на свічку для огляду OHLCV
          </div>
        )}
      </div>

      {/* 3. LIGHTWEIGHT-CHARTS CONTAINER */}
      <div className="relative flex-1 w-full overflow-hidden bg-[#090d16]" style={{ minHeight: height === '100%' ? 380 : height }}>
        {isLoading && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm gap-2">
            <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
            <span className="text-xs font-mono text-slate-300">
              Завантаження реальних OHLCV даних ({exchange.toUpperCase()} {symbol})...
            </span>
          </div>
        )}

        {isBackfilling && (
          <div className="absolute top-2 left-2 z-20 px-2 py-1 rounded bg-slate-900/90 border border-slate-700 text-[10px] font-mono text-cyan-300 flex items-center gap-1.5 shadow-lg">
            <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
            <span>Підвантаження історії...</span>
          </div>
        )}

        <div ref={chartContainerRef} className="w-full h-full" />
      </div>

      {/* 4. ACTIVE SIGNALS / ANALYSIS STATUS FOOTER */}
      <div className="px-3 py-1.5 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-400">
        <div className="flex items-center gap-3">
          <span>
            Тренд: <strong className={structure.trend === 'BULLISH' ? 'text-emerald-400' : structure.trend === 'BEARISH' ? 'text-rose-400' : 'text-slate-200'}>{structure.trend}</strong>
          </span>
          {structure.lastBreak && (
            <span className="text-cyan-300">
              {structure.lastBreak.type} {structure.lastBreak.direction} (${formatPrice(structure.lastBreak.price)})
            </span>
          )}
          {setups[0] && (
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
              {setups[0].title}
            </span>
          )}
        </div>
        <div className="text-[10px] text-slate-500">
          Lightweight Charts™ v5.2 • Справжні дані ринку • Останній тік: {lastTickTime || 'активно'}
        </div>
      </div>
    </div>
  );
};
