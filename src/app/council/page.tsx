"use client";

import { useState, useRef, useEffect } from "react";
import {
  Users,
  Play,
  Pause,
  RotateCcw,
  Terminal,
  TrendingUp,
  TrendingDown,
  Shield,
  Search as SearchIcon,
  BarChart3,
  MessageSquare,
  Zap,
  DollarSign,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  ChevronDown,
  Wallet,
  Activity,
  Info,
  Bot,
} from "lucide-react";

type AgentRole = "scout" | "analyst" | "risk";

interface AgentMessage {
  id: number;
  agent: AgentRole;
  message: string;
  timestamp: string;
  type: "analysis" | "debate" | "verdict" | "system";
}

interface PortfolioPosition {
  ticker: string;
  name: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
}

const agentConfig: Record<AgentRole, { name: string; icon: typeof SearchIcon; color: string; bg: string; border: string; role: string }> = {
  scout: {
    name: "Scout Agent",
    icon: SearchIcon,
    color: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-50 dark:bg-cyan-500/10",
    border: "border-cyan-200 dark:border-cyan-500/20",
    role: "Market Scanner & Data Gatherer",
  },
  analyst: {
    name: "Analyst Agent",
    icon: BarChart3,
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-500/10",
    border: "border-violet-200 dark:border-violet-500/20",
    role: "Financial Deep-Dive Specialist",
  },
  risk: {
    name: "Risk Officer",
    icon: Shield,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    border: "border-amber-200 dark:border-amber-500/20",
    role: "Risk Assessment & Compliance Guard",
  },
};

const debateLog: AgentMessage[] = [
  { id: 1, agent: "scout", message: "SCAN INITIATED: Evaluating TATAMOTORS for paper trade. Current price ₹780.25, 52W High ₹1,020, 52W Low ₹610.", timestamp: "14:30:01", type: "system" },
  { id: 2, agent: "scout", message: "Sector momentum is positive — Auto index up 1.1% today. Tata Motors JLR segment showing margin expansion. Q3 FY25 revenue beat expectations by 4.2%. I'm flagging this as a potential LONG opportunity.", timestamp: "14:30:03", type: "analysis" },
  { id: 3, agent: "analyst", message: "I concur on revenue momentum, but let me dig deeper. Operating margin improved to 14.8% from 11.2% YoY — that's genuinely strong. However, consolidated debt stands at ₹48,900 Cr. Debt/EBITDA is 2.8x which is above my comfort threshold of 2.5x.", timestamp: "14:30:06", type: "analysis" },
  { id: 4, agent: "risk", message: "⚠️ RISK FLAG: China exposure. JLR China revenue declined 18% YoY per the annual report (Pg 78). This is a material geographic concentration risk that's being underweighted in the bullish narrative.", timestamp: "14:30:08", type: "debate" },
  { id: 5, agent: "scout", message: "Valid point on China, but India passenger vehicle market share grew from 13.2% → 15.8%. EV segment (Nexon EV) now contributes 8% of domestic revenue. The diversification story is real.", timestamp: "14:30:11", type: "debate" },
  { id: 6, agent: "analyst", message: "Running DCF: Fair value estimate ₹820-870 at 12x forward EV/EBITDA. Current price of ₹780 implies ~10% upside to midpoint. FCF turned positive at ₹4,200 Cr — that's the key unlock. But I note promoter didn't increase stake despite price correction.", timestamp: "14:30:14", type: "analysis" },
  { id: 7, agent: "risk", message: "SEBI regulatory check PASSED — no flags on directors or promoters. Auditor report is clean with no qualifications. RK Score: 6.8/10 (Moderate-Low Risk). However, I'm limiting position size to 5% of portfolio due to the leverage ratio.", timestamp: "14:30:17", type: "analysis" },
  { id: 8, agent: "analyst", message: "PL Score: 7.1/10 (Strong). Revenue trajectory, margin expansion, and FCF turnaround all support a constructive view. The balance sheet concern is real but manageable given the cash flow improvement.", timestamp: "14:30:19", type: "analysis" },
  { id: 9, agent: "risk", message: "I'll approve a PAPER LONG with conditions: (1) Max 5% portfolio allocation, (2) Stop-loss at ₹720 (-7.7%), (3) Target ₹850 (+8.9%), (4) Review at next quarterly filing. This gives us a risk/reward ratio of 1:1.15.", timestamp: "14:30:22", type: "verdict" },
  { id: 10, agent: "scout", message: "✅ COUNCIL VERDICT: PAPER LONG — TATAMOTORS @ ₹780.25 | Qty: 50 | Target: ₹850 | Stop: ₹720 | Conviction: MODERATE (3 agents agree, 0 dissent)", timestamp: "14:30:24", type: "verdict" },
];

