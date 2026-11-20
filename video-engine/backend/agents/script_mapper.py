import re
from typing import Optional, List
from schemas import (
    VideoBrief,
    Scene,
    SceneType,
    VisualType,
    Tone,
    TickerData,
    BarItem,
    GaugeData,
    NumberData,
    ComparisonData,
    ComparisonRow,
    ShortScript,
    NiftyStockItem,
)
from agents.image_agent import detect_sector_key, get_scene_curated_query

VERDICT_TO_TONE = {
    "Bullish": Tone.bullish,
    "Bearish": Tone.bearish,
    "Neutral": Tone.neutral,
    "Watchlist": Tone.exciting,
}

def clean_text(text: Optional[str]) -> str:
    """Normalize and clean string text."""
    if not text:
        return ""
    # Remove excessive whitespace
    s = re.sub(r'\s+', ' ', str(text)).strip()
    return s

def condense_to_reels_length(text: Optional[str], max_words: int = 16) -> str:
    """
    Extracts high-impact, punchy spoken narration fitted for a 30-40s short.
    Keeps the most informative complete sentence(s) within max_words.
    """
    if not text:
        return ""
    clean = clean_text(text)
    words = clean.split()
    if len(words) <= max_words:
        return clean

    # Split by sentence boundaries (. ! ?)
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', clean) if s.strip()]
    if sentences:
        first_s = sentences[0]
        first_words = first_s.split()
        if len(first_words) <= max_words:
            # Check if second sentence also fits
            if len(sentences) > 1:
                combined = f"{first_s} {sentences[1]}"
                if len(combined.split()) <= max_words:
                    return combined
            return first_s
        else:
            # First sentence itself is long; split at clause boundary (, ; :)
            clauses = [c.strip() for c in re.split(r'[,;:]\s+', first_s) if c.strip()]
            res = ""
            for cl in clauses:
                candidate = f"{res}, {cl}" if res else cl
                if len(candidate.split()) <= max_words:
                    res = candidate
                else:
                    break
            if res:
                return res.rstrip(',;.') + '.'

    # Fallback truncate cleanly
    return " ".join(words[:max_words]).rstrip(',;.') + '.'

def build_default_script(stock: NiftyStockItem) -> ShortScript:
    """Fallback generator if stock.script was not populated (optimized for 30-40s short)."""
    price = stock.price or 0.0
    chg = stock.change_pct or 0.0
    verdict = "Bullish" if chg > 0.5 else "Bearish" if chg < -0.5 else "Neutral"
    
    return ShortScript(
        event_type="normal_session",
        estimated_read_seconds=35,
        word_count=85,
        verdict=verdict,
        hook=f"{stock.symbol} is on the move today with a {chg:+.2f}% swing at ₹{price:,.2f}.",
        price_action=f"At ₹{price:,.2f}, {stock.symbol} shows {'strong momentum' if chg >= 0 else 'selling pressure'} versus Nifty's {stock.nifty_change_pct:+.2f}%.",
        why_moving=f"Active institutional interest in {stock.sector} is driving order flow today.",
        technicals=f"RSI is at {stock.rsi_14:.0f}, with key support at ₹{stock.support:,.0f} and resistance at ₹{stock.resistance:,.0f}.",
        fundamentals=f"Healthy sector leadership and volumes in {stock.sector}.",
        valuation=f"Trading in line with peer valuations.",
        what_to_watch=f"Watch ₹{stock.resistance:,.0f} for breakout continuation.",
        investor_view=f"Track core earnings consistency.",
        trader_view=f"Watch ₹{stock.resistance:,.0f} for continuation with strict risk below ₹{stock.support:,.0f}.",
        disclaimer="Educational commentary for Indian markets, not financial advice.",
    )

