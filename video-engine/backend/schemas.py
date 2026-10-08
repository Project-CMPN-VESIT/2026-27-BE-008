from pydantic import BaseModel, Field
from typing import Optional, Literal, List, Dict, Any
from enum import Enum


# ─── Enums ────────────────────────────────────────────────────────────────────

class VideoFormat(str, Enum):
    daily_wrap  = "daily_wrap"
    breakout    = "breakout"
    sector      = "sector"
    ipo         = "ipo"
    earnings    = "earnings"
    nifty_short = "nifty_short"

class Language(str, Enum):
    hinglish = "Hinglish"
    english  = "English"
    hindi    = "Hindi"

class OutputMode(str, Enum):
    visual_story = "visual_story"
    avatar       = "avatar"

class MistralModel(str, Enum):
    small = "mistral-small-latest"
    large = "mistral-large-latest"

class Tone(str, Enum):
    bullish  = "bullish"
    bearish  = "bearish"
    neutral  = "neutral"
    urgent   = "urgent"
    exciting = "exciting"

class VisualType(str, Enum):
    price_ticker     = "price_ticker"
    bar_chart        = "bar_chart"
    line_chart       = "line_chart"
    sparkline        = "sparkline"
    comparison_table = "comparison_table"
    gauge            = "gauge"
    number_card      = "number_card"
    text_reveal      = "text_reveal"
    outro_card       = "outro_card"

class SceneType(str, Enum):
    intro  = "intro"
    stock  = "stock"
    sector = "sector"
    ipo    = "ipo"
    chart  = "chart"
    outro  = "outro"


# ─── Scene data payloads ──────────────────────────────────────────────────────

class TickerData(BaseModel):
    symbol:    str
    price:     str
    change:    str
    direction: Literal["up", "down"]

class BarItem(BaseModel):
    label:   str
    value:   float = Field(ge=0, le=100)
    color:   Literal["green", "red", "blue", "amber", "white"] = "green"
    display: str

class GaugeData(BaseModel):
    label: str
    value: float = Field(ge=0, le=100)
    color: Literal["green", "red", "blue", "amber"] = "green"
    low:   str = "0x"
    high:  str = "100x"

class LinePoint(BaseModel):
    label: str
    value: float

class SparklineItem(BaseModel):
    label:  str
    value:  float
    trend:  Literal["up", "down"]
    points: List[float]

class ComparisonRow(BaseModel):
    label:     str
    a:         str
    b:         str
    highlight: Optional[Literal["a", "b", "none"]] = None

class ComparisonData(BaseModel):
    col_a: str
    col_b: str
    rows:  List[ComparisonRow]

class NumberData(BaseModel):
    value:  float
    label:  Optional[str] = None
    prefix: Optional[str] = None
    suffix: Optional[str] = None

class LowerThird(BaseModel):
    main: str
    sub:  Optional[str] = None


# ─── Scene ────────────────────────────────────────────────────────────────────

class Scene(BaseModel):
    id:               int
    type:             SceneType
    duration_seconds: int
    headline:         str
    subline:          str
    narration:        str
    visual_type:      VisualType
    ticker_data:      Optional[TickerData]          = None
    chart_data:       Optional[List[BarItem]]       = None
    line_data:        Optional[List[LinePoint]]     = None
    sparkline_data:   Optional[List[SparklineItem]] = None
    comparison_data:  Optional[ComparisonData]      = None
    gauge_data:       Optional[GaugeData]           = None
    number_data:      Optional[NumberData]          = None
    lower_third:      Optional[LowerThird]          = None
    image_query:      Optional[str]                 = None
    image_url:        Optional[str]                 = None
    transition_type:  Optional[str]                 = None
    audio_url:        Optional[str]                 = None
    logo:             str                           = "FINPILOT"


# ─── Video Brief (full AI output) ─────────────────────────────────────────────

class VideoBrief(BaseModel):
    title:         str
    total_seconds: int
    tone:          Tone
    scenes:        List[Scene]
    disclaimer:    str


# ─── Nifty Shorts integration schemas ─────────────────────────────────────────

class ShortScript(BaseModel):
    event_type:             str = "normal_session"
    estimated_read_seconds: int = 75
    word_count:             Optional[int] = 180
    verdict:                Literal["Bullish", "Bearish", "Neutral", "Watchlist"] = "Neutral"
    hook:                   str = ""
    price_action:           str = ""
    why_moving:             str = ""
    technicals:             str = ""
    fundamentals:           str = ""
    valuation:              str = ""
    what_to_watch:          str = ""
    investor_view:          str = ""
    trader_view:            str = ""
    disclaimer:             str = "Educational commentary, not financial advice."

class NiftyStockItem(BaseModel):
    symbol:               str
    company_name:         str
    sector:               str
    industry:             Optional[str] = ""
    trading_date:         Optional[str] = None
    price:                Optional[float] = 0.0
    change_pct:           Optional[float] = 0.0
    previous_close:       Optional[float] = 0.0
    volume:               Optional[float] = 0.0
    volume_avg_20d:       Optional[float] = 0.0
    volume_ratio:         Optional[float] = 1.0
    nifty_change_pct:     Optional[float] = 0.0
    relative_performance: Optional[str] = None
    rsi_14:               Optional[float] = 50.0
    ema_20:               Optional[float] = 0.0
    sma_50:               Optional[float] = 0.0
    support:              Optional[float] = 0.0
    resistance:           Optional[float] = 0.0
    headlines:            Optional[List[str]] = []
    script:               Optional[ShortScript] = None
    generated_at:         Optional[str] = None
    status:               Optional[str] = "ready"
    error:                Optional[str] = None
    video_url:            Optional[str] = None

class StockRenderRequest(BaseModel):
    stock_data: NiftyStockItem
    script:     Optional[ShortScript] = None
    date:       Optional[str] = None
    voice:      Optional[str] = "en-IN-W"
    force:      Optional[bool] = False

class BatchRenderRequest(BaseModel):
    stocks: List[NiftyStockItem]
    date:   str
    force:  Optional[bool] = False
    voice:  Optional[str] = "en-IN-W"

class BatchStockStatus(BaseModel):
    symbol:    str
    status:    Literal["pending", "rendering", "done", "failed", "skipped"]
    progress:  int = 0
    video_url: Optional[str] = None
    error:     Optional[str] = None

class BatchStatusResponse(BaseModel):
    batch_id:    str
    date:        str
    status:      Literal["idle", "running", "completed", "cancelled", "failed"]
    total:       int
    completed:   int
    failed:      int
    current:     Optional[str] = None
    stock_items: Dict[str, BatchStockStatus] = {}

class PipelineStage(BaseModel):
    stage:   str
    label:   str
    status:  Literal["pending", "running", "done", "error"]
    detail:  Optional[str] = None

class GenerateResponse(BaseModel):
    success:     bool
    video_url:   Optional[str]        = None
    video_brief: Optional[VideoBrief] = None
    stages:      List[PipelineStage]  = []
    error:       Optional[str]        = None
