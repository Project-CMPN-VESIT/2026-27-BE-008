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

def build_default_script(stock: NiftyStockItem) -> ShortScript:
    """Fallback generator if stock.script was not populated."""
    price = stock.price or 0.0
    chg = stock.change_pct or 0.0
    verdict = "Bullish" if chg > 0.5 else "Bearish" if chg < -0.5 else "Neutral"
    
    return ShortScript(
        event_type="normal_session",
        estimated_read_seconds=75,
        word_count=180,
        verdict=verdict,
        hook=f"{stock.symbol} is making waves on Dalal Street today with a {chg:+.2f}% move at ₹{price:,.2f}.",
        price_action=f"Trading at ₹{price:,.2f}, {stock.symbol} shows {'strong momentum' if chg >= 0 else 'selling pressure'} against NIFTY 50's {stock.nifty_change_pct:+.2f}%.",
        why_moving=f"Market participants are actively watching {stock.sector} sector developments and corporate flows in {stock.company_name}.",
        technicals=f"Technicals show RSI at {stock.rsi_14:.1f}, with key support at ₹{stock.support:,.1f} and resistance at ₹{stock.resistance:,.1f}.",
        fundamentals=f"{stock.company_name} maintains strong sector leadership in {stock.sector} with healthy institutional interest.",
        valuation=f"Valuations reflect current market sentiment across peer stocks in {stock.sector}.",
        what_to_watch=f"Watch key price pivots around ₹{stock.resistance:,.1f} for directional confirmation.",
        investor_view=f"Long term investors should track earnings consistency and sector tailwinds.",
        trader_view=f"Traders should keep stop loss near ₹{stock.support:,.1f} and track volume expansion.",
        disclaimer="Educational commentary for Indian markets, not financial advice.",
    )

def map_short_to_video_brief(stock: NiftyStockItem, script: Optional[ShortScript] = None) -> VideoBrief:
    """
    Transforms a NiftyStockItem and its ShortScript into a complete VideoBrief
    ready for TTS generation and Remotion headless rendering.
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
    
    # ── Scene 1: INTRO (Text Reveal / Hook) ──────────────────────────────────
    hook_narration = clean_text(script.hook) or f"{symbol} in action today!"
    scenes.append(Scene(
        id=1,
        type=SceneType.intro,
        duration_seconds=9,
        headline=f"{symbol} ALERT",
        subline=f"{company} · {sector}",
        narration=hook_narration,
        visual_type=VisualType.text_reveal,
        transition_type="zoomIn",
        image_query=get_scene_curated_query(1, sector_key),
        logo="FINPILOT",
    ))

    # ── Scene 2: STOCK PRICE TICKER ─────────────────────────────────────────
    price_narration = clean_text(script.price_action) or f"{symbol} trades at ₹{price:,.2f}, moving {change_pct:+.2f}% today."
    scenes.append(Scene(
        id=2,
        type=SceneType.stock,
        duration_seconds=12,
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

    # ── Scene 3: DRIVERS & COMPARISON / BAR CHART ───────────────────────────
    # If earnings, use comparison table; otherwise dynamic bar chart comparing metrics
    why_narration = clean_text(script.why_moving)
    fund_narration = clean_text(script.fundamentals)
    scene_3_narration = f"{why_narration} {fund_narration}".strip()
    if not scene_3_narration:
        scene_3_narration = f"Key performance metrics and market drivers for {symbol}."

    if script.event_type == "earnings":
        scenes.append(Scene(
            id=3,
            type=SceneType.chart,
            duration_seconds=14,
            headline=f"{symbol} EARNINGS & FUNDAMENTALS",
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
        # Bar chart comparing relative performance
        stock_bar_val = min(max(abs(change_pct) * 12 + 25, 15), 100)
        nifty_bar_val = min(max(abs(nifty_pct) * 12 + 20, 10), 90)
        vol_bar_val   = min(max(vol_ratio * 30, 20), 100)
        rsi_bar_val   = min(max(rsi, 5), 100)
        
        scenes.append(Scene(
            id=3,
            type=SceneType.chart,
            duration_seconds=14,
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

    # ── Scene 4: TECHNICAL GAUGE ────────────────────────────────────────────
    tech_narration = clean_text(script.technicals) or f"RSI stands at {rsi:.1f}. Immediate support is at ₹{support:,.1f}, resistance at ₹{resistance:,.1f}."
    gauge_color = "green" if (rsi >= 50 and change_pct >= 0) else "red" if rsi < 45 else "amber"
    
    scenes.append(Scene(
        id=4,
        type=SceneType.chart,
        duration_seconds=12,
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

    # ── Scene 5: OUTLOOK & CATALYSTS ────────────────────────────────────────
    watch_narration = clean_text(script.what_to_watch)
    inv_narration = clean_text(script.investor_view)
    trader_narration = clean_text(script.trader_view)
    scene_5_narration = f"{watch_narration} For investors: {inv_narration} For traders: {trader_narration}".strip()
    if not scene_5_narration:
        scene_5_narration = f"Key levels to watch for {symbol}: Keep tight risk management around support and resistance."

    scenes.append(Scene(
        id=5,
        type=SceneType.sector,
        duration_seconds=14,
        headline="OUTLOOK & STRATEGY",
        subline=f"Catalysts & Trade Plan for {symbol}",
        narration=scene_5_narration,
        visual_type=VisualType.text_reveal,
        transition_type="slideUp",
        image_query=get_scene_curated_query(5, sector_key),
        logo="FINPILOT",
    ))

    # ── Scene 6: OUTRO & VERDICT ────────────────────────────────────────────
    outro_narration = f"FinPilot verdict for {symbol} is {script.verdict}. {clean_text(script.disclaimer)}"
    scenes.append(Scene(
        id=6,
        type=SceneType.outro,
        duration_seconds=10,
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
