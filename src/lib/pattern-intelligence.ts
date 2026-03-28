import type { TvCandle } from "@/lib/tradingview";

type PatternDirection = "bullish" | "bearish" | "neutral";

type PatternCategory = "breakout" | "reversal" | "support-resistance" | "divergence";

type PatternSignal = {
  id: string;
  name: string;
  category: PatternCategory;
  direction: PatternDirection;
  detectedAt: number;
  detectedAtLabel: string;
  confidence: number;
  entry: number;
  target: number | null;
  stop: number | null;
  description: string;
  successRate: number | null;
  sampleSize: number;
  avgMovePct: number | null;
};

type PatternStats = {
  total: number;
  success: number;
  moves: number[];
};

type MatchResult = {
  hit: boolean;
  confidence?: number;
  description?: string;
};

type PatternSpec = {
  id: string;
  name: string;
  category: PatternCategory;
  direction: PatternDirection;
  matcher: (candles: TvCandle[], rsi: Array<number | null>, index: number) => MatchResult;
};

export type PatternIntelligence = {
  patterns: PatternSignal[];
  supportLevels: number[];
  resistanceLevels: number[];
  trendBias: "bullish" | "bearish" | "sideways";
  note: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const average = (values: number[]) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const getRsiSeries = (closes: number[], period = 14): Array<number | null> => {
  if (closes.length <= period) {
    return closes.map(() => null);
  }

  const rsis: Array<number | null> = closes.map(() => null);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i += 1) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) gains += delta;
    if (delta < 0) losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsis[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rsis[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsis;
};

const isPivotHigh = (candles: TvCandle[], index: number, left = 2, right = 2) => {
  if (index < left || index + right >= candles.length) return false;
  const pivot = candles[index].high;
  for (let i = index - left; i <= index + right; i += 1) {
    if (i !== index && candles[i].high >= pivot) return false;
  }
  return true;
};

const isPivotLow = (candles: TvCandle[], index: number, left = 2, right = 2) => {
  if (index < left || index + right >= candles.length) return false;
  const pivot = candles[index].low;
  for (let i = index - left; i <= index + right; i += 1) {
    if (i !== index && candles[i].low <= pivot) return false;
  }
  return true;
};

const buildLevelClusters = (levels: number[], tolerancePct = 0.6) => {
  if (!levels.length) return [];
  const sorted = [...levels].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const lastCluster = clusters[clusters.length - 1];
    const clusterCenter = average(lastCluster);
    const tolerance = (clusterCenter * tolerancePct) / 100;

    if (Math.abs(current - clusterCenter) <= tolerance) {
      lastCluster.push(current);
    } else {
      clusters.push([current]);
    }
  }

  return clusters.map((cluster) => average(cluster));
};

const getAtrPct = (candles: TvCandle[], period = 14) => {
  if (candles.length < period + 1) return 0.01;
  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose)
    );
    trueRanges.push(tr);
  }

  const atr = average(trueRanges.slice(-period));
  const base = candles[candles.length - 1]?.close || 1;
  return clamp(atr / base, 0.002, 0.08);
};

const getSma = (values: number[], period: number) => {
  if (values.length < period) return null;
  return average(values.slice(-period));
};

