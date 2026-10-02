import { MarketCandle, Timeframe } from '../../types';
import { normalizeBinanceRestKline } from './marketDataNormalizer';

export async function fetchBinanceFuturesHistory(
  symbol: string,
  timeframe: Timeframe,
  limit = 1000,
  endTime?: number
): Promise<MarketCandle[]> {
  const cleanSym = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const endParam = endTime ? `&endTime=${endTime * 1000}` : '';

  // 1. Try our backend proxy first (which handles geo-routing & cache)
  try {
    const res = await fetch(
      `/api/klines?exchange=binance&market=futures&symbol=${cleanSym}&timeframe=${timeframe}&limit=${limit}${endParam}`
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
    // try direct public mirrors
  }

  // 2. Direct Binance Futures mirrors as fallback
  const intervalMap: Record<string, string> = {
    '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
    '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h',
    '1d': '1d', '1w': '1w',
  };
  const interval = intervalMap[timeframe] || '1h';
  const mirrors = [
    `https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSym}&interval=${interval}&limit=${limit}${endParam}`,
    `https://data-api.binance.vision/api/v3/klines?symbol=${cleanSym}&interval=${interval}&limit=${limit}${endParam}`,
  ];

  for (const url of mirrors) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map(normalizeBinanceRestKline);
      }
    } catch {
      // try next
    }
  }

  return [];
}

export async function fetchBinanceFuturesStats(symbol: string): Promise<{
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
    const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${cleanSym}`);
    if (res.ok) {
      const data = await res.json();
      price = parseFloat(data.lastPrice || '0');
      change24h = parseFloat(data.priceChangePercent || '0');
      high24h = parseFloat(data.highPrice || '0');
      low24h = parseFloat(data.lowPrice || '0');
      volumeUsd = parseFloat(data.quoteVolume || '0');
    }
  } catch {}

  try {
    const [fundRes, oiRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${cleanSym}`).catch(() => null),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${cleanSym}`).catch(() => null),
    ]);
    if (fundRes && fundRes.ok) {
      const fundData = await fundRes.json();
      if (fundData.lastFundingRate) {
        fundingRate = parseFloat(fundData.lastFundingRate) * 100;
      }
    }
    if (oiRes && oiRes.ok) {
      const oiData = await oiRes.json();
      if (oiData.openInterest && price > 0) {
        openInterestUsd = parseFloat(oiData.openInterest) * price;
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
