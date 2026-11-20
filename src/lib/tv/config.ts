// Shared by server AND client. One table drives resolution, bar counts, trimming and cache lifetimes.
export type RangeKey = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'MAX';

export interface RangeCfg {
  tf: string;        // TradingView timeframe: '5' = 5 min, '15' = 15 min, '60' = 1 h, 'D', 'W', 'M'
  n: number;         // bars to request for exchange-traded symbols (stocks have sessions)
  nx: number;        // bars to request for 24/7 symbols (crypto)
  spanSec?: number;  // keep only bars within this window, measured back from the LAST bar (not from "now")
  ttl: number;       // server + client cache lifetime (ms)
  intraday: boolean; // show time-of-day on the axis
}

const D = 86400;
// Smaller counts = faster TradingView responses. Never request more bars than the range can show.
export const RANGES: Record<RangeKey, RangeCfg> = {
  '1D':  { tf: '5',  n: 100, nx: 300, spanSec: D,           ttl: 15e3,  intraday: true },
  '5D':  { tf: '15', n: 160, nx: 500, spanSec: 5 * D,       ttl: 30e3,  intraday: true },
  '1M':  { tf: '60', n: 190, nx: 740, spanSec: 30 * D,      ttl: 60e3,  intraday: true },
  '6M':  { tf: 'D',  n: 140, nx: 190, spanSec: 183 * D,     ttl: 120e3, intraday: false },
  'YTD': { tf: 'D',  n: 270, nx: 370,                       ttl: 120e3, intraday: false },
  '1Y':  { tf: 'D',  n: 270, nx: 370, spanSec: 366 * D,     ttl: 120e3, intraday: false },
  '5Y':  { tf: 'W',  n: 270, nx: 270, spanSec: 5 * 366 * D, ttl: 6e5,   intraday: false },
  'MAX': { tf: 'M',  n: 600, nx: 600,                       ttl: 6e5,   intraday: false },
};
export const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];

const ZONES: Record<string, string> = {
  NSE: 'Asia/Kolkata', BSE: 'Asia/Kolkata', NASDAQ: 'America/New_York', NYSE: 'America/New_York',
  AMEX: 'America/New_York', LSE: 'Europe/London',
};
/** Exchange time zone for a TradingView symbol such as "NSE:RELIANCE". Unknown prefixes (BINANCE, ...) => UTC. */
export const zoneFor = (symbol: string) => ZONES[symbol.split(':')[0].toUpperCase()] ?? 'Asia/Kolkata';
export const is24x7 = (symbol: string) => {
  const prefix = symbol.split(':')[0].toUpperCase();
  return prefix !== 'NSE' && prefix !== 'BSE' && zoneFor(symbol) === 'UTC';
};

