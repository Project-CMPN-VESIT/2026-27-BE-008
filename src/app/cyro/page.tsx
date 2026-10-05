"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistentMessages, clearSessionMessages } from "@/hooks/usePersistentMessages";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ResearchActivityPanel } from "@/components/research/ResearchActivityPanel";
import { researchActivityReducer, initialResearchState, ResearchActivityState } from "@/components/research/researchActivityReducer";
import { normalizeResearchEvent } from "@/components/research/researchEventMapper";
import { CyroResearchOutlookChart, OutlookDomain } from "@/components/research/CyroResearchOutlookChart";
import {
  Bell,
  Bookmark,
  ChartColumn,
  ChevronDown,
  Copy,
  Edit3,
  File,
  FileText,
  FileSearch,
  Globe,
  Mic,
  Moon,
  Newspaper,
  Paperclip,
  Plus,
  Search,
  Send,
  Share2,
  Shield,
  Sparkles,
  Sun,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wallet,
} from "lucide-react";

type SourceCitation = {
  evidenceId?: string;
  agent: string;
  tool_name: string;
  source_type: string;
  label: string;
  input_args: Record<string, unknown>;
  excerpt: string;
  timestamp: string;
};

type ReportClaim = {
  id: string;
  text: string;
  category?: string;
  stance: string;
  importance: string;
  evidence_ids: string[];
  confidence?: number;
  limitations?: string[];
};

type FinalResearchReport = {
  research_id: string;
  symbol: string;
  horizon: string;
  conclusion: string;
  confidence: number;
  summary: string;
  sections?: Array<{ title?: string; content?: string }>;
  claims: ReportClaim[];
  data_limitations?: string[];
  sources?: unknown[];
};

type AnalystStatus = {
  name: string;
  status: "pending" | "running" | "done" | "error";
  verdict?: string;
  confidence?: number;
  key_points?: string[];
};

type ScorecardData = {
  weighted_total: number;
  verdict: string;
  agreement: number;
  conflicts: string[];
  scores: Record<string, number>;
};

type DebateCard = {
  type: "round" | "rebuttal" | "facilitator";
  round?: number;
  bull?: string;
  bear?: string;
  winner?: string;
  summary?: string;
};

type TradePlan = {
  strategy?: string;
  entry?: string;
  stop_loss?: string;
  target?: string;
  risk_reward?: string;
  position?: string;
};

type CyroMode = "normal" | "reasoning";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  time: string;
  liked?: boolean;
  disliked?: boolean;
  // CYRO-specific fields
  streaming?: boolean;
  signal?: "BUY" | "SELL" | "HOLD" | "STRONG_BUY" | string;
  citations?: SourceCitation[];
  analystStatuses?: AnalystStatus[];
  scorecard?: ScorecardData;
  debateCards?: DebateCard[];
  tradePlans?: Record<string, TradePlan>;
  ragUsed?: boolean;
  activityState?: ResearchActivityState;
  requestId?: string;
  researchId?: string;
  report?: FinalResearchReport;
  domainClaims?: Record<string, ReportClaim[]>;
};

function sourceCategory(source: Record<string, unknown>): string {
  const text = `${source.category ?? ""} ${source.type ?? ""} ${source.title ?? ""}`.toLowerCase();
  if (text.includes("shareholding") || text.includes("promoter")) return "Shareholding";
  if (text.includes("corporate") || text.includes("event") || text.includes("news")) return "Events & news";
  if (text.includes("quote") || text.includes("price") || text.includes("market")) return "Market data";
  if (text.includes("annual") || text.includes("financial result") || text.includes("financial statement")) return "Financials";
  if (text.includes("ratio") || text.includes("fundamental")) return "Fundamentals";
  return "Research evidence";
}

function sourceProvider(source: Record<string, unknown>): string {
  const name = String(source.source_name ?? source.label ?? "Source");
  if (/screener/i.test(name)) return "Screener";
  if (/upstox/i.test(name)) return "Upstox";
  if (/nse/i.test(name)) return "NSE";
  if (/yahoo/i.test(name)) return "Yahoo Finance";
  return name.replace(/\s*\(.*\)$/, "");
}

function normalizeSource(source: unknown): SourceCitation {
  const raw = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
  const category = sourceCategory(raw);
  return {
    evidenceId: typeof raw.id === "string" ? raw.id : undefined,
    agent: category,
    tool_name: sourceProvider(raw),
    source_type: category,
    label: sourceProvider(raw),
    input_args: {},
    excerpt: String(raw.excerpt ?? ""),
    timestamp: String(raw.fetched_at ?? raw.timestamp ?? ""),
  };
}

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function reportClaimText(claim: ReportClaim): string {
  return cleanInlineMarkdown(claim.text
    .replace(/^\[(BULL_CASE|BASE_CASE|BEAR_CASE)\]\s*/i, "")
    .replace(/\s*[\[(]-?\d+[\])]\s*$/, "") // Remove parser index artifacts like (5) or [-2]
  );
}

type ReportMetric = { label: string; value: string; note: string };

const METRIC_PATTERNS: Array<{ label: string; pattern: RegExp; suffix?: string; note: string }> = [
  { label: "ROE", pattern: /\bROE\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?%?)/i, suffix: "%", note: "Return on equity" },
  { label: "ROCE", pattern: /\bROCE\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?%?)/i, suffix: "%", note: "Capital efficiency" },
  { label: "P/E", pattern: /\bP\/?E\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?)/i, note: "Earnings multiple" },
  { label: "P/B", pattern: /\bP\/?B\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?)/i, note: "Book-value multiple" },
  { label: "D/E", pattern: /\bD\/?E\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?)/i, note: "Debt to equity" },
  { label: "Price", pattern: /(?:LTP|price)\s*(?:of|:|=|at)?\s*(₹\s?[\d,.]+)/i, note: "Reported market price" },
];

function extractMetrics(claims: ReportClaim[]): ReportMetric[] {
  const text = claims.map(reportClaimText).join(" \n");
  const seen = new Set<string>();
  const metrics: ReportMetric[] = [];
  for (const metric of METRIC_PATTERNS) {
    const match = text.match(metric.pattern);
    if (!match || seen.has(metric.label)) continue;
    const raw = match[1].replace(/\s/g, "");
    metrics.push({ label: metric.label, value: metric.suffix && !raw.includes("%") ? `${raw}${metric.suffix}` : raw, note: metric.note });
    seen.add(metric.label);
  }
  return metrics.slice(0, 6);
}

function claimHeading(claim: ReportClaim): string {
  const text = reportClaimText(claim);
  const normalized = text.toLowerCase();
  const positive = claim.stance.toLowerCase() === "positive";

  if (/\broe\b|\broce\b|profitability|capital efficiency/.test(normalized)) return positive ? "Strong profitability" : "Profitability signal";
  if (/\bd\/e\b|debt|leverage/.test(normalized)) return positive ? "Conservative leverage" : "Leverage sensitivity";
  if (/promoter|pledge|governance/.test(normalized)) return positive ? "Stable promoter alignment" : "Promoter alignment";
  if (/dividend|cash generation|cash flow/.test(normalized)) return positive ? "Cash-return capacity" : "Cash-flow evidence";
  if (/\bp\/b\b|price.to.book|book value/.test(normalized)) return "Premium book valuation";
  if (/\bp\/e\b|earnings growth/.test(normalized)) return "Earnings-growth evidence gap";
  if (/piotroski|financial health/.test(normalized)) return "Financial-health signal";
  if (/dcf|intrinsic value/.test(normalized)) return "Intrinsic-value evidence gap";
  if (/contract|deal|catalyst|partnership/.test(normalized)) return "Business catalyst";

  const firstClause = text
    .replace(/^\s*(?:[-•]|\d+[.)])\s*/, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .split(/[.:;]/)[0]
    .trim();
  return firstClause.split(/\s+/).slice(0, 6).join(" ") || "Research finding";
}

const INSIGHT_METRICS: Array<{ label: string; pattern: RegExp; suffix?: string }> = [
  { label: "ROE", pattern: /\bROE\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?%?)/i, suffix: "%" },
  { label: "ROCE", pattern: /\bROCE\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?%?)/i, suffix: "%" },
  { label: "D/E", pattern: /\bD\/?E\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?)/i },
  { label: "P/E", pattern: /\bP\/?E\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?)/i },
  { label: "P/B", pattern: /\bP\/?B\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?)/i },
  { label: "Promoter", pattern: /promoter(?:\s+ownership|\s+holding)?\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?%?)/i, suffix: "%" },
  { label: "Pledge", pattern: /(?:pledge|pledging)\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?%?)/i, suffix: "%" },
];

function insightFacts(claim: ReportClaim): string[] {
  const text = reportClaimText(claim);
  return INSIGHT_METRICS.flatMap((metric) => {
    const match = text.match(metric.pattern);
    if (!match) return [];
    const value = match[1].replace(/\s/g, "");
    return [`${metric.label} ${metric.suffix && !value.includes("%") ? `${value}${metric.suffix}` : value}`];
  }).slice(0, 2);
}

function sortClaims(claims: ReportClaim[], limit = 4): ReportClaim[] {
  const importance = (claim: ReportClaim) => ({ high: 0, medium: 1, low: 2 }[claim.importance.toLowerCase()] ?? 3);
  return [...claims].sort((a, b) => importance(a) - importance(b)).slice(0, limit);
}

function briefSummary(summary: string): string {
  // Return the full summary as requested, do not truncate.
  return cleanInlineMarkdown(summary).trim();
}

function domainKeyForAgent(agent: string): string | undefined {
  const normalized = agent.toLowerCase();
  if (normalized.includes("fundamental")) return "fundamental";
  if (normalized.includes("governance") || normalized.includes("filing")) return "governance";
  if (normalized.includes("technical")) return "technical";
  if (normalized.includes("sector") || normalized.includes("macro")) return "sector_macro";
  if (normalized.includes("news") || normalized.includes("catalyst")) return "catalysts";
  if (normalized.includes("risk") || normalized.includes("contradiction")) return "risk";
  return undefined;
}

function sourceForClaims(claims: ReportClaim[], sources: SourceCitation[]): SourceCitation | undefined {
  const evidenceIds = new Set(claims.flatMap((claim) => claim.evidence_ids));
  return sources.find((source) => source.evidenceId && evidenceIds.has(source.evidenceId));
}

function makeDomain(
  id: string,
  label: string,
  claims: ReportClaim[],
  specialistStatus: string | undefined,
  sources: SourceCitation[],
): OutlookDomain {
  const source = sourceForClaims(claims, sources);
  if (claims.length > 0) {
    const stances = new Set(claims.map((claim) => claim.stance.toLowerCase()));
    const tone = stances.size === 1 && stances.has("positive")
      ? "positive" as const
      : stances.size === 1 && (stances.has("negative") || stances.has("bearish"))
        ? "negative" as const
        : "neutral" as const;
    const status = tone === "positive" ? "Positive" : tone === "negative" ? "Bearish" : "Mixed";
    return { id, label, status, tone, detail: claims.map(reportClaimText).join(" · "), source };
  }
  if (specialistStatus === "warning" || specialistStatus === "error") {
    return { id, label, status: "Unavailable", tone: "unavailable", detail: "This specialist ran but reported unavailable evidence." };
  }
  if (specialistStatus === "done") {
    return { id, label, status: "Limited", tone: "limited", detail: "This specialist ran but did not produce an evidence-backed analytical claim." };
  }
  return { id, label, status: "Not assessed", tone: "not-assessed", detail: "This specialist was not routed for this research request." };
}

