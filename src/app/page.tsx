"use client";

import {
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  Shield,
  BarChart3,
  Swords,
  Users,
  ArrowRight,
  FileText,
  Zap,
  Eye,
  Clock,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

const marketData = [
  { time: "09:15", nifty: 22450 },
  { time: "10:00", nifty: 22510 },
  { time: "10:30", nifty: 22480 },
  { time: "11:00", nifty: 22530 },
  { time: "11:30", nifty: 22560 },
  { time: "12:00", nifty: 22540 },
  { time: "12:30", nifty: 22590 },
  { time: "13:00", nifty: 22610 },
  { time: "13:30", nifty: 22580 },
  { time: "14:00", nifty: 22620 },
  { time: "14:30", nifty: 22650 },
  { time: "15:00", nifty: 22640 },
  { time: "15:30", nifty: 22670 },
];

const sectorPerformance = [
  { sector: "IT", change: 2.3 },
  { sector: "Pharma", change: 1.8 },
  { sector: "Bank", change: -0.5 },
  { sector: "Auto", change: 1.1 },
  { sector: "FMCG", change: -0.3 },
  { sector: "Metal", change: 3.1 },
  { sector: "Energy", change: 0.7 },
  { sector: "Realty", change: -1.2 },
];

const recentAlerts = [
  {
    id: 1,
    type: "disparity",
    title: "Adani Enterprises",
    desc: "News sentiment \"Bullish\" vs Filing shows elevated debt/equity ratio",
    severity: "high",
    time: "2m ago",
  },
  {
    id: 2,
    type: "regulatory",
    title: "Yes Bank",
    desc: "Director flagged in SEBI debarred list — cross-verify required",
    severity: "critical",
    time: "8m ago",
  },
  {
    id: 3,
    type: "scoring",
    title: "Tata Motors",
    desc: "RK Score improved from 4.2 to 6.8 after Q3 filing review",
    severity: "info",
    time: "15m ago",
  },
  {
    id: 4,
    type: "disparity",
    title: "Paytm (One97)",
    desc: "Media reports expansion but annual report highlights cash burn",
    severity: "medium",
    time: "22m ago",
  },
];

const watchlist = [
  { symbol: "INFY", price: "1,542.30", change: "+1.24%", up: true },
  { symbol: "RELIANCE", price: "2,890.45", change: "-0.38%", up: false },
  { symbol: "TCS", price: "3,720.10", change: "+0.85%", up: true },
  { symbol: "HDFCBANK", price: "1,620.55", change: "+0.42%", up: true },
  { symbol: "ICICIBANK", price: "1,105.80", change: "-0.15%", up: false },
  { symbol: "SBIN", price: "780.25", change: "+1.67%", up: true },
];

const features = [
  { href: "/war-room", icon: Swords, title: "War Room", desc: "CYRO AI research with citation-backed analysis", color: "blue" },
  { href: "/regulatory", icon: Shield, title: "SEBI Shield", desc: "Automated regulatory integrity checks", color: "emerald" },
  { href: "/scoring", icon: BarChart3, title: "RK/PL Scores", desc: "Dual-metric risk & profit scoring", color: "amber" },
  { href: "/alerts", icon: AlertTriangle, title: "Disparity Alerts", desc: "Market hype vs. filing fact checker", color: "rose" },
  { href: "/council", icon: Users, title: "Agent Council", desc: "Multi-agent debate & paper trading", color: "cyan" },
];

const colorMap: Record<string, string> = {
  blue: "from-blue-500 to-blue-600", emerald: "from-emerald-500 to-emerald-600",
  amber: "from-amber-500 to-amber-600", rose: "from-rose-500 to-rose-600", cyan: "from-cyan-500 to-cyan-600",
};
const colorMapBorder: Record<string, string> = {
  blue: "border-blue-200 dark:border-blue-500/20", emerald: "border-emerald-200 dark:border-emerald-500/20",
  amber: "border-amber-200 dark:border-amber-500/20", rose: "border-rose-200 dark:border-rose-500/20", cyan: "border-cyan-200 dark:border-cyan-500/20",
};
const colorMapBg: Record<string, string> = {
  blue: "bg-blue-50 dark:bg-blue-500/5", emerald: "bg-emerald-50 dark:bg-emerald-500/5",
  amber: "bg-amber-50 dark:bg-amber-500/5", rose: "bg-rose-50 dark:bg-rose-500/5", cyan: "bg-cyan-50 dark:bg-cyan-500/5",
};
const severityColors: Record<string, string> = {
  critical: "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20",
  high: "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20",
  medium: "bg-yellow-100 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/20",
  info: "bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20",
};

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6 bg-grid-pattern min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Command Center</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time market intelligence · Grounded in regulatory filings
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Market Open</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">NSE · Live</span>
          </div>
        </div>
      </div>

      {/* Market Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "NIFTY 50", value: "22,670.35", change: "+0.98%", delta: "+220.15", up: true, icon: TrendingUp },
          { label: "SENSEX", value: "74,320.10", change: "+0.71%", delta: "+520.30", up: true, icon: TrendingUp },
          { label: "BANK NIFTY", value: "48,150.20", change: "-0.25%", delta: "-120.50", up: false, icon: TrendingDown },
          { label: "VIX", value: "13.45", change: "Low Volatility", delta: "-0.82", up: false, icon: Activity },
        ].map((item) => (
          <div key={item.label} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{item.label}</span>
              <item.icon className={`w-4 h-4 ${item.up ? "text-emerald-500" : item.label === "VIX" ? "text-amber-500" : "text-rose-500"}`} />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{item.value}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`text-sm font-medium ${item.up ? "text-emerald-600 dark:text-emerald-400" : item.label === "VIX" ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400"}`}>{item.change}</span>
              <span className="text-xs text-slate-400">{item.delta}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-6">
        {/* Nifty Chart */}
        <div className="col-span-8 bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">NIFTY 50 Intraday</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Live price movement</p>
            </div>
            <div className="flex gap-1">
              {["1D", "1W", "1M", "3M"].map((p) => (
                <button key={p} className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${p === "1D" ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"}`}>{p}</button>
              ))}
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={marketData}>
                <defs>
                  <linearGradient id="niftyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="[&>line]:stroke-slate-200 dark:[&>line]:stroke-slate-800" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis domain={["dataMin - 50", "dataMax + 50"]} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", fontSize: "12px", color: "#e2e8f0" }} />
                <Area type="monotone" dataKey="nifty" stroke="#3b82f6" strokeWidth={2} fill="url(#niftyGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Watchlist */}
        <div className="col-span-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Watchlist</h2>
            <Eye className="w-4 h-4 text-slate-400" />
          </div>
          <div className="space-y-1">
            {watchlist.map((s) => (
              <div key={s.symbol} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">{s.symbol.slice(0, 2)}</span>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{s.symbol}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">NSE</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">₹{s.price}</div>
                  <div className={`text-xs font-medium ${s.up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{s.change}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sector Performance */}
        <div className="col-span-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Sector Performance</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Today&apos;s sector-wise change</p>
            </div>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sectorPerformance} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="[&>line]:stroke-slate-200 dark:[&>line]:stroke-slate-800" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis dataKey="sector" type="category" tick={{ fontSize: 11, fill: "#94a3b8" }} width={50} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", fontSize: "12px", color: "#e2e8f0" }} formatter={(value) => [`${value}%`, "Change"]} />
                <Bar dataKey="change" radius={[0, 4, 4, 0]} fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="col-span-7 bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Recent Intelligence Alerts</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Filing-backed alerts from CYRO analysis engine</p>
            </div>
            <Link href="/alerts" className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {recentAlerts.map((a) => (
              <div key={a.id} className={`flex items-start gap-3 px-3 py-3 rounded-lg border ${severityColors[a.severity]} transition-colors`}>
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{a.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/5 font-medium uppercase">{a.severity}</span>
                  </div>
                  <p className="text-xs mt-0.5 opacity-80">{a.desc}</p>
                </div>
                <span className="text-[10px] whitespace-nowrap opacity-60 mt-0.5">{a.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Research Modules */}
        <div className="col-span-12">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Research Modules</h2>
          <div className="grid grid-cols-5 gap-4">
            {features.map((f) => (
              <Link key={f.href} href={f.href} className={`group bg-white dark:bg-slate-900 rounded-xl border ${colorMapBorder[f.color]} ${colorMapBg[f.color]} p-5 transition-all duration-200 hover:scale-[1.02] hover:shadow-lg`}>
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colorMap[f.color]} flex items-center justify-center mb-3`}>
                  <f.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">{f.title}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{f.desc}</p>
                <div className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 group-hover:gap-2 transition-all">
                  Open Module <ChevronRight className="w-3 h-3" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Filing Activity Feed */}
        <div className="col-span-12 bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Latest Regulatory Filings</h2>
            </div>
            <span className="text-xs text-slate-400">Auto-synced from NSE/BSE EDGAR</span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {[
              { company: "Reliance Industries", type: "Annual Report FY25", date: "Mar 1, 2026", pages: 342 },
              { company: "Infosys Ltd", type: "Q3 Quarterly Filing", date: "Feb 28, 2026", pages: 86 },
              { company: "HDFC Bank", type: "Board Resolution", date: "Feb 27, 2026", pages: 12 },
              { company: "Tata Motors", type: "Annual Report FY25", date: "Feb 25, 2026", pages: 298 },
            ].map((f) => (
              <div key={f.company} className="px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-300/60 dark:border-slate-700/50 hover:border-blue-200 dark:hover:border-blue-500/20 transition-colors cursor-pointer">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{f.company}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{f.type}</div>
                  </div>
                  <Zap className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium">{f.pages} pages</span>
                  <span className="text-[10px] text-slate-400">{f.date}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
