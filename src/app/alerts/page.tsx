"use client";

import { useState } from "react";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  FileText,
  Newspaper,
  ArrowRight,
  Filter,
  Search,
  Bell,
  BellRing,
  Zap,
  Eye,
  Clock,
  ShieldAlert,
  X,
  ChevronDown,
  Scale,
  ExternalLink,
  AlertCircle,
  Info,
} from "lucide-react";

type Severity = "critical" | "high" | "medium" | "low";

interface DisparityAlert {
  id: number;
  company: string;
  ticker: string;
  severity: Severity;
  timestamp: string;
  marketHype: {
    sentiment: string;
    source: string;
    headline: string;
    score: number;
  };
  officialFacts: {
    metric: string;
    source: string;
    detail: string;
    score: number;
  };
  disparityScore: number;
  recommendation: string;
  filingRef: string;
}

const alerts: DisparityAlert[] = [
  {
    id: 1,
    company: "Adani Enterprises",
    ticker: "ADANIENT",
    severity: "critical",
    timestamp: "2 minutes ago",
    marketHype: {
      sentiment: "Extremely Bullish",
      source: "Economic Times, MoneyControl, 12 news outlets",
      headline: "Adani Group poised for massive expansion; analysts target 40% upside",
      score: 92,
    },
    officialFacts: {
      metric: "Debt/Equity at 2.14x | Auditor Emphasis of Matter on refinancing",
      source: "Annual Report FY2025 (Filed: NSE, Pg 267)",
      detail: "Consolidated borrowings up 12.3% YoY to ₹47,320 Cr. Short-term CP of ₹14,700 Cr due within 12 months. Auditor flagged reliance on commercial paper rollover.",
      score: 28,
    },
    disparityScore: 87,
    recommendation: "Extreme mismatch between media optimism and filing-backed financial stress indicators. Verify debt rollover capability before considering any position.",
    filingRef: "AR 2025, Notes 21, 42; Auditor Report Pg 267",
  },
  {
    id: 2,
    company: "Paytm (One97 Communications)",
    ticker: "PAYTM",
    severity: "high",
    timestamp: "18 minutes ago",
    marketHype: {
      sentiment: "Bullish",
      source: "LiveMint, Business Standard, 8 news outlets",
      headline: "Paytm's lending business shows strong recovery; analysts upgrade to buy",
      score: 78,
    },
    officialFacts: {
      metric: "Cash burn ₹1,840 Cr in FY25 | RBI compliance observations pending",
      source: "Q3 FY25 Filing (BSE), RBI Circular",
      detail: "Operating cash flow remains negative. RBI directed Paytm Payments Bank to halt onboarding. Related party lending exposure flagged by auditor.",
      score: 35,
    },
    disparityScore: 72,
    recommendation: "Significant gap between recovery narrative and actual cash flow data. RBI regulatory overhang continues. Monitor quarterly burn rate.",
    filingRef: "Q3 FY25 Results, BSE Filing; RBI Directive dated 31-Jan-2024",
  },
  {
    id: 3,
    company: "Vodafone Idea",
    ticker: "IDEA",
    severity: "high",
    timestamp: "42 minutes ago",
    marketHype: {
      sentiment: "Moderately Bullish",
      source: "CNBC-TV18, Moneycontrol",
      headline: "Vi's 5G rollout plans boost investor confidence; stock surges 8%",
      score: 68,
    },
    officialFacts: {
      metric: "Negative net worth ₹-78,240 Cr | Going concern qualification",
      source: "Annual Report FY2025 (NSE Filing)",
      detail: "Auditor has issued going concern qualification for the third consecutive year. Accumulated losses exceed total equity. AGR dues of ₹58,254 Cr remain outstanding.",
      score: 12,
    },
    disparityScore: 82,
    recommendation: "Fundamental viability concerns remain unaddressed per auditor. Going concern risk is material. Market price appears disconnected from filing reality.",
    filingRef: "AR FY2025, Auditor Report; AGR Case SC Order",
  },
  {
    id: 4,
    company: "Infosys Limited",
    ticker: "INFY",
    severity: "low",
    timestamp: "1 hour ago",
    marketHype: {
      sentiment: "Neutral",
      source: "Reuters, Bloomberg",
      headline: "Infosys maintains guidance; steady quarter with no surprises",
      score: 52,
    },
    officialFacts: {
      metric: "Revenue guidance maintained at 4-7% | Clean audit report",
      source: "Q3 FY25 Investor Presentation (NSE)",
      detail: "Revenue growth at 5.2% in constant currency. Operating margins at 21.3%. No auditor qualifications. Clean regulatory record.",
      score: 48,
    },
    disparityScore: 8,
    recommendation: "Market narrative aligned with filing data. Low disparity — no action required.",
    filingRef: "Q3 FY25 Results, NSE Filing",
  },
  {
    id: 5,
    company: "Yes Bank",
    ticker: "YESBANK",
    severity: "critical",
    timestamp: "5 minutes ago",
    marketHype: {
      sentiment: "Bullish",
      source: "ET Markets, 6 analysts",
      headline: "Yes Bank turnaround story gains momentum; NPA ratios improve",
      score: 71,
    },
    officialFacts: {
      metric: "Director SEBI debarred | Restructured book 8.4% of advances",
      source: "Annual Report FY2025, SEBI Order",
      detail: "Key director flagged in SEBI debarment list. Restructured advances remain elevated at 8.4% (peer avg: 2.1%). Provision coverage ratio at 62% vs industry 72%.",
      score: 22,
    },
    disparityScore: 79,
    recommendation: "Governance risk from debarred director. Asset quality metrics below peer standards despite improving NPA headline numbers. Exercise caution.",
    filingRef: "AR FY2025; SEBI Order No. WTM/AB/2024/March",
  },
  {
    id: 6,
    company: "Tata Motors",
    ticker: "TATAMOTORS",
    severity: "medium",
    timestamp: "35 minutes ago",
    marketHype: {
      sentiment: "Very Bullish",
      source: "Auto industry analysts, CNBC",
      headline: "JLR margins expansion drives Tata Motors re-rating; target price ₹1,100",
      score: 85,
    },
    officialFacts: {
      metric: "JLR China exposure risk | FCF positive but leveraged balance sheet",
      source: "Annual Report FY2025 (NSE Filing)",
      detail: "China revenue contribution declined 18% YoY. Consolidated debt ₹48,900 Cr. While FCF turned positive, debt/EBITDA at 2.8x remains above comfort zone.",
      score: 55,
    },
    disparityScore: 45,
    recommendation: "Moderate disparity. Positive trajectory is real but market may be pricing in best-case scenario. China exposure risk underreported in coverage.",
    filingRef: "AR FY2025, Segment Analysis Pg 78; MD&A Section",
  },
];