const specs: PatternSpec[] = [
  {
    id: "bullish_engulfing",
    name: "Bullish Engulfing Reversal",
    category: "reversal",
    direction: "bullish",
    matcher: (candles, _rsi, i) => {
      if (i < 1) return { hit: false };
      const prev = candles[i - 1];
      const cur = candles[i];
      const prevBear = prev.close < prev.open;
      const curBull = cur.close > cur.open;
      const bodyPrev = Math.abs(prev.close - prev.open);
      const bodyCur = Math.abs(cur.close - cur.open);
      const engulf = cur.open <= prev.close && cur.close >= prev.open;

      if (!(prevBear && curBull && engulf)) return { hit: false };
      const confidence = clamp(50 + ((bodyCur / Math.max(bodyPrev, 0.0001)) - 1) * 20, 50, 92);
      return {
        hit: true,
        confidence,
        description: "Bullish body fully engulfs previous bearish candle, indicating reversal pressure.",
      };
    },
  },
  {
    id: "bearish_engulfing",
    name: "Bearish Engulfing Reversal",
    category: "reversal",
    direction: "bearish",
    matcher: (candles, _rsi, i) => {
      if (i < 1) return { hit: false };
      const prev = candles[i - 1];
      const cur = candles[i];
      const prevBull = prev.close > prev.open;
      const curBear = cur.close < cur.open;
      const bodyPrev = Math.abs(prev.close - prev.open);
      const bodyCur = Math.abs(cur.close - cur.open);
      const engulf = cur.open >= prev.close && cur.close <= prev.open;

      if (!(prevBull && curBear && engulf)) return { hit: false };
      const confidence = clamp(50 + ((bodyCur / Math.max(bodyPrev, 0.0001)) - 1) * 20, 50, 92);
      return {
        hit: true,
        confidence,
        description: "Bearish body fully engulfs previous bullish candle, indicating reversal pressure.",
      };
    },
  },
  {
    id: "resistance_breakout",
    name: "Resistance Breakout",
    category: "breakout",
    direction: "bullish",
    matcher: (candles, _rsi, i) => {
      if (i < 25) return { hit: false };
      const lookback = candles.slice(i - 20, i);
      const resistance = Math.max(...lookback.map((c) => c.high));
      const close = candles[i].close;
      const volume = candles[i].volume;
      const avgVolume = average(lookback.map((c) => c.volume || 0));
      const broke = close > resistance * 1.002;
      const volBoost = avgVolume > 0 ? volume / avgVolume : 1;
      if (!broke) return { hit: false };
      const confidence = clamp(55 + (volBoost - 1) * 18, 55, 95);
      return {
        hit: true,
        confidence,
        description: "Price closed above recent resistance with volume confirmation.",
      };
    },
  },
  {
    id: "support_breakdown",
    name: "Support Breakdown",
    category: "breakout",
    direction: "bearish",
    matcher: (candles, _rsi, i) => {
      if (i < 25) return { hit: false };
      const lookback = candles.slice(i - 20, i);
      const support = Math.min(...lookback.map((c) => c.low));
      const close = candles[i].close;
      const volume = candles[i].volume;
      const avgVolume = average(lookback.map((c) => c.volume || 0));
      const broke = close < support * 0.998;
      const volBoost = avgVolume > 0 ? volume / avgVolume : 1;
      if (!broke) return { hit: false };
      const confidence = clamp(55 + (volBoost - 1) * 18, 55, 95);
      return {
        hit: true,
        confidence,
        description: "Price broke below recent support with volume confirmation.",
      };
    },
  },
  {
    id: "bullish_rsi_divergence",
    name: "Bullish RSI Divergence",
    category: "divergence",
    direction: "bullish",
    matcher: (candles, rsi, i) => {
      if (i < 40) return { hit: false };
      const pivotLows: number[] = [];
      for (let k = Math.max(2, i - 60); k <= i - 2; k += 1) {
        if (isPivotLow(candles, k, 2, 2)) {
          pivotLows.push(k);
        }
      }
      if (pivotLows.length < 2) return { hit: false };
      const last = pivotLows[pivotLows.length - 1];
      const prev = pivotLows[pivotLows.length - 2];
      if (!rsi[last] || !rsi[prev]) return { hit: false };

      const lowerLow = candles[last].low < candles[prev].low;
      const higherRsi = (rsi[last] as number) > (rsi[prev] as number);
      if (!(lowerLow && higherRsi && i - last <= 6)) return { hit: false };

      const confidence = clamp(58 + ((rsi[last] as number) - (rsi[prev] as number)) * 1.2, 58, 90);
      return {
        hit: true,
        confidence,
        description: "Price formed lower low while RSI formed higher low, hinting momentum reversal.",
      };
    },
  },
  {
    id: "bearish_rsi_divergence",
    name: "Bearish RSI Divergence",
    category: "divergence",
    direction: "bearish",
    matcher: (candles, rsi, i) => {
      if (i < 40) return { hit: false };
      const pivotHighs: number[] = [];
      for (let k = Math.max(2, i - 60); k <= i - 2; k += 1) {
        if (isPivotHigh(candles, k, 2, 2)) {
          pivotHighs.push(k);
        }
      }
      if (pivotHighs.length < 2) return { hit: false };
      const last = pivotHighs[pivotHighs.length - 1];
      const prev = pivotHighs[pivotHighs.length - 2];
      if (!rsi[last] || !rsi[prev]) return { hit: false };

      const higherHigh = candles[last].high > candles[prev].high;
      const lowerRsi = (rsi[last] as number) < (rsi[prev] as number);
      if (!(higherHigh && lowerRsi && i - last <= 6)) return { hit: false };

      const confidence = clamp(58 + ((rsi[prev] as number) - (rsi[last] as number)) * 1.2, 58, 90);
      return {
        hit: true,
        confidence,
        description: "Price formed higher high while RSI formed lower high, hinting momentum fade.",
      };
    },
  },
];

const getHorizonBars = (timeframe: string) => {
  if (/^\d+$/.test(timeframe)) return 12;
  if (timeframe === "D") return 10;
  if (timeframe === "W") return 8;
  if (timeframe === "M") return 6;
  return 10;
};