def map_short_to_video_brief(stock: NiftyStockItem, script: Optional[ShortScript] = None) -> VideoBrief:
    """
    Transforms a NiftyStockItem and its ShortScript into a dynamic 30-40s VideoBrief
    ready for Kokoro TTS generation and Remotion headless rendering.
    """
    if not script:
        script = stock.script or build_default_script(stock)
        
    tone = VERDICT_TO_TONE.get(script.verdict, Tone.neutral)
    symbol = stock.symbol or "NSE"
    company = stock.company_name or symbol
    sector = stock.sector or "Indian Equities"
    price = float(stock.price or 0.0)
    change_pct = float(stock.change_pct or 0.0)
    nifty_pct = float(stock.nifty_change_pct or 0.0)
    vol_ratio = float(stock.volume_ratio or 1.0)
    rsi = float(stock.rsi_14 or 50.0)
    support = float(stock.support or (price * 0.97))
    resistance = float(stock.resistance or (price * 1.03))
    sector_key = detect_sector_key(sector, stock.industry or "", company, symbol)

    scenes: List[Scene] = []
    
    # ── Scene 1: INTRO (Text Reveal / Hook) (~5s) ─────────────────────────────
    hook_narration = condense_to_reels_length(script.hook, max_words=14) or f"{symbol} in high-momentum action on Dalal Street today!"
    scenes.append(Scene(
        id=1,
        type=SceneType.intro,
        duration_seconds=5,
        headline=f"{symbol} ALERT",
        subline=f"{company} · {sector}",
        narration=hook_narration,
        visual_type=VisualType.text_reveal,
        transition_type="zoomIn",
        image_query=get_scene_curated_query(1, sector_key),
        logo="FINPILOT",
    ))

    # ── Scene 2: STOCK PRICE TICKER (~6s) ────────────────────────────────────
    price_narration = condense_to_reels_length(script.price_action, max_words=16) or f"Trading at ₹{price:,.2f}, {symbol} is {'up' if change_pct >= 0 else 'down'} {abs(change_pct):.2f}% with {vol_ratio:.1f} times volume."
    scenes.append(Scene(
        id=2,
        type=SceneType.stock,
        duration_seconds=6,
        headline=f"{symbol} PRICE ACTION",
        subline=f"LTP ₹{price:,.2f} · NIFTY {nifty_pct:+.2f}%",
        narration=price_narration,
        visual_type=VisualType.price_ticker,
        ticker_data=TickerData(
            symbol=symbol,
            price=f"{price:,.2f}",
            change=f"{change_pct:+.2f}%",
            direction="up" if change_pct >= 0 else "down",
        ),
        transition_type="slideLeft",
        image_query=get_scene_curated_query(2, sector_key),
        logo="FINPILOT",
    ))

    # ── Scene 3: DRIVERS & METRICS BAR CHART (~6s) ───────────────────────────
    # Focus on the primary moving catalyst for crisp, punchy narration
    scene_3_narration = condense_to_reels_length(script.why_moving or script.fundamentals, max_words=16)
    if not scene_3_narration:
        scene_3_narration = f"Institutional buying in {sector} is powering {symbol}'s momentum today."

    if script.event_type == "earnings":
        scenes.append(Scene(
            id=3,
            type=SceneType.chart,
            duration_seconds=6,
            headline=f"{symbol} EARNINGS & METRICS",
            subline=f"{sector} Benchmark Comparison",
            narration=scene_3_narration,
            visual_type=VisualType.comparison_table,
            comparison_data=ComparisonData(
                col_a=symbol,
                col_b="Sector Avg",
                rows=[
                    ComparisonRow(label="Daily Move", a=f"{change_pct:+.2f}%", b=f"{nifty_pct:+.2f}%", highlight="a" if change_pct > nifty_pct else "b"),
                    ComparisonRow(label="Vol Ratio", a=f"{vol_ratio:.1f}x", b="1.0x", highlight="a" if vol_ratio >= 1.2 else "none"),
                    ComparisonRow(label="RSI(14)", a=f"{rsi:.1f}", b="50.0", highlight="a" if rsi > 50 else "none"),
                    ComparisonRow(label="Trend", a=script.verdict, b="Neutral", highlight="a"),
                ]
            ),
            transition_type="pushLeft",
            image_query=get_scene_curated_query(3, sector_key),
            logo="FINPILOT",
        ))
    else:
        # Dynamic Bar Chart
        stock_bar_val = min(max(abs(change_pct) * 12 + 25, 15), 100)
        nifty_bar_val = min(max(abs(nifty_pct) * 12 + 20, 10), 90)
        vol_bar_val   = min(max(vol_ratio * 30, 20), 100)
        rsi_bar_val   = min(max(rsi, 5), 100)
        
        scenes.append(Scene(
            id=3,
            type=SceneType.chart,
            duration_seconds=6,
            headline=f"{symbol} KEY METRICS",
            subline=f"Volume & Market Comparison",
            narration=scene_3_narration,
            visual_type=VisualType.bar_chart,
            chart_data=[
                BarItem(
                    label=symbol[:7],
                    value=stock_bar_val,
                    display=f"{change_pct:+.2f}%",
                    color="green" if change_pct >= 0 else "red"
                ),
                BarItem(
                    label="NIFTY 50",
                    value=nifty_bar_val,
                    display=f"{nifty_pct:+.2f}%",
                    color="green" if nifty_pct >= 0 else "red"
                ),
                BarItem(
                    label="Volume",
                    value=vol_bar_val,
                    display=f"{vol_ratio:.1f}x",
                    color="blue"
                ),
                BarItem(
                    label="RSI",
                    value=rsi_bar_val,
                    display=f"{rsi:.0f}",
                    color="amber"
                ),
            ],
            transition_type="pushLeft",
            image_query=get_scene_curated_query(3, sector_key),
            logo="FINPILOT",
        ))

    # ── Scene 4: TECHNICAL GAUGE (~6s) ──────────────────────────────────────
    tech_narration = condense_to_reels_length(script.technicals, max_words=16) or f"RSI is at {rsi:.0f}. Immediate support is at ₹{support:,.1f}, resistance at ₹{resistance:,.1f}."
    gauge_color = "green" if (rsi >= 50 and change_pct >= 0) else "red" if rsi < 45 else "amber"
    
    scenes.append(Scene(
        id=4,
        type=SceneType.chart,
        duration_seconds=6,
        headline=f"{symbol} TECHNICALS",
        subline=f"Support: ₹{support:,.1f} | Resist: ₹{resistance:,.1f}",
        narration=tech_narration,
        visual_type=VisualType.gauge,
        gauge_data=GaugeData(
            label="RSI MOMENTUM (14-DAY)",
            value=rsi,
            color=gauge_color,
            low="30 (Oversold)",
            high="70 (Overbought)",
        ),
        transition_type="reveal",
        image_query=get_scene_curated_query(4, sector_key),
        logo="FINPILOT",
    ))

    # ── Scene 5: OUTLOOK & STRATEGY (~6s) ───────────────────────────────────
    outlook_source = script.trader_view or script.what_to_watch or script.investor_view
    scene_5_narration = condense_to_reels_length(outlook_source, max_words=16)
    if not scene_5_narration:
        scene_5_narration = f"Watch resistance at ₹{resistance:,.1f} for continuation with strict risk control."

    scenes.append(Scene(
        id=5,
        type=SceneType.sector,
        duration_seconds=6,
        headline="OUTLOOK & STRATEGY",
        subline=f"Catalysts & Trade Plan for {symbol}",
        narration=scene_5_narration,
        visual_type=VisualType.text_reveal,
        transition_type="slideUp",
        image_query=get_scene_curated_query(5, sector_key),
        logo="FINPILOT",
    ))

    # ── Scene 6: OUTRO & VERDICT (~5s) ──────────────────────────────────────
    # Punchy call to action without reading full legal boilerplate aloud
    outro_narration = f"FinPilot verdict on {symbol} is {script.verdict}. Follow FinPilot for daily Dalal Street setups."
    scenes.append(Scene(
        id=6,
        type=SceneType.outro,
        duration_seconds=5,
        headline=f"VERDICT: {script.verdict.upper()}",
        subline=clean_text(script.disclaimer) or "Educational commentary, not financial advice.",
        narration=outro_narration,
        visual_type=VisualType.outro_card,
        transition_type="zoomOut",
        image_query=get_scene_curated_query(6, sector_key),
        logo="FINPILOT",
    ))

    total_seconds = sum(s.duration_seconds for s in scenes)

    return VideoBrief(
        title=f"{symbol} - Nifty 50 Daily Short",
        total_seconds=total_seconds,
        tone=tone,
        scenes=scenes,
        disclaimer=clean_text(script.disclaimer) or "Educational commentary, not financial advice.",
    )
