import { ExchangeId, MarketCandle, Timeframe } from '../../types';
import { normalizeBinanceWsKline, normalizeBybitWsKline } from './marketDataNormalizer';

export interface StreamCallbacks {
  onCandle: (candle: MarketCandle) => void;
  onTick: (data: { price: number; high24h: number; low24h: number; change24h: number; volumeUsd: number }) => void;
  onStatus: (status: 'LIVE' | 'RECONNECTING' | 'OFFLINE', latencyMs: number) => void;
  onReconnect?: () => void;
}

export class RealtimeMarketStream {
  private ws: WebSocket | null = null;
  private isDestroyed = false;
  private reconnectTimer: any = null;
  private pingTimer: any = null;
  private watchdogTimer: any = null;
  private reconnectAttempts = 0;
  private lastMessageAt = 0;

  constructor(
    public readonly exchange: ExchangeId,
    public readonly symbol: string,
    public readonly timeframe: Timeframe,
    private callbacks: StreamCallbacks
  ) {
    this.connect();
    this.startWatchdog();
  }

  private cleanSymbol(): string {
    return this.symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  private getBinanceInterval(): string {
    const map: Record<string, string> = {
      '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
      '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h',
      '1d': '1d', '1w': '1w',
    };
    return map[this.timeframe] || '1h';
  }

  private getBybitInterval(): string {
    const map: Record<string, string> = {
      '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
      '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
      '1d': 'D', '1w': 'W',
    };
    return map[this.timeframe] || '60';
  }

  private connect() {
    if (this.isDestroyed) return;
    this.cleanupSocket();

    const sym = this.cleanSymbol();

    if (this.exchange === 'binance') {
      const lower = sym.toLowerCase();
      const interval = this.getBinanceInterval();
      // Combined stream for kline and 24h ticker
      const url = `wss://fstream.binance.com/stream?streams=${lower}@kline_${interval}/${lower}@ticker`;

      try {
        this.ws = new WebSocket(url);
        this.callbacks.onStatus('RECONNECTING', 0);

        this.ws.onopen = () => {
          if (this.isDestroyed) return;
          this.reconnectAttempts = 0;
          this.lastMessageAt = Date.now();
          this.callbacks.onStatus('LIVE', 0);
          this.callbacks.onReconnect?.();
        };

        this.ws.onmessage = (event) => {
          if (this.isDestroyed) return;
          const now = Date.now();
          this.lastMessageAt = now;

          try {
            const raw = JSON.parse(event.data);
            const msg = raw.data || raw;

            if (msg.e === 'kline' && msg.k) {
              const candle = normalizeBinanceWsKline(msg.k);
              const latency = msg.E ? Math.max(0, now - msg.E) : 0;
              this.callbacks.onCandle(candle);
              this.callbacks.onStatus('LIVE', latency);
            } else if (msg.e === '24hrTicker') {
              const price = parseFloat(msg.c || '0');
              const high24h = parseFloat(msg.h || '0');
              const low24h = parseFloat(msg.l || '0');
              const change24h = parseFloat(msg.P || '0');
              const volumeUsd = parseFloat(msg.q || '0');
              this.callbacks.onTick({ price, high24h, low24h, change24h, volumeUsd });
            }
          } catch {}
        };

        this.ws.onerror = () => {
          if (this.isDestroyed) return;
          this.callbacks.onStatus('RECONNECTING', 0);
        };

        this.ws.onclose = () => {
          if (this.isDestroyed) return;
          this.callbacks.onStatus('OFFLINE', 0);
          this.scheduleReconnect();
        };
      } catch {
        this.scheduleReconnect();
      }
    } else {
      // Bybit
      const url = 'wss://stream.bybit.com/v5/public/linear';
      const interval = this.getBybitInterval();

      try {
        this.ws = new WebSocket(url);
        this.callbacks.onStatus('RECONNECTING', 0);

        this.ws.onopen = () => {
          if (this.isDestroyed) return;
          this.reconnectAttempts = 0;
          this.lastMessageAt = Date.now();
          this.callbacks.onStatus('LIVE', 0);

          // Subscribe to kline and tickers
          const subMsg = {
            op: 'subscribe',
            args: [`kline.${interval}.${sym}`, `tickers.${sym}`],
          };
          this.ws?.send(JSON.stringify(subMsg));

          // Bybit heartbeat ping every 20s
          this.pingTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ op: 'ping' }));
            }
          }, 20000);

          this.callbacks.onReconnect?.();
        };

        this.ws.onmessage = (event) => {
          if (this.isDestroyed) return;
          const now = Date.now();
          this.lastMessageAt = now;

          try {
            const msg = JSON.parse(event.data);
            if (msg.op === 'pong' || msg.ret_msg === 'pong') return;

            const topic = msg.topic || '';
            if (topic.startsWith('kline.') && Array.isArray(msg.data) && msg.data[0]) {
              const candle = normalizeBybitWsKline(msg.data[0]);
              const latency = msg.ts ? Math.max(0, now - msg.ts) : 0;
              this.callbacks.onCandle(candle);
              this.callbacks.onStatus('LIVE', latency);
            } else if (topic.startsWith('tickers.') && msg.data) {
              const d = msg.data;
              const price = parseFloat(d.lastPrice || '0');
              const high24h = parseFloat(d.highPrice24h || '0');
              const low24h = parseFloat(d.lowPrice24h || '0');
              const change24h = parseFloat(d.price24hPcnt || '0') * 100;
              const volumeUsd = parseFloat(d.turnover24h || '0');
              this.callbacks.onTick({ price, high24h, low24h, change24h, volumeUsd });
            }
          } catch {}
        };

        this.ws.onerror = () => {
          if (this.isDestroyed) return;
          this.callbacks.onStatus('RECONNECTING', 0);
        };

        this.ws.onclose = () => {
          if (this.isDestroyed) return;
          this.callbacks.onStatus('OFFLINE', 0);
          this.scheduleReconnect();
        };
      } catch {
        this.scheduleReconnect();
      }
    }
  }

  private startWatchdog() {
    this.watchdogTimer = setInterval(() => {
      if (this.isDestroyed) return;
      const now = Date.now();
      // If connected but no message for > 15s, reconnect
      if (this.ws?.readyState === WebSocket.OPEN && now - this.lastMessageAt > 15000) {
        console.warn(`[Chart WS] Watchdog: stale connection for ${this.symbol} on ${this.exchange}. Reconnecting...`);
        this.connect();
      }
    }, 5000);
  }

  private scheduleReconnect() {
    if (this.isDestroyed || this.reconnectTimer) return;
    const delays = [1000, 2000, 4000, 8000, 15000];
    const delay = delays[Math.min(this.reconnectAttempts, delays.length - 1)];
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isDestroyed) {
        this.connect();
      }
    }, delay);
  }

  private cleanupSocket() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.cleanupSocket();
  }
}