function makeRiskDomain(claims: ReportClaim[], riskStatus: string | undefined, sources: SourceCitation[]): OutlookDomain {
  const source = sourceForClaims(claims, sources);
  if (claims.length > 0) {
    const hasNegative = claims.some((claim) => ["negative", "bearish"].includes(claim.stance.toLowerCase()));
    return { id: "risk", label: "Risk", status: hasNegative ? "Risk flagged" : "Reviewed", tone: hasNegative ? "negative" : "neutral", detail: claims.map(reportClaimText).join(" · "), source };
  }
  if (riskStatus === "done") return { id: "risk", label: "Risk", status: "No flags found", tone: "neutral", detail: "The risk and contradiction engine completed without emitting a risk claim." };
  return { id: "risk", label: "Risk", status: "Not assessed", tone: "not-assessed", detail: "The risk and contradiction engine did not run." };
}

function InvestmentStance({ conclusion, confidence }: Pick<FinalResearchReport, "conclusion" | "confidence">) {
  const indeterminate = conclusion.toLowerCase() === "indeterminate";
  return (
    <section className={`report-stance ${indeterminate ? "is-indeterminate" : ""}`} aria-label="Investment stance">
      <div className="stance-header">
        <span className="stance-label">Investment stance</span>
        <strong className="stance-value">{conclusion}</strong>
      </div>
      <div className="stance-confidence">
        <span>Evidence confidence</span>
        <b>{confidence}%</b>
      </div>
    </section>
  );
}

function ReportHeader({ report, horizon }: { report: FinalResearchReport; horizon: string }) {
  return (
    <header className="report-header">
      <div className="report-company">
        <h2 className="report-title">{report.symbol}</h2>
        {report.horizon && <p className="report-horizon">{horizon} View</p>}
      </div>
      <InvestmentStance conclusion={report.conclusion} confidence={report.confidence} />
    </header>
  );
}

function ExecutiveTakeaway({ summary }: { summary: string }) {
  const paragraphs = summary.split(/\n\n+/).filter(Boolean);
  return (
    <section className="report-takeaway" aria-labelledby="takeaway-heading">
      <h3 id="takeaway-heading" className="report-kicker">Executive takeaway</h3>
      {paragraphs.map((p, i) => (
        <p key={i}>{cleanInlineMarkdown(p)}</p>
      ))}
    </section>
  );
}

