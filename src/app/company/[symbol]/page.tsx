"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createChart, IChartApi, LineSeries } from "lightweight-charts";
import { Activity, BarChart3, Users, DollarSign } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { screenerApiUrl } from "@/lib/screener-api";
import { Building2, Info, Trophy } from "lucide-react";
import LegendScores from "@/components/baskets/LegendScores";

// Static company business summaries — will be replaced by live API in future
const COMPANY_PROFILES: Record<string, { name: string; sector: string; summary: string }> = {
  "HDFCBANK.NS": {
    name: "HDFC Bank",
    sector: "Private Sector Bank",
    summary: "India's largest private sector bank by assets, offering a full range of banking and financial services including retail banking, wholesale banking, and treasury operations. Known for consistent asset quality and strong CASA ratios."
  },
  "SBIN.NS": {
    name: "State Bank of India",
    sector: "Public Sector Bank",
    summary: "India's largest commercial bank and a Fortune 500 company. Offers a wide spectrum of banking products including personal banking, commercial banking, NRI services, and government banking across 22,000+ branches."
  },
  "ICICIBANK.NS": {
    name: "ICICI Bank",
    sector: "Private Sector Bank",
    summary: "One of India's leading private sector banks offering a wide range of banking, insurance, and investment products. Known for its digital-first strategy and strong retail loan book."
  },
  "RELIANCE.NS": {
    name: "Reliance Industries",
    sector: "Conglomerate",
    summary: "India's largest company by market capitalisation. Operates across energy, petrochemicals, natural gas, retail, telecommunications, and media. Jio Platforms and Reliance Retail are key growth drivers."
  },
  "TCS.NS": {
    name: "Tata Consultancy Services",
    sector: "IT Services",
    summary: "India's largest IT services company and a global leader in digital transformation. Serves clients across 150+ countries with expertise in consulting, technology, and business process services."
  },
  "INFY.NS": {
    name: "Infosys",
    sector: "IT Services",
    summary: "A global leader in next-generation digital services and consulting with over 300,000 employees worldwide. Known for its strong margins, consistent dividend payouts, and exposure to large enterprise deals."
  },
};

