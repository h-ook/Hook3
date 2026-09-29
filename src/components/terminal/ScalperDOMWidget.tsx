import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Settings,
  Volume2,
  VolumeX,
  Crosshair,
  Layers,
  ChevronDown,
  Check,
  Zap,
  Info,
  Sliders,
  BellRing,
  BarChart3,
  LineChart,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  CircleDot,
  Filter,
  ArrowDownRight,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Target,
  Shield,
  RefreshCw,
  Trash2,
  AlertCircle,
  X as CloseIcon,
} from 'lucide-react';
import {
  ExchangeId,
  MarketType,
  Timeframe,
  ExchangeApiCredentials,
  PlacedOrder,
  OrderSide,
  OrderType,
  AccountBalanceInfo,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import {
  testExchangeApiKeys,
  submitExchangeOrder,
  getExchangeOpenOrders,
  cancelExchangeOrderById,
  cancelAllExchangeOrdersForSymbol,
  getLocalExchangeCredentials,
} from '../../utils/exchangeTradingClient';
import { formatCryptoPrice, formatVolume, formatWholeSum, formatCompactWholeBubble } from '../../utils/formatters';
import { playDensityChime } from '../../utils/domSound';

function formatOrderQty(rawQty: number, price: number): number {
  if (isNaN(rawQty) || rawQty <= 0) return 0;
  if (price > 10000) return Number(rawQty.toFixed(4));
  if (price > 100) return Number(rawQty.toFixed(3));
  if (price > 1) return Number(rawQty.toFixed(2));
  return Number(rawQty.toFixed(1));
}

function formatTradeTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatCompactClusterSum(vol: number | undefined | null): string {
  if (!vol || vol <= 0 || isNaN(vol)) return '0';
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${Math.round(vol / 1_000)}k`;
  return `${Math.round(vol)}`;
}

function formatCandleTotalSum(vol: number | undefined | null): string {
  if (!vol || vol <= 0 || isNaN(vol)) return '$0';
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(2)}B`;
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `$${Math.round(vol / 1_000)}k`;
  return `$${Math.round(vol)}`;
}

interface ScalperDOMWidgetProps {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  exchange: ExchangeId;
  marketType: MarketType;
  currentPrice?: number;
  priceChange24h?: number;
  initialTimeframe?: Timeframe;
  initialCompression?: number;
  initialDepth?: 'all' | 'deep' | 'medium' | 'small';
  initialDensityThreshold?: number;
  initialBubbleThreshold?: number;
  initialSoundAlert?: boolean;
  onUpdateSettings?: (settings: {
    compression?: number;
    depth?: 'all' | 'deep' | 'medium' | 'small';
    densityThresholdUsd?: number;
    bubbleThresholdUsd?: number;
    soundAlertEnabled?: boolean;
    clusterTimeframe?: Timeframe;
  }) => void;
  height?: string | number;
  domHeightPreset?: 'md' | 'lg' | 'xl';
  onDomHeightPresetChange?: (preset: 'md' | 'lg' | 'xl') => void;
  onToggleView?: () => void;
}

interface OrderBookRow {
  price: number;
  qty: number;
  volumeUsd: number;
  isAsk: boolean;
  isDensity: boolean;
}

interface RecentTrade {
  id: string;
  price: number;
  qty: number;
  volumeUsd: number;
  isBuyerMaker: boolean; // true = sell, false = buy
  timestamp: number;
}

interface ClusterLevel {
  price: number;
  buyVol: number;
  sellVol: number;
  totalVol: number;
  isPOC: boolean;
}

interface ClusterColumn {
  candleTime: number;
  label: string;
  totalVolume: number;
  pocPrice: number;
  maxLevelVol?: number;
  levels: Record<number, ClusterLevel>;
}

export const ScalperDOMWidget: React.FC<ScalperDOMWidgetProps> = ({
  symbol,
  baseAsset,
  quoteAsset,
  exchange,
  marketType,
  currentPrice: propPrice,
  priceChange24h = 0,
  initialTimeframe = '5m',
  initialCompression = 1,
  initialDepth = 'all',
  initialDensityThreshold = 100000, // $100K default
  initialBubbleThreshold = 1000, // $1K default
  initialSoundAlert = true,
  onUpdateSettings,
  height,
  domHeightPreset = 'lg',
  onDomHeightPresetChange,
  onToggleView,
}) => {
  // DOM settings state
  const [clusterTf, setClusterTf] = useState<Timeframe>(initialTimeframe);
  const [compression, setCompression] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('scalper_dom_compression');
      if (saved && !isNaN(Number(saved))) return Number(saved);
    } catch {}
    return 10; // default x10
  });
  const [depthPreset, setDepthPreset] = useState<'all' | 'deep' | 'medium' | 'small'>(() => {
    try {
      const saved = localStorage.getItem('scalper_dom_depth_preset');
      if (saved && ['all', 'deep', 'medium', 'small'].includes(saved)) {
        return saved as any;
      }
    } catch {}
    return 'medium'; // default 100 levels
  });
  const [densityThresholdUsd, setDensityThresholdUsd] = useState<number>(() => {
    const saved = localStorage.getItem('scalper_dom_density_threshold');
    if (saved && !isNaN(Number(saved)) && Number(saved) > 0) return Number(saved);
    return 500000; // default 500k
  });
  const [bubbleThresholdUsd, setBubbleThresholdUsd] = useState<number>(() => {
    const saved = localStorage.getItem('scalper_dom_bubble_threshold');
    if (saved !== null && !isNaN(Number(saved))) return Number(saved);
    return 5000; // default 5k
  });
  const [soundAlertEnabled, setSoundAlertEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('scalper_dom_sound_alert');
      if (saved !== null) return saved === 'true';
    } catch {}
    return false; // default false
  });
  const [autoCenterEnabled, setAutoCenterEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('scalper_dom_auto_center');
      if (saved !== null) return saved === 'true';
    } catch {}
    return true; // default true
  });

  // Settings popover toggle
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTfDropdownOpen, setIsTfDropdownOpen] = useState(false);
  const [isCompressionDropdownOpen, setIsCompressionDropdownOpen] = useState(false);

  // Collapsible trades tape (стрічка) state
  const [isTapeCollapsed, setIsTapeCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('scalper_dom_tape_collapsed');
      if (saved !== null) return saved === 'true';
    } catch {}
    return false;
  });

  // Collapsible cluster footprint history state (ALWAYS active by default on all devices)
  const [showClusters, setShowClusters] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('scalper_dom_show_clusters_v2');
      if (saved !== null) return saved === 'true';
    } catch {}
    return true;
  });

  // Collapsible presets on mobile screens
  const [isPresetsCollapsed, setIsPresetsCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      return true;
    }
    return false;
  });

  const handleToggleTape = useCallback(() => {
    setIsTapeCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('scalper_dom_tape_collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  const handleToggleClusters = useCallback(() => {
    setShowClusters((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('scalper_dom_show_clusters_v2', String(next));
      } catch {}
      return next;
    });
  }, []);

  // Live orderbook state (persistent full book maintained in memory)
  const bidsBookRef = useRef<Map<number, number>>(new Map());
  const asksBookRef = useRef<Map<number, number>>(new Map());
  const flushPendingRef = useRef<boolean>(false);

  const [rawBids, setRawBids] = useState<[number, number][]>([]);
  const [rawAsks, setRawAsks] = useState<[number, number][]>([]);
  const [livePrice, setLivePrice] = useState<number>(propPrice || 0);
  const [latencyMs, setLatencyMs] = useState<number>(38);
  const [localChangePct, setLocalChangePct] = useState<number>(-0.06);

  // Live trades tape
  const [trades, setTrades] = useState<RecentTrade[]>([]);

  // Cluster history state (initialized with ready footprint columns so it never flashes empty)
  const [clusters, setClusters] = useState<ClusterColumn[]>(() => {
    const now = Math.floor(Date.now() / 1000);
    const baseP = propPrice || 83000;
    return [3, 2, 1, 0].map((offset) => {
      const time = now - offset * 300;
      const date = new Date(time * 1000);
      const label = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      const levels: Record<number, ClusterLevel> = {};
      const step = baseP > 1000 ? 5 : 0.05;
      let maxVol = 0;
      for (let i = 0; i < 16; i++) {
        const p = Number((baseP - 40 * (step / 5) + i * step).toFixed(2));
        const buy = Math.round(160000 + (i % 5) * 90000);
        const sell = Math.round(130000 + (i % 4) * 70000);
        const tot = buy + sell;
        if (tot > maxVol) maxVol = tot;
        levels[p] = {
          price: p,
          buyVol: buy,
          sellVol: sell,
          totalVol: tot,
          isPOC: i === 8,
        };
      }
      return {
        candleTime: time,
        label,
        totalVolume: 4320000,
        pocPrice: Number(baseP.toFixed(2)),
        maxLevelVol: maxVol,
        levels,
      };
    });
  });

  // Selected trade preset size
  const [selectedPreset, setSelectedPreset] = useState<string>('$751');

  // Density sound alert tracking to prevent duplicates
  const alertedLevelsRef = useRef<Set<number>>(new Set());

  // Container ref for auto-centering
  const domScrollContainerRef = useRef<HTMLDivElement>(null);
  const spreadRowRef = useRef<HTMLDivElement>(null);

  // Clean symbol string
  const cleanSymbol = useMemo(() => symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(), [symbol]);

  // Max levels based on depth preset
  const depthLevelCount = useMemo(() => {
    switch (depthPreset) {
      case 'small': return 50;
      case 'medium': return 100;
      case 'deep': return 250;
      case 'all': return 999999;
      default: return 999999;
    }
  }, [depthPreset]);

  // Compute base tick size based on price
  const baseTickSize = useMemo(() => {
    const p = livePrice || propPrice || 1;
    if (p >= 1000) return 0.1;
    if (p >= 100) return 0.01;
    if (p >= 1) return 0.001;
    if (p >= 0.1) return 0.0001;
    if (p >= 0.01) return 0.00001;
    return 0.000001;
  }, [livePrice, propPrice]);

  const effectiveStep = useMemo(() => {
    return baseTickSize * compression;
  }, [baseTickSize, compression]);

  // --- EXCHANGE TRADING & REAL ORDERS INTEGRATION ---
  const { profile } = useAuth();
  const [exchangeCreds, setExchangeCreds] = useState<ExchangeApiCredentials | null>(() => {
    return profile?.exchangeApiKeys?.[exchange] || getLocalExchangeCredentials(exchange);
  });

  // Re-sync credentials on profile updates, exchange switch, or event
  useEffect(() => {
    const handleSyncCreds = () => {
      const creds = profile?.exchangeApiKeys?.[exchange] || getLocalExchangeCredentials(exchange);
      setExchangeCreds(creds || null);
    };
    handleSyncCreds();
    window.addEventListener('exchange_credentials_updated', handleSyncCreds);
    return () => window.removeEventListener('exchange_credentials_updated', handleSyncCreds);
  }, [profile, exchange]);

  const hasExchangeApi = Boolean(exchangeCreds?.apiKey && exchangeCreds?.apiSecret && exchangeCreds?.enabled !== false);

  // Account balance state
  const [accountBalance, setAccountBalance] = useState<AccountBalanceInfo | null>(null);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!exchangeCreds?.apiKey || !exchangeCreds?.apiSecret) return;
    setIsRefreshingBalance(true);
    try {
      const res = await testExchangeApiKeys(exchangeCreds);
      if (res.success && res.balance) {
        setAccountBalance(res.balance);
      }
    } catch {}
    finally {
      setIsRefreshingBalance(false);
    }
  }, [exchangeCreds]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // Open Orders for cleanSymbol
  const [openOrders, setOpenOrders] = useState<PlacedOrder[]>([]);

  const fetchOrders = useCallback(async () => {
    if (!exchangeCreds?.apiKey || !exchangeCreds?.apiSecret) return;
    try {
      const res = await getExchangeOpenOrders(exchangeCreds, cleanSymbol);
      if (res.success && Array.isArray(res.orders)) {
        setOpenOrders(res.orders);
      }
    } catch {}
  }, [exchangeCreds, cleanSymbol]);

  useEffect(() => {
    fetchOrders();
    const timer = setInterval(fetchOrders, 5000);
    return () => clearInterval(timer);
  }, [fetchOrders]);

  // Trading panel open/close
  const [isTradePanelOpen, setIsTradePanelOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('scalper_dom_trading_open') !== 'false';
    } catch {
      return true;
    }
  });

  const handleToggleTradePanel = useCallback(() => {
    setIsTradePanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('scalper_dom_trading_open', String(next));
      } catch {}
      return next;
    });
  }, []);

  // Order configuration
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [orderPrice, setOrderPrice] = useState<string>('');
  const [orderStopPrice, setOrderStopPrice] = useState<string>('');
  const [orderUnit, setOrderUnit] = useState<'usdt' | 'coin'>('usdt');
  const [orderAmountUsdt, setOrderAmountUsdt] = useState<string>('50');
  const [orderAmountCoin, setOrderAmountCoin] = useState<string>('');
  const [reduceOnly, setReduceOnly] = useState<boolean>(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState<boolean>(false);
  const [tradeToast, setTradeToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [openOrdersOpen, setOpenOrdersOpen] = useState<boolean>(false);

  // Auto-dismiss trade toast
  useEffect(() => {
    if (tradeToast) {
      const t = setTimeout(() => setTradeToast(null), 4500);
      return () => clearTimeout(t);
    }
  }, [tradeToast]);

  // Pre-fill price when livePrice first loads
  useEffect(() => {
    if (livePrice > 0 && !orderPrice) {
      setOrderPrice(livePrice.toString());
    }
  }, [livePrice, orderPrice]);

  // Calculate quantities
  const calculatedQty = useMemo(() => {
    const p = (orderPrice ? parseFloat(orderPrice) : livePrice) || 1;
    if (orderUnit === 'usdt') {
      const usdt = parseFloat(orderAmountUsdt || '0');
      return formatOrderQty(usdt / p, p);
    } else {
      return formatOrderQty(parseFloat(orderAmountCoin || '0'), p);
    }
  }, [orderUnit, orderAmountUsdt, orderAmountCoin, orderPrice, livePrice]);

  const calculatedUsdTotal = useMemo(() => {
    const p = (orderPrice ? parseFloat(orderPrice) : livePrice) || 0;
    if (orderUnit === 'usdt') {
      return parseFloat(orderAmountUsdt || '0');
    } else {
      return (parseFloat(orderAmountCoin || '0') || 0) * p;
    }
  }, [orderUnit, orderAmountUsdt, orderAmountCoin, orderPrice, livePrice]);

  const handlePlaceOrder = async (side: OrderSide, forcedType?: OrderType) => {
    if (!exchangeCreds?.apiKey || !exchangeCreds?.apiSecret) {
      setTradeToast({
        type: 'error',
        message: `API біржі ${exchange.toUpperCase()} не підключено! Відкрийте налаштування профілю для додавання ключів.`,
      });
      window.dispatchEvent(new CustomEvent('open_user_profile_modal', { detail: { tab: 'exchange_api' } }));
      return;
    }

    const type = forcedType || orderType;
    const p = orderPrice ? parseFloat(orderPrice) : livePrice;
    const stopP = orderStopPrice ? parseFloat(orderStopPrice) : undefined;
    const qty = calculatedQty;

    if (qty <= 0) {
      setTradeToast({ type: 'error', message: 'Вкажіть коректний об’єм заявки (USDT або монети) > 0' });
      return;
    }

    if ((type === 'LIMIT' || type === 'STOP' || type === 'TAKE_PROFIT') && (!p || p <= 0)) {
      setTradeToast({ type: 'error', message: 'Вкажіть ціну для лімітної заявки' });
      return;
    }

    if ((type === 'STOP_MARKET' || type === 'STOP' || type === 'TAKE_PROFIT_MARKET' || type === 'TAKE_PROFIT') && (!stopP || stopP <= 0)) {
      setTradeToast({ type: 'error', message: 'Вкажіть тригерну стоп-ціну (stopPrice) для спрацювання заявки' });
      return;
    }

    setIsSubmittingOrder(true);
    try {
      const res = await submitExchangeOrder(exchangeCreds, {
        symbol: cleanSymbol,
        side,
        type,
        quantity: qty,
        price: (type === 'LIMIT' || type === 'STOP' || type === 'TAKE_PROFIT') ? p : undefined,
        stopPrice: stopP,
        reduceOnly,
      });

      if (res.success) {
        setTradeToast({
          type: 'success',
          message: res.message || `Заявку ${side} успішно виставлено!`,
        });
        fetchOrders();
        fetchBalance();
      } else {
        setTradeToast({
          type: 'error',
          message: res.message || 'Помилка виконання ордера',
        });
      }
    } catch (err: any) {
      setTradeToast({
        type: 'error',
        message: err?.message || 'Помилка виставлення ордера',
      });
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!exchangeCreds) return;
    try {
      const res = await cancelExchangeOrderById(exchangeCreds, cleanSymbol, orderId);
      if (res.success) {
        setTradeToast({ type: 'info', message: res.message });
        setOpenOrders((prev) => prev.filter((o) => o.orderId !== orderId));
        fetchBalance();
      } else {
        setTradeToast({ type: 'error', message: res.message });
      }
    } catch (err: any) {
      setTradeToast({ type: 'error', message: err?.message || 'Помилка скасування заявки' });
    }
  };

  const handleCancelAllOrders = async () => {
    if (!exchangeCreds || openOrders.length === 0) return;
    try {
      const res = await cancelAllExchangeOrdersForSymbol(exchangeCreds, cleanSymbol);
      if (res.success) {
        setTradeToast({ type: 'info', message: res.message });
        setOpenOrders([]);
        fetchBalance();
      } else {
        setTradeToast({ type: 'error', message: res.message });
      }
    } catch (err: any) {
      setTradeToast({ type: 'error', message: err?.message || 'Помилка скасування всіх заявок' });
    }
  };

  // DOM Order Mode: 'LIMIT' (regular limit) or 'STOP' (stop breakout/stop loss)
  const [domOrderMode, setDomOrderMode] = useState<'LIMIT' | 'STOP'>('LIMIT');

  // Dedicated Stop Order Modal State
  const [isStopModalOpen, setIsStopModalOpen] = useState<boolean>(false);
  const [stopModalSide, setStopModalSide] = useState<OrderSide>('BUY');
  const [stopModalType, setStopModalType] = useState<'STOP_MARKET' | 'STOP'>('STOP_MARKET');
  const [stopModalTriggerPrice, setStopModalTriggerPrice] = useState<string>('');
  const [stopModalLimitPrice, setStopModalLimitPrice] = useState<string>('');
  const [stopModalAmountUsdt, setStopModalAmountUsdt] = useState<string>('50');
  const [stopModalReduceOnly, setStopModalReduceOnly] = useState<boolean>(false);

  // Swipe & Direct DOM Order Placement State
  const [swipingRow, setSwipingRow] = useState<{
    price: number;
    startX: number;
    startY: number;
    deltaX: number;
    isMouse?: boolean;
  } | null>(null);

  // TP/SL Management State for Orders
  const [expandedTpSlOrderId, setExpandedTpSlOrderId] = useState<string | null>(null);
  const [tpSlCustomValues, setTpSlCustomValues] = useState<
    Record<string, { tpPrice?: string; slPrice?: string; tpPct?: number; slPct?: number }>
  >({});

  // Direct DOM Limit Order Placement (Swipe or Click)
  const placeDirectDomLimitOrder = useCallback(
    async (price: number, side: OrderSide) => {
      const p = price > 0 ? price : livePrice;
      const calculatedAmt = parseFloat(orderAmountUsdt || '50');
      const baseQty = calculatedQty > 0 ? calculatedQty : formatOrderQty(calculatedAmt / p, p);
      const qty = baseQty > 0 ? baseQty : 0.001;

      if (!exchangeCreds?.apiKey || !exchangeCreds?.apiSecret) {
        // Local simulated order for immediate interactive testing and demo
        const simOrder: PlacedOrder = {
          orderId: `sim_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          symbol: cleanSymbol,
          exchange,
          marketType,
          side,
          type: 'LIMIT',
          price: p,
          origQty: qty,
          executedQty: 0,
          status: 'NEW',
          time: Date.now(),
        };
        setOpenOrders((prev) => [simOrder, ...prev]);
        setOpenOrdersOpen(true);
        setTradeToast({
          type: 'success',
          message: `Лімітну заявку ${side === 'BUY' ? 'LONG ▲' : 'SHORT ▼'} на $${formatCryptoPrice(p)} (${qty} ${baseAsset}) виставлено в стакані!`,
        });
        return;
      }

      setIsSubmittingOrder(true);
      try {
        const res = await submitExchangeOrder(exchangeCreds, {
          symbol: cleanSymbol,
          side,
          type: 'LIMIT',
          quantity: qty,
          price: p,
        });

        if (res.success) {
          setTradeToast({
            type: 'success',
            message: res.message || `Лімітну заявку ${side === 'BUY' ? 'LONG ▲' : 'SHORT ▼'} на $${formatCryptoPrice(p)} успішно виставлено!`,
          });
          fetchOrders();
          fetchBalance();
          setOpenOrdersOpen(true);
        } else {
          setTradeToast({
            type: 'error',
            message: res.message || 'Помилка виставлення ордера',
          });
        }
      } catch (err: any) {
        setTradeToast({
          type: 'error',
          message: err?.message || 'Помилка виставлення ордера',
        });
      } finally {
        setIsSubmittingOrder(false);
      }
    },
    [calculatedQty, orderAmountUsdt, livePrice, exchangeCreds, cleanSymbol, exchange, marketType, baseAsset, fetchOrders, fetchBalance]
  );

  // Direct DOM Stop Order Placement
  const placeDirectDomStopOrder = useCallback(
    async (price: number, side: OrderSide) => {
      const p = price > 0 ? price : livePrice;
      const calculatedAmt = parseFloat(orderAmountUsdt || '50');
      const baseQty = calculatedQty > 0 ? calculatedQty : formatOrderQty(calculatedAmt / p, p);
      const qty = baseQty > 0 ? baseQty : 0.001;

      if (!exchangeCreds?.apiKey || !exchangeCreds?.apiSecret) {
        // Local simulated stop order for immediate interactive testing and demo
        const simOrder: PlacedOrder = {
          orderId: `sim_stop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          symbol: cleanSymbol,
          exchange,
          marketType,
          side,
          type: 'STOP_MARKET',
          stopPrice: p,
          price: p,
          origQty: qty,
          executedQty: 0,
          status: 'NEW',
          time: Date.now(),
        };
        setOpenOrders((prev) => [simOrder, ...prev]);
        setOpenOrdersOpen(true);
        setTradeToast({
          type: 'success',
          message: `Стоп-заявку (STOP ${side === 'BUY' ? 'BUY ▲' : 'SELL ▼'}) тригер $${formatCryptoPrice(p)} (${qty} ${baseAsset}) виставлено на шкалі стакану!`,
        });
        return;
      }

      setIsSubmittingOrder(true);
      try {
        const res = await submitExchangeOrder(exchangeCreds, {
          symbol: cleanSymbol,
          side,
          type: 'STOP_MARKET',
          quantity: qty,
          stopPrice: p,
        });

        if (res.success) {
          setTradeToast({
            type: 'success',
            message: res.message || `Стоп-заявку ${side} на $${formatCryptoPrice(p)} успішно виставлено!`,
          });
          fetchOrders();
          fetchBalance();
          setOpenOrdersOpen(true);
        } else {
          setTradeToast({
            type: 'error',
            message: res.message || 'Помилка виставлення стоп-заявки',
          });
        }
      } catch (err: any) {
        setTradeToast({
          type: 'error',
          message: err?.message || 'Помилка виставлення стоп-заявки',
        });
      } finally {
        setIsSubmittingOrder(false);
      }
    },
    [calculatedQty, orderAmountUsdt, livePrice, exchangeCreds, cleanSymbol, exchange, marketType, baseAsset, fetchOrders, fetchBalance]
  );

  // Open Stop Order Dialog Helper
  const openStopOrderDialog = useCallback(
    (initialPrice?: number, initialSide?: OrderSide) => {
      const p = initialPrice && initialPrice > 0 ? initialPrice : livePrice;
      const formattedP = p > 0 ? p.toString() : '';
      setStopModalTriggerPrice(formattedP);
      setStopModalLimitPrice(formattedP);
      if (initialSide) {
        setStopModalSide(initialSide);
      } else {
        setStopModalSide(p >= livePrice ? 'BUY' : 'SELL');
      }
      setIsStopModalOpen(true);
    },
    [livePrice]
  );

  const stopModalQty = useMemo(() => {
    const trigger = parseFloat(stopModalTriggerPrice || '0') || livePrice || 1;
    const usdt = parseFloat(stopModalAmountUsdt || '0');
    return formatOrderQty(usdt / trigger, trigger);
  }, [stopModalTriggerPrice, stopModalAmountUsdt, livePrice]);

  const handleExecuteStopModalOrder = useCallback(async () => {
    const triggerP = parseFloat(stopModalTriggerPrice);
    if (!triggerP || triggerP <= 0) {
      setTradeToast({ type: 'error', message: 'Вкажіть коректну тригерну стоп-ціну (stopPrice)' });
      return;
    }
    const limitP = stopModalType === 'STOP' ? parseFloat(stopModalLimitPrice) : undefined;
    if (stopModalType === 'STOP' && (!limitP || limitP <= 0)) {
      setTradeToast({ type: 'error', message: 'Для стоп-лімітної заявки вкажіть ціну виконання (limitPrice)' });
      return;
    }

    const calculatedAmt = parseFloat(stopModalAmountUsdt || '50');
    const baseQty = stopModalQty > 0 ? stopModalQty : formatOrderQty(calculatedAmt / triggerP, triggerP);
    const qty = baseQty > 0 ? baseQty : 0.001;

    setIsSubmittingOrder(true);
    try {
      if (!exchangeCreds?.apiKey || !exchangeCreds?.apiSecret) {
        const simOrder: PlacedOrder = {
          orderId: `sim_stop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          symbol: cleanSymbol,
          exchange,
          marketType,
          side: stopModalSide,
          type: stopModalType,
          stopPrice: triggerP,
          price: limitP || triggerP,
          origQty: qty,
          executedQty: 0,
          status: 'NEW',
          time: Date.now(),
        };
        setOpenOrders((prev) => [simOrder, ...prev]);
        setOpenOrdersOpen(true);
        setIsStopModalOpen(false);
        setTradeToast({
          type: 'success',
          message: `Стоп-заявку (${stopModalSide === 'BUY' ? 'STOP BUY ▲' : 'STOP SELL ▼'}) на $${formatCryptoPrice(triggerP)} (${qty} ${baseAsset}) виставлено на шкалі стакану!`,
        });
        return;
      }

      const res = await submitExchangeOrder(exchangeCreds, {
        symbol: cleanSymbol,
        side: stopModalSide,
        type: stopModalType,
        quantity: qty,
        stopPrice: triggerP,
        price: limitP,
        reduceOnly: stopModalReduceOnly,
      });

      if (res.success) {
        setTradeToast({
          type: 'success',
          message: res.message || `Стоп-заявку (${stopModalSide}) на $${formatCryptoPrice(triggerP)} успішно виставлено!`,
        });
        setIsStopModalOpen(false);
        fetchOrders();
        fetchBalance();
        setOpenOrdersOpen(true);
      } else {
        setTradeToast({
          type: 'error',
          message: res.message || 'Помилка виставлення стоп-заявки',
        });
      }
    } catch (err: any) {
      setTradeToast({
        type: 'error',
        message: err?.message || 'Помилка виставлення стоп-заявки',
      });
    } finally {
      setIsSubmittingOrder(false);
    }
  }, [
    stopModalTriggerPrice,
    stopModalType,
    stopModalLimitPrice,
    stopModalAmountUsdt,
    stopModalQty,
    stopModalSide,
    stopModalReduceOnly,
    exchangeCreds,
    cleanSymbol,
    exchange,
    marketType,
    baseAsset,
    fetchOrders,
    fetchBalance,
  ]);

  // TP / SL Placement for an active order
  const handleSetTpSlForOrder = useCallback(
    async (ord: PlacedOrder, targetTpPrice?: number, targetSlPrice?: number) => {
      const isLong = ord.side === 'BUY';
      const closeSide: OrderSide = isLong ? 'SELL' : 'BUY';
      const qty = ord.origQty;

      let successCount = 0;

      // 1. Take Profit
      if (targetTpPrice && targetTpPrice > 0) {
        if (!exchangeCreds?.apiKey || !exchangeCreds?.apiSecret) {
          const simTp: PlacedOrder = {
            orderId: `sim_tp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            symbol: cleanSymbol,
            exchange,
            marketType,
            side: closeSide,
            type: 'TAKE_PROFIT_MARKET',
            price: targetTpPrice,
            stopPrice: targetTpPrice,
            origQty: qty,
            executedQty: 0,
            status: 'NEW',
            time: Date.now(),
          };
          setOpenOrders((prev) => [simTp, ...prev]);
          successCount++;
        } else {
          try {
            const res = await submitExchangeOrder(exchangeCreds, {
              symbol: cleanSymbol,
              side: closeSide,
              type: 'TAKE_PROFIT_MARKET',
              quantity: qty,
              stopPrice: targetTpPrice,
              reduceOnly: true,
            });
            if (res.success) successCount++;
          } catch {}
        }
      }

      // 2. Stop Loss
      if (targetSlPrice && targetSlPrice > 0) {
        if (!exchangeCreds?.apiKey || !exchangeCreds?.apiSecret) {
          const simSl: PlacedOrder = {
            orderId: `sim_sl_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            symbol: cleanSymbol,
            exchange,
            marketType,
            side: closeSide,
            type: 'STOP_MARKET',
            price: targetSlPrice,
            stopPrice: targetSlPrice,
            origQty: qty,
            executedQty: 0,
            status: 'NEW',
            time: Date.now(),
          };
          setOpenOrders((prev) => [simSl, ...prev]);
          successCount++;
        } else {
          try {
            const res = await submitExchangeOrder(exchangeCreds, {
              symbol: cleanSymbol,
              side: closeSide,
              type: 'STOP_MARKET',
              quantity: qty,
              stopPrice: targetSlPrice,
              reduceOnly: true,
            });
            if (res.success) successCount++;
          } catch {}
        }
      }

      if (successCount > 0) {
        setTradeToast({
          type: 'success',
          message: `TP / SL успішно виставлено для ордера ${ord.side} (${qty} ${baseAsset})!`,
        });
        fetchOrders();
        fetchBalance();
        setExpandedTpSlOrderId(null);
      } else {
        setTradeToast({
          type: 'error',
          message: 'Вкажіть коректні рівні TP або SL для ордера',
        });
      }
    },
    [exchangeCreds, cleanSymbol, exchange, marketType, baseAsset, fetchOrders, fetchBalance]
  );

  // Swipe Gestures for DOM Rows
  const handleTouchStartRow = (e: React.TouchEvent, price: number) => {
    const touch = e.touches[0];
    setSwipingRow({
      price,
      startX: touch.clientX,
      startY: touch.clientY,
      deltaX: 0,
      isMouse: false,
    });
  };

  const handleTouchMoveRow = (e: React.TouchEvent, price: number) => {
    if (!swipingRow || swipingRow.price !== price) return;
    const touch = e.touches[0];
    const dx = touch.clientX - swipingRow.startX;
    const dy = touch.clientY - swipingRow.startY;

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      setSwipingRow((prev) => (prev ? { ...prev, deltaX: dx } : null));
    }
  };

  const handleTouchEndRow = (_e: React.TouchEvent, price: number) => {
    if (swipingRow && swipingRow.price === price) {
      if (swipingRow.deltaX >= 40) {
        if (domOrderMode === 'STOP') {
          placeDirectDomStopOrder(price, 'BUY');
        } else {
          placeDirectDomLimitOrder(price, 'BUY');
        }
      } else if (swipingRow.deltaX <= -40) {
        if (domOrderMode === 'STOP') {
          placeDirectDomStopOrder(price, 'SELL');
        } else {
          placeDirectDomLimitOrder(price, 'SELL');
        }
      }
    }
    setSwipingRow(null);
  };

  const handleMouseDownRow = (e: React.MouseEvent, price: number) => {
    if (e.button !== 0) return;
    setSwipingRow({
      price,
      startX: e.clientX,
      startY: e.clientY,
      deltaX: 0,
      isMouse: true,
    });
  };

  const handleMouseMoveRow = (e: React.MouseEvent, price: number) => {
    if (!swipingRow || !swipingRow.isMouse || swipingRow.price !== price) return;
    const dx = e.clientX - swipingRow.startX;
    setSwipingRow((prev) => (prev ? { ...prev, deltaX: dx } : null));
  };

  const handleMouseUpRow = (_e: React.MouseEvent, price: number) => {
    if (swipingRow && swipingRow.isMouse && swipingRow.price === price) {
      if (swipingRow.deltaX >= 40) {
        if (domOrderMode === 'STOP') {
          placeDirectDomStopOrder(price, 'BUY');
        } else {
          placeDirectDomLimitOrder(price, 'BUY');
        }
      } else if (swipingRow.deltaX <= -40) {
        if (domOrderMode === 'STOP') {
          placeDirectDomStopOrder(price, 'SELL');
        } else {
          placeDirectDomLimitOrder(price, 'SELL');
        }
      }
    }
    setSwipingRow(null);
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setSwipingRow((prev) => {
        if (prev?.isMouse) {
          if (prev.deltaX >= 40) {
            if (domOrderMode === 'STOP') {
              placeDirectDomStopOrder(prev.price, 'BUY');
            } else {
              placeDirectDomLimitOrder(prev.price, 'BUY');
            }
          } else if (prev.deltaX <= -40) {
            if (domOrderMode === 'STOP') {
              placeDirectDomStopOrder(prev.price, 'SELL');
            } else {
              placeDirectDomLimitOrder(prev.price, 'SELL');
            }
          }
          return null;
        }
        return prev;
      });
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [domOrderMode, placeDirectDomLimitOrder, placeDirectDomStopOrder]);

  const handleClickAskRow = (price: number) => {
    setOrderPrice(price.toString());
    if (orderType === 'STOP_MARKET' || orderType === 'TAKE_PROFIT_MARKET') {
      setOrderStopPrice(price.toString());
    }
  };

  const handleClickBidRow = (price: number) => {
    setOrderPrice(price.toString());
    if (orderType === 'STOP_MARKET' || orderType === 'TAKE_PROFIT_MARKET') {
      setOrderStopPrice(price.toString());
    }
  };

  const getOrdersMatchingPrice = useCallback((price: number) => {
    if (openOrders.length === 0) return [];
    const halfStep = Math.max((effectiveStep || 0.01) * 0.55, price * 0.00025);
    return openOrders.filter((o) => {
      const isStop = o.type.startsWith('STOP') || o.type.startsWith('TAKE_PROFIT');
      const target = isStop && o.stopPrice ? o.stopPrice : (o.price || o.stopPrice || 0);
      return target > 0 && Math.abs(target - price) <= halfStep;
    });
  }, [openOrders, effectiveStep]);

  // Flush in-memory map to react state (throttled via requestAnimationFrame)
  const scheduleBookFlush = useCallback(() => {
    if (flushPendingRef.current) return;
    flushPendingRef.current = true;
    requestAnimationFrame(() => {
      flushPendingRef.current = false;
      const sortedBids = Array.from(bidsBookRef.current.entries())
        .filter(([, q]) => q > 0)
        .sort((a, b) => b[0] - a[0]); // Bids descending (highest near spread)

      const sortedAsks = Array.from(asksBookRef.current.entries())
        .filter(([, q]) => q > 0)
        .sort((a, b) => a[0] - b[0]); // Asks ascending (lowest near spread)

      setRawBids(sortedBids);
      setRawAsks(sortedAsks);

      if (sortedBids[0] && sortedAsks[0]) {
        const mid = (sortedBids[0][0] + sortedAsks[0][0]) / 2;
        setLivePrice(mid);
      }
    });
  }, []);

  // 1. Initial snapshot fetch via REST proxy (full depth 500+ orders)
  useEffect(() => {
    let isMounted = true;
    bidsBookRef.current.clear();
    asksBookRef.current.clear();

    const fetchSnapshot = async () => {
      try {
        const start = Date.now();
        const res = await fetch(
          `/api/orderbook?symbol=${cleanSymbol}&exchange=${exchange}&marketType=${marketType}&limit=500`
        );
        const elapsed = Math.max(10, Date.now() - start);
        if (isMounted) setLatencyMs(elapsed);

        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data.success && Array.isArray(data.bids) && Array.isArray(data.asks)) {
          data.bids.forEach(([p, q]: [number, number]) => {
            if (q > 0) bidsBookRef.current.set(p, q);
            else bidsBookRef.current.delete(p);
          });
          data.asks.forEach(([p, q]: [number, number]) => {
            if (q > 0) asksBookRef.current.set(p, q);
            else asksBookRef.current.delete(p);
          });
          scheduleBookFlush();
        }
      } catch (err) {
        console.warn('DOM snapshot fetch error:', err);
      }
    };

    fetchSnapshot();
    const interval = setInterval(fetchSnapshot, 3000); // Polling sync to ensure zero drift

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [cleanSymbol, exchange, marketType, scheduleBookFlush]);

  // 1b. Fetch recent trades snapshot on mount & periodic sync
  useEffect(() => {
    let isMounted = true;

    const fetchTradesSnapshot = async () => {
      try {
        const res = await fetch(
          `/api/trades?symbol=${cleanSymbol}&exchange=${exchange}&marketType=${marketType}&limit=60`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data.success && Array.isArray(data.trades) && data.trades.length > 0) {
          setTrades((prev) => {
            const existingIds = new Set(prev.map((t) => t.id));
            const newOnes = data.trades.filter((t: RecentTrade) => !existingIds.has(t.id));
            if (newOnes.length === 0) return prev;
            return [...newOnes, ...prev].slice(0, 150);
          });
        }
      } catch (err) {
        console.warn('Trades fetch error:', err);
      }
    };

    fetchTradesSnapshot();
    const interval = setInterval(fetchTradesSnapshot, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [cleanSymbol, exchange, marketType]);

  // 2. Fetch Klines for Cluster History
  useEffect(() => {
    let isMounted = true;
    const fetchClusters = async () => {
      try {
        const res = await fetch(
          `/api/klines?symbol=${cleanSymbol}&exchange=${exchange}&market=${marketType}&timeframe=${clusterTf}&limit=5`
        );
        if (!res.ok) return;
        const json = await res.json();
        const klines = json.data;
        if (!isMounted || !Array.isArray(klines) || klines.length === 0) return;

        // Generate footprint clusters from klines
        const newClusters: ClusterColumn[] = klines.slice(-4).map((k: any) => {
          const high = k.high;
          const low = k.low;
          const open = k.open;
          const close = k.close;
          // Calculate realistic USD volume (k.volume is base coin e.g. BTC, ETH)
          const rawVol = Number(k.volume) || 0;
          const totalVol = rawVol * close;

          const levels: Record<number, ClusterLevel> = {};
          const stepsCount = 16;
          const step = (high - low) / (stepsCount || 1);

          let maxVol = 0;
          let pocP = close;

          for (let i = 0; i < stepsCount; i++) {
            const priceLevel = Number((low + i * step).toFixed(5));
            // Realistic volume distribution (bell-curve around middle)
            const distFromMid = Math.abs(i - stepsCount / 2) / (stepsCount / 2);
            const levelVol = (totalVol / stepsCount) * (1.5 - distFromMid * 0.9);
            const isBullish = close >= open;
            const buyVol = isBullish ? levelVol * 0.58 : levelVol * 0.42;
            const sellVol = levelVol - buyVol;

            if (levelVol > maxVol) {
              maxVol = levelVol;
              pocP = priceLevel;
            }

            levels[priceLevel] = {
              price: priceLevel,
              buyVol,
              sellVol,
              totalVol: levelVol,
              isPOC: false,
            };
          }

          if (levels[pocP]) {
            levels[pocP].isPOC = true;
          }

          const date = new Date(k.time * 1000);
          const timeLabel = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

          return {
            candleTime: k.time,
            label: timeLabel,
            totalVolume: totalVol,
            pocPrice: pocP,
            maxLevelVol: maxVol,
            levels,
          };
        });

        setClusters(newClusters);
      } catch (e) {
        console.warn('Failed to load clusters:', e);
      }
    };

    fetchClusters();
    const interval = setInterval(fetchClusters, 10000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [cleanSymbol, exchange, marketType, clusterTf]);

  // 3. Connect to live Binance/Bybit WebSocket for instant real depth & trades
  useEffect(() => {
    let ws: WebSocket | null = null;
    let isSubscribed = true;

    try {
      if (exchange === 'bybit') {
        const bybitCategory = marketType === 'futures' ? 'linear' : 'spot';
        const wsUrl = `wss://stream.bybit.com/v5/public/${bybitCategory}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (!isSubscribed) return;
          try {
            ws?.send(
              JSON.stringify({
                op: 'subscribe',
                args: [`orderbook.200.${cleanSymbol}`, `publicTrade.${cleanSymbol}`],
              })
            );
          } catch {}
        };

        ws.onmessage = (event) => {
          if (!isSubscribed) return;
          try {
            const json = JSON.parse(event.data);
            const topic = json.topic || '';
            const data = json.data;

            if (topic.startsWith('orderbook') && data) {
              if (json.type === 'snapshot') {
                bidsBookRef.current.clear();
                asksBookRef.current.clear();
                (data.b || []).forEach(([pStr, qStr]: [string, string]) => {
                  const p = parseFloat(pStr);
                  const q = parseFloat(qStr);
                  if (q > 0) bidsBookRef.current.set(p, q);
                });
                (data.a || []).forEach(([pStr, qStr]: [string, string]) => {
                  const p = parseFloat(pStr);
                  const q = parseFloat(qStr);
                  if (q > 0) asksBookRef.current.set(p, q);
                });
              } else {
                // Delta update: q = 0 means remove level
                (data.b || []).forEach(([pStr, qStr]: [string, string]) => {
                  const p = parseFloat(pStr);
                  const q = parseFloat(qStr);
                  if (q <= 0) bidsBookRef.current.delete(p);
                  else bidsBookRef.current.set(p, q);
                });
                (data.a || []).forEach(([pStr, qStr]: [string, string]) => {
                  const p = parseFloat(pStr);
                  const q = parseFloat(qStr);
                  if (q <= 0) asksBookRef.current.delete(p);
                  else asksBookRef.current.set(p, q);
                });
              }
              scheduleBookFlush();
            } else if (topic.startsWith('publicTrade') && Array.isArray(data)) {
              for (const t of data) {
                const tradePrice = parseFloat(t.p);
                const tradeQty = parseFloat(t.v);
                const isBuyerMaker = t.S === 'Sell';
                const volumeUsd = tradePrice * tradeQty;

                setLivePrice(tradePrice);

                const newTrade: RecentTrade = {
                  id: String(t.i || `${t.T || Date.now()}-${tradePrice}-${tradeQty}`),
                  price: tradePrice,
                  qty: tradeQty,
                  volumeUsd,
                  isBuyerMaker,
                  timestamp: parseInt(t.T, 10) || Date.now(),
                };

                setTrades((prev) => {
                  if (prev.some((p) => p.id === newTrade.id)) return prev;
                  return [newTrade, ...prev].slice(0, 150);
                });
              }
            }
          } catch {}
        };
      } else {
        const lower = cleanSymbol.toLowerCase();
        // Binance real depth stream (all changes) + aggTrade
        const wsUrl = marketType === 'futures'
          ? `wss://fstream.binance.com/stream?streams=${lower}@depth@100ms/${lower}@aggTrade`
          : `wss://stream.binance.com:9443/stream?streams=${lower}@depth@100ms/${lower}@aggTrade`;

        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
          if (!isSubscribed) return;
          try {
            const msg = JSON.parse(event.data);
            const stream = msg.stream || '';
            const data = msg.data || msg;

            if (stream.includes('@depth') || data.e === 'depthUpdate') {
              let hasChanges = false;
              if (Array.isArray(data.b)) {
                data.b.forEach(([pStr, qStr]: [string, string]) => {
                  const p = parseFloat(pStr);
                  const q = parseFloat(qStr);
                  if (q <= 0) bidsBookRef.current.delete(p);
                  else bidsBookRef.current.set(p, q);
                });
                hasChanges = true;
              }
              if (Array.isArray(data.a)) {
                data.a.forEach(([pStr, qStr]: [string, string]) => {
                  const p = parseFloat(pStr);
                  const q = parseFloat(qStr);
                  if (q <= 0) asksBookRef.current.delete(p);
                  else asksBookRef.current.set(p, q);
                });
                hasChanges = true;
              }
              if (hasChanges) {
                scheduleBookFlush();
              }
            } else if (stream.includes('@aggTrade') || data.e === 'aggTrade') {
              const tradePrice = parseFloat(data.p);
              const tradeQty = parseFloat(data.q);
              const isBuyerMaker = !!data.m; // true = sell, false = buy
              const volumeUsd = tradePrice * tradeQty;

              setLivePrice(tradePrice);

              const newTrade: RecentTrade = {
                id: String(data.a || `${data.T || Date.now()}-${tradePrice}-${tradeQty}`),
                price: tradePrice,
                qty: tradeQty,
                volumeUsd,
                isBuyerMaker,
                timestamp: data.T || Date.now(),
              };

              setTrades((prev) => {
                if (prev.some((p) => p.id === newTrade.id)) return prev;
                return [newTrade, ...prev].slice(0, 150);
              });
            }
          } catch (e) {}
        };
      }

      ws.onerror = () => {};
    } catch (e) {}

    return () => {
      isSubscribed = false;
      if (ws) {
        try {
          ws.close();
        } catch (e) {}
      }
    };
  }, [cleanSymbol, marketType, exchange, scheduleBookFlush]);

  // 4. Aggregate Order Book according to Compression (1x - 100x) and Depth
  const { aggregatedAsks, aggregatedBids, maxVolumeUsd, bestAsk, bestBid, spreadUsd, spreadPct, totalRealOrdersCount } = useMemo(() => {
    let asksList: OrderBookRow[] = [];
    let bidsList: OrderBookRow[] = [];

    if (compression === 1) {
      // 1x: Show ALL real orders directly with exact prices and quantities from exchange
      asksList = rawAsks.map(([p, q]) => ({
        price: p,
        qty: q,
        volumeUsd: p * q,
        isAsk: true,
        isDensity: (p * q) >= densityThresholdUsd,
      }));

      bidsList = rawBids.map(([p, q]) => ({
        price: p,
        qty: q,
        volumeUsd: p * q,
        isAsk: false,
        isDensity: (p * q) >= densityThresholdUsd,
      }));

      // Ensure open orders are represented even if no other orders at exact price
      openOrders.forEach((ord) => {
        const targetPrice = (ord.type.startsWith('STOP') || ord.type.startsWith('TAKE_PROFIT')) && ord.stopPrice
          ? ord.stopPrice
          : (ord.price || ord.stopPrice || 0);
        if (targetPrice <= 0) return;
        if (targetPrice >= livePrice && !asksList.some((r) => Math.abs(r.price - targetPrice) < 0.0000001)) {
          asksList.push({
            price: targetPrice,
            qty: 0,
            volumeUsd: 0,
            isAsk: true,
            isDensity: false,
          });
        } else if (targetPrice < livePrice && !bidsList.some((r) => Math.abs(r.price - targetPrice) < 0.0000001)) {
          bidsList.push({
            price: targetPrice,
            qty: 0,
            volumeUsd: 0,
            isAsk: false,
            isDensity: false,
          });
        }
      });

      asksList.sort((a, b) => b.price - a.price); // Highest ask on top, lowest near spread
      bidsList.sort((a, b) => b.price - a.price); // Highest bid near spread, lowest at bottom
    } else {
      // > 1x: Aggregate real orders into price compression buckets (step = baseTickSize * compression)
      const roundToStep = (price: number) => {
        if (effectiveStep <= 0) return price;
        return Number((Math.round(price / effectiveStep) * effectiveStep).toFixed(8));
      };

      const asksMap = new Map<number, { qty: number; volumeUsd: number }>();
      rawAsks.forEach(([p, q]) => {
        const rounded = roundToStep(p);
        const curr = asksMap.get(rounded) || { qty: 0, volumeUsd: 0 };
        asksMap.set(rounded, {
          qty: curr.qty + q,
          volumeUsd: curr.volumeUsd + p * q,
        });
      });

      const bidsMap = new Map<number, { qty: number; volumeUsd: number }>();
      rawBids.forEach(([p, q]) => {
        const rounded = roundToStep(p);
        const curr = bidsMap.get(rounded) || { qty: 0, volumeUsd: 0 };
        bidsMap.set(rounded, {
          qty: curr.qty + q,
          volumeUsd: curr.volumeUsd + p * q,
        });
      });

      // Ensure open orders are represented
      openOrders.forEach((ord) => {
        const targetPrice = (ord.type.startsWith('STOP') || ord.type.startsWith('TAKE_PROFIT')) && ord.stopPrice
          ? ord.stopPrice
          : (ord.price || ord.stopPrice || 0);
        if (targetPrice <= 0) return;
        const rounded = roundToStep(targetPrice);
        if (targetPrice >= livePrice) {
          if (!asksMap.has(rounded)) {
            asksMap.set(rounded, { qty: 0, volumeUsd: 0 });
          }
        } else {
          if (!bidsMap.has(rounded)) {
            bidsMap.set(rounded, { qty: 0, volumeUsd: 0 });
          }
        }
      });

      asksList = Array.from(asksMap.entries())
        .map(([price, val]) => ({
          price,
          qty: val.qty,
          volumeUsd: val.volumeUsd,
          isAsk: true,
          isDensity: val.volumeUsd >= densityThresholdUsd,
        }))
        .sort((a, b) => b.price - a.price);

      bidsList = Array.from(bidsMap.entries())
        .map(([price, val]) => ({
          price,
          qty: val.qty,
          volumeUsd: val.volumeUsd,
          isAsk: false,
          isDensity: val.volumeUsd >= densityThresholdUsd,
        }))
        .sort((a, b) => b.price - a.price);
    }

    // Apply depth preset (if not 'all')
    let finalAsks = depthLevelCount < 99999 ? asksList.slice(-depthLevelCount) : asksList;
    let finalBids = depthLevelCount < 99999 ? bidsList.slice(0, depthLevelCount) : bidsList;

    // Retain rows that have open orders matching so they are always visible on screen
    const openOrderTargets = openOrders.map((o) =>
      (o.type.startsWith('STOP') || o.type.startsWith('TAKE_PROFIT')) && o.stopPrice
        ? o.stopPrice
        : (o.price || o.stopPrice || 0)
    ).filter((p) => p > 0);

    if (openOrderTargets.length > 0) {
      asksList.forEach((r) => {
        if (openOrderTargets.some((p) => Math.abs(p - r.price) <= (effectiveStep || 0.01) * 0.6) && !finalAsks.some((fa) => fa.price === r.price)) {
          finalAsks.push(r);
        }
      });
      finalAsks.sort((a, b) => b.price - a.price);

      bidsList.forEach((r) => {
        if (openOrderTargets.some((p) => Math.abs(p - r.price) <= (effectiveStep || 0.01) * 0.6) && !finalBids.some((fb) => fb.price === r.price)) {
          finalBids.push(r);
        }
      });
      bidsList.sort((a, b) => b.price - a.price);
    }

    // Find highest volume to scale horizontal bars
    let maxVol = 1000;
    finalAsks.forEach((r) => { if (r.volumeUsd > maxVol) maxVol = r.volumeUsd; });
    finalBids.forEach((r) => { if (r.volumeUsd > maxVol) maxVol = r.volumeUsd; });

    const bestA = finalAsks.length > 0 ? finalAsks[finalAsks.length - 1].price : 0;
    const bestB = finalBids.length > 0 ? finalBids[0].price : 0;
    const sUsd = bestA && bestB ? Math.max(0, bestA - bestB) : 0;
    const sPct = bestB > 0 ? (sUsd / bestB) * 100 : 0;

    return {
      aggregatedAsks: finalAsks,
      aggregatedBids: finalBids,
      maxVolumeUsd: maxVol,
      bestAsk: bestA,
      bestBid: bestB,
      spreadUsd: sUsd,
      spreadPct: sPct,
      totalRealOrdersCount: rawBids.length + rawAsks.length,
    };
  }, [rawAsks, rawBids, compression, effectiveStep, depthLevelCount, densityThresholdUsd, openOrders, livePrice]);

  // 5. Sound Alert detection for specified density
  useEffect(() => {
    if (!soundAlertEnabled) return;

    let hasNewDensity = false;
    const currentDenseLevels = new Set<number>();

    // Check asks
    aggregatedAsks.forEach((row) => {
      if (row.isDensity) {
        currentDenseLevels.add(row.price);
        if (!alertedLevelsRef.current.has(row.price)) {
          hasNewDensity = true;
        }
      }
    });

    // Check bids
    aggregatedBids.forEach((row) => {
      if (row.isDensity) {
        currentDenseLevels.add(row.price);
        if (!alertedLevelsRef.current.has(row.price)) {
          hasNewDensity = true;
        }
      }
    });

    if (hasNewDensity) {
      playDensityChime(false);
    }

    // Keep alert tracking updated
    alertedLevelsRef.current = currentDenseLevels;
  }, [aggregatedAsks, aggregatedBids, soundAlertEnabled]);

  // Auto-center on mount and on symbol change
  const handleCenterDOM = useCallback(() => {
    if (spreadRowRef.current && domScrollContainerRef.current) {
      const container = domScrollContainerRef.current;
      const spreadEl = spreadRowRef.current;
      const topOffset = spreadEl.offsetTop - container.clientHeight / 2 + spreadEl.clientHeight / 2;
      container.scrollTo({ top: topOffset, behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    if (autoCenterEnabled) {
      const timer = setTimeout(handleCenterDOM, 300);
      return () => clearTimeout(timer);
    }
  }, [handleCenterDOM, symbol, autoCenterEnabled]);

  // Timeframe switch handler
  const handleSelectClusterTf = (tf: Timeframe) => {
    setClusterTf(tf);
    setIsTfDropdownOpen(false);
    onUpdateSettings?.({ clusterTimeframe: tf });
  };

  // Compression switch handler
  const handleSelectCompression = (comp: number) => {
    setCompression(comp);
    setIsCompressionDropdownOpen(false);
    try {
      localStorage.setItem('scalper_dom_compression', String(comp));
    } catch {}
    onUpdateSettings?.({ compression: comp });
  };

  // Depth switch handler
  const handleSelectDepth = (depth: 'all' | 'deep' | 'medium' | 'small') => {
    setDepthPreset(depth);
    try {
      localStorage.setItem('scalper_dom_depth_preset', depth);
    } catch {}
    onUpdateSettings?.({ depth });
  };

  // Density threshold handler
  const handleSetDensityThreshold = (val: number) => {
    setDensityThresholdUsd(val);
    try {
      localStorage.setItem('scalper_dom_density_threshold', String(val));
    } catch {}
    onUpdateSettings?.({ densityThresholdUsd: val });
  };

  // Trade bubbles threshold handler
  const handleSetBubbleThreshold = (val: number) => {
    setBubbleThresholdUsd(val);
    try {
      localStorage.setItem('scalper_dom_bubble_threshold', String(val));
    } catch {}
    onUpdateSettings?.({ bubbleThresholdUsd: val });
  };

  // Sound toggle handler
  const handleToggleSound = () => {
    const next = !soundAlertEnabled;
    setSoundAlertEnabled(next);
    if (next) playDensityChime(true);
    try {
      localStorage.setItem('scalper_dom_sound_alert', String(next));
    } catch {}
    onUpdateSettings?.({ soundAlertEnabled: next });
  };

  // Auto-center toggle handler
  const handleToggleAutoCenter = () => {
    setAutoCenterEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('scalper_dom_auto_center', String(next));
      } catch {}
      if (next) {
        setTimeout(handleCenterDOM, 50);
      }
      return next;
    });
  };

  // Calculate recent trade bubbles placed next to the price ladder (filtered by volume threshold)
  const tradeBubbles = useMemo(() => {
    const filtered = bubbleThresholdUsd > 0
      ? trades.filter((t) => t.volumeUsd >= bubbleThresholdUsd)
      : trades;

    return filtered.slice(0, 50).map((t, idx) => {
      // Scale bubble diameter from 20px to 38px based on volume
      const sizePx = Math.min(38, Math.max(20, Math.round(Math.log10(Math.max(t.volumeUsd, 10)) * 7.5)));
      return {
        ...t,
        sizePx,
        opacity: Math.max(0.4, 1 - idx * 0.015),
      };
    });
  }, [trades, bubbleThresholdUsd]);

  return (
    <div
      className="relative flex flex-col w-full h-full bg-[#0b0e14] text-slate-200 select-none overflow-hidden font-mono text-[11px]"
      style={{ height: height || '100%' }}
    >
      {/* ================= TOP-LEFT OVERLAY (Responsive, mobile friendly) ================= */}
      <div className="absolute top-1 left-1.5 z-30 flex flex-col items-start gap-1 pointer-events-auto max-w-[calc(100%-80px)]">


        {/* Row 2: ⚙ | 5m | x10 | Стрічка [▾/▴] | Кластери | Center | Ping */}
        <div className="flex flex-wrap items-center gap-1 bg-[#090d16]/95 px-1.5 py-0.5 rounded-md border border-slate-800/80 text-[10px] text-slate-400 backdrop-blur-md shadow-sm">
          {/* Settings button ⚙ */}
          <button
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={`p-1 rounded hover:text-white transition-colors cursor-pointer ${
              isSettingsOpen ? 'text-cyan-400 bg-slate-800' : 'text-slate-400'
            }`}
            title="Налаштування стакану та сповіщень"
          >
            <Settings className="w-3 h-3" />
          </button>

          {/* Timeframe for clusters (5m) */}
          <div className="relative">
            <button
              onClick={() => setIsTfDropdownOpen(!isTfDropdownOpen)}
              className="px-1.5 py-0.5 rounded hover:bg-slate-800 text-slate-300 font-semibold hover:text-white transition-colors cursor-pointer flex items-center gap-0.5"
              title="Таймфрейм історії кластерів"
            >
              <span>{clusterTf}</span>
              <ChevronDown className="w-2.5 h-2.5 opacity-60" />
            </button>

            {isTfDropdownOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl py-1 flex flex-col min-w-[70px]">
                {(['1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => handleSelectClusterTf(tf)}
                    className={`px-2 py-1 text-left hover:bg-slate-800 text-[10px] flex items-center justify-between ${
                      clusterTf === tf ? 'text-cyan-400 font-bold' : 'text-slate-300'
                    }`}
                  >
                    <span>{tf}</span>
                    {clusterTf === tf && <Check className="w-2.5 h-2.5" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Compression badge (x10) */}
          <div className="relative">
            <button
              onClick={() => setIsCompressionDropdownOpen(!isCompressionDropdownOpen)}
              className="px-1.5 py-0.5 rounded hover:bg-slate-800 text-slate-300 font-semibold hover:text-white transition-colors cursor-pointer flex items-center gap-0.5"
              title="Рівень зжаття стакану (до 100х)"
            >
              <span>x{compression}</span>
              <ChevronDown className="w-2.5 h-2.5 opacity-60" />
            </button>

            {isCompressionDropdownOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl py-1 flex flex-col min-w-[80px]">
                {[1, 2, 5, 10, 20, 50, 100].map((c) => (
                  <button
                    key={c}
                    onClick={() => handleSelectCompression(c)}
                    className={`px-2 py-1 text-left hover:bg-slate-800 text-[10px] flex items-center justify-between ${
                      compression === c ? 'text-amber-400 font-bold' : 'text-slate-300'
                    }`}
                  >
                    <span>x{c}</span>
                    {compression === c && <Check className="w-2.5 h-2.5" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="text-slate-600 hidden sm:inline">-</span>

          {/* Tape Toggle Button (Згортати / Розгортати стрічку) */}
          <button
            onClick={handleToggleTape}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors cursor-pointer text-[9px] font-bold border shrink-0 ${
              !isTapeCollapsed
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
            }`}
            title={isTapeCollapsed ? 'Розгорнути стрічку угод' : 'Згорнути стрічку угод'}
          >
            <CircleDot className="w-2.5 h-2.5 text-cyan-400" />
            <span>{!isTapeCollapsed ? 'Стрічка' : 'Стрічка +'}</span>
          </button>

          {/* Clusters Toggle Button (Кластери) - Visible on ALL screen sizes */}
          <button
            onClick={handleToggleClusters}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors cursor-pointer text-[9px] font-bold border shrink-0 ${
              showClusters
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-white'
            }`}
            title={showClusters ? 'Згорнути кластери' : 'Показати кластери'}
          >
            <BarChart3 className="w-2.5 h-2.5 text-amber-400" />
            <span>{showClusters ? 'Кластери' : 'Кластери +'}</span>
          </button>

          {/* Latency ping indicator */}
          <div className="hidden sm:flex items-center gap-1 text-[9px] font-mono text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>{latencyMs}ms</span>
          </div>

          {/* Real orders count badge */}
          <div
            className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-mono text-[9px] font-bold"
            title={`Реальні активні заявки у стакані: ${rawAsks.length} Short (Asks) + ${rawBids.length} Long (Bids)`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            <span>{totalRealOrdersCount}</span>
          </div>

          {/* Auto Center Button */}
          <button
            onClick={handleCenterDOM}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer text-[9px] font-bold border border-slate-700"
            title="Центрувати стакан на спреді"
          >
            <Crosshair className="w-2.5 h-2.5 text-cyan-400" />
            <span className="hidden xs:inline">Центр</span>
          </button>

          {/* Trading Panel Toggle Button */}
          <button
            onClick={handleToggleTradePanel}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-all cursor-pointer text-[9px] font-bold border shrink-0 ${
              isTradePanelOpen
                ? 'bg-emerald-500/25 border-emerald-500 text-emerald-300 shadow-sm'
                : hasExchangeApi
                ? 'bg-slate-800/90 border-emerald-500/50 text-emerald-400 hover:text-white'
                : 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
            }`}
            title={hasExchangeApi ? 'Торгівля: виставлення реальних заявок зі стакану' : 'Підключити API біржі для реальної торгівлі'}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${hasExchangeApi ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <Zap className="w-2.5 h-2.5" />
            <span>{hasExchangeApi ? 'Торгівля ⚡' : 'Підкл. API'}</span>
            {accountBalance ? (
              <span className="hidden sm:inline font-mono text-[8.5px] text-emerald-300/90 font-medium pl-0.5">
                ${accountBalance.availableBalance.toFixed(0)}
              </span>
            ) : openOrders.length > 0 ? (
              <span className="px-1 py-0.1 rounded-full bg-cyan-500/30 text-cyan-200 text-[8px] font-mono">
                {openOrders.length}
              </span>
            ) : null}
          </button>
        </div>
      </div>



      {/* ================= SETTINGS POPOVER DIALOG ================= */}
      {isSettingsOpen && (
        <div
          className="absolute top-14 left-2.5 z-50 w-80 max-h-[85vh] overflow-y-auto no-scrollbar bg-slate-900/98 border border-slate-700 rounded-2xl shadow-2xl p-3.5 backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-800">
            <span className="font-bold text-xs text-white flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              Параметри стакану (DOM)
            </span>
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-slate-800 cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Розмір цілого блоку стакану */}
          <div className="mb-3 space-y-1.5 p-2 rounded-xl bg-slate-950/80 border border-slate-800/90">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>Розмір блоку стакану:</span>
              </span>
              <span className="text-cyan-400 font-bold font-mono">
                {domHeightPreset === 'md' ? '600px' : domHeightPreset === 'lg' ? '780px' : '950px'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              {[
                { size: 'md' as const, label: '600px' },
                { size: 'lg' as const, label: '780px' },
                { size: 'xl' as const, label: '950px' },
              ].map((item) => (
                <button
                  key={item.size}
                  type="button"
                  onClick={() => onDomHeightPresetChange?.(item.size)}
                  className={`py-1.5 rounded-lg border text-center font-bold transition-all cursor-pointer ${
                    domHeightPreset === item.size
                      ? 'bg-cyan-500/25 border-cyan-500 text-cyan-300 shadow-sm shadow-cyan-950/60'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Автоцентрування */}
          <div className="mb-3 p-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/15 flex items-center justify-center text-cyan-400">
                <Crosshair className="w-3.5 h-3.5" />
              </div>
              <div className="text-[11px]">
                <div className="font-semibold text-white">Автоцентрування</div>
                <div className="text-[9px] text-slate-400">Автоцентрувати стакан на спред</div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleToggleAutoCenter}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                autoCenterEnabled
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {autoCenterEnabled ? 'УВІМК' : 'ВИМК'}
            </button>
          </div>

          {/* 1. Плотність у стакані (Threshold) - від 100к, 300к, 500к, 1М */}
          <div className="mb-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium">Поріг плотності (USD):</span>
              <span className="text-amber-400 font-bold font-mono">
                {formatVolume(densityThresholdUsd)}
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1 text-[10px]">
              {[
                { amt: 100000, label: '100к' },
                { amt: 300000, label: '300к' },
                { amt: 500000, label: '500к' },
                { amt: 1000000, label: '1М' },
                { amt: 2000000, label: '2М' },
                { amt: 5000000, label: '5М' },
              ].map(({ amt, label }) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => handleSetDensityThreshold(amt)}
                  className={`py-1.5 rounded-lg border text-center font-bold transition-all cursor-pointer ${
                    densityThresholdUsd === amt
                      ? 'bg-amber-500/25 border-amber-500 text-amber-300 shadow-sm shadow-amber-950/60'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="range"
                min={50000}
                max={10000000}
                step={50000}
                value={densityThresholdUsd}
                onChange={(e) => handleSetDensityThreshold(Number(e.target.value))}
                className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] font-mono shrink-0">
                <span className="text-slate-500">$</span>
                <input
                  type="number"
                  min={10000}
                  step={25000}
                  value={densityThresholdUsd}
                  onChange={(e) => handleSetDensityThreshold(Math.max(10000, Number(e.target.value)))}
                  className="w-18 bg-transparent text-white text-right focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* 2. Сума показу кружечків у стрічці угод (Trade Bubbles Minimum Volume) */}
          <div className="mb-3 space-y-1.5 p-2 rounded-xl bg-slate-950/80 border border-slate-800/90">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium flex items-center gap-1.5">
                <CircleDot className="w-3.5 h-3.5 text-cyan-400" />
                <span>Сума кружечків у стрічці:</span>
              </span>
              <span className="text-cyan-400 font-bold font-mono">
                {bubbleThresholdUsd === 0 ? 'Всі угоди' : `≥ ${formatVolume(bubbleThresholdUsd)}`}
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1 text-[10px]">
              {[
                { val: 0, label: 'Всі' },
                { val: 1000, label: '1к' },
                { val: 5000, label: '5к' },
                { val: 10000, label: '10к' },
                { val: 25000, label: '25к' },
                { val: 50000, label: '50к' },
              ].map((item) => (
                <button
                  key={item.val}
                  type="button"
                  onClick={() => handleSetBubbleThreshold(item.val)}
                  className={`py-1 rounded border text-center font-bold transition-all cursor-pointer ${
                    bubbleThresholdUsd === item.val
                      ? 'bg-cyan-500/25 border-cyan-500 text-cyan-300 shadow-sm shadow-cyan-950/60'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="range"
                min={0}
                max={100000}
                step={500}
                value={bubbleThresholdUsd}
                onChange={(e) => handleSetBubbleThreshold(Number(e.target.value))}
                className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
              />
              <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] font-mono shrink-0">
                <span className="text-slate-500">$</span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={bubbleThresholdUsd}
                  onChange={(e) => handleSetBubbleThreshold(Math.max(0, Number(e.target.value)))}
                  className="w-16 bg-transparent text-white text-right focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* 2. Звукове сповіщення при появі плотності */}
          <div className="mb-3 p-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-400">
                <BellRing className="w-3.5 h-3.5" />
              </div>
              <div className="text-[11px]">
                <div className="font-semibold text-white">Звук при плотності</div>
                <div className="text-[9px] text-slate-400">Дзвінок при появі великого об'єму</div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => playDensityChime(true)}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 hover:text-white"
                title="Тест звуку"
              >
                Тест
              </button>
              <button
                onClick={handleToggleSound}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  soundAlertEnabled
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {soundAlertEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* 3. Рівень зжаття (Compression до 100x) */}
          <div className="mb-3 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium">Рівень зжаття стакану:</span>
              <span className="text-cyan-400 font-bold font-mono">x{compression}</span>
            </div>
            <div className="grid grid-cols-7 gap-1 text-[10px]">
              {[1, 2, 5, 10, 20, 50, 100].map((c) => (
                <button
                  key={c}
                  onClick={() => handleSelectCompression(c)}
                  className={`py-1 rounded border text-center font-bold transition-all cursor-pointer ${
                    compression === c
                      ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  x{c}
                </button>
              ))}
            </div>
          </div>

          {/* 4. Глибина стакану (Depth: 50, 100, 250, ВСІ 500+) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium">Глибина стакану:</span>
              <span className="text-cyan-400 text-[10px] font-mono font-bold">
                {depthPreset === 'small'
                  ? '50 рівнів'
                  : depthPreset === 'medium'
                  ? '100 рівнів'
                  : depthPreset === 'deep'
                  ? '250 рівнів'
                  : 'ВСІ реальні заявки (500+)'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-[10px]">
              {[
                { id: 'small', label: '50' },
                { id: 'medium', label: '100' },
                { id: 'deep', label: '250' },
                { id: 'all', label: 'ВСІ (500+)' },
              ].map((d) => (
                <button
                  key={d.id}
                  onClick={() => handleSelectDepth(d.id as any)}
                  className={`py-1.5 rounded-lg border text-center font-bold transition-all cursor-pointer ${
                    depthPreset === d.id
                      ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= BOTTOM-LEFT PRESETS ================= */}
      <div className="absolute bottom-2 left-2 z-30 flex flex-col items-start gap-1 pointer-events-auto">
        {/* Preset lot buttons: x5 tag, $751, $10, $20, $30, $50, $100 */}
        <div className="flex flex-col gap-0.5 bg-[#090d16]/95 p-1 rounded-lg border border-slate-800/80 text-[10px] font-mono shadow-md backdrop-blur-sm">
          <div
            className="flex items-center justify-between gap-1 px-1 py-0.5 text-[9px] text-slate-400 font-bold cursor-pointer hover:text-white select-none"
            onClick={() => setIsPresetsCollapsed(!isPresetsCollapsed)}
            title="Згорнути / розгорнути лоти"
          >
            <div className="flex items-center gap-1">
              <span className="px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">x5</span>
              <span>Лот {selectedPreset}</span>
            </div>
            {isPresetsCollapsed ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
          </div>

          {!isPresetsCollapsed && (
            <div className="flex flex-col gap-0.5 pt-0.5">
              {['$751', '$10', '$20', '$30', '$50', '$100'].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setSelectedPreset(preset)}
                  className={`px-2 py-0.5 rounded text-left font-bold transition-colors cursor-pointer ${
                    selectedPreset === preset
                      ? 'bg-slate-700 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Cluster Footprint Summary */}
        <div className="hidden xs:flex items-center gap-1.5 bg-[#090d16]/95 px-2 py-1 rounded-md border border-slate-800/80 text-[10px] text-slate-400 font-mono shadow-md backdrop-blur-sm">
          <span className="px-1.5 py-0.5 rounded bg-blue-600/80 text-white font-bold text-[9px]">
            1.3K
          </span>
          <span className="text-slate-300 font-semibold">1.2K</span>
          <span className="text-slate-500">|</span>
          <span className="text-cyan-400 font-bold">03:59</span>
        </div>
      </div>

      {/* ================= MAIN SCALPER CANVAS (Clusters + Tape + DOM) ================= */}
      <div className="flex-1 w-full overflow-hidden relative flex divide-x divide-slate-900/60 min-h-0">
        {/* Subtle Horizontal Price Grid Lines across canvas */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <div
            className="w-full h-full opacity-15"
            style={{
              backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
              backgroundSize: '100% 22px',
            }}
          />
        </div>

        {/* 1. LEFT SECTION: Cluster History (collapsible/expandable footprint clusters with all sums visible) */}
        {showClusters ? (
          <div className="w-48 sm:w-64 md:w-72 lg:w-80 shrink-0 h-full flex flex-col relative z-10 select-none overflow-hidden bg-[#070a10]/90 border-r border-slate-900/80">
            {/* Clusters Sticky Header */}
            <div className="sticky top-0 z-20 flex items-center justify-between px-1.5 py-1 bg-slate-950/95 border-b border-slate-800/80 backdrop-blur-md shrink-0">
              <div className="flex items-center gap-1 min-w-0">
                <BarChart3 className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                <span className="text-[10px] font-bold text-slate-200 uppercase tracking-wider truncate">
                  Кластери
                </span>
                <span className="text-[8px] font-mono text-amber-400/90 font-bold px-1 rounded bg-amber-500/10">
                  {clusterTf}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[7.5px] font-mono text-slate-500 hidden sm:inline">
                  (Куп/Сума)
                </span>
                <button
                  type="button"
                  onClick={handleToggleClusters}
                  className="p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-300 transition-colors cursor-pointer"
                  title="Згорнути кластери"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Footprint Cluster Columns (all sums clearly visible, horizontal scroll if screen is narrow) */}
            <div className="flex-1 flex items-stretch h-full gap-1 p-1 overflow-x-auto overflow-y-hidden no-scrollbar touch-pan-x">
              {clusters.map((col) => {
                const maxLvl = col.maxLevelVol || 1;
                return (
                  <div
                    key={col.candleTime}
                    className="flex-1 min-w-[46px] sm:min-w-[52px] flex flex-col h-full items-center justify-between relative group border border-slate-800/40 rounded bg-slate-950/40 p-0.5"
                  >
                    {/* Column top label: Candle time */}
                    <div className="text-[8.5px] text-slate-300 font-mono shrink-0 truncate py-0.5 font-bold">
                      {col.label}
                    </div>

                    {/* Footprint Cluster Levels Stack */}
                    <div className="flex-1 w-full flex flex-col justify-center gap-[2px] overflow-y-auto no-scrollbar my-0.5">
                      {Object.values(col.levels)
                        .sort((a, b) => b.price - a.price)
                        .slice(0, 16)
                        .map((lvl) => {
                          const isPOC = lvl.isPOC;
                          const fillPct = Math.min(100, Math.max(8, (lvl.totalVol / maxLvl) * 100));

                          return (
                            <div
                              key={lvl.price}
                              className={`w-full h-[18px] sm:h-[19px] relative flex items-center justify-between px-1 text-[8px] sm:text-[8.5px] rounded font-mono transition-all overflow-hidden ${
                                isPOC
                                  ? 'border border-amber-400 bg-amber-500/25 ring-1 ring-amber-400/40 shadow-sm shadow-amber-950/60'
                                  : lvl.buyVol >= lvl.sellVol
                                  ? 'bg-slate-900/60 hover:bg-slate-800 border-l border-emerald-500/80'
                                  : 'bg-slate-900/60 hover:bg-slate-800 border-l border-rose-500/80'
                              }`}
                              title={`Рівень: $${formatCryptoPrice(lvl.price)}\nКупівля: ${formatVolume(lvl.buyVol)}\nПродаж: ${formatVolume(lvl.sellVol)}\nРазом: ${formatVolume(lvl.totalVol)}${isPOC ? ' (POC - Point of Control)' : ''}`}
                            >
                              {/* Horizontal relative volume fill bar */}
                              <div
                                className={`absolute left-0 top-0 bottom-0 pointer-events-none opacity-20 ${
                                  isPOC
                                    ? 'bg-amber-400'
                                    : lvl.buyVol >= lvl.sellVol
                                    ? 'bg-emerald-400'
                                    : 'bg-rose-400'
                                }`}
                                style={{ width: `${fillPct}%` }}
                              />

                              {/* Buy volume sum on left */}
                              <span className="relative z-10 text-[7.5px] sm:text-[8px] font-bold text-emerald-400/90 shrink-0 font-mono">
                                {formatCompactClusterSum(lvl.buyVol)}
                              </span>

                              {/* Total volume sum on right with POC badge if applicable */}
                              <div className="relative z-10 flex items-center gap-0.5 shrink-0 ml-auto font-mono">
                                {isPOC && (
                                  <span className="text-[6.5px] font-black px-0.5 rounded bg-amber-400 text-slate-950 uppercase tracking-tighter">
                                    POC
                                  </span>
                                )}
                                <span
                                  className={`text-[8px] sm:text-[8.5px] font-bold ${
                                    isPOC ? 'text-amber-200 font-extrabold' : 'text-slate-100'
                                  }`}
                                >
                                  {formatCompactClusterSum(lvl.totalVol)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                    </div>

                    {/* Column bottom: Total Candle Volume Sum (Fully visible) */}
                    <div
                      className="text-[8.5px] text-amber-300 font-mono shrink-0 truncate py-0.5 font-extrabold tracking-tight"
                      title={`Загальний об'єм свічки: ${formatVolume(col.totalVolume)}`}
                    >
                      {formatCandleTotalSum(col.totalVolume)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Collapsed Clusters Strip */
          <div
            onClick={handleToggleClusters}
            className="w-7 shrink-0 h-full relative z-10 flex flex-col items-center justify-between py-2 border-r border-slate-900/70 bg-[#070a10]/95 hover:bg-slate-900/90 cursor-pointer transition-colors group select-none"
            title="Розгорнути кластери"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleToggleClusters();
              }}
              className="p-1 rounded text-amber-400 group-hover:text-amber-300 hover:bg-slate-800 transition-colors"
              title="Розгорнути кластери"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <div className="flex flex-col items-center gap-1.5 my-auto">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span
                className="text-[9px] font-bold text-slate-400 group-hover:text-amber-300 uppercase tracking-widest"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                Кластери
              </span>
            </div>
            <span className="text-[10px] text-slate-500 group-hover:text-amber-400 font-bold">»</span>
          </div>
        )}

        {/* 2. MIDDLE SECTION: Trades Tape ("Стрічка угод / Лента сделок") */}
        {!isTapeCollapsed ? (
          <div className="w-28 sm:w-36 md:w-44 shrink-0 h-full relative z-10 flex flex-col border-r border-slate-900/70 bg-[#070a10]/90 select-none">
            {/* Tape Sticky Header */}
            <div className="sticky top-0 z-20 flex flex-col px-2 py-1 bg-slate-950/95 border-b border-slate-800/80 backdrop-blur-md shrink-0">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-bold text-slate-200 uppercase tracking-wider truncate">
                    Стрічка
                  </span>
                  <span className="flex h-1.5 w-1.5 relative shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {/* Clickable threshold filter */}
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(true)}
                    className="flex items-center gap-0.5 text-[8px] font-mono px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 hover:border-cyan-500/50 transition-colors cursor-pointer"
                    title="Змінити поріг показу кружечків"
                  >
                    <CircleDot className="w-2 h-2 text-cyan-400" />
                    <span>{bubbleThresholdUsd === 0 ? 'Всі' : `≥${formatWholeSum(bubbleThresholdUsd)}`}</span>
                  </button>

                  {/* Collapse Tape Button */}
                  <button
                    type="button"
                    onClick={handleToggleTape}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer"
                    title="Згорнути стрічку"
                  >
                    <PanelRightClose className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Column labels: ONLY Circle and Price */}
              <div className="flex items-center justify-between text-[8px] text-slate-500 font-mono mt-0.5 pt-0.5 border-t border-slate-900/80">
                <span>Кружечок</span>
                <span className="text-right">Ціна</span>
              </div>
            </div>

            {/* Trade bubbles / Tape live scroll: ONLY CIRCLES AND PRICE */}
            <div
              className="flex-1 w-full overflow-y-auto no-scrollbar p-1 flex flex-col gap-1 touch-pan-y"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {tradeBubbles.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-2 text-center px-2 text-slate-500 my-auto">
                  <CircleDot className="w-6 h-6 text-slate-700 animate-pulse" />
                  <span className="text-[10px] font-mono leading-tight">
                    Немає угод {bubbleThresholdUsd > 0 ? `≥ ${formatWholeSum(bubbleThresholdUsd)}` : ''}
                  </span>
                  {bubbleThresholdUsd > 0 && (
                    <button
                      type="button"
                      onClick={() => handleSetBubbleThreshold(0)}
                      className="text-[9px] text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                    >
                      Показати всі угоди
                    </button>
                  )}
                </div>
              ) : (
                tradeBubbles.map((tb) => {
                  const isBuy = !tb.isBuyerMaker;
                  const isWhale = tb.volumeUsd >= densityThresholdUsd;

                  return (
                    <div
                      key={tb.id}
                      className={`flex items-center justify-between px-1.5 py-1 rounded-md border text-xs font-mono transition-all duration-150 animate-in fade-in hover:brightness-125 cursor-default ${
                        isWhale
                          ? isBuy
                            ? 'bg-emerald-950/70 border-emerald-400/90 shadow-sm shadow-emerald-500/20'
                            : 'bg-rose-950/70 border-rose-400/90 shadow-sm shadow-rose-500/20'
                          : isBuy
                          ? 'bg-emerald-950/30 border-emerald-800/40 hover:border-emerald-500/60'
                          : 'bg-rose-950/30 border-rose-800/40 hover:border-rose-500/60'
                      }`}
                      title={`${isBuy ? 'BUY' : 'SELL'}: $${formatCompactWholeBubble(tb.volumeUsd)} @ $${formatCryptoPrice(tb.price)} (${formatTradeTime(tb.timestamp)})`}
                    >
                      {/* ONLY THE CIRCLE (КРУЖЕЧОК) */}
                      <div
                        className={`flex items-center justify-center rounded-full font-extrabold shrink-0 shadow-sm transition-transform duration-100 ${
                          isBuy
                            ? 'bg-emerald-500 text-slate-950 shadow-emerald-900/50 ring-1 ring-emerald-400/60'
                            : 'bg-rose-500 text-white shadow-rose-900/50 ring-1 ring-rose-400/60'
                        }`}
                        style={{
                          width: `${tb.sizePx}px`,
                          height: `${tb.sizePx}px`,
                          minWidth: `${tb.sizePx}px`,
                          minHeight: `${tb.sizePx}px`,
                          fontSize: tb.sizePx >= 28 ? '8.5px' : '7.5px',
                        }}
                      >
                        <span className="truncate px-0.5 select-none font-bold">
                          {formatCompactWholeBubble(tb.volumeUsd)}
                        </span>
                      </div>

                      {/* ONLY THE PRICE (ЦІНА) */}
                      <span
                        className={`font-mono font-bold text-[10px] sm:text-[11px] shrink-0 text-right ml-auto select-all ${
                          isBuy ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        ${formatCryptoPrice(tb.price)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          /* Collapsed Tape Strip */
          <div
            onClick={handleToggleTape}
            className="w-7 shrink-0 h-full relative z-10 flex flex-col items-center justify-between py-2 border-r border-slate-900/70 bg-[#070a10]/95 hover:bg-slate-900/90 cursor-pointer transition-colors group select-none"
            title="Розгорнути стрічку угод"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleToggleTape();
              }}
              className="p-1 rounded text-cyan-400 group-hover:text-cyan-300 hover:bg-slate-800 transition-colors"
              title="Розгорнути стрічку"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="flex flex-col items-center gap-1.5 my-auto">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span
                className="text-[9px] font-bold text-slate-400 group-hover:text-cyan-300 uppercase tracking-widest"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                Стрічка
              </span>
            </div>
            <span className="text-[10px] text-slate-500 group-hover:text-cyan-400 font-bold">»</span>
          </div>
        )}

        {/* 3. RIGHT SECTION: Order Book ("Стакан") */}
        <div
          ref={domScrollContainerRef}
          className="w-44 sm:w-52 md:w-60 shrink-0 h-full overflow-y-auto no-scrollbar relative flex flex-col bg-[#090d16]/40 touch-pan-y"
          style={{ scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch' }}
        >
          {/* Header columns: Об'єм (ліворуч) | Ціна (праворуч, always visible) */}
          <div className="sticky top-0 z-20 flex flex-col border-b border-slate-800/80 shrink-0 bg-slate-950/95 backdrop-blur-sm">
            <div className="flex items-center justify-between px-2 sm:px-2.5 py-1 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
              <span className="flex items-center gap-1 min-w-0 truncate">
                <span>Об'єм</span>
                <span className="text-cyan-400/80 font-mono text-[8px]">({aggregatedAsks.length + aggregatedBids.length})</span>
              </span>
              <span className="shrink-0 text-right pl-1 text-slate-300">Шкала Ціни</span>
            </div>

            {/* Order Mode Toggle & Swipe Guidance Bar */}
            <div className="flex items-center justify-between px-1.5 py-1 bg-slate-900 border-t border-slate-800 text-[8.5px] font-mono select-none flex-wrap gap-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDomOrderMode('LIMIT')}
                  className={`px-1.5 py-0.5 rounded font-bold transition-colors cursor-pointer ${
                    domOrderMode === 'LIMIT'
                      ? 'bg-cyan-500 text-slate-950 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Режим лімітних заявок: свайп вправо = Limit Long, свайп вліво = Limit Short"
                >
                  ⚡ Ліміт
                </button>
                <button
                  type="button"
                  onClick={() => setDomOrderMode('STOP')}
                  className={`px-1.5 py-0.5 rounded font-bold transition-colors cursor-pointer ${
                    domOrderMode === 'STOP'
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Режим стоп-заявок: свайп вправо = Stop Buy, свайп вліво = Stop Sell"
                >
                  🛑 Стоп
                </button>

                {/* Direct Add Stop Order Button */}
                <button
                  type="button"
                  onClick={() => openStopOrderDialog()}
                  className="px-1.5 py-0.5 rounded font-bold bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/40 transition-colors cursor-pointer flex items-center gap-0.5"
                  title="Відкрити вікно налаштування та розміщення стоп-заявки"
                >
                  <Shield className="w-2.5 h-2.5" />
                  <span>+ Стоп-заявка</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                {openOrders.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpenOrdersOpen(!openOrdersOpen)}
                    className="flex items-center gap-1 text-[8.5px] text-cyan-300 font-bold hover:underline cursor-pointer"
                    title="Активні заявки на шкалі стакану"
                  >
                    <span>🎯 {openOrders.length} на шкалі</span>
                  </button>
                )}

                {domOrderMode === 'LIMIT' ? (
                  <div className="flex items-center gap-1">
                    <span className="text-emerald-400 font-bold" title="Свайп вправо = Limit Long">👉 Long</span>
                    <span className="text-slate-600">|</span>
                    <span className="text-rose-400 font-bold" title="Свайп вліво = Limit Short">Short 👈</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-amber-400 font-bold" title="Свайп вправо = Stop Buy тригер">👉 Stop Buy</span>
                    <span className="text-slate-600">|</span>
                    <span className="text-orange-400 font-bold" title="Свайп вліво = Stop Sell тригер">Stop Sell 👈</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Rows container */}
          <div className="flex flex-col py-1">
            {/* ASKS (TOP, Shorts) */}
            <div className="flex flex-col justify-end">
              {aggregatedAsks.map((row) => {
                const fillPct = Math.min(100, Math.max(3, (row.volumeUsd / maxVolumeUsd) * 100));
                const isDensity = row.isDensity;
                const matchingOrders = getOrdersMatchingPrice(row.price);
                const isSwipingThisRow = swipingRow?.price === row.price;
                const deltaX = isSwipingThisRow ? swipingRow.deltaX : 0;
                const isLongTrigger = deltaX >= 40;
                const isShortTrigger = deltaX <= -40;

                return (
                  <div
                    key={`ask-${row.price}`}
                    onClick={() => handleClickAskRow(row.price)}
                    onTouchStart={(e) => handleTouchStartRow(e, row.price)}
                    onTouchMove={(e) => handleTouchMoveRow(e, row.price)}
                    onTouchEnd={(e) => handleTouchEndRow(e, row.price)}
                    onMouseDown={(e) => handleMouseDownRow(e, row.price)}
                    onMouseMove={(e) => handleMouseMoveRow(e, row.price)}
                    onMouseUp={(e) => handleMouseUpRow(e, row.price)}
                    title={`Клік: вибрати ціну $${formatCryptoPrice(row.price)} | Свайп: ${domOrderMode === 'STOP' ? 'Stop Buy / Stop Sell' : 'Limit Long / Short'}`}
                    style={{
                      transform: isSwipingThisRow ? `translateX(${Math.max(-80, Math.min(80, deltaX))}px)` : undefined,
                      transition: isSwipingThisRow ? 'none' : 'transform 0.15s ease',
                    }}
                    className={`relative flex items-center justify-between px-2 sm:px-2.5 h-[21px] transition-colors group cursor-pointer select-none ${
                      matchingOrders.length > 0
                        ? 'bg-slate-900/90 border-y border-cyan-500/40 shadow-xs'
                        : isDensity
                        ? 'bg-rose-950/70 border-y border-amber-400 shadow-sm shadow-amber-950/50'
                        : 'hover:bg-slate-800/60'
                    }`}
                  >
                    {/* Dark Crimson Red Horizontal Volume Bar */}
                    <div
                      className={`absolute left-0 top-0 bottom-0 pointer-events-none transition-all duration-150 ${
                        isDensity ? 'bg-gradient-to-r from-amber-600/70 to-rose-700/80' : 'bg-rose-900/60'
                      }`}
                      style={{ width: `${fillPct}%` }}
                    />

                    {/* Active Order Glowing Marker Line across row */}
                    {matchingOrders.length > 0 && (
                      <div
                        className={`absolute inset-0 pointer-events-none z-20 border-y ${
                          matchingOrders.some((o) => o.type.startsWith('STOP'))
                            ? 'border-amber-400 bg-amber-500/15 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
                            : matchingOrders.some((o) => o.type.startsWith('TAKE_PROFIT'))
                            ? 'border-cyan-400 bg-cyan-500/15 shadow-[0_0_10px_rgba(6,182,212,0.25)]'
                            : matchingOrders.some((o) => o.side === 'BUY')
                            ? 'border-emerald-400 bg-emerald-500/15 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
                            : 'border-rose-400 bg-rose-500/15 shadow-[0_0_10px_rgba(244,63,94,0.25)]'
                        }`}
                      >
                        <div className="absolute left-0 top-0 bottom-0 flex items-center pl-1">
                          <span
                            className={`px-1 py-0.2 rounded font-mono font-black text-[7.5px] uppercase tracking-tighter ${
                              matchingOrders.some((o) => o.type.startsWith('STOP'))
                                ? 'bg-amber-500 text-slate-950 ring-1 ring-amber-300'
                                : matchingOrders.some((o) => o.type.startsWith('TAKE_PROFIT'))
                                ? 'bg-cyan-500 text-slate-950 ring-1 ring-cyan-300'
                                : matchingOrders.some((o) => o.side === 'BUY')
                                ? 'bg-emerald-500 text-slate-950 ring-1 ring-emerald-300'
                                : 'bg-rose-500 text-white ring-1 ring-rose-300'
                            }`}
                          >
                            {matchingOrders.some((o) => o.type.startsWith('STOP'))
                              ? '🛑 STOP'
                              : matchingOrders.some((o) => o.type.startsWith('TAKE_PROFIT'))
                              ? '🎯 TP'
                              : matchingOrders.some((o) => o.side === 'BUY')
                              ? '▲ LONG'
                              : '▼ SHORT'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Swipe Right Overlay (Limit Long or Stop Buy) */}
                    {isSwipingThisRow && deltaX > 8 && (
                      <div
                        className={`absolute inset-0 z-30 flex items-center pl-2 gap-1.5 pointer-events-none transition-colors ${
                          domOrderMode === 'STOP'
                            ? isLongTrigger
                              ? 'bg-amber-600/90 text-white font-bold animate-pulse'
                              : 'bg-amber-950/85 text-amber-300'
                            : isLongTrigger
                            ? 'bg-emerald-600/90 text-white font-bold animate-pulse'
                            : 'bg-emerald-950/85 text-emerald-300'
                        }`}
                      >
                        <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-[9.5px] font-mono font-bold truncate">
                          {domOrderMode === 'STOP'
                            ? isLongTrigger
                              ? '✓ ВІДПУСТІТЬ: СТОП BUY'
                              : 'Свайп: СТОП BUY'
                            : isLongTrigger
                            ? '✓ ВІДПУСТІТЬ: LIMIT LONG'
                            : 'Свайп: LIMIT LONG'} ${formatCryptoPrice(row.price)}
                        </span>
                      </div>
                    )}

                    {/* Swipe Left Overlay (Limit Short or Stop Sell) */}
                    {isSwipingThisRow && deltaX < -8 && (
                      <div
                        className={`absolute inset-0 z-30 flex items-center justify-end pr-2 gap-1.5 pointer-events-none transition-colors ${
                          domOrderMode === 'STOP'
                            ? isShortTrigger
                              ? 'bg-orange-600/90 text-white font-bold animate-pulse'
                              : 'bg-orange-950/85 text-orange-300'
                            : isShortTrigger
                            ? 'bg-rose-600/90 text-white font-bold animate-pulse'
                            : 'bg-rose-950/85 text-rose-300'
                        }`}
                      >
                        <span className="text-[9.5px] font-mono font-bold truncate">
                          {domOrderMode === 'STOP'
                            ? isShortTrigger
                              ? '✓ ВІДПУСТІТЬ: СТОП SELL'
                              : 'Свайп: СТОП SELL'
                            : isShortTrigger
                            ? '✓ ВІДПУСТІТЬ: LIMIT SHORT'
                            : 'Свайп: LIMIT SHORT'} ${formatCryptoPrice(row.price)}
                        </span>
                        <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                      </div>
                    )}

                    {/* Volume text on Left */}
                    <div className="relative z-10 flex items-center gap-1 min-w-0 pr-1 overflow-hidden">
                      <span className="font-mono text-white text-[10px] sm:text-[11px] font-medium truncate">
                        {formatVolume(row.volumeUsd)}$
                      </span>
                      {isDensity && (
                        <span className="text-[7.5px] sm:text-[8px] font-bold px-1 py-0.2 rounded bg-amber-500 text-slate-950 uppercase tracking-tighter shrink-0">
                          Плотн
                        </span>
                      )}

                      {/* Direct Click Quick Order Buttons on Hover (+L, +S, +Stop) */}
                      <div className="hidden group-hover:flex items-center gap-0.5 ml-0.5 shrink-0 z-30">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            placeDirectDomLimitOrder(row.price, 'BUY');
                          }}
                          className="px-1 py-0.2 rounded bg-emerald-500/30 hover:bg-emerald-500 text-emerald-200 hover:text-slate-950 font-bold text-[7.5px] border border-emerald-500/50 cursor-pointer"
                          title="Виставити Limit LONG на цьому рівні"
                        >
                          +L
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            placeDirectDomLimitOrder(row.price, 'SELL');
                          }}
                          className="px-1 py-0.2 rounded bg-rose-500/30 hover:bg-rose-500 text-rose-200 hover:text-white font-bold text-[7.5px] border border-rose-500/50 cursor-pointer"
                          title="Виставити Limit SHORT на цьому рівні"
                        >
                          +S
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            placeDirectDomStopOrder(row.price, 'BUY');
                          }}
                          className="px-1 py-0.2 rounded bg-amber-500/30 hover:bg-amber-500 text-amber-200 hover:text-slate-950 font-bold text-[7.5px] border border-amber-500/50 cursor-pointer flex items-center gap-0.5"
                          title="Швидкий STOP BUY тригер на цьому рівні"
                        >
                          <span>🛑 +Stop</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openStopOrderDialog(row.price, 'BUY');
                          }}
                          className="px-1 py-0.2 rounded bg-slate-800 hover:bg-amber-500/80 text-amber-300 hover:text-slate-950 font-bold text-[7.5px] border border-slate-700 cursor-pointer"
                          title="Відкрити детальне налаштування стоп-заявки для цього рівня"
                        >
                          ⚙️
                        </button>
                      </div>
                    </div>

                    {/* Price Scale Column with Prominent Visual Order Markers */}
                    <div className="relative z-30 shrink-0 text-right pl-1.5 ml-auto flex items-center justify-end gap-1.5">
                      {/* Active Order Markers directly on the scale */}
                      {matchingOrders.length > 0 && (
                        <div className="flex items-center gap-1 select-none animate-in fade-in duration-150">
                          {matchingOrders.map((ord) => {
                            const isTp = ord.type === 'TAKE_PROFIT_MARKET' || ord.type === 'TAKE_PROFIT';
                            const isSl = ord.type === 'STOP_MARKET' || ord.type === 'STOP';
                            const isStopOrder = ord.type.startsWith('STOP');
                            const isBuy = ord.side === 'BUY';

                            return (
                              <div
                                key={ord.orderId}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCancelOrder(ord.orderId);
                                }}
                                className={`flex items-center gap-1 px-1.5 py-0.5 rounded shadow-lg border font-mono font-bold text-[8.5px] cursor-pointer transition-all hover:scale-105 active:scale-95 group/marker ${
                                  isTp
                                    ? 'bg-cyan-500 text-slate-950 border-cyan-200 shadow-cyan-950/80 ring-1 ring-cyan-400'
                                    : isSl
                                    ? 'bg-amber-500 text-slate-950 border-amber-200 shadow-amber-950/80 ring-1 ring-amber-400 animate-pulse'
                                    : isStopOrder
                                    ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white border-amber-200 shadow-orange-950/80 ring-1 ring-orange-400'
                                    : isBuy
                                    ? 'bg-emerald-500 text-slate-950 border-emerald-200 shadow-emerald-950/80 ring-1 ring-emerald-400'
                                    : 'bg-rose-500 text-white border-rose-200 shadow-rose-950/80 ring-1 ring-rose-400'
                                }`}
                                title={`Активна заявка на шкалі:\n• Тип: ${ord.type}\n• Напрямок: ${ord.side}\n• Об'єм: ${ord.origQty} ${baseAsset}\n• Ціна: $${formatCryptoPrice(ord.price || ord.stopPrice || row.price)}\n\nНатисніть для скасування`}
                              >
                                <span className="text-[7.5px] uppercase tracking-tighter">
                                  {isTp ? '🎯 TP' : isSl ? '🛡️ SL' : isStopOrder ? '🛑 STOP' : isBuy ? '▲ L' : '▼ S'}
                                </span>
                                <span className="font-extrabold">{ord.origQty}</span>
                                <span className="hover:text-red-200 ml-0.5 font-black text-[9px] group-hover/marker:scale-125 transition-transform" title="Скасувати заявку">✕</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Actual Price on the Scale - ALWAYS VISIBLE! */}
                      <span
                        className={`font-mono font-bold text-[10.5px] sm:text-[11.5px] select-all tracking-tight ${
                          matchingOrders.length > 0
                            ? 'text-white underline decoration-cyan-400 decoration-2 underline-offset-2'
                            : 'text-rose-400'
                        }`}
                      >
                        {formatCryptoPrice(row.price)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* SPREAD AREA: Seamless flow with NO borders, NO boxes */}
            <div
              ref={spreadRowRef}
              className="flex items-center justify-between px-2 sm:px-2.5 h-[16px] bg-slate-900/60 text-slate-400 font-mono text-[9.5px] my-[1px] shrink-0"
            >
              <div className="flex items-center gap-1.5 min-w-0 truncate">
               
                <span className="text-[8.5px] sm:text-[9px] text-slate-500 hidden xs:inline">({spreadPct.toFixed(2)}%)</span>
              </div>
              <span className="text-cyan-400 font-bold text-[11px] sm:text-[12px] shrink-0 text-right pl-1.5 ml-auto">
                {formatCryptoPrice(livePrice)}
              </span>
            </div>

            {/* BIDS (BOTTOM, Longs) */}
            <div className="flex flex-col justify-start">
              {aggregatedBids.map((row) => {
                const fillPct = Math.min(100, Math.max(3, (row.volumeUsd / maxVolumeUsd) * 100));
                const isDensity = row.isDensity;
                const matchingOrders = getOrdersMatchingPrice(row.price);
                const isSwipingThisRow = swipingRow?.price === row.price;
                const deltaX = isSwipingThisRow ? swipingRow.deltaX : 0;
                const isLongTrigger = deltaX >= 40;
                const isShortTrigger = deltaX <= -40;

                return (
                  <div
                    key={`bid-${row.price}`}
                    onClick={() => handleClickBidRow(row.price)}
                    onTouchStart={(e) => handleTouchStartRow(e, row.price)}
                    onTouchMove={(e) => handleTouchMoveRow(e, row.price)}
                    onTouchEnd={(e) => handleTouchEndRow(e, row.price)}
                    onMouseDown={(e) => handleMouseDownRow(e, row.price)}
                    onMouseMove={(e) => handleMouseMoveRow(e, row.price)}
                    onMouseUp={(e) => handleMouseUpRow(e, row.price)}
                    title={`Клік: вибрати ціну $${formatCryptoPrice(row.price)} | Свайп: ${domOrderMode === 'STOP' ? 'Stop Buy / Stop Sell' : 'Limit Long / Short'}`}
                    style={{
                      transform: isSwipingThisRow ? `translateX(${Math.max(-80, Math.min(80, deltaX))}px)` : undefined,
                      transition: isSwipingThisRow ? 'none' : 'transform 0.15s ease',
                    }}
                    className={`relative flex items-center justify-between px-2 sm:px-2.5 h-[21px] transition-colors group cursor-pointer select-none ${
                      matchingOrders.length > 0
                        ? 'bg-slate-900/90 border-y border-cyan-500/40 shadow-xs'
                        : isDensity
                        ? 'bg-emerald-950/70 border-y border-amber-400 shadow-sm shadow-amber-950/50'
                        : 'hover:bg-slate-800/60'
                    }`}
                  >
                    {/* Dark Green Horizontal Volume Bar */}
                    <div
                      className={`absolute left-0 top-0 bottom-0 pointer-events-none transition-all duration-150 ${
                        isDensity ? 'bg-gradient-to-r from-amber-600/70 to-emerald-700/80' : 'bg-emerald-900/60'
                      }`}
                      style={{ width: `${fillPct}%` }}
                    />

                    {/* Active Order Glowing Marker Line across row */}
                    {matchingOrders.length > 0 && (
                      <div
                        className={`absolute inset-0 pointer-events-none z-20 border-y ${
                          matchingOrders.some((o) => o.type.startsWith('STOP'))
                            ? 'border-amber-400 bg-amber-500/15 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
                            : matchingOrders.some((o) => o.type.startsWith('TAKE_PROFIT'))
                            ? 'border-cyan-400 bg-cyan-500/15 shadow-[0_0_10px_rgba(6,182,212,0.25)]'
                            : matchingOrders.some((o) => o.side === 'BUY')
                            ? 'border-emerald-400 bg-emerald-500/15 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
                            : 'border-rose-400 bg-rose-500/15 shadow-[0_0_10px_rgba(244,63,94,0.25)]'
                        }`}
                      >
                        <div className="absolute left-0 top-0 bottom-0 flex items-center pl-1">
                          <span
                            className={`px-1 py-0.2 rounded font-mono font-black text-[7.5px] uppercase tracking-tighter ${
                              matchingOrders.some((o) => o.type.startsWith('STOP'))
                                ? 'bg-amber-500 text-slate-950 ring-1 ring-amber-300'
                                : matchingOrders.some((o) => o.type.startsWith('TAKE_PROFIT'))
                                ? 'bg-cyan-500 text-slate-950 ring-1 ring-cyan-300'
                                : matchingOrders.some((o) => o.side === 'BUY')
                                ? 'bg-emerald-500 text-slate-950 ring-1 ring-emerald-300'
                                : 'bg-rose-500 text-white ring-1 ring-rose-300'
                            }`}
                          >
                            {matchingOrders.some((o) => o.type.startsWith('STOP'))
                              ? '🛑 STOP'
                              : matchingOrders.some((o) => o.type.startsWith('TAKE_PROFIT'))
                              ? '🎯 TP'
                              : matchingOrders.some((o) => o.side === 'BUY')
                              ? '▲ LONG'
                              : '▼ SHORT'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Swipe Right Overlay (Limit Long or Stop Buy) */}
                    {isSwipingThisRow && deltaX > 8 && (
                      <div
                        className={`absolute inset-0 z-30 flex items-center pl-2 gap-1.5 pointer-events-none transition-colors ${
                          domOrderMode === 'STOP'
                            ? isLongTrigger
                              ? 'bg-amber-600/90 text-white font-bold animate-pulse'
                              : 'bg-amber-950/85 text-amber-300'
                            : isLongTrigger
                            ? 'bg-emerald-600/90 text-white font-bold animate-pulse'
                            : 'bg-emerald-950/85 text-emerald-300'
                        }`}
                      >
                        <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                        <span className="text-[9.5px] font-mono font-bold truncate">
                          {domOrderMode === 'STOP'
                            ? isLongTrigger
                              ? '✓ ВІДПУСТІТЬ: СТОП BUY'
                              : 'Свайп: СТОП BUY'
                            : isLongTrigger
                            ? '✓ ВІДПУСТІТЬ: LIMIT LONG'
                            : 'Свайп: LIMIT LONG'} ${formatCryptoPrice(row.price)}
                        </span>
                      </div>
                    )}

                    {/* Swipe Left Overlay (Limit Short or Stop Sell) */}
                    {isSwipingThisRow && deltaX < -8 && (
                      <div
                        className={`absolute inset-0 z-30 flex items-center justify-end pr-2 gap-1.5 pointer-events-none transition-colors ${
                          domOrderMode === 'STOP'
                            ? isShortTrigger
                              ? 'bg-orange-600/90 text-white font-bold animate-pulse'
                              : 'bg-orange-950/85 text-orange-300'
                            : isShortTrigger
                            ? 'bg-rose-600/90 text-white font-bold animate-pulse'
                            : 'bg-rose-950/85 text-rose-300'
                        }`}
                      >
                        <span className="text-[9.5px] font-mono font-bold truncate">
                          {domOrderMode === 'STOP'
                            ? isShortTrigger
                              ? '✓ ВІДПУСТІТЬ: СТОП SELL'
                              : 'Свайп: СТОП SELL'
                            : isShortTrigger
                            ? '✓ ВІДПУСТІТЬ: LIMIT SHORT'
                            : 'Свайп: LIMIT SHORT'} ${formatCryptoPrice(row.price)}
                        </span>
                        <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
                      </div>
                    )}

                    {/* Volume text on Left */}
                    <div className="relative z-10 flex items-center gap-1 min-w-0 pr-1 overflow-hidden">
                      <span className="font-mono text-white text-[10px] sm:text-[11px] font-medium truncate">
                        {formatVolume(row.volumeUsd)}$
                      </span>
                      {isDensity && (
                        <span className="text-[7.5px] sm:text-[8px] font-bold px-1 py-0.2 rounded bg-amber-500 text-slate-950 uppercase tracking-tighter shrink-0">
                          Плотн
                        </span>
                      )}

                      {/* Direct Click Quick Order Buttons on Hover (+L, +S, +Stop) */}
                      <div className="hidden group-hover:flex items-center gap-0.5 ml-0.5 shrink-0 z-30">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            placeDirectDomLimitOrder(row.price, 'BUY');
                          }}
                          className="px-1 py-0.2 rounded bg-emerald-500/30 hover:bg-emerald-500 text-emerald-200 hover:text-slate-950 font-bold text-[7.5px] border border-emerald-500/50 cursor-pointer"
                          title="Виставити Limit LONG на цьому рівні"
                        >
                          +L
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            placeDirectDomLimitOrder(row.price, 'SELL');
                          }}
                          className="px-1 py-0.2 rounded bg-rose-500/30 hover:bg-rose-500 text-rose-200 hover:text-white font-bold text-[7.5px] border border-rose-500/50 cursor-pointer"
                          title="Виставити Limit SHORT на цьому рівні"
                        >
                          +S
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            placeDirectDomStopOrder(row.price, 'SELL');
                          }}
                          className="px-1 py-0.2 rounded bg-amber-500/30 hover:bg-amber-500 text-amber-200 hover:text-slate-950 font-bold text-[7.5px] border border-amber-500/50 cursor-pointer flex items-center gap-0.5"
                          title="Швидкий STOP SELL (Stop Loss) тригер на цьому рівні"
                        >
                          <span>🛑 +Stop</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openStopOrderDialog(row.price, 'SELL');
                          }}
                          className="px-1 py-0.2 rounded bg-slate-800 hover:bg-amber-500/80 text-amber-300 hover:text-slate-950 font-bold text-[7.5px] border border-slate-700 cursor-pointer"
                          title="Відкрити детальне налаштування стоп-заявки для цього рівня"
                        >
                          ⚙️
                        </button>
                      </div>
                    </div>

                    {/* Price Scale Column with Prominent Visual Order Markers */}
                    <div className="relative z-30 shrink-0 text-right pl-1.5 ml-auto flex items-center justify-end gap-1.5">
                      {/* Active Order Markers directly on the scale */}
                      {matchingOrders.length > 0 && (
                        <div className="flex items-center gap-1 select-none animate-in fade-in duration-150">
                          {matchingOrders.map((ord) => {
                            const isTp = ord.type === 'TAKE_PROFIT_MARKET' || ord.type === 'TAKE_PROFIT';
                            const isSl = ord.type === 'STOP_MARKET' || ord.type === 'STOP';
                            const isStopOrder = ord.type.startsWith('STOP');
                            const isBuy = ord.side === 'BUY';

                            return (
                              <div
                                key={ord.orderId}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCancelOrder(ord.orderId);
                                }}
                                className={`flex items-center gap-1 px-1.5 py-0.5 rounded shadow-lg border font-mono font-bold text-[8.5px] cursor-pointer transition-all hover:scale-105 active:scale-95 group/marker ${
                                  isTp
                                    ? 'bg-cyan-500 text-slate-950 border-cyan-200 shadow-cyan-950/80 ring-1 ring-cyan-400'
                                    : isSl
                                    ? 'bg-amber-500 text-slate-950 border-amber-200 shadow-amber-950/80 ring-1 ring-amber-400 animate-pulse'
                                    : isStopOrder
                                    ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white border-amber-200 shadow-orange-950/80 ring-1 ring-orange-400'
                                    : isBuy
                                    ? 'bg-emerald-500 text-slate-950 border-emerald-200 shadow-emerald-950/80 ring-1 ring-emerald-400'
                                    : 'bg-rose-500 text-white border-rose-200 shadow-rose-950/80 ring-1 ring-rose-400'
                                }`}
                                title={`Активна заявка на шкалі:\n• Тип: ${ord.type}\n• Напрямок: ${ord.side}\n• Об'єм: ${ord.origQty} ${baseAsset}\n• Ціна: $${formatCryptoPrice(ord.price || ord.stopPrice || row.price)}\n\nНатисніть для скасування`}
                              >
                                <span className="text-[7.5px] uppercase tracking-tighter">
                                  {isTp ? '🎯 TP' : isSl ? '🛡️ SL' : isStopOrder ? '🛑 STOP' : isBuy ? '▲ L' : '▼ S'}
                                </span>
                                <span className="font-extrabold">{ord.origQty}</span>
                                <span className="hover:text-red-200 ml-0.5 font-black text-[9px] group-hover/marker:scale-125 transition-transform" title="Скасувати заявку">✕</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Actual Price on the Scale - ALWAYS VISIBLE! */}
                      <span
                        className={`font-mono font-bold text-[10.5px] sm:text-[11.5px] select-all tracking-tight ${
                          matchingOrders.length > 0
                            ? 'text-white underline decoration-cyan-400 decoration-2 underline-offset-2'
                            : 'text-emerald-400'
                        }`}
                      >
                        {formatCryptoPrice(row.price)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ================= TRADE TOAST NOTIFICATION ================= */}
      {tradeToast && (
        <div
          className={`absolute top-12 right-3 z-50 px-3.5 py-2 rounded-xl border text-xs shadow-2xl backdrop-blur-md flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200 ${
            tradeToast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-200'
              : tradeToast.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/60 text-rose-200'
              : 'bg-sky-950/90 border-sky-500/60 text-sky-200'
          }`}
        >
          {tradeToast.type === 'success' ? (
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : tradeToast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-sky-400 shrink-0" />
          )}
          <span className="font-medium">{tradeToast.message}</span>
          <button
            onClick={() => setTradeToast(null)}
            className="ml-2 text-slate-400 hover:text-white p-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {/* ================= MODAL: ADD STOP ORDER (ДОДАТИ СТОП-ЗАЯВКУ) ================= */}
      {isStopModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-4 sm:p-5 space-y-4 text-white">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <span>Виставити стоп-заявку</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono">
                      {cleanSymbol}
                    </span>
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Поточна ринкова ціна: <strong className="text-cyan-400 font-mono">${formatCryptoPrice(livePrice)}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsStopModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Side Selector: BUY (Long Breakout) vs SELL (Stop Loss / Breakdown) */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStopModalSide('BUY')}
                className={`py-2 px-3 rounded-xl font-bold text-xs flex flex-col items-center gap-0.5 border cursor-pointer transition-all ${
                  stopModalSide === 'BUY'
                    ? 'bg-emerald-600 border-emerald-400 text-white shadow-lg shadow-emerald-950/60'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-emerald-300'
                }`}
              >
                <span className="flex items-center gap-1">
                  <span>▲ СТОП BUY</span>
                  <span className="text-[9px] opacity-80">(Long)</span>
                </span>
                <span className="text-[9px] font-normal opacity-75">Пробій вище ринку / закриття шорта</span>
              </button>

              <button
                type="button"
                onClick={() => setStopModalSide('SELL')}
                className={`py-2 px-3 rounded-xl font-bold text-xs flex flex-col items-center gap-0.5 border cursor-pointer transition-all ${
                  stopModalSide === 'SELL'
                    ? 'bg-rose-600 border-rose-400 text-white shadow-lg shadow-rose-950/60'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-rose-300'
                }`}
              >
                <span className="flex items-center gap-1">
                  <span>▼ СТОП SELL</span>
                  <span className="text-[9px] opacity-80">(Short / SL)</span>
                </span>
                <span className="text-[9px] font-normal opacity-75">Стоп-лос лонга / пробій підтримки</span>
              </button>
            </div>

            {/* Stop Type Selector: STOP_MARKET vs STOP (Limit) */}
            <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setStopModalType('STOP_MARKET')}
                className={`flex-1 py-1.5 rounded-lg font-bold transition-colors cursor-pointer text-center ${
                  stopModalType === 'STOP_MARKET'
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Стоп-Маркет (Stop Market)
              </button>
              <button
                type="button"
                onClick={() => setStopModalType('STOP')}
                className={`flex-1 py-1.5 rounded-lg font-bold transition-colors cursor-pointer text-center ${
                  stopModalType === 'STOP'
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Стоп-Ліміт (Stop Limit)
              </button>
            </div>

            {/* Trigger Price Field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label className="text-slate-300 font-medium">Тригерна стоп-ціна (Stop Price)</label>
                <span className="text-[10px] text-amber-400 font-mono">Ціна активації заявки</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  value={stopModalTriggerPrice}
                  onChange={(e) => setStopModalTriggerPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-sm text-amber-300 font-mono focus:outline-none focus:border-amber-400"
                />
                <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-mono">USDT</span>
              </div>

              {/* Quick Trigger Presets based on live price */}
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span className="text-[10px] text-slate-400">Швидкі рівні:</span>
                {[
                  { label: 'Поточна', mult: 1 },
                  { label: '+0.5%', mult: 1.005 },
                  { label: '+1.0%', mult: 1.01 },
                  { label: '+2.0%', mult: 1.02 },
                  { label: '-0.5%', mult: 0.995 },
                  { label: '-1.0%', mult: 0.99 },
                  { label: '-2.0%', mult: 0.98 },
                ].map((preset) => {
                  const calculatedP = livePrice * preset.mult;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setStopModalTriggerPrice(calculatedP.toFixed(livePrice > 100 ? 2 : 4))}
                      className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-slate-300 hover:text-white border border-slate-700 cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Execution Price Field (Only if STOP limit) */}
            {stopModalType === 'STOP' && (
              <div className="space-y-1.5 animate-in fade-in">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-slate-300 font-medium">Ціна виконання (Limit Price)</label>
                  <span className="text-[10px] text-cyan-400 font-mono">Лімітна ціна в стакані</span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={stopModalLimitPrice}
                    onChange={(e) => setStopModalLimitPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-sm text-cyan-300 font-mono focus:outline-none focus:border-cyan-400"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-mono">USDT</span>
                </div>
              </div>
            )}

            {/* Order Amount USDT */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label className="text-slate-300 font-medium">Об'єм ордера</label>
                <span className="text-[10px] font-mono text-slate-400">
                  ≈ {stopModalQty} {baseAsset}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    step="any"
                    value={stopModalAmountUsdt}
                    onChange={(e) => setStopModalAmountUsdt(e.target.value)}
                    placeholder="50"
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-mono">USDT</span>
                </div>
                {/* Quick USDT Presets */}
                <div className="flex items-center gap-1 shrink-0">
                  {['25', '50', '100', '250', '500'].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setStopModalAmountUsdt(amt)}
                      className={`px-2 py-1.5 rounded-lg text-xs font-mono border cursor-pointer transition-colors ${
                        stopModalAmountUsdt === amt
                          ? 'bg-cyan-500/30 border-cyan-400 text-cyan-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Reduce-Only checkbox for futures */}
            {marketType === 'futures' && (
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={stopModalReduceOnly}
                  onChange={(e) => setStopModalReduceOnly(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <span>Тільки скорочення позиції (Reduce-Only / Стоп-лос без ризику розвороту)</span>
              </label>
            )}

            {/* Action Buttons */}
            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsStopModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs cursor-pointer transition-colors"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={handleExecuteStopModalOrder}
                disabled={isSubmittingOrder || !stopModalTriggerPrice || parseFloat(stopModalTriggerPrice) <= 0}
                className={`flex-[2] py-2.5 rounded-xl font-bold text-xs text-white shadow-xl cursor-pointer transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 ${
                  stopModalSide === 'BUY'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-950/50'
                    : 'bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 shadow-rose-950/50'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>
                  {isSubmittingOrder
                    ? 'Надсилання...'
                    : `Встановити Стоп ${stopModalSide === 'BUY' ? 'BUY ▲' : 'SELL ▼'} ($${stopModalTriggerPrice || '0'})`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= TRADING CONTROL PANEL (HUD) ================= */}
      {isTradePanelOpen && (
        <div className="shrink-0 w-full border-t border-slate-800/90 bg-[#070a10] p-2 sm:p-2.5 z-20 flex flex-col gap-2">
          {/* Top Bar: Exchange info + Balance + Tabs + Orders Drawer Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/70 pb-2">
            {/* Left: Account & API status */}
            <div className="flex items-center gap-2 min-w-0">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                exchange === 'binance' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
              }`}>
                {exchange} {marketType}
              </span>

              {hasExchangeApi ? (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-400 text-[10px]">Доступно:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    ${accountBalance ? accountBalance.availableBalance.toFixed(2) : '---'}
                  </span>
                  <button
                    onClick={fetchBalance}
                    disabled={isRefreshingBalance}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                    title="Оновити баланс"
                  >
                    <RefreshCw className={`w-3 h-3 ${isRefreshingBalance ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('open_user_profile_modal', { detail: { tab: 'exchange_api' } }))}
                  className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30 font-semibold cursor-pointer"
                >
                  <Settings className="w-3 h-3" />
                  <span>Підключити API біржі у Профілі</span>
                </button>
              )}
            </div>

            {/* Center: Order Types Tabs */}
            <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px]">
              {(
                [
                  { id: 'LIMIT' as OrderType, label: 'Лімітка' },
                  { id: 'MARKET' as OrderType, label: 'По ринку' },
                  { id: 'STOP' as OrderType, label: 'Стоп-заявка' },
                  { id: 'STOP_MARKET' as OrderType, label: 'Стоп-лос' },
                  { id: 'TAKE_PROFIT_MARKET' as OrderType, label: 'Тейк-профіт' },
                ]
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setOrderType(t.id)}
                  className={`px-2 py-1 rounded font-bold transition-all cursor-pointer ${
                    orderType === t.id
                      ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/50 shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Right: Open Orders counter & Panel Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOpenOrdersOpen(!openOrdersOpen)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                  openOrders.length > 0
                    ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="Переглянути активні відкриті заявки"
              >
                <span>Заявки ({openOrders.length})</span>
                {openOrdersOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              </button>

              <button
                onClick={handleToggleTradePanel}
                className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-800 cursor-pointer"
                title="Згорнути панель торгівлі"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Controls Row: Inputs (Price, Trigger, Volume) + Buy/Sell Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2 items-center">
            {/* Price Input (if not Market) */}
            {orderType !== 'MARKET' ? (
              <div className="lg:col-span-3 flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Ціна ордера ($)</span>
                  <button
                    type="button"
                    onClick={() => setOrderPrice(livePrice.toString())}
                    className="text-cyan-400 hover:underline cursor-pointer font-mono"
                  >
                    Ринок: {formatCryptoPrice(livePrice)}
                  </button>
                </div>
                <input
                  type="number"
                  step="any"
                  value={orderPrice}
                  onChange={(e) => setOrderPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            ) : (
              <div className="lg:col-span-3 flex flex-col justify-center gap-1 p-2 rounded-lg bg-slate-950/60 border border-slate-800/60 text-[11px] text-slate-400">
                <span>Виконання: <strong className="text-white">По найкращій ринковій ціні</strong></span>
                <span className="text-[10px] font-mono text-cyan-400">Поточна: ${formatCryptoPrice(livePrice)}</span>
              </div>
            )}

            {/* Stop Price Input (when conditional) */}
            {(orderType === 'STOP' || orderType === 'STOP_MARKET' || orderType === 'TAKE_PROFIT_MARKET' || orderType === 'TAKE_PROFIT') && (
              <div className="lg:col-span-3 flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Тригерна стоп-ціна ($)</span>
                  <span className="text-amber-400 text-[9px]">StopPrice</span>
                </div>
                <input
                  type="number"
                  step="any"
                  value={orderStopPrice}
                  onChange={(e) => setOrderStopPrice(e.target.value)}
                  placeholder="Вкажіть тригер"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-500"
                />
                <div className="flex items-center gap-1 flex-wrap pt-0.5">
                  <span className="text-[8.5px] text-slate-500">Тригер:</span>
                  {[
                    { label: 'Поточна', mult: 1 },
                    { label: '+0.5%', mult: 1.005 },
                    { label: '+1%', mult: 1.01 },
                    { label: '-0.5%', mult: 0.995 },
                    { label: '-1%', mult: 0.99 },
                  ].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setOrderStopPrice((livePrice * p.mult).toFixed(livePrice > 100 ? 2 : 4))}
                      className="px-1 py-0.2 rounded bg-slate-900 hover:bg-slate-800 text-[8px] font-mono text-amber-300 hover:text-white border border-slate-800 cursor-pointer"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity / Volume input */}
            <div className={`${(orderType === 'STOP' || orderType === 'STOP_MARKET' || orderType === 'TAKE_PROFIT_MARKET' || orderType === 'TAKE_PROFIT') ? 'lg:col-span-3' : 'lg:col-span-5'} flex flex-col gap-1`}>
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <div className="flex items-center gap-1">
                  <span>Об'єм:</span>
                  <button
                    type="button"
                    onClick={() => setOrderUnit(orderUnit === 'usdt' ? 'coin' : 'usdt')}
                    className="text-cyan-400 font-bold hover:underline cursor-pointer uppercase"
                  >
                    [{orderUnit}]
                  </button>
                </div>
                <span className="font-mono text-slate-300 text-[10px]">
                  ≈ {calculatedQty} {symbol.replace(/USDT$/i, '')} (${calculatedUsdTotal.toFixed(2)})
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="any"
                  value={orderUnit === 'usdt' ? orderAmountUsdt : orderAmountCoin}
                  onChange={(e) => {
                    if (orderUnit === 'usdt') setOrderAmountUsdt(e.target.value);
                    else setOrderAmountCoin(e.target.value);
                  }}
                  placeholder="0"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                />
                {/* Quick Presets */}
                <div className="flex items-center gap-1 shrink-0">
                  {['25', '50', '100', '500'].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        setOrderUnit('usdt');
                        setOrderAmountUsdt(amt);
                      }}
                      className="px-1.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[9px] font-mono text-slate-300 hover:text-white cursor-pointer"
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Buy & Sell Action Buttons */}
            <div className={`${(orderType === 'STOP' || orderType === 'STOP_MARKET' || orderType === 'TAKE_PROFIT_MARKET' || orderType === 'TAKE_PROFIT') ? 'lg:col-span-3' : 'lg:col-span-4'} flex items-center gap-2 pt-1 sm:pt-0`}>
              <button
                type="button"
                onClick={() => handlePlaceOrder('BUY')}
                disabled={isSubmittingOrder || calculatedQty <= 0}
                className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 transition-all flex flex-col items-center justify-center disabled:opacity-40 cursor-pointer active:scale-95"
              >
                <span>
                  {isSubmittingOrder
                    ? 'Надсилання...'
                    : (orderType.startsWith('STOP') ? '🛑 СТОП BUY' : 'КУПИТИ (LONG)')}
                </span>
                <span className="text-[9px] font-mono opacity-80">+{calculatedQty}</span>
              </button>

              <button
                type="button"
                onClick={() => handlePlaceOrder('SELL')}
                disabled={isSubmittingOrder || calculatedQty <= 0}
                className="flex-1 py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-950/50 transition-all flex flex-col items-center justify-center disabled:opacity-40 cursor-pointer active:scale-95"
              >
                <span>
                  {isSubmittingOrder
                    ? 'Надсилання...'
                    : (orderType.startsWith('STOP') ? '🛑 СТОП SELL' : 'ПРОДАТИ (SHORT)')}
                </span>
                <span className="text-[9px] font-mono opacity-80">-{calculatedQty}</span>
              </button>
            </div>
          </div>

          {/* Open Orders Section (when toggled open) */}
          {openOrdersOpen && (
            <div className="pt-2 border-t border-slate-800/80 space-y-1.5 animate-in fade-in">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Відкриті заявки по {cleanSymbol} ({openOrders.length})</span>
                </span>
                {openOrders.length > 0 && (
                  <button
                    type="button"
                    onClick={handleCancelAllOrders}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-[10px] font-bold cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    <span>Скасувати всі заявки</span>
                  </button>
                )}
              </div>

              {openOrders.length === 0 ? (
                <div className="text-[11px] text-slate-500 py-2.5 text-center bg-slate-950/50 rounded-lg border border-slate-900">
                  Активних заявок по {cleanSymbol} немає
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-2 pr-0.5">
                  {openOrders.map((ord) => {
                    const isLong = ord.side === 'BUY';
                    const isTp = ord.type === 'TAKE_PROFIT_MARKET' || ord.type === 'TAKE_PROFIT';
                    const isSl = ord.type === 'STOP_MARKET' || ord.type === 'STOP';
                    const isExpanded = expandedTpSlOrderId === ord.orderId;
                    const entryPrice = ord.price || ord.stopPrice || livePrice;

                    return (
                      <div
                        key={ord.orderId}
                        className="flex flex-col rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono overflow-hidden shadow-sm"
                      >
                        <div className="flex items-center justify-between px-2.5 py-1.5 flex-wrap gap-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-1.5 py-0.2 rounded font-bold text-[9px] ${
                                isTp
                                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                  : isSl
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : isLong
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                              }`}
                            >
                              {isTp ? '🎯 TP' : isSl ? '🛡️ SL' : isLong ? 'LONG ▲' : 'SHORT ▼'}
                            </span>
                            <span className="font-bold text-slate-200">{ord.type}</span>
                            <span className="text-slate-400">
                              Об'єм: <strong className="text-white">{ord.origQty}</strong> {baseAsset}
                            </span>
                            {ord.price ? (
                              <span className="text-cyan-300">Ціна: ${formatCryptoPrice(ord.price)}</span>
                            ) : null}
                            {ord.stopPrice ? (
                              <span className="text-amber-300">Стоп: ${formatCryptoPrice(ord.stopPrice)}</span>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* TP/SL Button for Main Orders */}
                            {!isTp && !isSl && (
                              <button
                                type="button"
                                onClick={() => {
                                  const opening = !isExpanded;
                                  setExpandedTpSlOrderId(opening ? ord.orderId : null);
                                  if (opening) {
                                    const defaultTp = isLong ? entryPrice * 1.01 : entryPrice * 0.99;
                                    const defaultSl = isLong ? entryPrice * 0.995 : entryPrice * 1.005;
                                    setTpSlCustomValues((prev) => ({
                                      ...prev,
                                      [ord.orderId]: {
                                        tpPct: 1,
                                        slPct: 0.5,
                                        tpPrice: defaultTp.toFixed(entryPrice > 100 ? 2 : 4),
                                        slPrice: defaultSl.toFixed(entryPrice > 100 ? 2 : 4),
                                      },
                                    }));
                                  }
                                }}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                                  isExpanded
                                    ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                                    : 'bg-cyan-950/70 hover:bg-cyan-900 border-cyan-800/80 text-cyan-300'
                                }`}
                                title="Розставити або змінити Take Profit та Stop Loss для цієї заявки"
                              >
                                <Target className="w-3 h-3" />
                                <span>{isExpanded ? 'Закрити TP/SL' : 'TP / SL'}</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleCancelOrder(ord.orderId)}
                              className="p-1 rounded text-rose-400 hover:text-rose-200 hover:bg-rose-950/60 transition-colors cursor-pointer"
                              title="Скасувати цей ордер"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Interactive TP/SL Placement Form Drawer */}
                        {isExpanded && (
                          <div className="p-2.5 bg-slate-900/90 border-t border-slate-800 space-y-2">
                            <div className="flex items-center justify-between text-[10px] text-slate-300">
                              <span className="font-bold flex items-center gap-1 text-cyan-300">
                                <Target className="w-3 h-3" />
                                <span>
                                  Розставлення TP / SL для {isLong ? 'LONG ▲' : 'SHORT ▼'} ({ord.origQty} {baseAsset})
                                </span>
                              </span>
                              <span className="text-slate-400 font-mono">
                                Базова ціна: <strong className="text-white">${formatCryptoPrice(entryPrice)}</strong>
                              </span>
                            </div>

                            {/* Take Profit Setting Block */}
                            <div className="p-1.5 rounded-lg bg-emerald-950/40 border border-emerald-900/60 space-y-1.5">
                              <div className="flex items-center justify-between text-[9.5px]">
                                <span className="font-bold text-emerald-400 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                  <span>Take Profit (TP)</span>
                                </span>
                                <div className="flex items-center gap-1">
                                  {[0.5, 1, 1.5, 2, 3, 5].map((pct) => (
                                    <button
                                      key={pct}
                                      type="button"
                                      onClick={() => {
                                        const newTp = isLong ? entryPrice * (1 + pct / 100) : entryPrice * (1 - pct / 100);
                                        setTpSlCustomValues((prev) => ({
                                          ...prev,
                                          [ord.orderId]: {
                                            ...prev[ord.orderId],
                                            tpPct: pct,
                                            tpPrice: newTp.toFixed(entryPrice > 100 ? 2 : 4),
                                          },
                                        }));
                                      }}
                                      className={`px-1.5 py-0.2 rounded text-[8.5px] font-mono cursor-pointer transition-colors ${
                                        tpSlCustomValues[ord.orderId]?.tpPct === pct
                                          ? 'bg-emerald-500 text-slate-950 font-bold'
                                          : 'bg-emerald-900/50 hover:bg-emerald-900 text-emerald-200'
                                      }`}
                                    >
                                      +{pct}%
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 flex-1">
                                  <span className="text-[9px] text-slate-400">Ціна TP:</span>
                                  <input
                                    type="number"
                                    step="any"
                                    value={tpSlCustomValues[ord.orderId]?.tpPrice || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setTpSlCustomValues((prev) => ({
                                        ...prev,
                                        [ord.orderId]: {
                                          ...prev[ord.orderId],
                                          tpPrice: val,
                                        },
                                      }));
                                    }}
                                    className="flex-1 bg-slate-950 border border-emerald-700/60 rounded px-1.5 py-0.5 text-[10px] text-emerald-300 font-mono focus:outline-none"
                                    placeholder="Ціна Take Profit"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const tpP = parseFloat(tpSlCustomValues[ord.orderId]?.tpPrice || '0');
                                    if (tpP > 0) handleSetTpSlForOrder(ord, tpP, undefined);
                                  }}
                                  className="px-2 py-0.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[9px] cursor-pointer"
                                >
                                  Встановити TP
                                </button>
                              </div>
                            </div>

                            {/* Stop Loss Setting Block */}
                            <div className="p-1.5 rounded-lg bg-rose-950/40 border border-rose-900/60 space-y-1.5">
                              <div className="flex items-center justify-between text-[9.5px]">
                                <span className="font-bold text-rose-400 flex items-center gap-1">
                                  <Shield className="w-2.5 h-2.5" />
                                  <span>Stop Loss (SL)</span>
                                </span>
                                <div className="flex items-center gap-1">
                                  {[0.3, 0.5, 0.8, 1, 1.5, 2].map((pct) => (
                                    <button
                                      key={pct}
                                      type="button"
                                      onClick={() => {
                                        const newSl = isLong ? entryPrice * (1 - pct / 100) : entryPrice * (1 + pct / 100);
                                        setTpSlCustomValues((prev) => ({
                                          ...prev,
                                          [ord.orderId]: {
                                            ...prev[ord.orderId],
                                            slPct: pct,
                                            slPrice: newSl.toFixed(entryPrice > 100 ? 2 : 4),
                                          },
                                        }));
                                      }}
                                      className={`px-1.5 py-0.2 rounded text-[8.5px] font-mono cursor-pointer transition-colors ${
                                        tpSlCustomValues[ord.orderId]?.slPct === pct
                                          ? 'bg-rose-500 text-white font-bold'
                                          : 'bg-rose-900/50 hover:bg-rose-900 text-rose-200'
                                      }`}
                                    >
                                      -{pct}%
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1 flex-1">
                                  <span className="text-[9px] text-slate-400">Ціна SL:</span>
                                  <input
                                    type="number"
                                    step="any"
                                    value={tpSlCustomValues[ord.orderId]?.slPrice || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setTpSlCustomValues((prev) => ({
                                        ...prev,
                                        [ord.orderId]: {
                                          ...prev[ord.orderId],
                                          slPrice: val,
                                        },
                                      }));
                                    }}
                                    className="flex-1 bg-slate-950 border border-rose-700/60 rounded px-1.5 py-0.5 text-[10px] text-rose-300 font-mono focus:outline-none"
                                    placeholder="Ціна Stop Loss"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const slP = parseFloat(tpSlCustomValues[ord.orderId]?.slPrice || '0');
                                    if (slP > 0) handleSetTpSlForOrder(ord, undefined, slP);
                                  }}
                                  className="px-2 py-0.5 rounded bg-rose-500 hover:bg-rose-400 text-white font-bold text-[9px] cursor-pointer"
                                >
                                  Встановити SL
                                </button>
                              </div>
                            </div>

                            {/* One Click Both TP & SL Button */}
                            <button
                              type="button"
                              onClick={() => {
                                const tpP = parseFloat(tpSlCustomValues[ord.orderId]?.tpPrice || '0');
                                const slP = parseFloat(tpSlCustomValues[ord.orderId]?.slPrice || '0');
                                if (tpP > 0 || slP > 0) {
                                  handleSetTpSlForOrder(ord, tpP > 0 ? tpP : undefined, slP > 0 ? slP : undefined);
                                }
                              }}
                              className="w-full py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 via-sky-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-[10px] font-bold shadow-md cursor-pointer transition-all flex items-center justify-center gap-1.5"
                            >
                              <Target className="w-3 h-3" />
                              <span>✓ Виставити TP і SL в один клік</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
