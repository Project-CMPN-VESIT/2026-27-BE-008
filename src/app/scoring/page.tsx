"use client";

import { useState } from "react";
import {
  BarChart3,
  ShieldAlert,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Info,
  ArrowUpRight,
  ArrowDownRight,
  Gauge,
  Target,
  Scale,
  FileText,
  Eye,
} from "lucide-react";
import {
  RadialBarChart,
  RadialBar,
  ResponsiveContainer,
  PolarAngleAxis,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  RadarChart,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
} from "recharts";

interface CompanyScore {
  id: string;
  name: string;
  ticker: string;
  rk: number;
  pl: number;
  rkTrend: "up" | "down" | "stable";
  plTrend: "up" | "down" | "stable";
  rkChange: string;
  plChange: string;
  rkBreakdown: { leverage: number; auditRisk: number; regulatoryFlags: number; promoterPledge: number; relatedParty: number };
  plBreakdown: { revenue: number; margin: number; cashFlow: number; roe: number; debtService: number };
}

const companies: CompanyScore[] = [
  {
    id: "adani",
    name: "Adani Enterprises",
    ticker: "ADANIENT",
    rk: 3.2,
    pl: 5.8,
    rkTrend: "down",
    plTrend: "up",
    rkChange: "-0.5",
    plChange: "+0.8",
    rkBreakdown: { leverage: 2.5, auditRisk: 3.0, regulatoryFlags: 4.5, promoterPledge: 3.2, relatedParty: 2.8 },
    plBreakdown: { revenue: 7.2, margin: 5.0, cashFlow: 4.8, roe: 6.0, debtService: 5.2 },
  },
  {
    id: "reliance",
    name: "Reliance Industries",
    ticker: "RELIANCE",
    rk: 7.5,
    pl: 8.2,
    rkTrend: "stable",
    plTrend: "up",
    rkChange: "0.0",
    plChange: "+0.3",
    rkBreakdown: { leverage: 7.5, auditRisk: 8.5, regulatoryFlags: 8.0, promoterPledge: 9.0, relatedParty: 4.5 },
    plBreakdown: { revenue: 8.5, margin: 7.8, cashFlow: 8.0, roe: 8.5, debtService: 8.2 },
  },
  {
    id: "infy",
    name: "Infosys Limited",
    ticker: "INFY",
    rk: 8.8,
    pl: 7.5,
    rkTrend: "up",
    plTrend: "down",
    rkChange: "+0.2",
    plChange: "-0.4",
    rkBreakdown: { leverage: 9.5, auditRisk: 9.0, regulatoryFlags: 9.0, promoterPledge: 9.5, relatedParty: 7.0 },
    plBreakdown: { revenue: 7.0, margin: 8.0, cashFlow: 8.5, roe: 7.0, debtService: 7.0 },
  },
  {
    id: "yesbank",
    name: "Yes Bank",
    ticker: "YESBANK",
    rk: 2.1,
    pl: 3.4,
    rkTrend: "down",
    plTrend: "stable",
    rkChange: "-1.2",
    plChange: "0.0",
    rkBreakdown: { leverage: 2.0, auditRisk: 1.5, regulatoryFlags: 1.0, promoterPledge: 3.0, relatedParty: 3.0 },
    plBreakdown: { revenue: 3.5, margin: 2.8, cashFlow: 3.0, roe: 4.0, debtService: 3.7 },
  },
  {
    id: "tata",
    name: "Tata Motors",
    ticker: "TATAMOTORS",
    rk: 6.8,
    pl: 7.1,
    rkTrend: "up",
    plTrend: "up",
    rkChange: "+2.6",
    plChange: "+1.4",
    rkBreakdown: { leverage: 6.5, auditRisk: 7.5, regulatoryFlags: 8.0, promoterPledge: 8.5, relatedParty: 3.5 },
    plBreakdown: { revenue: 7.5, margin: 6.8, cashFlow: 7.0, roe: 7.2, debtService: 7.0 },
  },
];