const severityConfig: Record<Severity, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-500/10", border: "border-red-200 dark:border-red-500/20", label: "CRITICAL" },
  high: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-500/10", border: "border-amber-200 dark:border-amber-500/20", label: "HIGH" },
  medium: { color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-500/10", border: "border-yellow-200 dark:border-yellow-500/20", label: "MEDIUM" },
  low: { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-500/10", border: "border-blue-200 dark:border-blue-500/20", label: "LOW" },
};

function DisparityMeter({ score }: { score: number }) {
  const getColor = () => {
    if (score >= 70) return "bg-red-500";
    if (score >= 40) return "bg-amber-500";
    return "bg-emerald-500";
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${getColor()}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-bold min-w-[2rem] text-right ${
        score >= 70 ? "text-red-500" : score >= 40 ? "text-amber-500" : "text-emerald-500"
      }`}>
        {score}%
      </span>
    </div>
  );
}

export default function AlertsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(1);
  const [dismissedBanner, setDismissedBanner] = useState(false);

  const criticalCount = alerts.filter(a => a.severity === "critical").length;

  const filtered = alerts.filter(a => {
    const matchesSearch = a.company.toLowerCase().includes(searchQuery.toLowerCase()) || a.ticker.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterSeverity === "all" || a.severity === filterSeverity;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="min-h-screen bg-grid-pattern">
      {/* Critical Alert Banner */}
      {!dismissedBanner && criticalCount > 0 && (
        <div className="bg-red-600 dark:bg-red-900/80 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/15 animate-pulse">
              <BellRing className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-sm font-bold text-white">
                {criticalCount} CRITICAL DISPARITY ALERT{criticalCount > 1 ? "S" : ""}
              </span>
              <span className="text-xs text-red-100 ml-3">
                Severe mismatch between market narrative and filing data detected
              </span>
            </div>
          </div>
          <button onClick={() => setDismissedBanner(true)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-white" />
          </button>
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Disparity Alerts</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Market Hype vs. Official Filing Facts — Misinformation Detection Engine
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
              <span className="text-xs font-bold text-red-600 dark:text-red-400">{criticalCount} Critical</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
              <span className="text-xs font-bold text-amber-600 dark:text-amber-400">{alerts.filter(a => a.severity === "high").length} High</span>
            </div>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus-within:border-blue-300 dark:focus-within:border-blue-500/40 transition-colors">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by company or ticker..."
              className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            {["all", "critical", "high", "medium", "low"].map((f) => (
              <button
                key={f}
                onClick={() => setFilterSeverity(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                  filterSeverity === f
                    ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20"
                    : "bg-white dark:bg-slate-900 text-slate-500 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Alert Cards */}
        <div className="space-y-4">
          {filtered.map((alert) => {
            const sev = severityConfig[alert.severity];
            const isExpanded = expandedId === alert.id;

            return (
              <div
                key={alert.id}
                className={`bg-white dark:bg-slate-900 rounded-xl border overflow-hidden transition-all duration-200 ${
                  alert.severity === "critical" ? "border-red-200 dark:border-red-500/20" :
                  alert.severity === "high" ? "border-amber-200 dark:border-amber-500/20" :
                  "border-slate-300 dark:border-slate-800"
                } ${alert.severity === "critical" ? "glow-rose" : ""}`}
              >
                {/* Alert Header */}
                <div
                  className="px-5 py-4 cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : alert.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 p-2 rounded-lg ${sev.bg}`}>
                        <AlertTriangle className={`w-4 h-4 ${sev.color}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{alert.company}</h3>
                          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{alert.ticker}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${sev.color} ${sev.bg} border ${sev.border}`}>
                            {sev.label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{alert.recommendation}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 mb-1">Disparity Index</div>
                        <div className="w-28">
                          <DisparityMeter score={alert.disparityScore} />
                        </div>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-slate-300/60 dark:border-slate-800 animate-fade-in">
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      {/* Market Hype */}
                      <div className="rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Newspaper className="w-4 h-4 text-amber-500" />
                          <span className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Market Hype</span>
                          <span className="ml-auto text-lg font-bold text-amber-600 dark:text-amber-400">{alert.marketHype.score}</span>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <span className="text-[10px] text-amber-600/70 dark:text-amber-400/50 uppercase">Sentiment</span>
                            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{alert.marketHype.sentiment}</p>
                          </div>
                          <div>
                            <span className="text-[10px] text-amber-600/70 dark:text-amber-400/50 uppercase">Headline</span>
                            <p className="text-xs text-amber-700 dark:text-amber-300/80 leading-relaxed">&ldquo;{alert.marketHype.headline}&rdquo;</p>
                          </div>
                          <div className="flex items-center gap-1.5 pt-1">
                            <Newspaper className="w-3 h-3 text-amber-500/60" />
                            <span className="text-[10px] text-amber-600/60 dark:text-amber-400/40">{alert.marketHype.source}</span>
                          </div>
                        </div>
                      </div>

                      {/* Official Facts */}
                      <div className="rounded-lg border border-blue-200 dark:border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <FileText className="w-4 h-4 text-blue-500" />
                          <span className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">Official Facts</span>
                          <span className="ml-auto text-lg font-bold text-blue-600 dark:text-blue-400">{alert.officialFacts.score}</span>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <span className="text-[10px] text-blue-600/70 dark:text-blue-400/50 uppercase">Key Metrics</span>
                            <p className="text-sm font-medium text-blue-800 dark:text-blue-300">{alert.officialFacts.metric}</p>
                          </div>
                          <div>
                            <span className="text-[10px] text-blue-600/70 dark:text-blue-400/50 uppercase">Filing Detail</span>
                            <p className="text-xs text-blue-700 dark:text-blue-300/80 leading-relaxed">{alert.officialFacts.detail}</p>
                          </div>
                          <div className="flex items-center gap-1.5 pt-1">
                            <FileText className="w-3 h-3 text-blue-500/60" />
                            <span className="text-[10px] text-blue-600/60 dark:text-blue-400/40">{alert.officialFacts.source}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Actions */}
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-300/60 dark:border-slate-800">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Ref: {alert.filingRef}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400">{alert.timestamp}</span>
                        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium border border-blue-200 dark:border-blue-500/20 hover:bg-blue-100 dark:hover:bg-blue-500/15 transition-colors">
                          <Eye className="w-3 h-3" /> View Filing
                        </button>
                        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-medium border border-violet-200 dark:border-violet-500/20 hover:bg-violet-100 dark:hover:bg-violet-500/15 transition-colors">
                          <Zap className="w-3 h-3" /> Analyze in War Room
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Methodology */}
        <div className="bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-300 dark:border-slate-700/50 p-4">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Disparity Detection Methodology</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">
                The Disparity Index (0-100) measures the divergence between aggregated news sentiment scores and quantitative metrics extracted from regulatory filings. 
                Scores above 70 indicate critical misalignment. Market Hype scores are derived from NLP sentiment analysis of 50+ financial news sources. 
                Official Facts scores reflect fundamental strength indicators sourced exclusively from filed documents (NSE/BSE EDGAR).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
