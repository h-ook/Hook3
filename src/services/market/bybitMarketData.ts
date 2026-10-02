import { MarketCandle, Timeframe } from '../../types';
import { normalizeBybitRestKline } from './marketDataNormalizer';

export async function fetchBybitFuturesHistory(
  symbol: string,
  timeframe: Timeframe,
  limit = 1000,
  endTime?: number
): Promise<MarketCandle[]> {
  const cleanSym = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const endParam = endTime ? `&endTime=${endTime * 1000}` : '';

  // 1. Try backend proxy first
  try {
    const res = await fetch(
      `/api/klines?exchange=bybit&market=futures&symbol=${cleanSym}&timeframe=${timeframe}&limit=${limit}${endParam}`
    );
    if (res.ok) {
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        return json.data.map((d: any) => ({
          time: d.time,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume,
          closed: true,
        }));
      }
    }
  } catch (e) {
    // try direct
  }

  // 2. Direct Bybit v5 API
  const intervalMap: Record<string, string> = {
    '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
    '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
    '1d': 'D', '1w': 'W',
  };
  const interval = intervalMap[timeframe] || '60';
  const bybitEnd = endTime ? `&end=${endTime * 1000}` : '';

  const hosts = ['https://api.bybit.com', 'https://api.bytick.com'];
  for (const host of hosts) {
    try {
      const url = `${host}/v5/market/kline?category=linear&symbol=${cleanSym}&interval=${interval}&limit=${limit}${bybitEnd}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const list = json?.result?.list;
      if (Array.isArray(list) && list.length > 0) {
        return list.slice().reverse().map(normalizeBybitRestKline);
      }
    } catch {}
  }

  return [];
}

export async function fetchBybitFuturesStats(symbol: string): Promise<{
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volumeUsd: number;
  fundingRate: number | null;
  openInterestUsd: number | null;
}> {
  const cleanSym = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  let price = 0;
  let change24h = 0;
  let high24h = 0;
  let low24h = 0;
  let volumeUsd = 0;
  let fundingRate: number | null = null;
  let openInterestUsd: number | null = null;

  try {
    const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${cleanSym}`);
    if (res.ok) {
      const json = await res.json();
      const item = json?.result?.list?.[0];
      if (item) {
        price = parseFloat(item.lastPrice || '0');
        change24h = parseFloat(item.price24hPcnt || '0') * 100;
        high24h = parseFloat(item.highPrice24h || '0');
        low24h = parseFloat(item.lowPrice24h || '0');
        volumeUsd = parseFloat(item.turnover24h || '0');
        if (item.fundingRate) {
          fundingRate = parseFloat(item.fundingRate) * 100;
        }
        if (item.openInterestValue) {
          openInterestUsd = parseFloat(item.openInterestValue);
        }
      }
    }
  } catch {}

  return {
    price,
    change24h: Number(change24h.toFixed(2)),
    high24h,
    low24h,
    volumeUsd,
    fundingRate: fundingRate !== null ? Number(fundingRate.toFixed(4)) : null,
    openInterestUsd,
  };
}