const portfolio: PortfolioPosition[] = [
  { ticker: "INFY", name: "Infosys Ltd", qty: 100, avgPrice: 1510.0, currentPrice: 1542.3, pnl: 3230, pnlPct: 2.14 },
  { ticker: "RELIANCE", name: "Reliance Industries", qty: 30, avgPrice: 2920.0, currentPrice: 2890.45, pnl: -886.5, pnlPct: -1.01 },
  { ticker: "HDFCBANK", name: "HDFC Bank", qty: 80, avgPrice: 1590.0, currentPrice: 1620.55, pnl: 2444, pnlPct: 1.92 },
  { ticker: "TATAMOTORS", name: "Tata Motors (NEW)", qty: 50, avgPrice: 780.25, currentPrice: 780.25, pnl: 0, pnlPct: 0 },
];

const totalInvested = portfolio.reduce((s, p) => s + p.avgPrice * p.qty, 0);
const totalCurrent = portfolio.reduce((s, p) => s + p.currentPrice * p.qty, 0);
const totalPnL = totalCurrent - totalInvested;
const totalPnLPct = (totalPnL / totalInvested) * 100;

export default function CouncilPage() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [visibleMessages, setVisibleMessages] = useState(debateLog.length);
  const logRef = useRef<HTMLDivElement>(null);
  const [selectedTicker, setSelectedTicker] = useState("TATAMOTORS");

  const handleReplay = () => {
    setVisibleMessages(0);
    setIsPlaying(true);
  };

  useEffect(() => {
    if (!isPlaying) return;
    if (visibleMessages >= debateLog.length) {
      setIsPlaying(false);
      return;
    }
    const timer = setTimeout(() => {
      setVisibleMessages((prev) => prev + 1);
    }, 1200);
    return () => clearTimeout(timer);
  }, [isPlaying, visibleMessages]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [visibleMessages]);

  return (
    <div className="p-6 space-y-6 bg-grid-pattern min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Agent Council & Paper Trading</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Multi-agent deliberation engine with virtual portfolio simulation
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-900 dark:text-white cursor-pointer"
            value={selectedTicker}
            onChange={(e) => setSelectedTicker(e.target.value)}
          >
            <option value="TATAMOTORS">Tata Motors (TATAMOTORS)</option>
            <option value="INFY">Infosys (INFY)</option>
            <option value="RELIANCE">Reliance (RELIANCE)</option>
            <option value="ADANIENT">Adani Enterprises (ADANIENT)</option>
          </select>
          <button
            onClick={handleReplay}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Replay Debate
          </button>
        </div>
      </div>

      {/* Agent Cards */}
      <div className="grid grid-cols-3 gap-4">
        {(["scout", "analyst", "risk"] as AgentRole[]).map((role) => {
          const config = agentConfig[role];
          const Icon = config.icon;
          return (
            <div key={role} className={`bg-white dark:bg-slate-900 rounded-xl border ${config.border} p-4`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${config.bg} flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${config.color}`} />
                </div>
                <div>
                  <h3 className={`text-sm font-bold ${config.color}`}>{config.name}</h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">{config.role}</p>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] text-emerald-500 font-medium">Active</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Chain of Thought Terminal */}
        <div className="col-span-8 bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 overflow-hidden flex flex-col" style={{ height: "520px" }}>
          {/* Terminal Header */}
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-300 dark:border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Chain-of-Thought Log
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 font-medium">
                LIVE
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                {isPlaying ? <Pause className="w-4 h-4 text-slate-500" /> : <Play className="w-4 h-4 text-slate-500" />}
              </button>
              <span className="text-[10px] text-slate-400 font-mono">
                {visibleMessages}/{debateLog.length} messages
              </span>
            </div>
          </div>

          {/* Terminal Body */}
          <div ref={logRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50 dark:bg-slate-950/50">
            {debateLog.slice(0, visibleMessages).map((msg) => {
              const config = agentConfig[msg.agent];
              const Icon = config.icon;

              return (
                <div key={msg.id} className="flex gap-3 animate-fade-in">
                  <div className={`w-7 h-7 rounded-md ${config.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                    <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[11px] font-bold ${config.color}`}>{config.name}</span>
                      <span className="text-[9px] text-slate-400 font-mono">{msg.timestamp}</span>
                      {msg.type === "verdict" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 font-bold">
                          VERDICT
                        </span>
                      )}
                      {msg.type === "debate" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20 font-medium">
                          DEBATE
                        </span>
                      )}
                    </div>
                    <p className={`text-xs leading-relaxed ${
                      msg.type === "verdict"
                        ? "text-emerald-700 dark:text-emerald-300 font-medium"
                        : msg.type === "system"
                        ? "text-slate-500 dark:text-slate-400 font-mono"
                        : "text-slate-700 dark:text-slate-300"
                    }`}>
                      {msg.message}
                    </p>
                  </div>
                </div>
              );
            })}
            {isPlaying && visibleMessages < debateLog.length && (
              <div className="flex items-center gap-2 pl-10">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span className="text-[10px] text-slate-400">Agent deliberating...</span>
              </div>
            )}
          </div>
        </div>

        {/* Paper Trading Portfolio */}
        <div className="col-span-4 space-y-4">
          {/* Portfolio Summary */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Wallet className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Paper Portfolio</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20 font-medium ml-auto">
                SIMULATION
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase">Capital</span>
                <div className="text-lg font-bold text-slate-900 dark:text-white">₹10,00,000</div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase">Current Value</span>
                <div className="text-lg font-bold text-slate-900 dark:text-white">₹{totalCurrent.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
              </div>
            </div>
            <div className={`p-3 rounded-lg border ${totalPnL >= 0 ? "bg-emerald-50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/20" : "bg-rose-50 dark:bg-rose-500/5 border-rose-200 dark:border-rose-500/20"}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-600 dark:text-slate-400">Unrealized P&L</span>
                <div className="flex items-center gap-1">
                  {totalPnL >= 0 ? <ArrowUpRight className="w-4 h-4 text-emerald-500" /> : <ArrowDownRight className="w-4 h-4 text-rose-500" />}
                  <span className={`text-sm font-bold ${totalPnL >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    ₹{Math.abs(totalPnL).toLocaleString("en-IN", { maximumFractionDigits: 0 })} ({totalPnLPct >= 0 ? "+" : ""}{totalPnLPct.toFixed(2)}%)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Holdings */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-300 dark:border-slate-800">
              <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Holdings</h3>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {portfolio.map((pos) => (
                <div key={pos.ticker} className={`px-4 py-3 ${pos.pnlPct === 0 ? "bg-blue-50/30 dark:bg-blue-500/[0.03]" : ""}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900 dark:text-white">{pos.ticker}</span>
                        {pos.pnlPct === 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-bold border border-cyan-200 dark:border-cyan-500/20">NEW</span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">{pos.qty} shares @ ₹{pos.avgPrice.toFixed(2)}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">₹{pos.currentPrice.toFixed(2)}</div>
                      <div className={`text-[10px] font-medium ${pos.pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {pos.pnl >= 0 ? "+" : ""}₹{pos.pnl.toLocaleString("en-IN")} ({pos.pnlPct >= 0 ? "+" : ""}{pos.pnlPct.toFixed(2)}%)
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Latest Trade */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-cyan-200 dark:border-cyan-500/20 p-4 bg-cyan-50/30 dark:bg-cyan-500/[0.03]">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-cyan-500" />
              <span className="text-xs font-bold text-cyan-700 dark:text-cyan-400">Latest Council Decision</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Action</span>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">PAPER LONG</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Stock</span>
                <span className="text-xs font-medium text-slate-900 dark:text-white">TATAMOTORS @ ₹780.25</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Target</span>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">₹850 (+8.9%)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Stop Loss</span>
                <span className="text-xs font-medium text-rose-600 dark:text-rose-400">₹720 (-7.7%)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Conviction</span>
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">MODERATE</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Council Vote</span>
                <span className="text-xs font-medium text-slate-900 dark:text-white">3/3 Agree</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Methodology */}
      <div className="bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-300 dark:border-slate-700/50 p-4">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Educational Simulation</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">
              This is a paper trading simulation for educational purposes only. No real money is involved. The multi-agent debate showcases how 
              specialized AI agents (Scout — market data gathering, Analyst — financial deep-dive, Risk Officer — compliance & position sizing) 
              collaborate to produce a research-backed virtual trade decision. All analysis is grounded in actual regulatory filing data.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