function KeyMetrics({ metrics }: { metrics: ReportMetric[] }) {
  if (metrics.length === 0) return null;
  return (
    <section className="report-section" aria-labelledby="metrics-heading">
      <h3 id="metrics-heading" className="report-kicker">Key metrics</h3>
      <div className="metric-grid">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <span className="metric-label">{metric.label}</span>
            <strong className="metric-value">{metric.value}</strong>
            <small className="metric-note">{metric.note}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function ResearchOutlook({ report, horizon, rationale, domains, onSourceClick }: {
  report: FinalResearchReport;
  horizon: string;
  rationale: string;
  domains: OutlookDomain[];
  onSourceClick: (source: SourceCitation) => void;
}) {
  return <section className="report-section report-outlook" aria-labelledby="outlook-heading"><h3 id="outlook-heading" className="report-kicker">Research outlook</h3><CyroResearchOutlookChart symbol={report.symbol} horizon={horizon} decision={report.conclusion} driver={rationale || report.summary} domains={domains} onSourceClick={onSourceClick} /></section>;
}

function InsightList({ title, claims, kind }: { title: string; claims: ReportClaim[]; kind: "positive" | "concern" }) {
  if (claims.length === 0) return null;
  const mark = kind === "positive" ? "✓" : "!";
  return <section className="report-section" aria-labelledby={`${kind}-heading`}><h3 id={`${kind}-heading`} className="report-kicker">{title}</h3><div className="finding-grid">{sortClaims(claims).map((claim) => {
    const facts = insightFacts(claim);
    return <article className={`finding ${kind}`} key={claim.id}><span className="finding-mark" aria-hidden="true">{mark}</span><div><strong>{claimHeading(claim)}</strong>{facts.length > 0 && <span className="finding-facts">{facts.join(" · ")}</span>}<p>{reportClaimText(claim)}</p></div></article>;
  })}</div></section>;
}

function KeyPositives({ claims }: { claims: ReportClaim[] }) {
  return <InsightList title="Key positives" claims={claims} kind="positive" />;
}

function KeyConcerns({ claims }: { claims: ReportClaim[] }) {
  return <InsightList title="Key concerns" claims={claims} kind="concern" />;
}

function EvidenceGaps({ limitations }: { limitations: string[] }) {
  if (limitations.length === 0) return null;
  return <section className="report-section report-limitations" aria-labelledby="gaps-heading"><h3 id="gaps-heading" className="report-kicker">Evidence gaps</h3><ul>{limitations.slice(0, 5).map((item) => <li key={item}><span aria-hidden="true">○</span><p>{cleanInlineMarkdown(item)}</p></li>)}</ul></section>;
}

function sourceIcon(category: string) {
  const categoryText = category.toLowerCase();
  if (categoryText.includes("market")) return <ChartColumn size={13} aria-hidden="true" />;
  if (categoryText.includes("event") || categoryText.includes("news")) return <Newspaper size={13} aria-hidden="true" />;
  if (categoryText.includes("shareholding")) return <Wallet size={13} aria-hidden="true" />;
  if (categoryText.includes("financial") || categoryText.includes("fundamental")) return <FileText size={13} aria-hidden="true" />;
  return <Globe size={13} aria-hidden="true" />;
}

function SourceReferences({ sources, onSourceClick }: { sources: SourceCitation[]; onSourceClick: (source: SourceCitation) => void }) {
  if (sources.length === 0) return null;
  return <section className="report-sources" aria-labelledby="sources-heading"><h3 id="sources-heading" className="report-kicker">Sources</h3><div className="cite-list">{sources.map((source) => <button type="button" className="cite-card" key={`${source.source_type}:${source.label}`} onClick={() => onSourceClick(source)} aria-label={`Open ${source.source_type} source from ${source.label}`}><span className="cite-icon">{sourceIcon(source.source_type)}</span><span className="cite-copy"><b>{source.source_type}</b><small>{source.label}</small></span></button>)}</div></section>;
}

function CyroResearchReport({ report, sources, activityState, domainClaims = {}, onSourceClick }: {
  report: FinalResearchReport;
  sources: SourceCitation[];
  activityState?: ResearchActivityState;
  domainClaims?: Record<string, ReportClaim[]>;
  onSourceClick: (source: SourceCitation) => void;
}) {
  const positives = report.claims.filter((claim) => ["positive", "bullish", "strength", "opportunity"].includes(claim.stance.toLowerCase()));
  const concerns = report.claims.filter((claim) => ["negative", "bearish", "mixed", "cautionary", "risk"].includes(claim.stance.toLowerCase()));
  const limitations = Array.from(new Set([
    ...(report.data_limitations ?? []),
    ...report.claims.flatMap((claim) => claim.limitations ?? []),
  ].filter(Boolean)));
  const sourceReferences = Array.from(new Map(sources.map((source) => [`${source.source_type}:${source.label}`, source])).values());
  const horizonValue = report.horizon?.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Unspecified";
  const horizon = horizonValue.toLowerCase() === "unspecified" ? "Research" : horizonValue;
  const indeterminate = report.conclusion.toLowerCase() === "indeterminate";
  const metrics = extractMetrics(report.claims);
  const rationale = cleanInlineMarkdown(report.sections?.find((section) => section.content)?.content ?? "");
  const specialistStatus = (domain: string) => activityState?.milestones.specialists.subStatuses?.find((item) => domainKeyForAgent(item.id) === domain)?.status;
  const overviewDomains = [
    makeDomain("fundamental", "Fundamental", domainClaims.fundamental ?? [], specialistStatus("fundamental"), sources),
    makeDomain("governance", "Governance", domainClaims.governance ?? [], specialistStatus("governance"), sources),
    makeDomain("technical", "Technical", domainClaims.technical ?? [], specialistStatus("technical"), sources),
    makeDomain("sector_macro", "Sector / Macro", domainClaims.sector_macro ?? [], specialistStatus("sector_macro"), sources),
    makeDomain("catalysts", "Catalysts", domainClaims.catalysts ?? [], specialistStatus("catalysts"), sources),
    makeRiskDomain(domainClaims.risk ?? [], activityState?.milestones.risk.status, sources),
  ];

  return (
    <article className="research-report">
      <ReportHeader report={report} horizon={horizon} />
      {indeterminate && <p className="report-status-note">Research completed. The available evidence does not support a sufficiently confident directional investment call.</p>}
      <ExecutiveTakeaway summary={report.summary} />
      <ResearchOutlook report={report} horizon={report.horizon} rationale={rationale} domains={overviewDomains} onSourceClick={onSourceClick} />
      <KeyMetrics metrics={metrics} />
      <KeyPositives claims={positives} />
      <KeyConcerns claims={concerns} />
      <EvidenceGaps limitations={limitations} />
      <SourceReferences sources={sourceReferences} onSourceClick={onSourceClick} />
    </article>
  );
}

type FiiDiiData = {
  fii_dii_rows?: Array<{ date?: string; fii_net?: number; dii_net?: number }>;
  flow_intel?: Record<string, unknown>;
  market_breadth?: Record<string, unknown>;
  vix?: number | null;
};

type OptionsData = {
  symbol?: string;
  pcr?: number | null;
  pcr_interpretation?: string;
  max_pain?: number | null;
  iv_rank?: number | null;
  iv_interpretation?: string;
};

type RagCheckData = {
  indexed?: boolean;
  fresh?: boolean;
  chunk_count?: number;
  age_hours?: number;
  message?: string;
};

type NewsItem = {
  title: string;
  source: string;
  published_at?: string;
  url?: string;
  summary?: string;
};

type AlertItem = {
  type: "info" | "warn" | "error";
  title: string;
  message: string;
  category?: string;
  source?: string;
};

type RightPanelLive = {
  fiiDii?: FiiDiiData | null;
  options?: OptionsData | null;
  ragCheck?: RagCheckData | null;
  news?: { news: NewsItem[], announcements: NewsItem[] } | null;
  alerts?: AlertItem[] | null;
  loading?: boolean;
};

type Session = {
  id: number;
  title: string;
  tag: "Bullish" | "Bearish" | "Neutral";
  time: string;
};

type LiveQuote = {
  symbol: string;
  company: string;
  ltp: number;
  dayChange?: number;
  dayChangePerc?: number;
  source: "live" | "fallback";
  updatedAt?: string;
};

type StockDocData = {
  symbol: string;
  available: boolean;
  summaryText?: string | null;
  pipelineRunAt?: string | null;
  annualReportLinks?: Array<{ year?: string; label?: string; url?: string }>;
  metrics?: {
    peRatio?: number | null;
    pbRatio?: number | null;
    roePct?: number | null;
  };
  counts?: {
    announcements?: number;
    quarterlyRows?: number;
    insiderTrades?: number;
  };
};

const initialSessions: Session[] = [];

const nowTime = () =>
  new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export default function CyroPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState("");
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [stockDocData, setStockDocData] = useState<StockDocData | null>(null);
  const [stockDocError, setStockDocError] = useState("");
  // activeSessionId must be declared before usePersistentMessages which uses it
  const [activeSessionId, setActiveSessionId] = useState<number>(1);
  // Session-persistent messages — survives page reloads, keyed by activeSessionId
  const [messages, setMessages] = usePersistentMessages<Message>(activeSessionId, []);
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [sessionFilter, setSessionFilter] = useState("");
  const [input, setInput] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [attachName, setAttachName] = useState("");
  const [activeTab, setActiveTab] = useState<"news" | "alerts" | "flow" | "source">("source");
  const [quickOn, setQuickOn] = useState<Record<string, boolean>>({
    live: false,
    news: false,
    fundamentals: false,
    chart: false,
  });
  const [toastText, setToastText] = useState("");
  const [toastOn, setToastOn] = useState(false);
  // CYRO streaming state
  const [cyroMode, setCyroMode] = useState<CyroMode>("normal");
  const [isStreaming, setIsStreaming] = useState(false);
  // Right panel live data (Week 5)
  const [rightPanel, setRightPanel] = useState<RightPanelLive>({});
  const [selectedSource, setSelectedSource] = useState<SourceCitation | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const msgWrapRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    // Hydrate state from localStorage after initial render to avoid hydration mismatch
    try {
      const rawAct = localStorage.getItem("cyro_active_session");
      if (rawAct) setActiveSessionId(Number(rawAct) || 1);
    } catch {}
    try {
      const rawSess = localStorage.getItem("cyro_sessions");
      const parsedSess = rawSess ? (JSON.parse(rawSess) as Session[]) : null;
      if (Array.isArray(parsedSess) && parsedSess.length > 0) {
        setSessions(parsedSess);
      }
    } catch {}
  }, []);

  // Persist sessions list and active session ID on every change
  useEffect(() => {
    if (!mounted) return;
    try { localStorage.setItem("cyro_sessions", JSON.stringify(sessions)); } catch { /* quota */ }
  }, [sessions, mounted]);

  useEffect(() => {
    if (!mounted) return;
    try { localStorage.setItem("cyro_active_session", String(activeSessionId)); } catch { /* quota */ }
  }, [activeSessionId, mounted]);

  const activeSymbol = selectedTicker ? `NSE_${selectedTicker}` : "";


  // ── Week 5: Load right-panel live data whenever ticker changes ──
  useEffect(() => {
    let alive = true;
    if (!selectedTicker) {
      setRightPanel({});
      return () => { alive = false; };
    }
    setRightPanel({ loading: true });

    const loadRightPanel = async () => {
      try {
        const [fiiRes, optRes, ragRes, newsRes, alertsRes] = await Promise.allSettled([
          fetch(`/api/cyro-market?endpoint=fii-dii&days=5`, { cache: "no-store" }),
          fetch(`/api/cyro-market?endpoint=options&ticker=${selectedTicker}`, { cache: "no-store" }),
          fetch(`/api/cyro-market?endpoint=rag-check&ticker=${selectedTicker}`, { cache: "no-store" }),
          fetch(`/api/cyro-market?endpoint=news&ticker=${selectedTicker}`, { cache: "no-store" }),
          fetch(`/api/cyro-market?endpoint=alerts&ticker=${selectedTicker}`, { cache: "no-store" }),
        ]);

        if (!alive) return;

        const fiiData = fiiRes.status === "fulfilled" && fiiRes.value.ok
          ? (await fiiRes.value.json()).data as FiiDiiData
          : null;
        const optData = optRes.status === "fulfilled" && optRes.value.ok
          ? (await optRes.value.json()).data as OptionsData
          : null;
        const ragData = ragRes.status === "fulfilled" && ragRes.value.ok
          ? (await ragRes.value.json()).data as RagCheckData
          : null;
        const newsData = newsRes.status === "fulfilled" && newsRes.value.ok
          ? (await newsRes.value.json()).data as { news: NewsItem[], announcements: NewsItem[] }
          : null;
        const alertsData = alertsRes.status === "fulfilled" && alertsRes.value.ok
          ? (await alertsRes.value.json()).data.alerts as AlertItem[]
          : null;

        setRightPanel({ fiiDii: fiiData, options: optData, ragCheck: ragData, news: newsData, alerts: alertsData, loading: false });
      } catch {
        if (alive) setRightPanel({ loading: false });
      }
    };

    loadRightPanel();
    // Refresh every 60s
    const t = setInterval(loadRightPanel, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [selectedTicker]);

  const handleInputChange = (val: string) => {
    setInput(val);
  };

  useEffect(() => {
    let alive = true;
    let inFlight = false;

    if (!selectedTicker) {
      setQuote(null);
      setQuoteError("");
      return () => { alive = false; };
    }

    const loadQuote = async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;

      try {
        const response = await fetch(`/api/live-quote?symbol=${activeSymbol}&company=${encodeURIComponent(selectedTicker)}&_ts=${Date.now()}`, {
          cache: "no-store",
        });
        const data = await response.json();

        if (!alive) return;

        if (!response.ok || !data.ok) {
          setQuoteError(data.error ?? "Unable to load quote");
          return;
        }

        setQuote(data.data as LiveQuote);
        setQuoteError("");
      } catch {
        if (alive) setQuoteError("Unable to connect to quote service");
      } finally {
        inFlight = false;
      }
    };

    loadQuote();
    const timer = setInterval(loadQuote, 1000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeSymbol, selectedTicker]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    const loadStockDocData = async () => {
      try {
        const response = await fetch(`/api/stock-docs?symbol=${encodeURIComponent(activeSymbol)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();

        if (!alive) {
          return;
        }

        if (!response.ok || !payload.ok) {
          setStockDocData(null);
          setStockDocError(payload.error ?? "Unable to load doc data");
          return;
        }

        setStockDocData((payload.data ?? null) as StockDocData | null);
        setStockDocError("");
      } catch {
        if (!alive) {
          return;
        }
        setStockDocData(null);
        setStockDocError("Unable to connect to doc data service");
      }
    };

    setStockDocData(null);
    loadStockDocData();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [activeSymbol]);

  useEffect(() => {
    if (!msgWrapRef.current) return;
    msgWrapRef.current.scrollTop = msgWrapRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = (msg: string) => {
    setToastText(msg);
    setToastOn(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastOn(false), 2000);
  };

  const filteredSessions = useMemo(() => {
    if (!sessionFilter.trim()) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(sessionFilter.toLowerCase()));
  }, [sessions, sessionFilter]);

  const sendMsg = useCallback((e?: FormEvent) => {
    if (e) e.preventDefault();
    const txt = input.trim();
    if (!txt || isStreaming) return;

    // Close any existing stream
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const userMsgId = Date.now();
    const aiMsgId = userMsgId + 1;

    const userMsg: Message = { id: userMsgId, role: "user", text: txt, time: nowTime() };
    const aiMsg: Message = {
      id: aiMsgId,
      role: "assistant",
      text: "",
      time: nowTime(),
      streaming: true,
      citations: [],
      activityState: { ...initialResearchState },
      analystStatuses: [
        "IntentRouter",
        "ContextBuilder",
        "QualityGate",
        "FundamentalAnalyst",
        "FilingsGovernanceAnalyst",
        "TechnicalAnalyst",
        "SectorPeerMacroAnalyst",
        "NewsCatalystAnalyst",
        "RiskBearAnalyst",
        "InvestmentCommittee"
      ].map(n => ({ name: n, status: "pending" as const })),
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    // Auto-update session title from first user message (only if still default)
    setSessions((prev) => prev.map((s) =>
      s.id === activeSessionId && messages.filter(m => m.role === "user").length === 0
        ? { ...s, title: txt.slice(0, 50) }
        : s
    ));

    setInput("");
    setAttachName("");

    setIsStreaming(true);

    let finalTicker: string | null = null;
    // Extract @TICKER manually from text if user typed it without selecting from dropdown
    const atMatch = txt.match(/@([A-Za-z0-9_]+)/);
    if (atMatch) {
      finalTicker = atMatch[1].toUpperCase();
      setSelectedTicker(finalTicker);
    }
    
    const params = new URLSearchParams({
      message: txt,
      mode: cyroMode,
      session_id: String(activeSessionId),
      ...(finalTicker ? { ticker: finalTicker } : selectedTicker ? { ticker: selectedTicker } : {}),
    });
    const url = `/api/cyro-chat?${params.toString()}`;
    const es = new EventSource(url);
    esRef.current = es;
    let cyroRequestId: string | null = null;
    let cyroResearchId: string | null = null;
    let isConversationStream = false;

    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as Record<string, unknown>;
        const type = event.type as string;
        const incomingRequestId = typeof event.request_id === "string" ? event.request_id : null;
        const incomingResearchId = typeof event.research_id === "string" ? event.research_id : null;

        // The UI message association is local, but every graph event must also
        // belong to the one request/research pair established by `started`.
        if (cyroRequestId && incomingRequestId && incomingRequestId !== cyroRequestId) return;
        if (cyroResearchId && incomingResearchId && incomingResearchId !== cyroResearchId) return;
        if ((cyroRequestId && !incomingRequestId) || (cyroResearchId && !incomingResearchId)) {
          if (type !== "error") return;
        }
        if (incomingRequestId) cyroRequestId = incomingRequestId;
        if (incomingResearchId) cyroResearchId = incomingResearchId;

        if (incomingRequestId || incomingResearchId) {
          setMessages((prev) => prev.map((m) =>
            m.id === aiMsgId ? {
              ...m,
              requestId: incomingRequestId ?? m.requestId,
              researchId: incomingResearchId ?? m.researchId,
            } : m
          ));
        }

        if (type === "started" && event.mode === "conversation") {
          isConversationStream = true;
        }

        const normalized = normalizeResearchEvent(type, event);
        if (normalized.type !== "noop") {
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiMsgId || !m.activityState) return m;
            return {
              ...m,
              activityState: researchActivityReducer(m.activityState, { type: "PROCESS_EVENT", payload: normalized })
            };
          }));
        }

        if (type === "ticker_resolved") {
          // Update selected ticker if backend resolved a different one
          const resolved = event.ticker as string;
          if (resolved && resolved !== "NIFTY") setSelectedTicker(resolved);
        }

        else if (type === "analyst_start") {
          const analyst = event.analyst as string;
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiMsgId) return m;
            const statuses = (m.analystStatuses ?? []).map((s) =>
              s.name === analyst ? { ...s, status: "running" as const } : s
            );
            return { ...m, analystStatuses: statuses, text: m.text || `🔍 Analysing ${analyst}...` };
          }));
        }

        else if (type === "analyst_done") {
          const analyst = event.analyst as string;
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiMsgId) return m;
            const statuses = (m.analystStatuses ?? []).map((s) =>
              s.name === analyst
                ? { ...s, status: "done" as const, verdict: event.verdict as string, confidence: event.confidence as number }
                : s
            );
            return { ...m, analystStatuses: statuses };
          }));
        }

        else if (type === "agent_claims_ready") {
          const domain = domainKeyForAgent(String(event.agent ?? ""));
          const claims = Array.isArray(event.claims) ? event.claims as ReportClaim[] : [];
          if (!domain) return;
          setMessages((prev) => prev.map((m) => m.id === aiMsgId ? {
            ...m,
            domainClaims: { ...(m.domainClaims ?? {}), [domain]: claims },
          } : m));
        }

        else if (type === "source_captured") {
          const citation = event.citation as SourceCitation;
          setMessages((prev) => prev.map((m) =>
            m.id === aiMsgId
              ? { ...m, citations: [...(m.citations ?? []), citation] }
              : m
          ));
        }

        else if (type === "phase") {
          const phase = event.phase as string;
          const label = phase === "debate" ? "⚔️ Bull vs Bear debate..." :
                        phase === "synthesis" ? "🧠 Synthesising final decision..." :
                        `📊 ${phase}...`;
          setMessages((prev) => prev.map((m) =>
            m.id === aiMsgId ? { ...m, text: label } : m
          ));
        }

        else if (type === "scorecard") {
          const sc = event as unknown as ScorecardData;
          setMessages((prev) => prev.map((m) =>
            m.id === aiMsgId ? { ...m, scorecard: sc } : m
          ));
        }

        else if (type === "debate_token") {
          const step = event.step as string;
          const token = event.token as string;
          
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiMsgId) return m;
            
            const currentCards = m.debateCards ?? [];
            const updatedCards = [...currentCards];
            
            if (step === "bull_r1" || step === "bear_r1") {
              let r1Card = updatedCards.find(c => c.type === "round" && c.round === 1);
              if (!r1Card) {
                r1Card = { type: "round", round: 1, bull: "", bear: "" };
                updatedCards.push(r1Card);
              }
              if (step === "bull_r1") r1Card.bull = (r1Card.bull || "") + token;
              if (step === "bear_r1") r1Card.bear = (r1Card.bear || "") + token;
            } 
            else if (step === "bull_r2" || step === "bear_r2") {
              let r2Card = updatedCards.find(c => c.type === "rebuttal" && c.round === 2);
              if (!r2Card) {
                r2Card = { type: "rebuttal", round: 2, bull: "", bear: "" };
                updatedCards.push(r2Card);
              }
              if (step === "bull_r2") r2Card.bull = (r2Card.bull || "") + token;
              if (step === "bear_r2") r2Card.bear = (r2Card.bear || "") + token;
            }
            else if (step === "facilitator") {
              let facCard = updatedCards.find(c => c.type === "facilitator");
              if (!facCard) {
                facCard = { type: "facilitator", summary: "", winner: "" };
                updatedCards.push(facCard);
              }
              facCard.summary = (facCard.summary || "") + token;
              if (facCard.summary.toUpperCase().includes("WINNER: BULL")) facCard.winner = "BULL";
              else if (facCard.summary.toUpperCase().includes("WINNER: BEAR")) facCard.winner = "BEAR";
            }
            
            return { ...m, debateCards: updatedCards, text: m.text || "⚔️ Bull vs Bear debate underway..." };
          }));
        }

        else if (type === "final_report") {
          const report = event.report as FinalResearchReport | undefined;
          if (!report || !report.symbol) return;
          const sources = (report.sources ?? []).map(normalizeSource);
          setMessages((prev) => prev.map((m) => m.id === aiMsgId ? {
            ...m,
            report,
            signal: report.conclusion,
            text: report.summary,
            citations: sources,
          } : m));
        }

        else if (type === "final_decision") {
          const signal = (event.signal as string) ?? "HOLD";
          const summary = (event.summary as string) ?? "";
          const sources = ((event.sources_used as unknown[]) ?? []).map(normalizeSource);
          const tradePlans = (event.trade_plans as Record<string, TradePlan>) ?? {};
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiMsgId) return m;
            return {
              ...m,
              text: m.report ? m.text : summary,
              signal,
              streaming: false,
              citations: m.report ? m.citations : [...(m.citations ?? []), ...sources],
              tradePlans,
              ragUsed: !!(event.rag_used),
            };
          }));
        }

        else if (type === "error") {
          const errMsg = (event.message as string) ?? "Unknown error";
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiMsgId) return m;
            
            const isBrokerError = event.error_type === "BROKER_AUTH_ERROR";
            const isUnsupportedComparison = event.error_type === "MULTI_STOCK_UNSUPPORTED";
            
            return {
              ...m,
              text: isBrokerError 
                ? `❌ **Broker Connection Failed**\n\nThe CYRO engine encountered an authentication error with your broker. This usually happens when your access token has expired. Please click the **Broker Settings** button in the sidebar to re-authenticate.\n\n_Technical details: ${errMsg}_`
                : isUnsupportedComparison
                  ? `ℹ️ ${errMsg}`
                : `❌ **CYRO Research Pipeline Error**\n\n${event.error_type ? "The research pipeline could not complete this request." : errMsg}`,
              streaming: false
            };
          }));
          setIsStreaming(false);
          es.close();
        }

        else if (type === "done") {
          const conversationConclusion = event.conclusion as string | undefined;
          setIsStreaming(false);
          setMessages((prev) => prev.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  text: isConversationStream && conversationConclusion ? conversationConclusion : m.text,
                  streaming: false,
                }
              : m
          ));
          es.close();
          esRef.current = null;
        }
      } catch {
        // Ignore malformed events
      }
    };

    es.onerror = () => {
      setIsStreaming(false);
      setMessages((prev) => prev.map((m) =>
        m.id === aiMsgId && m.streaming
          ? { ...m, text: m.text || "Connection to CYRO backend lost. Is india-trade-cli running on port 8765?", streaming: false }
          : m
      ));
      es.close();
      esRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isStreaming, cyroMode, selectedTicker, activeSessionId]);

  const copyMessage = async (id: number) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg) return;
    try {
      await navigator.clipboard.writeText(msg.text);
      showToast("Copied");
    } catch {
      showToast("Unable to copy");
    }
  };

  const deleteMessage = (id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    showToast("Message deleted");
  };

  const editMessage = (id: number) => {
    const msg = messages.find((m) => m.id === id && m.role === "user");
    if (!msg) return;
    setInput(msg.text);
    setMessages((prev) => prev.filter((m) => m.id !== id));
    showToast("Message moved to editor");
  };

  const regenerateLastAssistant = () => {
    const lastAssistantIndex = [...messages].reverse().findIndex((m) => m.role === "assistant");
    if (lastAssistantIndex === -1) return;
    const actualIndex = messages.length - 1 - lastAssistantIndex;
    const base = messages[actualIndex - 1];

    setMessages((prev) => {
      const next = [...prev];
      next.splice(actualIndex, 1);
      next.push({
        id: Date.now(),
        role: "assistant",
        text: `Regenerated response for: ${base?.text ?? "latest query"}. Updated brief can include valuation bands, risk map, catalysts, and position sizing notes.`,
        time: nowTime(),
      });
      return next;
    });

    showToast("Response regenerated");
  };

  const toggleActivityExpand = (id: number) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === id && m.activityState) {
          return {
            ...m,
            activityState: researchActivityReducer(m.activityState, { type: "TOGGLE_EXPAND" }),
          };
        }
        return m;
      })
    );
  };

  const rateMessage = (id: number, positive: boolean) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              liked: positive,
              disliked: !positive,
            }
          : m,
      ),
    );
    showToast(positive ? "Marked helpful" : "Feedback noted");
  };

  const newChat = () => {
    // Clear stored history for the current session before switching
    clearSessionMessages(activeSessionId);
    setMessages([]);
    const id = Date.now();
    const next: Session = {
      id,
      title: "New research session",
      tag: "Neutral",
      time: "now",
    };
    setSessions((prev) => [next, ...prev]);
    setActiveSessionId(id);
    showToast("New research session");
  };

  const onAttach = () => fileRef.current?.click();

  const onFileChange = (file?: File | null) => {
    if (!file) return;
    setAttachName(file.name);
    showToast("Attachment added");
  };

  const onExport = () => {
    if (!messages.length) {
      showToast("No messages to export");
      return;
    }
    const lines = messages.map((m) => `${m.role.toUpperCase()} (${m.time})\n${m.text}\n`).join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cyro-chat-export.txt";
    a.click();
    showToast("Chat exported");
  };

  const onCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Link copied");
    } catch {
      showToast("Unable to copy link");
    }
  };

  const latestAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");
  const latestSources = latestAssistantMsg?.citations || [];

  const visibleTheme = mounted ? (resolvedTheme === "dark" ? "dark" : "light") : "light";
  const priceUp = (quote?.dayChangePerc ?? 0) >= 0;

  return (
    <div className="cyro-page" data-theme={visibleTheme}>
      <div id="toast" className={toastOn ? "on" : ""}>
        {toastText}
      </div>

      <div className="shell">
        <aside className="sidebar">
          <div className="sb-head">
            <div className="sb-brand">
              <span className="sb-brand-name">CYRO AI</span>
              <span className="sb-brand-badge">PRO</span>
            </div>
            <button className="new-chat-btn" onClick={newChat}>
              <Plus size={14} />
              New Research
            </button>
          </div>

          <div className="wl-block">
            <div className="wl-top">
              <span className="block-label">Live Quote</span>
              <button className="wl-add-btn" onClick={() => showToast("Add watch item")}>+
              </button>
            </div>
            <div className="wl-chip-wrap">
              <div className={`wl-chip ${priceUp ? "up" : "dn"}`}>
                {quote?.symbol ?? "No stock selected"}
                <span>{quote?.dayChangePerc !== undefined ? `${priceUp ? "+" : ""}${quote.dayChangePerc.toFixed(2)}%` : "--"}</span>
              </div>
            </div>
          </div>

          <div className="sb-search">
            <div className="sf">
              <Search size={13} />
              <input
                value={sessionFilter}
                onChange={(e) => setSessionFilter(e.target.value)}
                placeholder="Search sessions..."
              />
            </div>
          </div>

          <div className="chat-list">
            {filteredSessions.map((s) => (
              <button
                key={s.id}
                className={`ci ${activeSessionId === s.id ? "on" : ""}`}
                onClick={() => setActiveSessionId(s.id)}
              >
                <div className={`ci-dot ${s.tag === "Bullish" ? "bull" : s.tag === "Bearish" ? "bear" : "neut"}`} />
                <div className="ci-body">
                  <div className="ci-title">{s.title}</div>
                  <div className="ci-sub">{s.tag} · {s.time}</div>
                </div>
                <span
                  className="xbtn"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    clearSessionMessages(s.id);
                    setSessions((prev) => prev.filter((x) => x.id !== s.id));
                    showToast("Session removed");
                  }}
                >
                  <Trash2 size={11} />
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="chat-main">
          <div className="topbar">
            <div className="tb-l">
              <div className="live-ticker">
                <span className="dot" />
                <span className="sym">{quote?.symbol ?? "Select a stock"}</span>
                <span className="price">{quote?.ltp ? `Rs ${quote.ltp.toFixed(2)}` : "--"}</span>
                <span className={`chg ${priceUp ? "up" : "dn"}`}>
                  {quote?.dayChangePerc !== undefined ? `${priceUp ? "+" : ""}${quote.dayChangePerc.toFixed(2)}%` : "--"}
                </span>
              </div>
              <div className="model-pill" onClick={() => showToast("Model switched")}>CYRO Analyst <ChevronDown size={12} /></div>
              <input
                value={selectedTicker}
                onChange={(e) => setSelectedTicker(e.target.value)}
                className="company-picker"
                placeholder="Ticker (optional)"
                aria-label="Optional stock ticker"
              />
            </div>
            <div className="tb-r">
              <button className="tb-btn" onClick={() => showToast("Search chat")}
              ><Search size={15} /></button>
              <button className="tb-btn" onClick={onExport}><File size={15} /></button>
              <button className="tb-btn" onClick={onCopyLink}><Share2 size={15} /></button>
              <button className="tb-btn" onClick={() => showToast("Notifications")}><Bell size={15} /></button>
              <button
                className="tb-btn"
                onClick={() => setTheme(visibleTheme === "dark" ? "light" : "dark")}
                aria-label="Toggle theme"
              >
                {visibleTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              </button>
            </div>
          </div>

          <div className="messages" ref={msgWrapRef}>
            {messages.length === 0 ? (
              <div className="empty-state">Conversation is empty. Start with the input below.</div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`msg-row ${msg.role === "user" ? "user-row" : ""}`}>
                  <div className={`msg-av ${msg.role === "assistant" ? "ai-av" : "u-av"}`}>
                    {msg.role === "assistant" ? <span className="av-mark av-cy">CY</span> : <span className="av-mark av-you">YU</span>}
                  </div>
                  <div className="msg-col">
                    <div className="msg-sender">
                      {msg.role === "assistant" ? "CYRO" : "You"} · {msg.time}
                      {msg.signal && !msg.report && (
                        <span className={`signal-badge signal-${msg.signal.toLowerCase()}`}>
                          {msg.signal.replace("_", " ")}
                        </span>
                      )}
                      {msg.streaming && <span className="streaming-dot">●</span>}
                    </div>

                    {/* Research Activity Panel */}
                    {msg.activityState && (
                      <ResearchActivityPanel 
                        state={msg.activityState} 
                        onToggleExpand={() => toggleActivityExpand(msg.id)} 
                      />
                    )}

                    <div className={`bubble ${msg.report ? "report-bubble" : "markdown-content"} ${msg.role === "assistant" ? "ai-bubble" : "user-bubble"}`}>
                      {msg.report ? (
                        <CyroResearchReport report={msg.report} sources={msg.citations ?? []} activityState={msg.activityState} domainClaims={msg.domainClaims} onSourceClick={(source) => { setSelectedSource(source); setActiveTab("source"); }} />
                      ) : msg.text ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.text}
                        </ReactMarkdown>
                      ) : (msg.streaming ? <span className="thinking">Thinking...</span> : "")}
                    </div>

                    {/* Source Citation Cards */}
                    {msg.role === "assistant" && !msg.report && msg.citations && msg.citations.length > 0 && (
                      <div className="citations">
                        <div className="cite-label">Sources used ({msg.citations.length})</div>
                        <div className="cite-list">
                          {msg.citations.slice(0, 6).map((c, i) => (
                            <div key={i} className="cite-card" onClick={() => { setSelectedSource(c); setActiveTab("source"); }}>
                              <div className="cite-agent">{c.source_type}</div>
                              <div className="cite-source">{c.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Scorecard (reasoning mode) */}
                    {msg.role === "assistant" && msg.scorecard && (
                      <div className="scorecard-card">
                        <div className="sc-header">
                          <span className="sc-title">📊 Scorecard</span>
                          <span className={`sc-verdict sc-${msg.scorecard.verdict.toLowerCase()}`}>{msg.scorecard.verdict}</span>
                          <span className="sc-agree">{msg.scorecard.agreement.toFixed(0)}% agreement</span>
                        </div>
                        <div className="sc-scores">
                          {Object.entries(msg.scorecard.scores).map(([name, score]) => (
                            <div key={name} className="sc-row">
                              <span className="sc-name">{name}</span>
                              <div className="sc-bar-wrap">
                                <div className={`sc-bar ${score > 0 ? "bull" : score < 0 ? "bear" : "neut"}`}
                                  style={{ width: `${Math.min(Math.abs(score), 100)}%` }} />
                              </div>
                              <span className={`sc-val ${score > 0 ? "pos" : score < 0 ? "neg" : ""}`}>{score > 0 ? "+" : ""}{score.toFixed(0)}</span>
                            </div>
                          ))}
                        </div>
                        {msg.scorecard.conflicts.length > 0 && (
                          <div className="sc-conflicts">⚠️ {msg.scorecard.conflicts.join(" | ")}</div>
                        )}
                      </div>
                    )}

                    {/* Debate Cards (reasoning mode) */}
                    {msg.role === "assistant" && msg.debateCards && msg.debateCards.length > 0 && (
                      <div className="debate-section">
                        {msg.debateCards.map((card, i) => (
                          <div key={i} className={`debate-card dc-${card.type}`}>
                            {card.type === "round" && (
                              <>
                                <div className="dc-label">⚔️ Bull vs Bear — Round {card.round}</div>
                                <div className="dc-row">
                                  <div className="dc-side bull">
                                    <div className="dc-side-label">🟢 Bull</div>
                                    <div className="dc-text">{card.bull}</div>
                                  </div>
                                  <div className="dc-side bear">
                                    <div className="dc-side-label">🔴 Bear</div>
                                    <div className="dc-text">{card.bear}</div>
                                  </div>
                                </div>
                              </>
                            )}
                            {card.type === "rebuttal" && (
                              <>
                                <div className="dc-label">🔄 Rebuttals — Round {card.round}</div>
                                <div className="dc-row">
                                  <div className="dc-side bull"><div className="dc-side-label">Bull Rebuttal</div><div className="dc-text">{card.bull}</div></div>
                                  <div className="dc-side bear"><div className="dc-side-label">Bear Rebuttal</div><div className="dc-text">{card.bear}</div></div>
                                </div>
                              </>
                            )}
                            {card.type === "facilitator" && (
                              <>
                                <div className="dc-label">⚖️ Facilitator Summary — Winner: <strong>{card.winner}</strong></div>
                                <div className="dc-text">{card.summary}</div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Trade Plans (reasoning mode final decision) */}
                    {msg.role === "assistant" && msg.tradePlans && Object.keys(msg.tradePlans).length > 0 && (
                      <div className="trade-plans">
                        <div className="tp-label">💼 Trade Plans</div>
                        <div className="tp-grid">
                          {Object.entries(msg.tradePlans).map(([key, plan]) => plan && (
                            <div key={key} className="tp-card">
                              <div className="tp-profile">{key}</div>
                              {plan.strategy && <div className="tp-row"><span>Strategy</span><span>{plan.strategy}</span></div>}
                              {plan.entry && <div className="tp-row"><span>Entry</span><span>{plan.entry}</span></div>}
                              {plan.stop_loss && <div className="tp-row"><span>Stop</span><span className="neg">{plan.stop_loss}</span></div>}
                              {plan.target && <div className="tp-row"><span>Target</span><span className="pos">{plan.target}</span></div>}
                              {plan.risk_reward && <div className="tp-row"><span>R:R</span><span>{plan.risk_reward}</span></div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className={`msg-foot ${msg.role === "assistant" ? "assistant-foot" : "user-foot"}`}>
                      {msg.role === "assistant" ? (
                        <div className="m-acts assistant">
                          <button className="act-btn" onClick={() => copyMessage(msg.id)} title="Copy"><Copy size={11} /></button>
                          <button className={`act-btn ${msg.liked ? "liked" : ""}`} onClick={() => rateMessage(msg.id, true)} title="Helpful"><ThumbsUp size={11} /></button>
                          <button className={`act-btn ${msg.disliked ? "disliked" : ""}`} onClick={() => rateMessage(msg.id, false)} title="Not helpful"><ThumbsDown size={11} /></button>
                          <button className="act-btn" onClick={regenerateLastAssistant} title="Regenerate"><RefreshCw size={11} /></button>
                        </div>
                      ) : (
                        <div className="m-acts user">
                          <button className="act-btn" onClick={() => copyMessage(msg.id)} title="Copy"><Copy size={11} /></button>
                          <button className="act-btn" onClick={() => editMessage(msg.id)} title="Edit"><Edit3 size={11} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <form className="input-area" onSubmit={sendMsg}>
            <div className="quick-bar">
              {/* Mode toggle */}
              <button
                type="button"
                className={`q-pill mode-pill ${cyroMode === "normal" ? "on" : ""}`}
                onClick={() => setCyroMode("normal")}
                title="Normal mode: fast single-analyst research (~15s)"
              >
                ⚡ Normal
              </button>
              <button
                type="button"
                className={`q-pill mode-pill ${cyroMode === "reasoning" ? "on reasoning" : ""}`}
                onClick={() => setCyroMode("reasoning")}
                title="Reasoning mode: 7 analysts + debate (~3min)"
              >
                🧠 Deep
              </button>
              <div className="q-divider" />
              <button
                type="button"
                className={`q-pill ${quickOn.live ? "on" : ""}`}
                onClick={() => setQuickOn((p) => ({ ...p, live: !p.live }))}
              >
                <Globe size={11} /> Live Data
              </button>
              <button
                type="button"
                className={`q-pill ${quickOn.news ? "on" : ""}`}
                onClick={() => setQuickOn((p) => ({ ...p, news: !p.news }))}
              >
                <Newspaper size={11} /> News
              </button>
              <button
                type="button"
                className={`q-pill ${quickOn.fundamentals ? "on" : ""}`}
                onClick={() => setQuickOn((p) => ({ ...p, fundamentals: !p.fundamentals }))}
              >
                <Wallet size={11} /> Fundamentals
              </button>
              <button
                type="button"
                className={`q-pill ${quickOn.chart ? "on" : ""}`}
                onClick={() => setQuickOn((p) => ({ ...p, chart: !p.chart }))}
              >
                <ChartColumn size={11} /> Chart
              </button>
              <button type="button" className="q-pill" onClick={onAttach}><Paperclip size={11} /> Attach</button>
              <button type="button" className="q-pill" onClick={() => showToast("Screener module")}><FileSearch size={11} /> Screener</button>
            </div>

            {attachName ? <div className="att-prev">{attachName}</div> : null}

            <div className="input-shell">
              <button type="button" className="in-left" onClick={onAttach}>
                <Plus size={18} />
              </button>
              <input
                ref={inputRef}
                className="msg-inp"
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendMsg();
                  }
                }}
                placeholder="Ask CYRO about a stock... (type @ to tag a ticker)"
              />
              <div className="inp-right">
                {isStreaming && (
                  <button
                    type="button"
                    className="r-btn stop-btn"
                    title="Stop"
                    onClick={() => {
                      esRef.current?.close();
                      esRef.current = null;
                      setIsStreaming(false);
                      showToast("Stopped");
                    }}
                  >
                    ■
                  </button>
                )}
                <button
                  type="button"
                  className={`r-btn ${micOn ? "rec" : ""}`}
                  onClick={() => {
                    setMicOn((p) => !p);
                    showToast(!micOn ? "Listening..." : "Mic stopped");
                  }}
                ><Mic size={15} /></button>
                <button type="submit" disabled={isStreaming} className={`send-btn ${input.trim() && !isStreaming ? "" : "off"}`}><Send size={14} /></button>
              </div>
            </div>

            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(e) => {
                onFileChange(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
          </form>
        </main>

        <aside className="rpanel">
          <div className="rp-tabs">
            <button className={`rp-tab ${activeTab === "source" ? "on" : ""}`} onClick={() => setActiveTab("source")}>Source</button>
            <button className={`rp-tab ${activeTab === "flow" ? "on" : ""}`} onClick={() => setActiveTab("flow")}>Flow</button>
            <button className={`rp-tab ${activeTab === "news" ? "on" : ""}`} onClick={() => setActiveTab("news")}>News</button>
            <button className={`rp-tab ${activeTab === "alerts" ? "on" : ""}`} onClick={() => setActiveTab("alerts")}>Alerts</button>
          </div>
          <div className="rp-body">


            {/* Week 5: Flow Intelligence Tab */}
            {activeTab === "flow" ? (
              <>
                {rightPanel.loading && <div className="txt">Loading flow data…</div>}
                {/* VIX */}
                {rightPanel.fiiDii?.vix != null && (
                  <div className="card">
                    <div className="lbl">🌡️ India VIX</div>
                    <div className="val">{rightPanel.fiiDii.vix.toFixed(2)}</div>
                  </div>
                )}
                {/* FII/DII last 3 rows */}
                {(rightPanel.fiiDii?.fii_dii_rows ?? []).slice(0, 3).map((row, i) => (
                  <div key={i} className="card">
                    <div className="lbl">📊 FII/DII {row.date ?? ""}</div>
                    <div className="txt">
                      FII: <span className={`${(row.fii_net ?? 0) > 0 ? "pos" : "neg"}`}>{(row.fii_net ?? 0) > 0 ? "+" : ""}{row.fii_net?.toFixed(0)} Cr</span>
                      {" · "}
                      DII: <span className={`${(row.dii_net ?? 0) > 0 ? "pos" : "neg"}`}>{(row.dii_net ?? 0) > 0 ? "+" : ""}{row.dii_net?.toFixed(0)} Cr</span>
                    </div>
                  </div>
                ))}
                {/* Options data */}
                {rightPanel.options && (
                  <div className="card">
                    <div className="lbl">📈 Options — {selectedTicker || "Selected stock"}</div>
                    <div className="txt">
                      PCR: <strong>{rightPanel.options.pcr?.toFixed(2) ?? "--"}</strong> · {rightPanel.options.pcr_interpretation}
                    </div>
                    {rightPanel.options.max_pain != null && (
                      <div className="txt">Max Pain: Rs {rightPanel.options.max_pain.toFixed(2)}</div>
                    )}
                    {rightPanel.options.iv_rank != null && (
                      <div className="txt">IV Rank: {rightPanel.options.iv_rank} — {rightPanel.options.iv_interpretation}</div>
                    )}
                  </div>
                )}
                {!rightPanel.loading && !rightPanel.fiiDii && (
                  <div className="txt">Flow data unavailable (CYRO backend offline?)</div>
                )}
              </>
            ) : null}
            {activeTab === "alerts" ? (
              <>
                {rightPanel.loading && <div className="txt">Loading alerts…</div>}
                {rightPanel.alerts && rightPanel.alerts.length > 0 ? (
                  rightPanel.alerts.map((alert, i) => (
                    <div key={i} className={`card ${alert.type === 'error' ? 'crit' : alert.type === 'warn' ? 'warn' : 'info'}`} title={alert.source || undefined}>
                      <div className="lbl">
                        {alert.type === 'info' ? <Shield size={12} /> : <Bell size={12} />} {alert.title}
                        {alert.category ? <span className="alert-cat">{alert.category}</span> : null}
                      </div>
                      <div className="txt">{alert.message}</div>
                    </div>
                  ))
                ) : (
                  !rightPanel.loading && <div className="txt">{selectedTicker ? `No active alerts for ${selectedTicker}.` : "Select a stock to view alerts."}</div>
                )}
              </>
            ) : null}
            {activeTab === "news" ? (
              <>
                {rightPanel.loading && <div className="txt">Loading news…</div>}
                {rightPanel.news?.announcements && rightPanel.news.announcements.length > 0 && (
                  <div className="card">
                    <div className="lbl">📣 Recent Announcements</div>
                    {rightPanel.news.announcements.map((a: any, i: number) => (
                      <div key={a.item_id || `${a.title}-${a.published_at || i}`} className="src-item" style={{ cursor: "default", border: "none", padding: "4px 0", background: "transparent" }}>
                        <strong style={{color: "var(--text-1)"}}>{a.title}</strong>
                        {a.summary && <div className="txt" style={{marginTop: "2px"}}>{a.summary}</div>}
                        <div className="txt" style={{fontSize: "9px", color: "var(--text-3)"}}>{a.published_at}</div>
                      </div>
                    ))}
                  </div>
                )}
                {rightPanel.news?.news && rightPanel.news.news.length > 0 && (
                  <div className="card">
                    <div className="lbl"><Newspaper size={12} /> Latest News</div>
                    {rightPanel.news.news.map((n: any, i: number) => (
                      <a key={n.item_id || `${n.title}-${n.published_at || i}`} href={n.url || "#"} target="_blank" rel="noreferrer" className="src-item" style={{ display: "block", cursor: n.url ? "pointer" : "default" }}>
                        <strong style={{color: "var(--text-1)"}}>{n.title}</strong>
                        {n.summary && <div className="txt" style={{marginTop: "2px"}}>{n.summary}</div>}
                        <div className="txt" style={{fontSize: "9px", color: "var(--text-3)", marginTop: "4px"}}>{n.source} {n.published_at ? `· ${n.published_at}` : ""}</div>
                      </a>
                    ))}
                  </div>
                )}
                {!rightPanel.loading && !rightPanel.news?.news?.length && !rightPanel.news?.announcements?.length && (
                  <div className="txt">No recent news or announcements found.</div>
                )}
              </>
            ) : null}
            {activeTab === "source" ? (
              <>
                {selectedSource ? (
                  <div className="card">
                    <div className="lbl"><FileText size={12} /> Source Details</div>
                    <div className="txt"><strong>{selectedSource.source_type}</strong> · {selectedSource.label}</div>
                    <div className="txt" style={{ color: 'var(--text-3)', marginTop: '3px' }}>Used as supporting research evidence.</div>
                    {selectedSource.excerpt && (
                      <div className="txt">
                        <strong>Excerpt:</strong>
                        <div style={{ marginTop: '4px', padding: '6px', background: 'var(--bg-surface)', borderRadius: '4px', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', fontSize: '11px' }}>
                          {selectedSource.excerpt}
                        </div>
                      </div>
                    )}
                    {selectedSource.timestamp && (
                      <div className="txt" style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '8px' }}>
                        Retrieved at: {selectedSource.timestamp}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="txt" style={{ marginBottom: '10px' }}>Select a source reference in the research report to view its supporting detail.</div>
                )}

                <div className="card src">
                  <div className="lbl"><FileText size={12} /> Research Evidence</div>
                  {latestSources.length > 0 ? (
                    latestSources.map((c, i) => (
                      <div key={i} className="src-item" onClick={() => setSelectedSource(c)}>
                        <strong>{c.source_type}</strong> · {c.label}
                        <div className="txt" style={{ marginTop: '4px', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', fontSize: '10px', color: 'var(--text-3)' }}>
                          {c.excerpt ? c.excerpt.slice(0, 150) + "..." : "No excerpt available"}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="txt">No source snippets used in the latest response.</div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </aside>
      </div>

      <style jsx global>{`
        .cyro-page {
          height: calc(100vh - 56px);
          overflow: hidden;
          font-family: Manrope, sans-serif;
        }
        .cyro-page * {
          box-sizing: border-box;
        }
        .cyro-page [data-theme="dark"],
        .cyro-page[data-theme="dark"] {
          --bg-base: #080c14;
          --bg-surface: #0c1220;
          --bg-raised: #111827;
          --bg-hover: #161e2e;
          --bg-active: #1a2438;
          --bg-input: #0e1624;
          --border-faint: #1a2438;
          --border-mid: #1e2d47;
          --text-1: #f0f4ff;
          --text-2: #8b9dc8;
          --text-3: #4a5880;
          --accent: #3b82f6;
          --accent-dim: rgba(59, 130, 246, 0.12);
          --green: #10b981;
          --red: #ef4444;
        }
        .cyro-page [data-theme="light"],
        .cyro-page[data-theme="light"] {
          --bg-base: #f4f6fb;
          --bg-surface: #ffffff;
          --bg-raised: #f8fafd;
          --bg-hover: #f0f4fa;
          --bg-active: #e8eef8;
          --bg-input: #ffffff;
          --border-faint: #e2e8f2;
          --border-mid: #d0daea;
          --text-1: #0f1729;
          --text-2: #3d5278;
          --text-3: #7a90b8;
          --accent: #2563eb;
          --accent-dim: rgba(37, 99, 235, 0.1);
          --green: #059669;
          --red: #dc2626;
        }
        .shell {
          display: grid;
          grid-template-columns: 250px 1fr 290px;
          height: 100%;
          background: var(--bg-base);
          color: var(--text-1);
        }
        .sidebar,
        .chat-main,
        .rpanel {
          min-height: 0;
        }
        .sidebar {
          border-right: 1px solid var(--border-faint);
          background: var(--bg-surface);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .sb-head {
          padding: 14px;
          border-bottom: 1px solid var(--border-faint);
        }
        .sb-brand {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }
        .sb-brand-name {
          font-size: 14px;
          font-weight: 800;
        }
        .sb-brand-badge {
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 8px;
          background: var(--accent-dim);
          color: var(--accent);
          border: 1px solid var(--border-mid);
        }
        .new-chat-btn {
          width: 100%;
          border: none;
          border-radius: 9px;
          background: var(--accent);
          color: #fff;
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: center;
          padding: 9px 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }
        .wl-block,
        .sb-search {
          padding: 10px 14px;
          border-bottom: 1px solid var(--border-faint);
        }
        .wl-top {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .block-label {
          font-size: 10px;
          color: var(--text-3);
          text-transform: uppercase;
          font-weight: 700;
        }
        .wl-add-btn {
          border: none;
          background: transparent;
          color: var(--text-3);
          cursor: pointer;
        }
        .wl-chip-wrap {
          display: flex;
        }
        .wl-chip {
          font-size: 11px;
          border-radius: 14px;
          padding: 5px 9px;
          font-weight: 700;
          display: inline-flex;
          gap: 6px;
          align-items: center;
        }
        .wl-chip.up {
          color: var(--green);
          background: rgba(16, 185, 129, 0.12);
        }
        .wl-chip.dn {
          color: var(--red);
          background: rgba(239, 68, 68, 0.12);
        }
        .sf {
          border: 1px solid var(--border-faint);
          border-radius: 8px;
          padding: 7px 9px;
          display: flex;
          gap: 7px;
          align-items: center;
          color: var(--text-3);
          background: var(--bg-input);
        }
        .sf input {
          width: 100%;
          border: none;
          background: transparent;
          outline: none;
          color: var(--text-1);
          font-size: 12px;
        }
        .chat-list {
          flex: 1;
          overflow: auto;
          padding: 8px;
        }
        .ci {
          width: 100%;
          border: none;
          background: transparent;
          text-align: left;
          border-radius: 8px;
          display: flex;
          gap: 8px;
          padding: 9px;
          margin-bottom: 6px;
          cursor: pointer;
          color: var(--text-2);
        }
        .ci:hover,
        .ci.on {
          background: var(--bg-hover);
        }
        .ci-dot {
          width: 8px;
          height: 8px;
          margin-top: 5px;
          border-radius: 999px;
          flex-shrink: 0;
        }
        .ci-dot.bull { background: var(--green); }
        .ci-dot.bear { background: var(--red); }
        .ci-dot.neut { background: #f59e0b; }
        .ci-body { flex: 1; min-width: 0; }
        .ci-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ci-sub {
          font-size: 10px;
          color: var(--text-3);
          margin-top: 3px;
        }
        .xbtn {
          color: var(--text-3);
          cursor: pointer;
          align-self: start;
          padding: 2px;
        }
        .chat-main {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--bg-base);
        }
        .topbar {
          border-bottom: 1px solid var(--border-faint);
          background: var(--bg-surface);
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          gap: 10px;
        }
        .tb-l,
        .tb-r {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .live-ticker,
        .model-pill {
          border: 1px solid var(--border-faint);
          background: var(--bg-raised);
          border-radius: 9px;
          padding: 6px 9px;
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          color: var(--text-2);
        }
        .company-picker {
          border: 1px solid var(--border-faint);
          background: var(--bg-raised);
          color: var(--text-2);
          border-radius: 9px;
          padding: 6px 9px;
          font-size: 12px;
          max-width: 240px;
          outline: none;
        }
        .sym,
        .price {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px;
        }
        .sym { color: var(--text-1); font-weight: 700; }
        .chg.up { color: var(--green); }
        .chg.dn { color: var(--red); }
        .dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: var(--green);
        }
        .tb-btn {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: var(--text-2);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .tb-btn:hover {
          background: var(--bg-hover);
        }
        .messages {
          flex: 1;
          overflow: auto;
          padding: 16px 0;
        }
        .empty-state {
          margin: 10px auto;
          width: min(760px, calc(100% - 28px));
          border: 1px dashed var(--border-mid);
          border-radius: 12px;
          background: var(--bg-surface);
          color: var(--text-3);
          font-size: 13px;
          text-align: center;
          padding: 20px;
        }
        .msg-row {
          display: flex;
          gap: 10px;
          width: min(920px, calc(100% - 36px));
          margin: 0 auto 10px;
        }
        .msg-row.user-row {
          flex-direction: row-reverse;
        }
        .msg-av {
          width: 30px;
          height: 30px;
          border-radius: 999px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          border: 1px solid rgba(148, 163, 184, 0.25);
        }
        .ai-av { background: radial-gradient(circle at 25% 20%, #67e8f9 0%, #3b82f6 45%, #1e3a8a 100%); }
        .u-av { background: radial-gradient(circle at 20% 20%, #fde68a 0%, #fb7185 45%, #7c3aed 100%); }
        .av-mark {
          font-size: 9px;
          line-height: 1;
          font-weight: 800;
          letter-spacing: 0.04em;
          color: #ffffff;
          text-shadow: 0 1px 2px rgba(15, 23, 42, 0.45);
          transform: translateY(0.2px);
        }
        .av-cy {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .av-you {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .msg-col { max-width: 90%; min-width: 0; }
        .msg-sender { font-size: 11px; color: var(--text-3); margin-bottom: 3px; }
        .bubble {
          border-radius: 14px;
          padding: 11px 13px;
          font-size: 13px;
          line-height: 1.6;
          border: 1px solid var(--border-faint);
          white-space: pre-wrap;
        }
        .ai-bubble {
          background: transparent;
          color: var(--text-1);
          border: none;
          padding: 2px 0;
          border-radius: 0;
        }
        .markdown-content {
          white-space: normal;
          word-break: break-word;
        }
        .markdown-content p {
          margin: 0 0 0.75rem 0;
        }
        .markdown-content p:last-child {
          margin-bottom: 0;
        }
        .markdown-content ul,
        .markdown-content ol {
          margin: 0 0 0.75rem 0;
          padding-left: 1.25rem;
        }
        .markdown-content li {
          margin-bottom: 0.25rem;
        }
        .markdown-content li > p {
          margin: 0;
        }
        .markdown-content h1,
        .markdown-content h2,
        .markdown-content h3 {
          margin: 1.25rem 0 0.5rem 0;
          font-weight: 700;
          line-height: 1.3;
        }
        .markdown-content h1:first-child,
        .markdown-content h2:first-child,
        .markdown-content h3:first-child {
          margin-top: 0;
        }
        .markdown-content code {
          background: var(--bg-raised);
          padding: 2px 4px;
          border-radius: 4px;
          font-family: ui-monospace, monospace;
          font-size: 0.9em;
        }
        .user-bubble {
          background: var(--accent);
          color: #fff;
          border-color: transparent;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1);
        }
        .msg-foot {
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 20px;
        }
        .msg-foot.user-foot {
          justify-content: flex-end;
        }
        .m-acts {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .m-acts.user {
          visibility: hidden;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.15s ease;
        }
        .msg-row.user-row:hover .m-acts.user {
          visibility: visible;
          opacity: 1;
          pointer-events: auto;
        }
        .act-btn {
          width: 20px;
          height: 20px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--text-3);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0.8;
        }
        .act-btn:hover {
          color: var(--text-1);
          opacity: 1;
          background: transparent;
        }
        .act-btn.liked {
          color: var(--green);
          opacity: 1;
        }
        .act-btn.disliked {
          color: var(--red);
          opacity: 1;
        }
        .input-area {
          border-top: none;
          background: transparent;
          padding: 8px 14px 10px;
        }
        .quick-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 8px;
        }
        .q-pill {
          border: 1px solid var(--border-faint);
          background: transparent;
          color: var(--text-2);
          border-radius: 14px;
          padding: 4px 9px;
          font-size: 11px;
          font-weight: 600;
          display: inline-flex;
          gap: 5px;
          align-items: center;
          cursor: pointer;
        }
        .q-pill.on,
        .q-pill:hover {
          background: var(--accent-dim);
          color: var(--accent);
          border-color: var(--border-mid);
        }
        .q-divider {
          width: 1px;
          height: 16px;
          background: var(--border-faint);
          margin: 0 2px;
          align-self: center;
        }
        .mode-pill {
          font-weight: 700;
          letter-spacing: 0.01em;
        }
        .mode-pill.on.reasoning {
          background: rgba(139, 92, 246, 0.15);
          color: #a78bfa;
          border-color: rgba(139, 92, 246, 0.3);
        }
        /* BUY/SELL/HOLD signal badge */
        .signal-badge {
          display: inline-block;
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          vertical-align: middle;
        }
        .signal-buy, .signal-strong_buy { background: rgba(16,185,129,0.15); color: #10b981; }
        .signal-sell { background: rgba(239,68,68,0.15); color: #ef4444; }
        .signal-hold { background: rgba(234,179,8,0.15); color: #eab308; }
        .signal-indeterminate { background: rgba(148,163,184,0.16); color: #94a3b8; }
        /* Streaming indicator */
        .streaming-dot {
          display: inline-block;
          margin-left: 6px;
          color: var(--accent);
          animation: pulse 1.2s infinite;
          font-size: 8px;
          vertical-align: middle;
        }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        .thinking { color: var(--text-3); font-style: italic; font-size: 13px; }
        /* Stop button */
        .stop-btn {
          font-size: 12px;
          background: rgba(239,68,68,0.12) !important;
          color: #ef4444 !important;
          border: 1px solid rgba(239,68,68,0.25) !important;
        }
        /* Analyst progress pills */
        .analyst-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin: 6px 0 4px;
        }
        .a-pill {
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 10px;
          font-weight: 600;
          border: 1px solid var(--border-faint);
          background: var(--bg-raised);
          color: var(--text-3);
          transition: all 0.2s;
        }
        .a-pill-running {
          border-color: var(--accent);
          color: var(--accent);
          background: var(--accent-dim);
          animation: pulse 1.5s infinite;
        }
        .a-pill-done {
          border-color: rgba(16,185,129,0.3);
          background: rgba(16,185,129,0.08);
          color: #10b981;
        }
        .a-pill-error {
          border-color: rgba(239,68,68,0.3);
          color: #ef4444;
        }
        .a-pill-verdict { font-size: 9px; opacity: 0.85; }
        /* Citation cards */
        .citations {
          margin-top: 8px;
          border-top: 1px solid var(--border-faint);
          padding-top: 8px;
        }
        .cite-label {
          font-size: 9px;
          color: var(--text-3);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 6px;
        }
        .cite-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .cite-card {
          background: var(--bg-raised);
          border: 1px solid var(--border-mid);
          border-radius: 999px;
          padding: 6px 10px;
          max-width: 260px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .cite-card:hover {
          background: var(--bg-hover);
          border-color: var(--border-mid);
        }
        button.cite-card { text-align: left; font: inherit; }
        .cite-card > span { display: block; color: var(--text-2); font-size: 10px; font-weight: 700; line-height: 1.25; }
        .cite-agent { font-size: 9px; color: var(--accent); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .cite-source { font-size: 10px; color: var(--text-2); font-weight: 600; margin-top: 1px; }
        .research-report { display: flex; flex-direction: column; gap: 22px; width: min(100%, 780px); padding: 22px; border: 1px solid var(--border-faint); border-radius: 16px; background: var(--bg-surface); }
        .report-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding-bottom: 18px; border-bottom: 1px solid var(--border-faint); }
        .report-company { min-width: 0; }.report-title { margin: 0; font-size: 28px; line-height: 1.05; letter-spacing: -0.03em; font-weight: 800; color: var(--text-1); }
        .report-horizon { margin: 6px 0 0; font-size: 14px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.05em; }
        .report-stance { min-width: 190px; padding: 14px 16px; border: 1px solid var(--border-mid); border-radius: 12px; background: var(--bg-raised); display: flex; flex-direction: column; gap: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
        .stance-header { display: flex; flex-direction: column; gap: 4px; }
        .stance-label, .stance-confidence span { color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
        .stance-value { color: var(--text-1); font-size: 18px; line-height: 1.15; letter-spacing: .02em; font-weight: 800; text-transform: uppercase; }
        .stance-confidence { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding-top: 10px; border-top: 1px solid var(--border-faint); }.stance-confidence b { color: var(--text-1); font-size: 14px; font-weight: 700; letter-spacing: -.01em; }
        .report-stance.is-indeterminate { border-color: rgba(202, 138, 4, .32); }
        .report-kicker { margin: 0; font-size: 10px; color: var(--text-3); font-weight: 750; text-transform: uppercase; letter-spacing: .115em; }
        .report-status-note { margin: -8px 0 0; max-width: 610px; color: var(--text-2); font-size: 13px; line-height: 1.55; }
        .report-takeaway { display: grid; gap: 8px; max-width: 680px; border-left: 2px solid var(--accent); padding: 3px 0 3px 14px; }
        .report-takeaway p, .report-rationale p { margin: 0; color: var(--text-1); font-size: 15px; line-height: 1.6; }
        .report-section { display: grid; gap: 10px; }.report-section > .report-kicker, .report-sources > .report-kicker { padding-bottom: 7px; border-bottom: 1px solid var(--border-faint); }
        .metric-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); gap: 12px; }
        .metric-card { min-width: 0; padding: 16px; border: 1px solid var(--border-faint); border-radius: 12px; background: var(--bg-raised); display: flex; flex-direction: column; gap: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.02); transition: transform 0.15s, box-shadow 0.15s; }
        .metric-card:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .metric-label { color: var(--text-3); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
        .metric-value { color: var(--text-1); font-size: 26px; font-weight: 800; line-height: 1; letter-spacing: -.03em; margin-top: auto; }
        .metric-note { color: var(--text-2); font-size: 12px; line-height: 1.3; font-weight: 500; }
        .finding-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
        .finding { min-width: 0; padding: 14px 16px; border-radius: 12px; background: var(--bg-raised); border-left: 3px solid var(--border-faint); display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 12px; transition: background 0.15s; }
        .finding:hover { background: var(--bg-hover); }
        .finding.positive { border-left-color: var(--green); }
        .finding.concern { border-left-color: #d97706; }
        .finding-mark { width: 22px; height: 22px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; }
        .positive .finding-mark { color: var(--green); background: rgba(16,185,129,.12); }
        .concern .finding-mark { color: #a96d15; background: rgba(183,121,31,.12); }
        .finding strong { display: block; color: var(--text-1); font-size: 15px; line-height: 1.4; font-weight: 700; }
        .finding-facts { display: block; margin-top: 4px; color: var(--accent); font-size: 12px; font-weight: 600; }
        .finding p { max-width: 680px; margin: 6px 0 0; color: var(--text-2); font-size: 14px; line-height: 1.5; }
        .report-section ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; color: var(--text-2); font-size: 14px; line-height: 1.5; }
        .report-section li { display: flex; gap: 10px; align-items: flex-start; padding: 8px 12px; background: var(--bg-raised); border-radius: 8px; }
        .report-section li span { color: var(--text-3); font-size: 12px; margin-top: 2px; }
        .report-section li p { margin: 0; }
        .report-limitations { padding: 16px; border: 1px solid var(--border-faint); border-radius: 12px; background: var(--bg-surface); }
        .report-limitations ul { color: var(--text-3); }
        .report-rationale { padding-top: 2px; }
        .report-sources { display: grid; gap: 12px; padding-top: 8px; }
        .report-sources .cite-list { display: flex; flex-wrap: wrap; gap: 10px; }
        .report-sources .cite-card { display: inline-flex; align-items: center; gap: 10px; max-width: 260px; min-height: 48px; padding: 8px 12px; border-radius: 12px; background: var(--bg-raised); border: 1px solid var(--border-faint); transition: all 0.15s; }
        .report-sources .cite-card:hover { border-color: var(--accent); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.04); }
        .report-sources .cite-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .cite-icon { display: inline-flex; color: var(--accent); background: var(--accent-dim); padding: 6px; border-radius: 8px; }
        .cite-copy { display: grid !important; gap: 2px; text-align: left; }
        .cite-copy b { color: var(--text-3); font-size: 10px; font-weight: 700; line-height: 1.2; text-transform: uppercase; letter-spacing: .06em; }
        .cite-copy small { color: var(--text-1); font-size: 12px; font-weight: 600; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        @media (max-width: 560px) { .msg-row { width: min(100% - 20px, 920px); }.msg-col { max-width: 100%; }.research-report { padding: 15px; gap: 19px; }.report-header { flex-direction: column; }.report-stance { width: 100%; }.metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.report-sources .cite-card { max-width: 100%; }.finding-grid { grid-template-columns: 1fr; } }
        .att-prev {
          border: 1px solid var(--border-faint);
          background: var(--bg-raised);
          border-radius: 8px;
          padding: 7px 10px;
          font-size: 12px;
          color: var(--text-2);
          margin-bottom: 7px;
        }
        .input-shell {
          border: 1px solid var(--border-mid);
          background: var(--bg-surface);
          border-radius: 999px;
          padding: 8px 10px;
          display: flex;
          gap: 8px;
          align-items: center;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
        }
        .in-left {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 999px;
          background: transparent;
          color: var(--text-1);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .in-left:hover {
          background: var(--bg-hover);
        }
        .msg-inp {
          width: 100%;
          border: none;
          background: transparent;
          color: var(--text-1);
          font-size: 16px;
          outline: none;
          height: 34px;
          line-height: 34px;
        }
        .msg-inp::placeholder {
          color: var(--text-3);
        }
        .inp-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .r-btn,
        .send-btn {
          width: 36px;
          height: 36px;
          border: none;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .r-btn {
          color: var(--text-3);
          background: transparent;
        }
        .r-btn:hover { background: var(--bg-hover); }
        .r-btn.rec { color: var(--red); }
        .send-btn {
          background: #0b0b0b;
          color: #fff;
        }
        .send-btn.off {
          background: #d6dbe8;
          color: #94a3b8;
        }
        .rpanel {
          border-left: 1px solid var(--border-faint);
          background: var(--bg-surface);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .rp-tabs {
          border-bottom: 1px solid var(--border-faint);
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          background: var(--bg-raised);
        }
        .rp-tab {
          border: none;
          background: transparent;
          color: var(--text-3);
          font-size: 11px;
          font-weight: 700;
          padding: 10px 4px;
          cursor: pointer;
        }
        .rp-tab.on {
          color: var(--accent);
          border-bottom: 2px solid var(--accent);
        }
        .rp-body {
          flex: 1;
          overflow: auto;
          padding: 11px;
        }
        .card {
          border: 1px solid var(--border-faint);
          background: var(--bg-raised);
          border-radius: 10px;
          padding: 10px;
          margin-bottom: 8px;
        }
        .card.big .val {
          font-size: 20px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          color: var(--text-1);
          font-weight: 700;
          margin-top: 5px;
        }
        .lbl {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-3);
          text-transform: uppercase;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          letter-spacing: 0.08em;
        }
        .txt {
          margin-top: 6px;
          font-size: 12px;
          line-height: 1.45;
          color: var(--text-2);
        }
        .warn {
          border-color: rgba(239, 68, 68, 0.25);
          background: rgba(239, 68, 68, 0.08);
        }
        .crit {
          border-color: rgba(220, 38, 38, 0.45);
          background: rgba(220, 38, 38, 0.14);
        }
        .alert-cat {
          margin-left: auto;
          padding: 1px 6px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.04em;
          background: var(--bg-surface);
          color: var(--text-3);
          border: 1px solid var(--border-faint);
        }
        .info {
          border-color: rgba(16, 185, 129, 0.25);
          background: rgba(16, 185, 129, 0.08);
        }
        .src-item {
          width: 100%;
          border: 1px solid var(--border-faint);
          background: var(--bg-surface);
          color: var(--text-2);
          border-radius: 7px;
          padding: 7px 8px;
          text-align: left;
          font-size: 11px;
          margin-top: 6px;
          cursor: pointer;
        }
        .src-item:hover {
          border-color: var(--border-mid);
        }
        #toast {
          position: fixed;
          left: 50%;
          bottom: 20px;
          transform: translateX(-50%) translateY(44px);
          opacity: 0;
          pointer-events: none;
          background: var(--bg-raised);
          border: 1px solid var(--border-mid);
          color: var(--text-1);
          border-radius: 20px;
          padding: 8px 14px;
          font-size: 12px;
          z-index: 90;
          transition: all 0.2s ease;
        }
        #toast.on {
          transform: translateX(-50%) translateY(0);
          opacity: 1;
        }
        @media (max-width: 1380px) {
          .shell { grid-template-columns: 250px 1fr; }
          .rpanel { display: none; }
        }
        @media (max-width: 1024px) {
          .shell { grid-template-columns: 1fr; }
          .sidebar {
            display: none;
          }
        }

        /* ─ @ mention picker ──────────────────────────────────── */
        .at-picker {
          position: absolute;
          bottom: 100%;
          left: 0;
          right: 0;
          margin-bottom: 4px;
          background: var(--bg-surface);
          border: 1px solid var(--border-mid);
          border-radius: 12px;
          padding: 6px;
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          z-index: 20;
          box-shadow: 0 4px 24px rgba(0,0,0,0.18);
          max-height: 140px;
          overflow-y: auto;
        }
        .at-picker-hint {
          width: 100%;
          font-size: 10px;
          color: var(--text-3);
          padding: 2px 4px 4px;
          border-bottom: 1px solid var(--border-faint);
          margin-bottom: 2px;
        }
        .at-item {
          background: var(--bg-raised);
          border: 1px solid var(--border-faint);
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 600;
          color: var(--accent);
          cursor: pointer;
          transition: background 0.15s;
        }
        .at-item:hover {
          background: var(--accent-dim);
          border-color: var(--accent);
        }
        .input-area {
          position: relative;
        }

        /* ─ Scorecard card ────────────────────────────────────── */
        .scorecard-card {
          margin-top: 10px;
          background: var(--bg-raised);
          border: 1px solid var(--border-mid);
          border-radius: 12px;
          padding: 12px;
        }
        .sc-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }
        .sc-title { font-size: 12px; font-weight: 600; color: var(--text-1); }
        .sc-verdict {
          font-size: 10px;
          font-weight: 700;
          border-radius: 4px;
          padding: 2px 6px;
          text-transform: uppercase;
        }
        .sc-verdict.sc-strong_buy, .sc-verdict.sc-buy { background: rgba(16,185,129,0.15); color: var(--green); }
        .sc-verdict.sc-sell, .sc-verdict.sc-strong_sell { background: rgba(239,68,68,0.15); color: var(--red); }
        .sc-verdict.sc-hold { background: rgba(139,157,200,0.15); color: var(--text-2); }
        .sc-agree { margin-left: auto; font-size: 10px; color: var(--text-3); }
        .sc-scores { display: flex; flex-direction: column; gap: 5px; }
        .sc-row { display: flex; align-items: center; gap: 6px; font-size: 11px; }
        .sc-name { width: 120px; color: var(--text-2); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sc-bar-wrap { flex: 1; background: var(--bg-surface); border-radius: 4px; height: 5px; overflow: hidden; }
        .sc-bar { height: 100%; border-radius: 4px; transition: width 0.4s ease; }
        .sc-bar.bull { background: var(--green); }
        .sc-bar.bear { background: var(--red); }
        .sc-bar.neut { background: var(--text-3); }
        .sc-val { width: 28px; text-align: right; font-weight: 600; flex-shrink: 0; }
        .sc-conflicts { margin-top: 8px; font-size: 10px; color: var(--red); background: rgba(239,68,68,0.08); border-radius: 6px; padding: 4px 8px; }

        /* ─ Debate cards ──────────────────────────────────────── */
        .debate-section { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
        .debate-card {
          background: var(--bg-raised);
          border: 1px solid var(--border-mid);
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 12px;
        }
        .dc-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-2);
          margin-bottom: 8px;
        }
        .dc-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .dc-side { background: var(--bg-surface); border-radius: 8px; padding: 8px; border: 1px solid var(--border-faint); }
        .dc-side.bull { border-color: rgba(16,185,129,0.25); }
        .dc-side.bear { border-color: rgba(239,68,68,0.25); }
        .dc-side-label { font-size: 10px; font-weight: 700; margin-bottom: 4px; color: var(--text-3); }
        .dc-side.bull .dc-side-label { color: var(--green); }
        .dc-side.bear .dc-side-label { color: var(--red); }
        .dc-text { font-size: 11px; line-height: 1.5; color: var(--text-2); }
        .dc-facilitator .dc-text { font-size: 11px; line-height: 1.6; color: var(--text-1); }

        /* ─ Trade plans grid ──────────────────────────────────── */
        .trade-plans { margin-top: 10px; }
        .tp-label { font-size: 11px; font-weight: 600; color: var(--text-2); margin-bottom: 8px; }
        .tp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .tp-card {
          background: var(--bg-raised);
          border: 1px solid var(--border-mid);
          border-radius: 10px;
          padding: 8px;
          font-size: 11px;
        }
        .tp-profile {
          font-weight: 700;
          color: var(--accent);
          font-size: 10px;
          text-transform: uppercase;
          margin-bottom: 6px;
          border-bottom: 1px solid var(--border-faint);
          padding-bottom: 4px;
        }
        .tp-row { display: flex; justify-content: space-between; gap: 4px; margin-top: 3px; color: var(--text-2); }
        .tp-row span:first-child { color: var(--text-3); }
        .pos { color: var(--green); }
        .neg { color: var(--red); }

        /* ─ Right panel action button ─────────────────────────── */
        .rp-action-btn {
          margin-top: 6px;
          width: 100%;
          padding: 6px;
          font-size: 11px;
          border-radius: 7px;
          border: 1px solid var(--accent);
          background: var(--accent-dim);
          color: var(--accent);
          cursor: pointer;
          transition: background 0.15s;
        }
        .rp-action-btn:hover { background: var(--accent); color: #fff; }
      `}</style>
    </div>
  );
}
