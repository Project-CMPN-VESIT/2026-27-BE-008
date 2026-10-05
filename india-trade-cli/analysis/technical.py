"""
analysis/technical.py
─────────────────────
Technical indicators computed on OHLCV pandas DataFrames.
Pure numpy/pandas — no external TA library dependency.

All functions accept a DataFrame with columns:
    open, high, low, close, volume  (index = datetime)

Main entry point: analyse(symbol) → TechnicalSnapshot
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from market.history import get_ohlcv


# ── Result dataclass ─────────────────────────────────────────


from typing import Optional

@dataclass
class Signal:
    name: str
    value: float | str | None
    verdict: str  # "BULLISH" | "BEARISH" | "NEUTRAL"
    detail: str = ""

@dataclass
class TechnicalSnapshot:
    symbol: str
    ltp: float
    interval: str = "1D"
    as_of: str = ""

    # Indicators
    rsi: Optional[float] = None
    macd: Optional[float] = None
    macd_sig: Optional[float] = None
    macd_hist: Optional[float] = None
    ema20: Optional[float] = None
    ema50: Optional[float] = None
    sma200: Optional[float] = None
    bb_upper: Optional[float] = None
    bb_lower: Optional[float] = None
    bb_mid: Optional[float] = None
    atr: Optional[float] = None
    volume_ratio: Optional[float] = None

    # Support / Resistance
    support: Optional[float] = None
    resistance: Optional[float] = None
    pivot: Optional[float] = None

    # Signals list
    signals: list[Signal] = field(default_factory=list)

    # Limitations
    limitations: list[str] = field(default_factory=list)

    # Overall verdict
    verdict: str = "NEUTRAL"
    score: int = 0
    summary: str = ""
# ── Core indicators ──────────────────────────────────────────


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period).mean()


def macd(
    close: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal_span: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Returns (macd_line, signal_line, histogram)."""
    ema_fast = ema(close, fast)
    ema_slow = ema(close, slow)
    macd_line = ema_fast - ema_slow
    signal_line = ema(macd_line, signal_span)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def bollinger_bands(
    close: pd.Series,
    period: int = 20,
    std_k: float = 2.0,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Returns (upper, mid, lower)."""
    mid = sma(close, period)
    std = close.rolling(window=period).std()
    upper = mid + std_k * std
    lower = mid - std_k * std
    return upper, mid, lower


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high_low = df["high"] - df["low"]
    high_close = (df["high"] - df["close"].shift()).abs()
    low_close = (df["low"] - df["close"].shift()).abs()
    true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    return true_range.ewm(alpha=1 / period, adjust=False).mean()


def pivot_points(df: pd.DataFrame) -> dict[str, float]:
    """
    Classic floor pivot points from the last completed candle.
    Returns: pivot, r1, r2, r3, s1, s2, s3
    """
    prev = df.iloc[-2] if len(df) >= 2 else df.iloc[-1]
    h, l, c = prev["high"], prev["low"], prev["close"]
    pivot = (h + l + c) / 3
    return {
        "pivot": round(pivot, 2),
        "r1": round(2 * pivot - l, 2),
        "r2": round(pivot + (h - l), 2),
        "r3": round(h + 2 * (pivot - l), 2),
        "s1": round(2 * pivot - h, 2),
        "s2": round(pivot - (h - l), 2),
        "s3": round(l - 2 * (h - pivot), 2),
    }


# ── Main analyser ────────────────────────────────────────────


def analyse_dataframe(
    df: pd.DataFrame, symbol: str, interval: str = "1D", as_of: str = ""
) -> TechnicalSnapshot:
    """
    Compute technical analysis strictly from a provided DataFrame.
    Gracefully handles insufficient history instead of padding zeros.
    """
    limitations = []
    
    if df.empty or len(df) < 5:
        return TechnicalSnapshot(
            symbol=symbol, ltp=0.0, interval=interval, as_of=as_of, 
            verdict="INSUFFICIENT DATA", limitations=["Not enough candles to compute ANY metrics (minimum 5 required)."]
        )

    close = df["close"]
    ltp = float(close.iloc[-1])
    n_candles = len(df)

    snap = TechnicalSnapshot(symbol=symbol, ltp=round(ltp, 2), interval=interval, as_of=as_of)
    signals: list[Signal] = []
    score = 0

    # RSI
    if n_candles >= 14:
        rsi_val = float(rsi(close).iloc[-1])
        snap.rsi = round(rsi_val, 2)
        if rsi_val < 30:
            signals.append(Signal("RSI", round(rsi_val, 1), "BULLISH", "Oversold (<30)"))
            score += 15
        elif rsi_val > 70:
            signals.append(Signal("RSI", round(rsi_val, 1), "BEARISH", "Overbought (>70)"))
            score -= 15
        else:
            signals.append(Signal("RSI", round(rsi_val, 1), "NEUTRAL", "Bullish zone" if rsi_val > 50 else "Bearish zone"))
            score += 5 if rsi_val > 50 else -5
    else:
        limitations.append("Insufficient data for RSI (need >= 14).")

    # MACD
    if n_candles >= 35:
        macd_line, sig_line, histogram = macd(close)
        snap.macd = round(float(macd_line.iloc[-1]), 4)
        snap.macd_sig = round(float(sig_line.iloc[-1]), 4)
        snap.macd_hist = round(float(histogram.iloc[-1]), 4)
        
        hist_val = snap.macd_hist
        prev_hist = float(histogram.iloc[-2])
        if hist_val > 0 and prev_hist <= 0:
            signals.append(Signal("MACD", snap.macd, "BULLISH", "Bullish crossover"))
            score += 15
        elif hist_val < 0 and prev_hist >= 0:
            signals.append(Signal("MACD", snap.macd, "BEARISH", "Bearish crossover"))
            score -= 15
        elif hist_val > 0:
            signals.append(Signal("MACD", snap.macd, "BULLISH", "Above signal line"))
            score += 8
        else:
            signals.append(Signal("MACD", snap.macd, "BEARISH", "Below signal line"))
            score -= 8
    else:
        limitations.append("Insufficient data for MACD (need >= 35).")

    # EMAs
    if n_candles >= 20:
        ema20_val = float(ema(close, 20).iloc[-1])
        snap.ema20 = round(ema20_val, 2)
        if ltp > ema20_val:
            signals.append(Signal("EMA20", snap.ema20, "BULLISH", "Price above EMA20"))
            score += 8
        else:
            signals.append(Signal("EMA20", snap.ema20, "BEARISH", "Price below EMA20"))
            score -= 8
    else:
        limitations.append("Insufficient data for EMA20.")

    if n_candles >= 50:
        ema50_val = float(ema(close, 50).iloc[-1])
        snap.ema50 = round(ema50_val, 2)
        if ltp > ema50_val:
            signals.append(Signal("EMA50", snap.ema50, "BULLISH", "Price above EMA50"))
            score += 8
        else:
            signals.append(Signal("EMA50", snap.ema50, "BEARISH", "Price below EMA50"))
            score -= 8
    else:
        limitations.append("Insufficient data for EMA50.")

    # SMA200
    if n_candles >= 200:
        sma200_val = float(sma(close, 200).iloc[-1])
        snap.sma200 = round(sma200_val, 2)
        if ltp > sma200_val:
            signals.append(Signal("SMA200", snap.sma200, "BULLISH", "Price above 200 DMA"))
            score += 10
        else:
            signals.append(Signal("SMA200", snap.sma200, "BEARISH", "Price below 200 DMA"))
            score -= 10
    else:
        limitations.append("Insufficient data for SMA200.")

    # Bollinger Bands
    if n_candles >= 20:
        bb_upper, bb_mid, bb_lower = bollinger_bands(close)
        bb_u = float(bb_upper.iloc[-1])
        bb_m = float(bb_mid.iloc[-1])
        bb_l = float(bb_lower.iloc[-1])
        snap.bb_upper, snap.bb_mid, snap.bb_lower = round(bb_u, 2), round(bb_m, 2), round(bb_l, 2)
        
        if ltp < bb_l:
            signals.append(Signal("BollingerBands", round(ltp, 2), "BULLISH", "Price below lower band"))
            score += 10
        elif ltp > bb_u:
            signals.append(Signal("BollingerBands", round(ltp, 2), "BEARISH", "Price above upper band"))
            score -= 10
        else:
            bb_pos = (ltp - bb_l) / (bb_u - bb_l) if (bb_u - bb_l) else 0.5
            signals.append(Signal("BollingerBands", f"{bb_pos:.0%} of band", "NEUTRAL", "Inside bands"))
    else:
        limitations.append("Insufficient data for Bollinger Bands.")

    # ATR
    if n_candles >= 14:
        snap.atr = round(float(atr(df).iloc[-1]), 2)
    else:
        limitations.append("Insufficient data for ATR.")

    # Volume
    if n_candles >= 20:
        vol_avg = float(df["volume"].rolling(20).mean().iloc[-1])
        vol_today = float(df["volume"].iloc[-1])
        vol_ratio = round(vol_today / vol_avg, 2) if vol_avg else 1.0
        snap.volume_ratio = vol_ratio
        if vol_ratio > 1.5:
            dir_signal = "BULLISH" if ltp >= float(df["open"].iloc[-1]) else "BEARISH"
            signals.append(Signal("Volume", f"{vol_ratio:.1f}x avg", dir_signal, "High volume"))
            score += 8 if dir_signal == "BULLISH" else -8
        else:
            signals.append(Signal("Volume", f"{vol_ratio:.1f}x avg", "NEUTRAL", "Normal volume"))
    else:
        limitations.append("Insufficient data for 20-day Volume Average.")

    # Pivots
    try:
        pivots = pivot_points(df)
        snap.pivot = pivots["pivot"]
        snap.support = pivots["s1"]
        snap.resistance = pivots["r1"]
    except Exception:
        limitations.append("Unable to calculate pivot points.")

    # Verdict
    snap.score = max(-100, min(100, score))
    snap.verdict = "BULLISH" if snap.score > 30 else "BEARISH" if snap.score < -30 else "NEUTRAL"
    snap.signals = signals
    snap.limitations = limitations
    
    bullish_count = sum(1 for s in signals if s.verdict == "BULLISH")
    bearish_count = sum(1 for s in signals if s.verdict == "BEARISH")
    snap.summary = (
        f"{bullish_count} bullish / {bearish_count} bearish signals | "
        f"Score: {snap.score:+d}"
    )

    return snap


def analyse(
    symbol: str,
    exchange: str = "NSE",
    days: int = 365,
) -> TechnicalSnapshot:
    """
    Full technical analysis for a symbol.
    Fetches OHLCV and calls analyse_dataframe.
    """
    try:
        df = get_ohlcv(symbol=symbol, exchange=exchange, days=days)
    except Exception:
        df = pd.DataFrame()

    return analyse_dataframe(df, symbol=symbol, interval="1D", as_of="")
