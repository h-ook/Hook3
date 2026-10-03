import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { ExchangeId, MarketType } from '../../src/types';
import { OrderBookStatus } from './types';

export interface RawTradeEvent {
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  time: number;
  isBuyerMaker: boolean;
}

export interface RawDepthDelta {
  bids: [number, number][]; // [price, qty]
  asks: [number, number][];
  isSnapshot?: boolean;
  sequence?: number;
}

export class ExchangeStreamClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private isDestroyed = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  private reconnectAttempts = 0;
  private readonly backoffSchedule = [1000, 2000, 4000, 8000, 15000, 30000];

  public status: OrderBookStatus = 'CONNECTING';
  public lastDataReceivedAt = 0;

  constructor(
    public readonly symbol: string,
    public readonly exchange: ExchangeId,
    public readonly marketType: MarketType
  ) {
    super();
    this.connect();
    this.startWatchdog();
  }

  private cleanSymbol(): string {
    return this.symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }

  /**
   * Correct WebSocket endpoint formatting:
   * Binance multiplex streams:
   * - Futures: wss://fstream.binance.com/stream?streams=<s1>/<s2>/<s3>
   * - Spot: wss://stream.binance.com:9443/stream?streams=<s1>/<s2>/<s3>
   * Bybit v5 public:
   * - Futures: wss://stream.bybit.com/v5/public/linear
   * - Spot: wss://stream.bybit.com/v5/public/spot
   */
  private getWebSocketUrl(): string {
    const sym = this.cleanSymbol();
    if (this.exchange === 'binance') {
      const lower = sym.toLowerCase();
      if (this.marketType === 'futures') {
        const streams = [
          `${lower}@ticker`,
          `${lower}@aggTrade`,
          `${lower}@depth20@100ms`,
        ].join('/');
        return `wss://fstream.binance.com/stream?streams=${streams}`;
      } else {
        const streams = [
          `${lower}@ticker`,
          `${lower}@trade`,
          `${lower}@depth20@100ms`,
        ].join('/');
        return `wss://stream.binance.com:9443/stream?streams=${streams}`;
      }
    } else {
      // Bybit
      if (this.marketType === 'futures') {
        return 'wss://stream.bybit.com/v5/public/linear';
      } else {
        return 'wss://stream.bybit.com/v5/public/spot';
      }
    }
  }

  private setStatus(newStatus: OrderBookStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.emit('status', newStatus);
    }
  }

  public connect() {
    if (this.isDestroyed) return;
    this.cleanupSocket();

    const url = this.getWebSocketUrl();
    this.setStatus('CONNECTING');

    try {
      this.ws = new WebSocket(url, {
        handshakeTimeout: 10000,
      });

      this.ws.on('open', () => {
        if (this.isDestroyed) return;
        this.reconnectAttempts = 0;
        this.setStatus('SYNCING');
        this.lastDataReceivedAt = Date.now();

        // If Bybit, send subscription payload and start heartbeat ping
        if (this.exchange === 'bybit') {
          const sym = this.cleanSymbol();
          const subscribeMsg = {
            op: 'subscribe',
            args: [`tickers.${sym}`, `publicTrade.${sym}`, `orderbook.50.${sym}`],
          };
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(subscribeMsg));
          }

          // Bybit heartbeat ping every 20 seconds
          this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ op: 'ping' }));
            }
          }, 20000);
        } else {
          // Binance ping interval: actively keep TCP connection alive
          this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              try {
                this.ws.ping();
              } catch {}
            }
          }, 25000);
        }
      });

      this.ws.on('ping', (data) => {
        if (this.isDestroyed) return;
        this.lastDataReceivedAt = Date.now();
        try {
          this.ws?.pong(data);
        } catch {}
      });

      this.ws.on('pong', () => {
        if (this.isDestroyed) return;
        this.lastDataReceivedAt = Date.now();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        if (this.isDestroyed) return;
        this.lastDataReceivedAt = Date.now();
        try {
          const str = data.toString();
          const json = JSON.parse(str);
          this.handleIncomingMessage(json);
        } catch (e) {
          // Ignore invalid JSON frames
        }
      });

      this.ws.on('error', (err) => {
        if (this.isDestroyed) return;
        this.setStatus('ERROR');
        console.warn(`[exchangeStream ${this.symbol} (${this.exchange})] Socket error: ${err.message}`);
        this.emit('error', err);
      });

      this.ws.on('close', (code, reason) => {
        if (this.isDestroyed) return;
        const reasonStr = reason ? reason.toString() : 'None';
        console.log(`[exchangeStream ${this.symbol} (${this.exchange})] Socket closed (code: ${code}, reason: ${reasonStr}). Scheduling reconnect...`);
        this.setStatus('STALE');
        this.scheduleReconnect(`close_code_${code}`);
      });
    } catch (e: any) {
      this.setStatus('ERROR');
      console.error(`[exchangeStream ${this.symbol} (${this.exchange})] Connect exception: ${e?.message}`);
      this.scheduleReconnect('connect_exception');
    }
  }

  private handleIncomingMessage(msg: any) {
    if (this.exchange === 'binance') {
      this.handleBinanceMessage(msg);
    } else {
      this.handleBybitMessage(msg);
    }
  }

  private handleBinanceMessage(msg: any) {
    // In Binance combined streams (/stream?streams=...), payload is wrapped in { stream: string, data: any }
    const raw = (msg && msg.data) ? msg.data : msg;
    if (!raw) return;

    const eventType = raw.e;

    // 1. Ticker stream (24hr ticker)
    if (eventType === '24hrTicker' || (raw.s && raw.c !== undefined)) {
      const price = parseFloat(raw.c);
      const high24h = parseFloat(raw.h || 0);
      const low24h = parseFloat(raw.l || 0);
      const volume24hUsd = parseFloat(raw.q || 0);
      if (!isNaN(price) && price > 0) {
        this.emit('price', {
          price,
          high24h,
          low24h,
          volume24hUsd,
          time: raw.E || Date.now(),
        });
      }
    }

    // 2. Trade stream (trade or aggTrade)
    if (eventType === 'trade' || eventType === 'aggTrade') {
      const price = parseFloat(raw.p);
      const quantity = parseFloat(raw.q);
      const isBuyerMaker = Boolean(raw.m);
      // If buyer is maker, taker is seller -> aggressive SELL. If buyer is taker -> aggressive BUY.
      const side: 'BUY' | 'SELL' = isBuyerMaker ? 'SELL' : 'BUY';

      if (!isNaN(price) && price > 0 && !isNaN(quantity) && quantity > 0) {
        const tradeEvent: RawTradeEvent = {
          price,
          quantity,
          side,
          time: raw.T || raw.E || Date.now(),
          isBuyerMaker,
        };
        this.emit('trade', tradeEvent);
      }
    }

    // 3. Depth stream (depth20@100ms or partial book depth)
    // Supports both { bids: [], asks: [] } and { b: [], a: [] } formats
    const bidsRaw = raw.bids || raw.b;
    const asksRaw = raw.asks || raw.a;

    if (Array.isArray(bidsRaw) && Array.isArray(asksRaw)) {
      this.setStatus('LIVE');
      const bids: [number, number][] = bidsRaw.map((b: any) => [parseFloat(b[0]), parseFloat(b[1])]);
      const asks: [number, number][] = asksRaw.map((a: any) => [parseFloat(a[0]), parseFloat(a[1])]);
      this.emit('depth', {
        bids,
        asks,
        isSnapshot: true,
        sequence: raw.lastUpdateId || raw.u || Date.now(),
      } as RawDepthDelta);
    }
  }

  private handleBybitMessage(msg: any) {
    if (msg.op === 'pong' || msg.ret_msg === 'pong') {
      return;
    }

    const topic = msg.topic || '';

    // Tickers
    if (topic.startsWith('tickers.')) {
      const data = msg.data;
      if (data) {
        const lastPrice = parseFloat(data.lastPrice);
        const high24h = parseFloat(data.highPrice24h || 0);
        const low24h = parseFloat(data.lowPrice24h || 0);
        const volume24hUsd = parseFloat(data.turnover24h || 0);
        if (!isNaN(lastPrice) && lastPrice > 0) {
          this.emit('price', {
            price: lastPrice,
            high24h,
            low24h,
            volume24hUsd,
            time: msg.ts || Date.now(),
          });
        }
      }
    }

    // Public trades
    if (topic.startsWith('publicTrade.')) {
      const tradeList = Array.isArray(msg.data) ? msg.data : [msg.data];
      for (const t of tradeList) {
        if (!t) continue;
        const price = parseFloat(t.p);
        const quantity = parseFloat(t.v);
        const side: 'BUY' | 'SELL' = t.S?.toUpperCase() === 'BUY' ? 'BUY' : 'SELL';
        if (!isNaN(price) && price > 0 && !isNaN(quantity) && quantity > 0) {
          this.emit('trade', {
            price,
            quantity,
            side,
            time: t.T || msg.ts || Date.now(),
            isBuyerMaker: side === 'SELL',
          } as RawTradeEvent);
        }
      }
    }

    // Orderbook 50
    if (topic.startsWith('orderbook.')) {
      const type = msg.type; // 'snapshot' or 'delta'
      const data = msg.data;
      if (data && (data.b || data.a)) {
        this.setStatus('LIVE');
        const bids: [number, number][] = (data.b || []).map((b: any) => [parseFloat(b[0]), parseFloat(b[1])]);
        const asks: [number, number][] = (data.a || []).map((a: any) => [parseFloat(a[0]), parseFloat(a[1])]);
        this.emit('depth', {
          bids,
          asks,
          isSnapshot: type === 'snapshot',
          sequence: msg.data?.seq || msg.data?.u || Date.now(),
        } as RawDepthDelta);
      }
    }
  }

  private startWatchdog() {
    this.watchdogTimer = setInterval(() => {
      if (this.isDestroyed) return;
      const now = Date.now();
      const elapsed = now - this.lastDataReceivedAt;

      // Watchdog: If no message for > 15 seconds after having been LIVE or SYNCING, trigger reconnect
      if ((this.status === 'LIVE' || this.status === 'SYNCING') && elapsed > 15000) {
        this.setStatus('STALE');
        console.warn(`[Watchdog] Stale stream detected for ${this.symbol} (${this.exchange}) - no data for ${Math.round(elapsed / 1000)}s. Reconnecting...`);
        this.scheduleReconnect('watchdog_stale_data_timeout');
      }
    }, 5000);
  }

  private scheduleReconnect(reason = 'unknown') {
    if (this.isDestroyed || this.reconnectTimeout) return;
    const backoffIndex = Math.min(this.reconnectAttempts, this.backoffSchedule.length - 1);
    const baseDelay = this.backoffSchedule[backoffIndex];
    // Add jitter (up to 30% randomness) to prevent thundering herd
    const jitter = Math.floor(Math.random() * (baseDelay * 0.3));
    const delay = baseDelay + jitter;
    this.reconnectAttempts++;

    console.log(`[exchangeStream ${this.symbol} (${this.exchange})] Reconnecting in ${delay}ms (attempt #${this.reconnectAttempts}, reason: ${reason})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.isDestroyed) {
        this.connect();
      }
    }, delay);
  }

  private cleanupSocket() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.terminate();
        }
      } catch (e) {}
      this.ws = null;
    }
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.cleanupSocket();
    this.removeAllListeners();
    console.log(`[exchangeStream ${this.symbol} (${this.exchange})] Destroyed cleanly.`);
  }
}