const historicalData = [
  { quarter: "Q1 FY24", rk: 4.0, pl: 5.0 },
  { quarter: "Q2 FY24", rk: 3.8, pl: 5.2 },
  { quarter: "Q3 FY24", rk: 3.5, pl: 5.5 },
  { quarter: "Q4 FY24", rk: 3.7, pl: 5.0 },
  { quarter: "Q1 FY25", rk: 3.4, pl: 5.6 },
  { quarter: "Q2 FY25", rk: 3.2, pl: 5.8 },
];

function ScoreGauge({ score, label, color, size = "lg" }: { score: number; label: string; color: string; size?: "lg" | "sm" }) {
  const gaugeData = [{ value: score, fill: color }];
  const dim = size === "lg" ? 180 : 120;
  const innerRadius = size === "lg" ? "60%" : "65%";
  const outerRadius = size === "lg" ? "85%" : "90%";

  return (
    <div className="flex flex-col items-center">
      <div style={{ width: dim, height: dim / 2 + 20 }} className="relative">
        <ResponsiveContainer>
          <RadialBarChart
            cx="50%"
            cy="100%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            startAngle={180}
            endAngle={0}
            data={gaugeData}
            barSize={size === "lg" ? 14 : 10}
          >
            <PolarAngleAxis type="number" domain={[0, 10]} tick={false} angleAxisId={0} />
            <RadialBar
              background={{ fill: "rgba(148,163,184,0.1)" }}
              dataKey="value"
              cornerRadius={8}
              angleAxisId={0}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-center">
          <div className={`font-bold ${size === "lg" ? "text-3xl" : "text-xl"}`} style={{ color }}>
            {score.toFixed(1)}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">
            / 10
          </div>
        </div>
      </div>
      <span className={`font-semibold text-slate-700 dark:text-slate-300 ${size === "lg" ? "text-sm mt-1" : "text-xs mt-0"}`}>
        {label}
      </span>
    </div>
  );
}

function getRkColor(score: number) {
  if (score >= 7) return "#10b981";
  if (score >= 4) return "#f59e0b";
  return "#f43f5e";
}

function getPlColor(score: number) {
  if (score >= 7) return "#10b981";
  if (score >= 4) return "#14b8a6";
  return "#f43f5e";
}

function getRkLabel(score: number) {
  if (score >= 7) return "Low Risk";
  if (score >= 4) return "Moderate Risk";
  return "High Risk";
}

function getPlLabel(score: number) {
  if (score >= 7) return "Strong";
  if (score >= 4) return "Moderate";
  return "Weak";
}

