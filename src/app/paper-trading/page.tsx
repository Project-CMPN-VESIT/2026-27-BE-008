"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, LineSeries, ColorType } from "lightweight-charts";
import { Activity, BookOpen, Briefcase, DollarSign, TrendingUp, Brain } from "lucide-react";
import TradingModal from "@/components/TradingModal";

type SearchSuggestion = {
  marketId: string;
  exchange: string;
  symbol: string;
  companyName: string;
};

type Position = {
  id: number;
  ticker: string;
  quantity: number;
  average_buy_price: number;
  updated_at: string;
};

type JournalEntry = {
  id: number;
  ticker: string;
  action: string;
  execution_price: number;
  quantity: number;
  user_thesis: string;
  ai_feedback: string;
  timestamp: string;
};

type PortfolioData = {
  balance: number;
  positions: Position[];
  journal: JournalEntry[];
};

export default function PaperTradingPage() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  
  const [data, setData] = useState<PortfolioData | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"holdings" | "journal">("holdings");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tradeForm, setTradeForm] = useState({ ticker: "RELIANCE", action: "BUY" as "BUY"|"SELL", quantity: 10 });
  const [isClient, setIsClient] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (tradeForm.ticker.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/tv-search?q=${encodeURIComponent(tradeForm.ticker.trim())}`);
        const data = await response.json();
        if (!isMounted) return;
        if (response.ok && data.ok) {
          const items = data.data as SearchSuggestion[];
          // simple dedupe by symbol
          const deduped = Array.from(new Map(items.map(i => [i.symbol, i])).values());
          setSuggestions(deduped);
        }
      } catch {}
    }, 250);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [tradeForm.ticker]);

  const fetchLivePrices = async (positions: Position[]) => {
    const newPrices: Record<string, number> = {};
    for (const p of positions) {
      try {
        const res = await fetch(`/api/live-quote?symbol=NSE_${p.ticker}`);
        const json = await res.json();
        if (json.ok && json.data.ltp) newPrices[p.ticker] = json.data.ltp;
      } catch (e) {}
    }
    setLivePrices(prev => ({ ...prev, ...newPrices }));
  };
  
  const loadPortfolio = async () => {
    try {
      const res = await fetch("/api/paper-trading/portfolio?userId=test_user");
      const json = await res.json();
      if (json.ok) {
        setData(json.data);
        fetchLivePrices(json.data.positions);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    setIsClient(true);
    loadPortfolio();
    const interval = setInterval(loadPortfolio, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!chartContainerRef.current || !data) return;
    
    // Cleanup old chart
    if (chartRef.current) {
        chartRef.current.remove();
    }

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      width: chartContainerRef.current.clientWidth,
      height: 300,
    });
    
    const lineSeries = chart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 2 });
    
    // Mock 30-day data for the chart 
    const initialBalance = 1000000;
    const mockData = [];
    const now = new Date();
    for (let i = 30; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      mockData.push({ time: d.toISOString().split("T")[0], value: initialBalance });
    }
    
    // Set actual current value as last point
    const holdingsValueCalc = data.positions.reduce((acc, p) => acc + (p.quantity * (livePrices[p.ticker] || p.average_buy_price)), 0);
    mockData[mockData.length - 1].value = data.balance + holdingsValueCalc;
    
    lineSeries.setData(mockData);
    chart.timeScale().fitContent();
    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, livePrices]);

  const handleExecuteTrade = async (thesis: string, feedback: string) => {
    try {
      const res = await fetch("/api/paper-trading/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "test_user",
          ticker: tradeForm.ticker,
          action: tradeForm.action,
          quantity: tradeForm.quantity,
          userThesis: thesis,
          aiFeedback: feedback
        })
      });
      const json = await res.json();
      if (json.ok) {
        alert("Trade Executed Successfully!");
        loadPortfolio();
      } else {
        alert("Trade Failed: " + json.error);
      }
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  if (!isClient || !data) return <div className="p-8 text-white min-h-screen bg-[#080c14]">Loading Crucible Dashboard...</div>;

  const holdingsValue = data.positions.reduce((acc, p) => acc + (p.quantity * (livePrices[p.ticker] || p.average_buy_price)), 0);
  const totalValue = data.balance + holdingsValue;
  const pnl = totalValue - 1000000;

  return (
    <div className="min-h-screen bg-[#080c14] p-6 text-slate-200 font-sans">
      <div className="mx-auto max-w-6xl space-y-6">
        
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="h-6 w-6 text-blue-500" /> Paper Trading Crucible
          </h1>
          <p className="text-slate-400 text-sm mt-1">AI-Mentored Reflection Loop & Virtual Ledger</p>
        </div>

        {/* Top KPI Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="text-sm font-medium text-slate-400 flex items-center gap-2"><Briefcase className="h-4 w-4" /> Total Portfolio Value</div>
            <div className="mt-2 text-3xl font-bold text-white">₹{totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="text-sm font-medium text-slate-400 flex items-center gap-2"><DollarSign className="h-4 w-4" /> Available Cash</div>
            <div className="mt-2 text-3xl font-bold text-white">₹{data.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="text-sm font-medium text-slate-400 flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Realized/Unrealized P&L</div>
            <div className={`mt-2 text-3xl font-bold ${pnl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
              {pnl >= 0 ? "+" : ""}₹{pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Middle: Chart & Trade Entry */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl border border-slate-800 bg-slate-900/30 p-5">
            <h2 className="text-base font-semibold text-white mb-4">30-Day Value Curve</h2>
            <div ref={chartContainerRef} className="w-full relative" />
          </div>
          
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 flex flex-col justify-center relative">
            <h2 className="text-base font-semibold text-white mb-4">Execute Trade</h2>
            <div className="space-y-4">
              <div className="relative">
                <label className="text-sm text-slate-400 block mb-1">Ticker</label>
                <input 
                  value={tradeForm.ticker} 
                  onChange={e => {
                    setTradeForm({...tradeForm, ticker: e.target.value.toUpperCase()});
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-white outline-none focus:border-blue-500" 
                />
                
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute left-0 top-full mt-1 z-30 w-full rounded-lg border border-slate-700 bg-slate-900 shadow-xl max-h-60 overflow-y-auto">
                    {suggestions.map((item) => (
                      <button
                        key={item.marketId}
                        type="button"
                        onClick={() => {
                          setTradeForm({...tradeForm, ticker: item.symbol});
                          setShowSuggestions(false);
                        }}
                        className="flex w-full flex-col px-3 py-2 text-left hover:bg-slate-800 border-b border-slate-800/50 last:border-0"
                      >
                        <div className="text-sm font-bold text-slate-200">{item.symbol}</div>
                        <div className="text-xs text-slate-400 truncate w-full">{item.companyName}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-slate-400 block mb-1">Action</label>
                  <select 
                    value={tradeForm.action} 
                    onChange={e => setTradeForm({...tradeForm, action: e.target.value as "BUY"|"SELL"})}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-white outline-none focus:border-blue-500"
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-slate-400 block mb-1">Qty</label>
                  <input 
                    type="number"
                    value={tradeForm.quantity} 
                    onChange={e => setTradeForm({...tradeForm, quantity: Number(e.target.value)})}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2 px-3 text-white outline-none focus:border-blue-500" 
                  />
                </div>
              </div>
              <button 
                onClick={() => setIsModalOpen(true)}
                className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition"
              >
                Queue Trade
              </button>
            </div>
          </div>
        </div>

        {/* Bottom: Tabs */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden">
          <div className="flex border-b border-slate-800 bg-slate-900/50 px-4">
            <button 
              onClick={() => setActiveTab("holdings")}
              className={`py-4 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === "holdings" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
            >
              Current Holdings
            </button>
            <button 
              onClick={() => setActiveTab("journal")}
              className={`py-4 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === "journal" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-slate-200"}`}
            >
              <BookOpen className="h-4 w-4" /> Reflection Journal
            </button>
          </div>
          
          <div className="p-0">
            {activeTab === "holdings" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-6 py-4 font-medium">Ticker</th>
                      <th className="px-6 py-4 font-medium">Quantity</th>
                      <th className="px-6 py-4 font-medium">Avg Buy Price</th>
                      <th className="px-6 py-4 font-medium">Current Value (Est)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {data.positions.length === 0 ? (
                      <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-500">No open positions.</td></tr>
                    ) : data.positions.map(p => (
                      <tr key={p.id} className="hover:bg-slate-800/20">
                        <td className="px-6 py-4 font-medium text-white">{p.ticker}</td>
                        <td className="px-6 py-4">{p.quantity}</td>
                        <td className="px-6 py-4">₹{p.average_buy_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span>₹{(p.quantity * (livePrices[p.ticker] || p.average_buy_price)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                            <span className={`text-xs ${
                              (livePrices[p.ticker] || p.average_buy_price) >= p.average_buy_price ? 'text-emerald-500' : 'text-rose-500'
                            }`}>
                              @ ₹{(livePrices[p.ticker] || p.average_buy_price).toLocaleString(undefined, { maximumFractionDigits: 2 })} {livePrices[p.ticker] ? '' : '(Offline)'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/50">
                {data.journal.length === 0 ? (
                  <div className="px-6 py-8 text-center text-slate-500">No trades logged yet.</div>
                ) : data.journal.map(entry => (
                  <div key={entry.id} className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 text-xs font-bold rounded-md ${entry.action === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
                          {entry.action}
                        </span>
                        <span className="font-bold text-white text-lg">{entry.quantity} {entry.ticker}</span>
                        <span className="text-slate-400 text-sm">@ ₹{entry.execution_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      </div>
                      <span className="text-xs text-slate-500">{new Date(entry.timestamp).toLocaleString()}</span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                      <div className="rounded-lg bg-slate-900 p-4 border border-slate-800">
                        <div className="text-xs font-semibold uppercase text-slate-500 mb-2">My Thesis</div>
                        <p className="text-sm text-slate-300 italic">"{entry.user_thesis}"</p>
                      </div>
                      <div className="rounded-lg bg-blue-900/10 p-4 border border-blue-900/30">
                        <div className="text-xs font-semibold uppercase text-blue-500 mb-2 flex items-center gap-1">
                          <Brain className="h-3 w-3" /> AI Mentor Feedback
                        </div>
                        <p className="text-sm text-slate-300">{entry.ai_feedback}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {isModalOpen && (
        <TradingModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          ticker={tradeForm.ticker}
          action={tradeForm.action}
          quantity={tradeForm.quantity}
          currentPrice={100} // Dynamic execution price fetched on server
          onExecute={handleExecuteTrade}
        />
      )}
    </div>
  );
}
