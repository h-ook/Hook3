import { MarketCandle } from '../../types';

export function normalizeBinanceRestKline(raw: any[]): MarketCandle {
  return {
    time: Math.floor(raw[0] / 1000),
    open: parseFloat(raw[1]),
    high: parseFloat(raw[2]),
    low: parseFloat(raw[3]),
    close: parseFloat(raw[4]),
    volume: parseFloat(raw[5]),
    quoteVolume: parseFloat(raw[7] || '0'),
    closed: true,
  };
}

export function normalizeBinanceWsKline(k: any): MarketCandle {
  return {
    time: Math.floor(k.t / 1000),
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
    volume: parseFloat(k.v),
    quoteVolume: parseFloat(k.q || '0'),
    closed: Boolean(k.x),
  };
}

export function normalizeBybitRestKline(raw: any[]): MarketCandle {
  return {
    time: Math.floor(parseInt(raw[0], 10) / 1000),
    open: parseFloat(raw[1]),
    high: parseFloat(raw[2]),
    low: parseFloat(raw[3]),
    close: parseFloat(raw[4]),
    volume: parseFloat(raw[5]),
    quoteVolume: parseFloat(raw[6] || '0'),
    closed: true,
  };
}

export function normalizeBybitWsKline(k: any): MarketCandle {
  return {
    time: Math.floor(parseInt(k.start, 10) / 1000),
    open: parseFloat(k.open),
    high: parseFloat(k.high),
    low: parseFloat(k.low),
    close: parseFloat(k.close),
    volume: parseFloat(k.volume),
    quoteVolume: parseFloat(k.turnover || '0'),
    closed: Boolean(k.confirm),
  };
}
