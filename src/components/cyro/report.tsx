"use client";

/**
 * Research report rendering (moved out of the old cyro page unchanged in behaviour).
 * Pure presentation of a FinalResearchReport produced by the CYRO research pipeline.
 */

import { ChartColumn, FileText, Globe, Newspaper, Wallet } from "lucide-react";
import { CyroResearchOutlookChart, OutlookDomain } from "@/components/research/CyroResearchOutlookChart";
import { ResearchActivityState } from "@/components/research/researchActivityReducer";

export type SourceCitation = {
  evidenceId?: string;
  agent: string;
  tool_name: string;
  source_type: string;
  label: string;
  input_args: Record<string, unknown>;
  excerpt: string;
  timestamp: string;
};

export type ReportClaim = {
  id: string;
  text: string;
  category?: string;
  stance: string;
  importance: string;
  evidence_ids: string[];
  confidence?: number;
  limitations?: string[];
};

export type FinalResearchReport = {
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

export function normalizeSource(source: unknown): SourceCitation {
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

export function cleanInlineMarkdown(value: string): string {
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

export type ReportMetric = { label: string; value: string; note: string };

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

export function domainKeyForAgent(agent: string): string | undefined {
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
        {metrics.map((metric, mi) => (
          <article className="metric-card" key={`${metric.label}-${mi}`}>
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
  return <section className="report-section" aria-labelledby={`${kind}-heading`}><h3 id={`${kind}-heading`} className="report-kicker">{title}</h3><div className="finding-grid">{sortClaims(claims).map((claim, ci) => {
    const facts = insightFacts(claim);
    return <article className={`finding ${kind}`} key={`${claim.id}-${ci}`}><span className="finding-mark" aria-hidden="true">{mark}</span><div><strong>{claimHeading(claim)}</strong>{facts.length > 0 && <span className="finding-facts">{facts.join(" · ")}</span>}<p>{reportClaimText(claim)}</p></div></article>;
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

export function CyroResearchReport({ report, sources, activityState, domainClaims = {}, onSourceClick }: {
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