const computeSupportResistance = (candles: TvCandle[]) => {
  const recent = candles.slice(-300);
  const lastClose = recent[recent.length - 1]?.close ?? 0;
  const lows: number[] = [];
  const highs: number[] = [];

  for (let i = 2; i < recent.length - 2; i += 1) {
    if (isPivotLow(recent, i)) lows.push(recent[i].low);
    if (isPivotHigh(recent, i)) highs.push(recent[i].high);
  }

  const support = buildLevelClusters(lows)
    .filter((level) => level < lastClose)
    .sort((a, b) => b - a)
    .slice(0, 3);

  const resistance = buildLevelClusters(highs)
    .filter((level) => level > lastClose)
    .sort((a, b) => a - b)
    .slice(0, 3);

  return { support, resistance };
};

export function analyzePatternIntelligence(candles: TvCandle[], timeframe: string): PatternIntelligence {
  if (!candles.length) {
    return {
      patterns: [],
      supportLevels: [],
      resistanceLevels: [],
      trendBias: "sideways",
      note: "Not enough candle data to compute pattern intelligence.",
    };
  }

  const closes = candles.map((candle) => candle.close);
  const rsi = getRsiSeries(closes, 14);
  const atrPct = getAtrPct(candles, 14);
  const horizonBars = getHorizonBars(timeframe);
  const successThreshold = clamp(atrPct * 0.8, 0.0025, 0.03);

  const statsByPattern = new Map<string, PatternStats>();
  const latestSignals: PatternSignal[] = [];

  const lastIndex = candles.length - 1;

  for (const spec of specs) {
    const stats: PatternStats = { total: 0, success: 0, moves: [] };

    for (let i = 5; i < candles.length - horizonBars; i += 1) {
      const match = spec.matcher(candles, rsi, i);
      if (!match.hit) continue;

      stats.total += 1;
      const entry = candles[i].close;
      const forward = candles[i + horizonBars].close;
      const rawMove = (forward - entry) / entry;
      const signedMove = spec.direction === "bearish" ? -rawMove : rawMove;
      stats.moves.push(signedMove);
      if (signedMove >= successThreshold) {
        stats.success += 1;
      }
    }

    statsByPattern.set(spec.id, stats);

    for (let i = Math.max(5, lastIndex - 4); i <= lastIndex; i += 1) {
      const match = spec.matcher(candles, rsi, i);
      if (!match.hit) continue;

      const entry = candles[i].close;
      const target = spec.direction === "neutral"
        ? null
        : spec.direction === "bullish"
          ? entry * (1 + atrPct * 1.8)
          : entry * (1 - atrPct * 1.8);
      const stop = spec.direction === "neutral"
        ? null
        : spec.direction === "bullish"
          ? entry * (1 - atrPct)
          : entry * (1 + atrPct);

      const currentStats = statsByPattern.get(spec.id) || { total: 0, success: 0, moves: [] };
      const successRate = currentStats.total > 0 ? (currentStats.success / currentStats.total) * 100 : null;
      const avgMovePct = currentStats.moves.length ? average(currentStats.moves) * 100 : null;

      latestSignals.push({
        id: spec.id,
        name: spec.name,
        category: spec.category,
        direction: spec.direction,
        detectedAt: candles[i].time,
        detectedAtLabel: candles[i].timeLabel,
        confidence: clamp(match.confidence ?? 60, 45, 98),
        entry,
        target,
        stop,
        description: match.description ?? `${spec.name} detected from recent candle structure.`,
        successRate,
        sampleSize: currentStats.total,
        avgMovePct,
      });

      break;
    }
  }

  const dedupedSignals = Array.from(
    latestSignals
      .sort((a, b) => b.detectedAt - a.detectedAt)
      .reduce((map, signal) => map.set(signal.id, signal), new Map<string, PatternSignal>())
      .values()
  )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  const { support, resistance } = computeSupportResistance(candles);

  const sma20 = getSma(closes, 20);
  const sma50 = getSma(closes, 50);
  const recentSlope = closes.length > 10 ? (closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10] : 0;

  let trendBias: "bullish" | "bearish" | "sideways" = "sideways";
  if (sma20 && sma50) {
    if (sma20 > sma50 && recentSlope > 0) trendBias = "bullish";
    if (sma20 < sma50 && recentSlope < 0) trendBias = "bearish";
  }

  return {
    patterns: dedupedSignals,
    supportLevels: support,
    resistanceLevels: resistance,
    trendBias,
    note:
      dedupedSignals.length > 0
        ? "Signals are generated from live candle structure with stock-specific historical hit-rate backtests."
        : "No high-confidence active pattern in latest candles; support/resistance and trend bias still available.",
  };
}