export default function ScoringPage() {
  const [selected, setSelected] = useState(companies[0]);

  const radarData = [
    { metric: "Leverage", rk: selected.rkBreakdown.leverage },
    { metric: "Audit Risk", rk: selected.rkBreakdown.auditRisk },
    { metric: "Reg Flags", rk: selected.rkBreakdown.regulatoryFlags },
    { metric: "Pledge", rk: selected.rkBreakdown.promoterPledge },
    { metric: "Related Pty", rk: selected.rkBreakdown.relatedParty },
  ];

  const plRadarData = [
    { metric: "Revenue", pl: selected.plBreakdown.revenue },
    { metric: "Margin", pl: selected.plBreakdown.margin },
    { metric: "Cash Flow", pl: selected.plBreakdown.cashFlow },
    { metric: "ROE", pl: selected.plBreakdown.roe },
    { metric: "Debt Svc", pl: selected.plBreakdown.debtService },
  ];

  return (
    <div className="p-6 space-y-6 bg-grid-pattern min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">RK/PL Scoring Dashboard</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Dual-metric scorecard replacing simplistic Buy/Sell ratings
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Analyzing:</span>
          <select
            className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-900 dark:text-white cursor-pointer"
            value={selected.id}
            onChange={(e) => setSelected(companies.find(c => c.id === e.target.value)!)}
          >
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.ticker})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Score Cards */}
      <div className="grid grid-cols-2 gap-6">
        {/* RK Score Card */}
        <div className={`bg-white dark:bg-slate-900 rounded-xl border p-6 ${
          selected.rk < 4 ? "border-rose-200 dark:border-rose-500/20 glow-rose" : selected.rk < 7 ? "border-amber-200 dark:border-amber-500/20" : "border-emerald-200 dark:border-emerald-500/20 glow-emerald"
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-500" />
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">RK Score</h2>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">Risk Assessment</p>
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
              selected.rk < 4 ? "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20" :
              selected.rk < 7 ? "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20" :
              "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20"
            }`}>
              {getRkLabel(selected.rk)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <ScoreGauge score={selected.rk} label="Risk Score" color={getRkColor(selected.rk)} />
            <div className="flex-1 ml-4">
              <div className="space-y-2.5">
                {Object.entries(selected.rkBreakdown).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 w-24 capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${val * 10}%`, backgroundColor: getRkColor(val) }} />
                    </div>
                    <span className="text-[10px] font-semibold w-6 text-right" style={{ color: getRkColor(val) }}>{val.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-300/60 dark:border-slate-800">
            {selected.rkTrend === "up" ? <ArrowUpRight className="w-4 h-4 text-emerald-500" /> :
             selected.rkTrend === "down" ? <ArrowDownRight className="w-4 h-4 text-rose-500" /> :
             <Target className="w-4 h-4 text-slate-400" />}
            <span className={`text-xs font-medium ${
              selected.rkTrend === "up" ? "text-emerald-600 dark:text-emerald-400" :
              selected.rkTrend === "down" ? "text-rose-600 dark:text-rose-400" :
              "text-slate-500"
            }`}>
              {selected.rkChange} from last quarter
            </span>
            <span className="text-[10px] text-slate-400 ml-auto">Based on: Leverage, Audit, SEBI flags</span>
          </div>
        </div>

        {/* PL Score Card */}
        <div className={`bg-white dark:bg-slate-900 rounded-xl border p-6 ${
          selected.pl < 4 ? "border-rose-200 dark:border-rose-500/20 glow-rose" : selected.pl < 7 ? "border-teal-200 dark:border-teal-500/20" : "border-emerald-200 dark:border-emerald-500/20 glow-emerald"
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">PL Score</h2>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">Profit/Loss Strength</p>
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
              selected.pl < 4 ? "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20" :
              selected.pl < 7 ? "bg-teal-50 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-200 dark:border-teal-500/20" :
              "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20"
            }`}>
              {getPlLabel(selected.pl)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <ScoreGauge score={selected.pl} label="Profit/Loss Score" color={getPlColor(selected.pl)} />
            <div className="flex-1 ml-4">
              <div className="space-y-2.5">
                {Object.entries(selected.plBreakdown).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 w-24 capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${val * 10}%`, backgroundColor: getPlColor(val) }} />
                    </div>
                    <span className="text-[10px] font-semibold w-6 text-right" style={{ color: getPlColor(val) }}>{val.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-300/60 dark:border-slate-800">
            {selected.plTrend === "up" ? <ArrowUpRight className="w-4 h-4 text-emerald-500" /> :
             selected.plTrend === "down" ? <ArrowDownRight className="w-4 h-4 text-rose-500" /> :
             <Target className="w-4 h-4 text-slate-400" />}
            <span className={`text-xs font-medium ${
              selected.plTrend === "up" ? "text-emerald-600 dark:text-emerald-400" :
              selected.plTrend === "down" ? "text-rose-600 dark:text-rose-400" :
              "text-slate-500"
            }`}>
              {selected.plChange} from last quarter
            </span>
            <span className="text-[10px] text-slate-400 ml-auto">Based on: Revenue, Margins, Cash Flow</span>
          </div>
        </div>
      </div>

      {/* Radar + Historical Charts */}
      <div className="grid grid-cols-12 gap-6">
        {/* RK Radar */}
        <div className="col-span-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Risk Factor Breakdown</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="#334155" strokeOpacity={0.3} />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
                <Radar dataKey="rk" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* PL Radar */}
        <div className="col-span-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Profit Strength Breakdown</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={plRadarData}>
                <PolarGrid stroke="#334155" strokeOpacity={0.3} />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
                <Radar dataKey="pl" stroke="#14b8a6" fill="#14b8a6" fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Historical Trend */}
        <div className="col-span-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Score Trend (6Q)</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historicalData}>
                <CartesianGrid strokeDasharray="3 3" className="[&>line]:stroke-slate-200 dark:[&>line]:stroke-slate-800" />
                <XAxis dataKey="quarter" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", fontSize: "11px", color: "#e2e8f0" }} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
                <Line type="monotone" dataKey="rk" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="RK (Risk)" />
                <Line type="monotone" dataKey="pl" stroke="#14b8a6" strokeWidth={2} dot={{ r: 3 }} name="PL (Profit)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Company Comparison Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-300 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Peer Comparison</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">All scores derived from latest regulatory filings</p>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <th className="text-left px-5 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Company</th>
              <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">RK Score</th>
              <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">RK Trend</th>
              <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">PL Score</th>
              <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">PL Trend</th>
              <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Signal</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr
                key={c.id}
                onClick={() => setSelected(c)}
                className={`border-b border-slate-300/70 dark:border-slate-800/50 cursor-pointer transition-colors ${
                  selected.id === c.id ? "bg-blue-50/50 dark:bg-blue-500/5" : "hover:bg-slate-50 dark:hover:bg-slate-800/30"
                }`}
              >
                <td className="px-5 py-3">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">{c.name}</div>
                  <div className="text-[10px] text-slate-500">{c.ticker}</div>
                </td>
                <td className="px-3 py-3 text-center">
                  <span className="text-sm font-bold" style={{ color: getRkColor(c.rk) }}>{c.rk.toFixed(1)}</span>
                </td>
                <td className="px-3 py-3 text-center">
                  <span className={`text-xs font-medium ${
                    c.rkTrend === "up" ? "text-emerald-500" : c.rkTrend === "down" ? "text-rose-500" : "text-slate-400"
                  }`}>
                    {c.rkChange}
                  </span>
                </td>
                <td className="px-3 py-3 text-center">
                  <span className="text-sm font-bold" style={{ color: getPlColor(c.pl) }}>{c.pl.toFixed(1)}</span>
                </td>
                <td className="px-3 py-3 text-center">
                  <span className={`text-xs font-medium ${
                    c.plTrend === "up" ? "text-emerald-500" : c.plTrend === "down" ? "text-rose-500" : "text-slate-400"
                  }`}>
                    {c.plChange}
                  </span>
                </td>
                <td className="px-3 py-3 text-center">
                  {c.rk >= 6 && c.pl >= 6 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                      <CheckCircle2 className="w-3 h-3" /> Favorable
                    </span>
                  ) : c.rk < 4 || c.pl < 4 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20">
                      <XCircle className="w-3 h-3" /> Caution
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
                      <AlertTriangle className="w-3 h-3" /> Mixed
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Methodology */}
      <div className="bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-300 dark:border-slate-700/50 p-4">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Scoring Methodology</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">
              <strong>RK (Risk Score):</strong> Evaluates leverage ratio, auditor qualifications, SEBI/RBI flags, promoter pledge %, and related party exposure from annual reports.
              <strong> PL (Profit/Loss Score):</strong> Assesses revenue growth consistency, operating margin stability, free cash flow generation, ROE, and debt service coverage. All data sourced from filed regulatory documents only.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
