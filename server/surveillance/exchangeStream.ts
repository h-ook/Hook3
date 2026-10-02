import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { ExchangeId, MarketType } from '../../src/types';
import { DataHealth, OrderBookStatus } from './types';

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
  public lastPriceUpdate = 0;
  public lastOrderbookUpdate = 0;
  public lastTradeUpdate = 0;
  public lastOIUpdate = 0;
  public latencyMs = 0;

  // Bybit sequence checking
  private lastBybitSeq = 0;

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
   * Proper WebSocket URL for Binance and Bybit.
   * Binance uses /stream?streams=... for reliable multiplexed streams.
   */
  private getWebSocketUrl(): string {
    const sym = this.cleanSymbol();
    if (this.exchange === 'binance') {
      const lower = sym.toLowerCase();
      if (this.marketType === 'futures') {
        return `wss://fstream.binance.com/stream?streams=${lower}@ticker/${lower}@aggTrade/${lower}@depth20@100ms`;
      } else {
        return `wss://stream.binance.com:9443/stream?streams=${lower}@ticker/${lower}@trade/${lower}@depth20@100ms`;
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

  public getDataHealth(): DataHealth {
    const now = Date.now();
    const priceFresh = this.lastPriceUpdate > 0 && now - this.lastPriceUpdate < 15000;
    const orderbookFresh = this.lastOrderbookUpdate > 0 && now - this.lastOrderbookUpdate < 15000;
    const tradesFresh = this.lastTradeUpdate > 0 && now - this.lastTradeUpdate < 60000; // trades can be slow on quiet pairs
    const oiFresh = this.lastOIUpdate > 0 && now - this.lastOIUpdate < 60000;

    let healthStatus: DataHealth['status'] = 'LIVE';
    if (this.status === 'ERROR') {
      healthStatus = 'ERROR';
    } else if (this.status === 'CONNECTING' || this.status === 'SYNCING') {
      healthStatus = this.status;
    } else if (!priceFresh || !orderbookFresh) {
      healthStatus = 'STALE';
    } else if (!tradesFresh) {
      healthStatus = 'DEGRADED';
    }

    return {
      status: healthStatus,
      priceFresh,
      orderbookFresh,
      tradesFresh,
      oiFresh,
      candlesFresh: true,
      latencyMs: this.latencyMs,
      lastPriceUpdate: this.lastPriceUpdate,
      lastOrderbookUpdate: this.lastOrderbookUpdate,
      lastTradeUpdate: this.lastTradeUpdate,
      lastOIUpdate: this.lastOIUpdate,
    };
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

        // If Bybit, send subscription payload and start ping interval
        if (this.exchange === 'bybit') {
          const sym = this.cleanSymbol();
          const subscribeMsg = {
            op: 'subscribe',
            args: [`tickers.${sym}`, `publicTrade.${sym}`, `orderbook.50.${sym}`],
          };
          this.ws?.send(JSON.stringify(subscribeMsg));

          // Bybit heartbeat ping every 20 seconds
          this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ op: 'ping' }));
            }
          }, 20000);
        }
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        if (this.isDestroyed) return;
        const now = Date.now();
        this.lastDataReceivedAt = now;
        try {
          const str = data.toString();
          const json = JSON.parse(str);
          this.handleIncomingMessage(json, now);
        } catch (e) {
          // ignore invalid json
        }
      });

      this.ws.on('error', (err) => {
        if (this.isDestroyed) return;
        this.setStatus('ERROR');
        this.emit('error', err);
      });

      this.ws.on('close', () => {
        if (this.isDestroyed) return;
        this.setStatus('STALE');
        this.scheduleReconnect();
      });
    } catch (e) {
      this.setStatus('ERROR');
      this.scheduleReconnect();
    }
  }

  private handleIncomingMessage(raw: any, receiveTime: number) {
    // If Binance combined stream format: { stream: '...', data: { ... } }
    const msg = raw.data !== undefined && raw.stream !== undefined ? raw.data : raw;

    if (this.exchange === 'binance') {
      this.handleBinanceMessage(msg, receiveTime);
    } else {
      this.handleBybitMessage(raw, receiveTime);
    }
  }

  private handleBinanceMessage(msg: any, receiveTime: number) {
    const eventType = msg.e;

    // Ticker stream (24hrTicker)
    if (eventType === '24hrTicker' || (msg.s && msg.c !== undefined)) {
      const price = parseFloat(msg.c);
      const high24h = parseFloat(msg.h || 0);
      const low24h = parseFloat(msg.l || 0);
      const volume24hUsd = parseFloat(msg.q || 0);

      if (msg.E) {
        this.latencyMs = Math.max(0, receiveTime - msg.E);
      }
      this.lastPriceUpdate = receiveTime;

      if (!isNaN(price) && price > 0) {
        this.emit('price', {
          price,
          high24h,
          low24h,
          volume24hUsd,
          time: msg.E || receiveTime,
        });
      }
    }

    // Trade stream (trade or aggTrade)
    if (eventType === 'trade' || eventType === 'aggTrade') {
      const price = parseFloat(msg.p);
      const quantity = parseFloat(msg.q);
      const isBuyerMaker = Boolean(msg.m);
      const side: 'BUY' | 'SELL' = isBuyerMaker ? 'SELL' : 'BUY';

      this.lastTradeUpdate = receiveTime;

      if (!isNaN(price) && price > 0 && !isNaN(quantity) && quantity > 0) {
        const tradeEvent: RawTradeEvent = {
          price,
          quantity,
          side,
          time: msg.T || msg.E || receiveTime,
          isBuyerMaker,
        };
        this.emit('trade', tradeEvent);
      }
    }

    // Depth stream (depth20)
    if (msg.bids && msg.asks) {
      this.setStatus('LIVE');
      this.lastOrderbookUpdate = receiveTime;

      const bids: [number, number][] = msg.bids.map((b: any) => [parseFloat(b[0]), parseFloat(b[1])]);
      const asks: [number, number][] = msg.asks.map((a: any) => [parseFloat(a[0]), parseFloat(a[1])]);

      this.emit('depth', {
        bids,
        asks,
        isSnapshot: true,
        sequence: msg.lastUpdateId || receiveTime,
      } as RawDepthDelta);
    }
  }

  private handleBybitMessage(msg: any, receiveTime: number) {
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

        if (msg.ts) {
          this.latencyMs = Math.max(0, receiveTime - msg.ts);
        }
        this.lastPriceUpdate = receiveTime;

        if (!isNaN(lastPrice) && lastPrice > 0) {
          this.emit('price', {
            price: lastPrice,
            high24h,
            low24h,
            volume24hUsd,
            time: msg.ts || receiveTime,
          });
        }
      }
    }

    // Public trades
    if (topic.startsWith('publicTrade.')) {
      const tradeList = Array.isArray(msg.data) ? msg.data : [msg.data];
      this.lastTradeUpdate = receiveTime;

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
            time: t.T || msg.ts || receiveTime,
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
        this.lastOrderbookUpdate = receiveTime;

        const currentSeq = data.seq || data.u || receiveTime;

        // Sequence validation for Bybit
        if (type === 'snapshot') {
          this.lastBybitSeq = currentSeq;
        } else if (type === 'delta') {
          // If we see an impossible backwards sequence or massive gap, signal resync
          if (this.lastBybitSeq > 0 && currentSeq < this.lastBybitSeq) {
            console.warn(`[Bybit OB] Sequence out of order for ${this.symbol}: expected >= ${this.lastBybitSeq}, got ${currentSeq}`);
          }
          this.lastBybitSeq = currentSeq;
        }

        const bids: [number, number][] = (data.b || []).map((b: any) => [parseFloat(b[0]), parseFloat(b[1])]);
        const asks: [number, number][] = (data.a || []).map((a: any) => [parseFloat(a[0]), parseFloat(a[1])]);

        this.emit('depth', {
          bids,
          asks,
          isSnapshot: type === 'snapshot',
          sequence: currentSeq,
        } as RawDepthDelta);
      }
    }
  }

  private startWatchdog() {
    this.watchdogTimer = setInterval(() => {
      if (this.isDestroyed) return;
      const now = Date.now();
      const elapsed = now - this.lastDataReceivedAt;

      // Watchdog: If no message for > 15 seconds, consider STALE and trigger reconnect
      if (this.status === 'LIVE' && elapsed > 15000) {
        this.setStatus('STALE');
        console.warn(`[Watchdog] Stale stream detected for ${this.symbol} (${this.exchange}) - reconnecting`);
        this.scheduleReconnect();
      }
    }, 4000);
  }

  public recordOIUpdated(timestamp = Date.now()) {
    this.lastOIUpdate = timestamp;
  }

  private scheduleReconnect() {
    if (this.isDestroyed || this.reconnectTimeout) return;
    const backoffIndex = Math.min(this.reconnectAttempts, this.backoffSchedule.length - 1);
    const delay = this.backoffSchedule[backoffIndex];
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.isDestroyed) {
        this.connect();
      }
    }, delay);
  }

  public resync() {
    this.cleanupSocket();
    this.reconnectAttempts = 0;
    this.connect();
  }

  private cleanupSocket() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
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
  }
}