export default function CompanyPage() {
  const { symbol } = useParams();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [alertMetric, setAlertMetric] = useState("current_price");
  const [alertCondition, setAlertCondition] = useState("<");
  const [alertThreshold, setAlertThreshold] = useState("");
  const [isSavingAlert, setIsSavingAlert] = useState(false);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const handleSaveAlert = async () => {
    if (!user) {
      alert("You must be logged in to set an alert.");
      return;
    }
    setIsSavingAlert(true);
    try {
      const res = await fetch(screenerApiUrl("/api/v1/screener/alerts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          symbol,
          metric: alertMetric,
          condition: alertCondition,
          threshold: parseFloat(alertThreshold)
        })
      });
      const data = await res.json();
      if (data.success) {
        alert("Alert created successfully!");
        setIsAlertModalOpen(false);
        setAlertThreshold("");
      } else {
        throw new Error(data.detail || "Failed to create alert");
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSavingAlert(false);
    }
  };

  // Mock data for Phase 1 MVP
  const mockMetrics: Record<string, number> = {
    market_cap: 1540000000000,
    pe_ttm: 22.4,
    pb: 3.1,
    roe: 18.5,
    roce: 15.2,
    debt_equity: 0.4,
    dividend_yield: 1.2,
    current_price: 2450.50,
    high_52w: 2900,
    low_52w: 2100
  };

  const symbolStr = Array.isArray(symbol) ? symbol[0] : symbol ?? "";
  const profile = COMPANY_PROFILES[symbolStr] ?? null;

  // Current value of the selected alert metric for display in modal
  const METRIC_LABELS: Record<string, string> = {
    current_price: "Current Price",
    pe_ttm: "P/E Ratio (TTM)",
    roe: "ROE %",
    market_cap: "Market Cap"
  };
  const currentAlertValue = mockMetrics[alertMetric] ?? null;

  useEffect(() => {
    if (activeTab === "overview" && chartContainerRef.current) {
      const chart = createChart(chartContainerRef.current, {
        layout: { background: { color: 'transparent' }, textColor: '#64748b' },
        grid: { vertLines: { color: '#e2e8f0' }, horzLines: { color: '#e2e8f0' } },
        width: chartContainerRef.current.clientWidth,
        height: 300,
      });

      const lineSeries = chart.addSeries(LineSeries, { color: '#2563eb', lineWidth: 2 });
      
      // Mock chart data
      const data = [];
      let price = 2200;
      for (let i = 0; i < 100; i++) {
        price += (Math.random() - 0.45) * 50;
        data.push({ time: `2023-01-${(i%28)+1}` as any, value: price });
      }
      // Sort and fix dates for Lightweight charts requirement (must be strictly increasing)
      const sortedData = data.map((d, idx) => {
        const date = new Date(2023, 0, 1);
        date.setDate(date.getDate() + idx);
        return { time: date.toISOString().split('T')[0], value: d.value };
      });
      lineSeries.setData(sortedData);
      
      chart.timeScale().fitContent();
      chartRef.current = chart;

      const handleResize = () => {
        if (chartContainerRef.current) {
          chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      };
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        chart.remove();
      };
    }
  }, [activeTab]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 text-slate-900 dark:text-slate-100">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-slate-200 dark:border-slate-800 pb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-bold tracking-tight">{symbolStr}</h1>
            {profile && <span className="text-base font-semibold text-slate-500 dark:text-slate-400">{profile.name}</span>}
            <span className="bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 text-xs font-bold px-2 py-1 rounded">NSE</span>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <div className="text-3xl font-bold text-slate-900 dark:text-white">
              ₹{mockMetrics.current_price.toFixed(2)}
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">52W Range</span>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">₹{mockMetrics.low_52w} - ₹{mockMetrics.high_52w}</span>
            </div>
            {profile && (
              <span className="ml-2 text-xs font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded uppercase tracking-wider">{profile.sector}</span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-bold shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            + Watchlist
          </button>
          <button 
            onClick={() => setIsAlertModalOpen(true)}
            className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-sm font-bold shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Set Alert
          </button>
          <Link href={`/compare?symbols=${symbol},RELIANCE.NS`} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-md transition-colors border border-blue-500">
            Compare Peers
          </Link>
        </div>
      </div>

      {/* Business Summary Card */}
      {profile && (
        <div className="flex items-start gap-3 bg-blue-50/60 dark:bg-slate-900/80 border border-blue-100 dark:border-slate-800 rounded-xl px-5 py-4 shadow-sm">
          <Building2 className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <span className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Business Overview</span>
            <p className="text-sm text-slate-700 dark:text-slate-300 mt-1 leading-relaxed">{profile.summary}</p>
          </div>
        </div>
      )}

      {isAlertModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Set Alert for {symbol}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              Get notified when a financial metric hits your target.
            </p>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Metric</label>
                <select 
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm outline-none"
                  value={alertMetric}
                  onChange={e => setAlertMetric(e.target.value)}
                >
                  <option value="current_price">Current Price</option>
                  <option value="pe_ttm">P/E Ratio (TTM)</option>
                  <option value="roe">ROE %</option>
                  <option value="market_cap">Market Cap</option>
                </select>
              </div>
              
              {/* Current value context */}
              {currentAlertValue !== null && (
                <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-lg text-sm">
                  <Info className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-slate-500">Current {METRIC_LABELS[alertMetric]}:</span>
                  <span className="font-bold text-slate-900 dark:text-white font-mono">
                    {alertMetric === "current_price" ? `₹${currentAlertValue.toFixed(2)}` :
                     alertMetric === "market_cap" ? `₹${(currentAlertValue / 10000000).toFixed(0)} Cr` :
                     `${currentAlertValue.toFixed(2)}`}
                  </span>
                </div>
              )}

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Condition</label>
                  <select 
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm outline-none"
                    value={alertCondition}
                    onChange={e => setAlertCondition(e.target.value)}
                  >
                    <option value="<">Drops Below (&lt;)</option>
                    <option value=">">Rises Above (&gt;)</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Threshold</label>
                  <input 
                    type="number" 
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm outline-none font-mono"
                    value={alertThreshold}
                    onChange={e => setAlertThreshold(e.target.value)}
                    placeholder="e.g. 20"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setIsAlertModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveAlert}
                disabled={isSavingAlert || !alertThreshold}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-bold shadow-md transition-colors"
              >
                {isSavingAlert ? "Saving..." : "Create Alert"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-6 border-b border-slate-200 dark:border-slate-800 font-medium overflow-x-auto custom-scrollbar">
        {[
          { id: "overview", label: "Overview", icon: Activity },
          { id: "financials", label: "Financials", icon: DollarSign },
          { id: "peers", label: "Peer Preview", icon: Users },
          { id: "investors", label: "Invest Like", icon: Trophy }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`pb-4 flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id 
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400" 
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-300"
            }`}
          >
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Grouped Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Valuation Group */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-xl shadow-sm">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Valuation</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Market Cap</div>
                  <div className="text-base font-bold">₹{(mockMetrics.market_cap / 10000000).toFixed(0)} Cr</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">P/E Ratio</div>
                  <div className="text-base font-bold">{mockMetrics.pe_ttm}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">P/B Ratio</div>
                  <div className="text-base font-bold">{mockMetrics.pb}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Div Yield</div>
                  <div className="text-base font-bold">{mockMetrics.dividend_yield}%</div>
                </div>
              </div>
            </div>

            {/* Profitability Group */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-xl shadow-sm">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Profitability & Growth</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-slate-500 mb-1">ROE</div>
                  <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">{mockMetrics.roe}%</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">ROCE</div>
                  <div className="text-base font-bold">{mockMetrics.roce}%</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">5Y Sales Gr.</div>
                  <div className="text-base font-bold text-slate-400" title="Awaiting XBRL data">—</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">5Y Profit Gr.</div>
                  <div className="text-base font-bold text-slate-400" title="Awaiting XBRL data">—</div>
                </div>
              </div>
            </div>

            {/* Health Group */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 rounded-xl shadow-sm">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 dark:border-slate-800 pb-2">Financial Health</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Debt / Equity</div>
                  <div className="text-base font-bold">{mockMetrics.debt_equity}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Current Ratio</div>
                  <div className="text-base font-bold text-slate-400">—</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Interest Coverage</div>
                  <div className="text-base font-bold text-slate-400">—</div>
                </div>
              </div>
            </div>
            
          </div>

          {/* Chart Section */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm mt-6">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" /> Price Trend
            </h3>
            <div ref={chartContainerRef} className="w-full h-[300px]" />
          </div>
        </div>
      )}

      {/* Financials Tab */}
      {activeTab === "financials" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm animate-in fade-in duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold">Annual Financials (Consolidated)</h3>
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
              <button className="px-4 py-1.5 text-sm font-medium bg-white dark:bg-slate-700 rounded-md shadow-sm">Annual</button>
              <button className="px-4 py-1.5 text-sm font-medium text-slate-500">Quarterly</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-950/50">
                <tr>
                  <th className="py-3 px-4 rounded-tl-lg">Line Item</th>
                  <th className="py-3 px-4 text-right">Mar 2021</th>
                  <th className="py-3 px-4 text-right">Mar 2022</th>
                  <th className="py-3 px-4 text-right">Mar 2023</th>
                  <th className="py-3 px-4 text-right rounded-tr-lg">Mar 2024</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Sales", "45,000", "52,000", "61,000", "75,000"],
                  ["Expenses", "38,000", "42,000", "48,000", "58,000"],
                  ["Operating Profit", "7,000", "10,000", "13,000", "17,000"],
                  ["OPM %", "15%", "19%", "21%", "23%"],
                  ["Net Profit", "4,500", "6,800", "9,200", "12,500"],
                ].map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-4 font-medium">{row[0]}</td>
                    <td className="py-3 px-4 text-right">{row[1]}</td>
                    <td className="py-3 px-4 text-right">{row[2]}</td>
                    <td className="py-3 px-4 text-right">{row[3]}</td>
                    <td className="py-3 px-4 text-right font-semibold text-blue-600 dark:text-blue-400">{row[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invest Like Tab: investor-style scores */}
      {activeTab === "investors" && (
        <div className="animate-in fade-in duration-300">
          <LegendScores symbol={symbolStr} />
        </div>
      )}

      {/* Peers Tab */}
      {activeTab === "peers" && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm animate-in fade-in duration-300">
          <h3 className="text-lg font-bold mb-6">Peer Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-950/50">
                <tr>
                  <th className="py-3 px-4">Company</th>
                  <th className="py-3 px-4 text-right">Price</th>
                  <th className="py-3 px-4 text-right">P/E</th>
                  <th className="py-3 px-4 text-right">Market Cap</th>
                  <th className="py-3 px-4 text-right">ROE %</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b-2 border-blue-100 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-900/10">
                  <td className="py-3 px-4 font-bold text-blue-600 dark:text-blue-400">{symbol}</td>
                  <td className="py-3 px-4 text-right font-medium">₹2450.50</td>
                  <td className="py-3 px-4 text-right font-medium">22.4</td>
                  <td className="py-3 px-4 text-right font-medium">₹15.4L Cr</td>
                  <td className="py-3 px-4 text-right font-medium">18.5%</td>
                </tr>
                <tr className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-3 px-4 font-medium cursor-pointer hover:underline text-slate-700 dark:text-slate-300">PEER_A.NS</td>
                  <td className="py-3 px-4 text-right">₹1820.00</td>
                  <td className="py-3 px-4 text-right">19.2</td>
                  <td className="py-3 px-4 text-right">₹8.2L Cr</td>
                  <td className="py-3 px-4 text-right">15.1%</td>
                </tr>
                <tr className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-3 px-4 font-medium cursor-pointer hover:underline text-slate-700 dark:text-slate-300">PEER_B.NS</td>
                  <td className="py-3 px-4 text-right">₹3100.25</td>
                  <td className="py-3 px-4 text-right">28.5</td>
                  <td className="py-3 px-4 text-right">₹5.1L Cr</td>
                  <td className="py-3 px-4 text-right">22.4%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
