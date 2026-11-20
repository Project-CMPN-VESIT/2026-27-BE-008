"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import PortfolioChart from "@/components/chart/PortfolioChart";
import { Holding } from "@/lib/portfolio/usePortfolio";
import { firebaseDb } from "@/lib/firebase/client";
import { doc, setDoc } from "firebase/firestore";
import {
  Plus,
  Trash2,
  Edit2,
  Search,
  Upload,
  RefreshCw,
  X,
  AlertCircle,
  ShieldAlert,
  BellRing,
  Newspaper,
  Calendar,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";

export interface UserHolding {
  id: string;
  symbol: string;
  companyName: string;
  exchange: string;
  sector: string;
  shares: number;
  buyPrice: number;
  buyDate: string;
  currentPrice: number;
  previousClose: number;
  dayChange: number;
  dayChangePercent: number;
  investedValue: number;
  currentValue: number;
  totalPnL: number;
  totalPnLPercent: number;
  dayGain: number;
  dayGainPercent: number;
}

interface StockSearchResult {
  symbol: string;
  companyName: string;
  sector: string;
  exchange: string;
  price: number;
  pChange: number;
}


const PALETTE = ["#1F5EFF", "#84ADFF", "#344054", "#D0D5DD", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"];



export default function PortfolioPage() {
  const { user } = useAuth();

  const ownerName = useMemo(() => {
    const raw = (user?.name || user?.email?.split("@")[0] || "Shivam").trim();
    const first = raw.split(" ")[0].trim();
    const letters = first.replace(/[^a-zA-Z]/g, "");
    const base = letters.length >= 2 ? letters : first;
    return base.charAt(0).toUpperCase() + base.slice(1);
  }, [user]);

  const portfolioChartTitle = `${ownerName}'s Portfolio`;

  const [holdings, setHoldings] = useState<UserHolding[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showPurposeDetails, setShowPurposeDetails] = useState(false);

  // Add / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingHolding, setEditingHolding] = useState<UserHolding | null>(null);
  const [modalSearch, setModalSearch] = useState("");
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [selectedStock, setSelectedStock] = useState<StockSearchResult | null>(null);
  const [formShares, setFormShares] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formDate, setFormDate] = useState(new Date().toISOString().split("T")[0]);
  const [formError, setFormError] = useState("");

  // CSV Import Modal
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete Action
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Synchronous initial load with non-blocking async background hydration
  const loadPortfolio = async () => {
    const storageKey = user?.id ? `finpilot_portfolio_${user.id}` : "finpilot_portfolio_guest";

    // 1. Instant local read so UI never freezes or waits
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setHoldings(parsed);
        }
      }
    } catch {
      // ignore
    }

    // PostgreSQL is the authoritative source for authenticated portfolios.
    // Firebase remains a write mirror and must not overwrite newer server holdings.
    if (user?.id) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await authenticatedFetch("/api/portfolio", { signal: controller.signal });
        clearTimeout(timer);
        const json = await res.json();
        if (json.ok && Array.isArray(json.holdings) && json.holdings.length > 0) {
          setHoldings(json.holdings);
          localStorage.setItem(storageKey, JSON.stringify(json.holdings));
        }
      } catch {
        // ignore
      }
    }

    setRefreshing(false);
  };

  useEffect(() => {
    loadPortfolio();
  }, [user?.id]);

  // Stock search autocomplete inside modal (fast 100ms debounce)
  useEffect(() => {
    if (!modalOpen || selectedStock) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/portfolio/search?q=${encodeURIComponent(modalSearch.trim())}`);
        const json = await res.json();
        if (json.ok && Array.isArray(json.data)) {
          setSearchResults(json.data);
        }
      } catch {
        // ignore
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [modalSearch, modalOpen, selectedStock]);

  // Handle escape key to close modals instantly
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
        setCsvModalOpen(false);
        setDeleteId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Aggregate Portfolio Computations
  const summary = useMemo(() => {
    let totalInvested = 0;
    let totalCurrentValue = 0;
    let totalDayGain = 0;

    holdings.forEach((h) => {
      totalInvested += h.shares * h.buyPrice;
      totalCurrentValue += h.shares * h.currentPrice;
      totalDayGain += h.shares * (h.currentPrice - h.previousClose);
    });

    const totalPnL = totalCurrentValue - totalInvested;
    const totalPnLPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
    const prevTotal = totalCurrentValue - totalDayGain;
    const totalDayGainPercent = prevTotal > 0 ? (totalDayGain / prevTotal) * 100 : 0;

    // Sector breakdown
    const sectorMap: Record<string, number> = {};
    holdings.forEach((h) => {
      const val = h.shares * h.currentPrice;
      sectorMap[h.sector] = (sectorMap[h.sector] || 0) + val;
    });

    const sectorBreakdown = Object.entries(sectorMap)
      .map(([sector, val], idx) => ({
        sector,
        value: val,
        percentage: totalCurrentValue > 0 ? (val / totalCurrentValue) * 100 : 0,
        color: PALETTE[idx % PALETTE.length],
      }))
      .sort((a, b) => b.value - a.value);

    // Best & Worst performers
    const sorted = [...holdings].sort((a, b) => b.totalPnLPercent - a.totalPnLPercent);
    const bestPerformer = sorted.length > 0 ? sorted[0] : null;
    const worstPerformer = sorted.length > 1 ? sorted[sorted.length - 1] : null;

    return {
      totalInvested,
      totalCurrentValue,
      totalPnL,
      totalPnLPercent,
      totalDayGain,
      totalDayGainPercent,
      sectorBreakdown,
      bestPerformer,
      worstPerformer,
      count: holdings.length,
    };
  }, [holdings]);

  // Convert holdings to unified Holding type for PortfolioChart
  const chartHoldings: Holding[] = useMemo(() => {
    return holdings
      .filter((h) => Number(h.shares) > 0)
      .map((h) => {
        const rawSym = String(h.symbol || "").trim().toUpperCase();
        const sym = rawSym.includes(":") ? rawSym : `NSE:${rawSym}`;
        return {
          symbol: sym,
          qty: Number(h.shares),
        };
      });
  }, [holdings]);

  // Non-blocking background sync with 2.5s timeouts so UI never hangs
  const syncHoldingsBackground = async (newList: UserHolding[]) => {
    const storageKey = user?.id ? `finpilot_portfolio_${user.id}` : "finpilot_portfolio_guest";
    try {
      localStorage.setItem(storageKey, JSON.stringify(newList));
    } catch {
      // ignore
    }

    // Sync to Firebase Firestore asynchronously
    if (user?.id) {
      try {
        const userDocRef = doc(firebaseDb, "user_portfolios", user.id);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2500));
        await Promise.race([
          setDoc(
            userDocRef,
            {
              holdings: newList,
              updatedAt: new Date().toISOString(),
              uid: user.id,
              email: user.email || null,
            },
            { merge: true }
          ),
          timeoutPromise,
        ]);
      } catch (err) {
        console.warn("[Firebase sync]", err);
      }
    }

    // Sync to PostgreSQL backend API asynchronously
    if (user) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        await authenticatedFetch("/api/portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ holdings: newList }),
          signal: controller.signal,
        });
        clearTimeout(timer);
      } catch (err) {
        console.warn("[API sync]", err);
      }
    }
  };

  // Instant optimistic submit: updates UI in 0 ms and closes modal immediately
  const handleSaveHolding = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    const sharesNum = parseFloat(formShares);
    const priceNum = parseFloat(formPrice);

    if (isNaN(sharesNum) || sharesNum <= 0) {
      setFormError("Enter a valid number of shares.");
      return;
    }
    if (isNaN(priceNum) || priceNum <= 0) {
      setFormError("Enter a valid average cost.");
      return;
    }

    const symbol = editingHolding?.symbol || selectedStock?.symbol;
    const companyName = editingHolding?.companyName || selectedStock?.companyName || symbol || "";
    const sector = editingHolding?.sector || selectedStock?.sector || "General";
    const exchange = editingHolding?.exchange || selectedStock?.exchange || "NSE";
    const currentPrice = editingHolding?.currentPrice || selectedStock?.price || priceNum;
    const pChange = editingHolding?.dayChangePercent || selectedStock?.pChange || 0;
    const prevClose = currentPrice / (1 + pChange / 100);

    if (!symbol) {
      setFormError("Please select a stock first.");
      return;
    }

    const newH: UserHolding = {
      id: editingHolding?.id || `hld_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      symbol,
      companyName,
      exchange,
      sector,
      shares: sharesNum,
      buyPrice: priceNum,
      buyDate: formDate,
      currentPrice,
      previousClose: prevClose,
      dayChange: currentPrice - prevClose,
      dayChangePercent: pChange,
      investedValue: sharesNum * priceNum,
      currentValue: sharesNum * currentPrice,
      totalPnL: sharesNum * (currentPrice - priceNum),
      totalPnLPercent: ((currentPrice - priceNum) / priceNum) * 100,
      dayGain: sharesNum * (currentPrice - prevClose),
      dayGainPercent: pChange,
    };

    let updated: UserHolding[] = [];
    if (editingHolding) {
      updated = holdings.map((h) => (h.id === editingHolding.id ? newH : h));
    } else {
      updated = [newH, ...holdings];
    }

    // 1. Instantly update UI state
    setHoldings(updated);
    // 2. Instantly close modal (no delay, no sticking)
    closeModal();
    // 3. Refresh the current market quote immediately, then persist the live value.
    void (async () => {
      try {
        const market = exchange === "BSE" ? "BSE" : "NSE";
        const res = await fetch(
          `/api/live-quote?symbol=${encodeURIComponent(`${market}_${symbol}`)}&company=${encodeURIComponent(companyName)}`
        );
        const json = await res.json();
        const livePrice = Number(json?.data?.ltp);
        if (res.ok && json.ok && livePrice > 0) {
          const liveChange = Number(json?.data?.dayChangePerc);
          setHoldings((current) => {
            const refreshed = current.map((holding) => {
              if (holding.id !== newH.id) return holding;
              const previousClose = livePrice / (1 + (liveChange || 0) / 100);
              const dayChange = livePrice - previousClose;
              return {
                ...holding,
                currentPrice: livePrice,
                previousClose,
                dayChange,
                dayChangePercent: liveChange || 0,
                currentValue: sharesNum * livePrice,
                totalPnL: sharesNum * (livePrice - priceNum),
                totalPnLPercent: ((livePrice - priceNum) / priceNum) * 100,
                dayGain: sharesNum * dayChange,
                dayGainPercent: liveChange || 0,
              };
            });
            void syncHoldingsBackground(refreshed);
            return refreshed;
          });
        }
      } catch {
        // The optimistic holding already contains the selected quote.
      }
    })();
    // 4. Sync the optimistic holding immediately in the background.
    void syncHoldingsBackground(updated);
  };

  // Instant CSV Import: closes modal immediately
  const handleImportCsv = async () => {
    setCsvError("");
    if (!csvText.trim()) {
      setCsvError("Paste CSV data or select a valid CSV file.");
      return;
    }

    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const parsed: UserHolding[] = [];
    const resolveCsvSymbol = async (symbol: string) => {
      try {
        const res = await fetch(`/api/portfolio/search?q=${encodeURIComponent(symbol)}`);
        const json = await res.json();
        if (json.ok && Array.isArray(json.data)) {
          const exact = json.data.find((item: StockSearchResult) =>
            item.symbol.toUpperCase() === symbol ||
            item.companyName.toUpperCase().includes(symbol)
          );
          if (exact) return exact;
          return json.data[0] as StockSearchResult | undefined;
        }
      } catch {
        // Keep the CSV row as an unresolved symbol.
      }
      return undefined;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i === 0 && (line.toLowerCase().includes("symbol") || line.toLowerCase().includes("ticker"))) {
        continue;
      }
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length >= 3) {
        const symbol = parts[0].toUpperCase();
        const shares = parseFloat(parts[1]);
        const buyPrice = parseFloat(parts[2]);
        const buyDate = parts[3] || new Date().toISOString().split("T")[0];

        if (symbol && !isNaN(shares) && !isNaN(buyPrice) && shares > 0 && buyPrice > 0) {
          const resolved = await resolveCsvSymbol(symbol);
          const resolvedSymbol = resolved?.symbol || symbol;
          parsed.push({
            id: `hld_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            symbol: resolvedSymbol,
            companyName: resolved?.companyName || symbol,
            exchange: resolved?.exchange || "NSE",
            sector: resolved?.sector || "Equity",
            shares,
            buyPrice,
            buyDate,
            currentPrice: resolved?.price || buyPrice,
            previousClose: resolved?.price || buyPrice,
            dayChange: 0,
            dayChangePercent: resolved?.pChange || 0,
            investedValue: shares * buyPrice,
            currentValue: shares * (resolved?.price || buyPrice),
            totalPnL: shares * ((resolved?.price || buyPrice) - buyPrice),
            totalPnLPercent: ((resolved?.price || buyPrice) - buyPrice) / buyPrice * 100,
            dayGain: 0,
            dayGainPercent: resolved?.pChange || 0,
          });
        }
      }
    }

    if (parsed.length === 0) {
      setCsvError("No valid rows found. Format: Symbol, Shares, BuyPrice, [BuyDate]");
      return;
    }

    const combined = [...holdings, ...parsed];
    // 1. Instantly update UI
    setHoldings(combined);
    // 2. Instantly close modal
    setCsvModalOpen(false);
    setCsvText("");
    // 3. Background non-blocking sync
    void syncHoldingsBackground(combined);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCsvText(event.target?.result as string || "");
      };
      reader.readAsText(file);
    }
  };

  // Instant Delete: closes dialog immediately
  const handleDelete = (id: string) => {
    const updated = holdings.filter((h) => h.id !== id);
    setHoldings(updated);
    setDeleteId(null);
    void syncHoldingsBackground(updated);
  };

  const openAddModal = () => {
    setEditingHolding(null);
    setSelectedStock(null);
    setModalSearch("");
    setFormShares("");
    setFormPrice("");
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormError("");
    setModalOpen(true);
  };

  const openEditModal = (h: UserHolding) => {
    setEditingHolding(h);
    setSelectedStock({
      symbol: h.symbol,
      companyName: h.companyName,
      sector: h.sector,
      exchange: h.exchange,
      price: h.currentPrice,
      pChange: h.dayChangePercent,
    });
    setFormShares(h.shares.toString());
    setFormPrice(h.buyPrice.toString());
    setFormDate(h.buyDate);
    setFormError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingHolding(null);
    setSelectedStock(null);
    setModalSearch("");
    setFormError("");
  };

  // Donut chart calculation
  let accumulatedDash = 0;
  const circumference = 376.99; // 2 * PI * 60

  return (
    <div
      style={{
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
      className="min-h-screen bg-[#F6F7F9] dark:bg-[#0B1220] text-[#0F172A] dark:text-slate-100 antialiased overflow-x-hidden"
    >
      {/* 
        Scaled container matching reference: looks like 90% zoom at 100% zoom, 
        preserving clean spacious margins and alignment 
      */}
      <main
        style={{
          zoom: 0.90,
          width: "111.111%",
          maxWidth: "1440px",
          margin: "0 auto",
          transformOrigin: "top center",
        }}
        className="px-6 sm:px-8 py-8 flex flex-col gap-7 select-none"
      >
        {/* ─── Title & Action Header ─── */}
        <div className="flex justify-between items-end gap-6 flex-wrap">
          <div>
            <h1 className="m-0 text-[32px] font-bold tracking-[-0.025em] leading-[1.15]">
              My Portfolio
            </h1>
            <button
              type="button"
              onClick={() => setShowPurposeDetails(!showPurposeDetails)}
              className="inline-flex items-center gap-1.5 h-7 mt-1 px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 text-xs font-medium cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/60 active:scale-[0.98] transition-all"
            >
              <span>Monitoring, alerts &amp; intelligence telemetry</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showPurposeDetails ? "rotate-180" : ""}`} />
            </button>
          </div>

          <div className="flex gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setRefreshing(true);
                loadPortfolio();
              }}
              className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-xl border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-[#0F172A] dark:text-slate-200 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer shadow-2xs active:scale-[0.98] transition-all"
              title="Refresh quotes"
            >
              <RefreshCw className={`w-4 h-4 text-slate-500 ${refreshing ? "animate-spin text-blue-600" : ""}`} />
            </button>

            <button
              type="button"
              onClick={() => setCsvModalOpen(true)}
              className="inline-flex items-center gap-2 h-11 px-4.5 rounded-xl border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-[#0F172A] dark:text-slate-200 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer shadow-2xs active:scale-[0.98] transition-all"
            >
              <Upload className="w-4 h-4 text-slate-500" />
              <span>Import CSV</span>
            </button>

            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-[#1F5EFF] hover:bg-[#1849A9] text-white text-sm font-semibold cursor-pointer shadow-sm active:scale-[0.98] transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Add holding</span>
            </button>
          </div>
        </div>

        {/* ─── Informative Purpose Banner: Why FinPilot tracks user portfolio ─── */}
        {showPurposeDetails && (
          <div className="bg-white dark:bg-[#111622] border border-blue-200 dark:border-blue-900/60 rounded-2xl p-6 shadow-xs animate-in fade-in duration-100">
            <div className="flex items-start gap-4">
              <span className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-[#1F5EFF] grid place-items-center shrink-0 border border-blue-100 dark:border-blue-900">
                <BellRing className="w-5 h-5" />
              </span>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Why Connect Your Stock Portfolio to FinPilot?
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-4xl">
                  FinPilot is not just a passive tracker. Once your stock holdings are entered, our backend surveillance engine activates continuous real-time monitoring across Indian markets:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 text-xs">
                    <span className="font-semibold text-slate-900 dark:text-white block mb-1 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-blue-600" /> SEBI Compliance
                    </span>
                    Surveillance watch for ASM/GSM, insider trading filings, and regulatory sanctions on your tickers.
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 text-xs">
                    <span className="font-semibold text-slate-900 dark:text-white block mb-1 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-emerald-600" /> Earnings Radar
                    </span>
                    Automated quarterly earnings calendar dates, investor concall highlights, and brokerage revisions.
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 text-xs">
                    <span className="font-semibold text-slate-900 dark:text-white block mb-1 flex items-center gap-1.5">
                      <Newspaper className="w-3.5 h-3.5 text-amber-600" /> Catalyst News
                    </span>
                    Market-moving news filtered strictly for your stocks with AI sentiment score analysis.
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 text-xs">
                    <span className="font-semibold text-slate-900 dark:text-white block mb-1 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-purple-600" /> Cloud Firebase Sync
                    </span>
                    All portfolio records are securely encrypted and linked with your Firebase account credentials.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Top Main Grid: Chart Card & Allocation Donut Card ─── */}
        <div className="flex flex-wrap gap-5 items-stretch">
          {/* Left Card: Value, Range & Dynamic Portfolio Chart */}
          <section className="bg-white dark:bg-[#111622] border border-[#E5E8EE] dark:border-slate-800 rounded-2xl shadow-xs flex-[2_1_600px] min-w-0 p-5 sm:p-6 flex flex-col gap-4">
            {chartHoldings.length === 0 ? (
              <div className="w-full h-[330px] flex flex-col items-center justify-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/30 gap-1 text-center p-6">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  No holdings yet
                </div>
                <p className="text-xs text-slate-500">
                  Add holdings using the button above to display your live portfolio performance curve.
                </p>
              </div>
            ) : (
              <PortfolioChart
                holdings={chartHoldings}
                defaultRange="1D"
                defaultMode="line"
                live
                height={330}
                title={portfolioChartTitle}
              />
            )}

            {/* Metric Strip (4 columns) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-[1px] bg-[#EAECF0] dark:bg-slate-800 border border-[#EAECF0] dark:border-slate-800 rounded-xl overflow-hidden mt-1">
              <div className="bg-white dark:bg-[#111622] p-3.5 sm:px-4">
                <div className="text-xs font-semibold tracking-[0.07em] uppercase text-[#667085] dark:text-slate-400">
                  Invested
                </div>
                <div className="mt-1.5 text-base sm:text-[17px] font-bold tabular-nums text-slate-900 dark:text-white">
                  ₹{summary.totalInvested.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>

              <div className="bg-white dark:bg-[#111622] p-3.5 sm:px-4">
                <div className="text-xs font-semibold tracking-[0.07em] uppercase text-[#667085] dark:text-slate-400">
                  Total P&amp;L
                </div>
                <div
                  className={`mt-1.5 text-base sm:text-[17px] font-bold tabular-nums ${
                    summary.totalPnL >= 0 ? "text-[#067647] dark:text-emerald-400" : "text-[#B42318] dark:text-rose-400"
                  }`}
                >
                  {summary.totalPnL >= 0 ? "+" : ""}₹
                  {Math.abs(summary.totalPnL).toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                  <small className="text-xs font-semibold ml-1.5 opacity-90 tabular-nums">
                    {summary.totalPnLPercent >= 0 ? "+" : ""}
                    {summary.totalPnLPercent.toFixed(2)}%
                  </small>
                </div>
              </div>

              <div className="bg-white dark:bg-[#111622] p-3.5 sm:px-4">
                <div className="text-xs font-semibold tracking-[0.07em] uppercase text-[#667085] dark:text-slate-400">
                  Day’s P&amp;L
                </div>
                <div
                  className={`mt-1.5 text-base sm:text-[17px] font-bold tabular-nums ${
                    summary.totalDayGain >= 0 ? "text-[#067647] dark:text-emerald-400" : "text-[#B42318] dark:text-rose-400"
                  }`}
                >
                  {summary.totalDayGain >= 0 ? "+" : ""}₹
                  {Math.abs(summary.totalDayGain).toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                  <small className="text-xs font-semibold ml-1.5 opacity-90 tabular-nums">
                    {summary.totalDayGainPercent >= 0 ? "+" : ""}
                    {summary.totalDayGainPercent.toFixed(2)}%
                  </small>
                </div>
              </div>

              <div className="bg-white dark:bg-[#111622] p-3.5 sm:px-4">
                <div className="text-xs font-semibold tracking-[0.07em] uppercase text-[#667085] dark:text-slate-400">
                  Holdings
                </div>
                <div className="mt-1.5 text-base sm:text-[17px] font-bold tabular-nums text-slate-900 dark:text-white">
                  {summary.count}
                </div>
              </div>
            </div>
          </section>

          {/* Right Card: Allocation Donut & Highlights */}
          <aside className="bg-white dark:bg-[#111622] border border-[#E5E8EE] dark:border-slate-800 rounded-2xl shadow-xs flex-[1_1_320px] min-w-0 p-6 sm:p-7 flex flex-col gap-4.5">
            <div className="flex justify-between items-baseline">
              <span className="text-xs font-semibold tracking-[0.07em] uppercase text-[#667085] dark:text-slate-400">
                Allocation
              </span>
              <span className="text-xs text-[#667085] dark:text-slate-400">By sector</span>
            </div>

            {/* Circular Donut Chart */}
            <div className="flex justify-center my-1">
              <svg width="180" height="180" viewBox="0 0 160 160">
                <g transform="rotate(-90 80 80)" fill="none" strokeWidth="18">
                  {summary.sectorBreakdown.length === 0 ? (
                    <circle cx="80" cy="80" r="60" stroke="#EAECF0" className="dark:stroke-slate-800" strokeWidth="18" />
                  ) : (
                    summary.sectorBreakdown.map((s, idx) => {
                      const segLen = (s.percentage / 100) * circumference;
                      const offset = -accumulatedDash;
                      accumulatedDash += segLen;
                      return (
                        <circle
                          key={idx}
                          cx="80"
                          cy="80"
                          r="60"
                          stroke={s.color}
                          strokeDasharray={`${segLen.toFixed(2)} ${circumference}`}
                          strokeDashoffset={offset.toFixed(2)}
                          className="transition-all duration-300"
                        />
                      );
                    })
                  )}
                </g>
                <text
                  x="80"
                  y="82"
                  textAnchor="middle"
                  className="font-bold text-[26px] fill-[#0F172A] dark:fill-white font-sans"
                >
                  {summary.count}
                </text>
                <text
                  x="80"
                  y="100"
                  textAnchor="middle"
                  className="text-[11px] fill-[#667085] dark:fill-slate-400 font-sans"
                >
                  Holdings
                </text>
              </svg>
            </div>

            {/* Legend List */}
            <div className="flex flex-col gap-3">
              {summary.sectorBreakdown.length === 0 ? (
                <div className="text-xs text-center text-slate-400 py-3">
                  No sectors recorded yet.
                </div>
              ) : (
                summary.sectorBreakdown.slice(0, 4).map((s, idx) => (
                  <div key={idx} className="flex items-center gap-2.5 text-xs text-[#344054] dark:text-slate-300">
                    <i
                      className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="truncate">{s.sector}</span>
                    <b className="ml-auto font-semibold tabular-nums text-slate-900 dark:text-white">
                      {s.percentage.toFixed(2)}%
                    </b>
                  </div>
                ))
              )}
            </div>

            {/* Best & Worst Performers */}
            <div className="mt-auto border-t border-[#EAECF0] dark:border-slate-800 pt-4 flex flex-col gap-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-[#667085] dark:text-slate-400">Best performer</span>
                {summary.bestPerformer ? (
                  <span>
                    <b className="text-slate-900 dark:text-white mr-1.5">{summary.bestPerformer.symbol}</b>
                    <span
                      className={`font-semibold tabular-nums ${
                        summary.bestPerformer.totalPnLPercent >= 0 ? "text-[#067647]" : "text-[#B42318]"
                      }`}
                    >
                      {summary.bestPerformer.totalPnLPercent >= 0 ? "+" : ""}
                      {summary.bestPerformer.totalPnLPercent.toFixed(2)}%
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </div>

              <div className="flex justify-between items-center">
                <span className="text-[#667085] dark:text-slate-400">Worst performer</span>
                {summary.worstPerformer && summary.worstPerformer.id !== summary.bestPerformer?.id ? (
                  <span>
                    <b className="text-slate-900 dark:text-white mr-1.5">{summary.worstPerformer.symbol}</b>
                    <span
                      className={`font-semibold tabular-nums ${
                        summary.worstPerformer.totalPnLPercent >= 0 ? "text-[#067647]" : "text-[#B42318]"
                      }`}
                    >
                      {summary.worstPerformer.totalPnLPercent >= 0 ? "+" : ""}
                      {summary.worstPerformer.totalPnLPercent.toFixed(2)}%
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </div>
            </div>
          </aside>
        </div>

        {/* ─── Holdings Management Table Card ─── */}
        <section className="bg-white dark:bg-[#111622] border border-[#E5E8EE] dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
          <div className="flex justify-between items-center gap-3 flex-wrap p-5 px-6">
            <h2 className="m-0 text-base font-semibold text-slate-900 dark:text-white">
              Holdings <span className="text-[#667085] dark:text-slate-400 font-normal">· {summary.count}</span>
            </h2>
            <span className="text-xs text-[#667085] dark:text-slate-400">
              Live quotes synced via NSE / BSE data feed
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[1180px]">
              {/* Header row matching reference mockup */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(220px, 2.2fr) 70px 110px 110px 130px 120px 120px 150px 44px",
                  gap: "12px",
                  alignItems: "center",
                  padding: "0 24px",
                  height: "48px",
                  borderTop: "1px solid #EAECF0",
                }}
                className="bg-[#F9FAFB] dark:bg-slate-900/60 text-[11.5px] font-semibold tracking-[0.07em] uppercase text-[#667085] dark:text-slate-400"
              >
                <span>Company</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Avg. cost</span>
                <span className="text-right">LTP</span>
                <span className="text-right">Current value</span>
                <span className="text-right">Weight</span>
                <span className="text-right">Day change</span>
                <span className="text-right">Total P&amp;L</span>
                <span></span>
              </div>

              {/* Minimal Clean Empty State */}
              {holdings.length === 0 ? (
                <div className="py-12 px-6 text-center flex flex-col items-center justify-center gap-2.5 border-t border-[#EAECF0] dark:border-slate-800">
                  <div className="w-10 h-10 rounded-full bg-[#EFF4FF] dark:bg-blue-950/50 text-[#1F5EFF] grid place-items-center">
                    <Plus className="w-5 h-5" />
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Your portfolio is empty
                  </div>
                  <div className="flex gap-2.5 mt-1">
                    <button
                      type="button"
                      onClick={openAddModal}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-[#1F5EFF] hover:bg-[#1849A9] text-white text-xs font-semibold cursor-pointer shadow-2xs active:scale-[0.98] transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add holding</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCsvModalOpen(true)}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer shadow-2xs active:scale-[0.98] transition-all"
                    >
                      <Upload className="w-3.5 h-3.5 text-slate-500" />
                      <span>Import CSV</span>
                    </button>
                  </div>
                </div>
              ) : (
                holdings.map((h) => {
                  const weightPct =
                    summary.totalCurrentValue > 0
                      ? (h.currentValue / summary.totalCurrentValue) * 100
                      : 0;
                  const isDayUp = h.dayChange >= 0;
                  const isTotalUp = h.totalPnL >= 0;

                  return (
                    <div
                      key={h.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(220px, 2.2fr) 70px 110px 110px 130px 120px 120px 150px 44px",
                        gap: "12px",
                        alignItems: "center",
                        minHeight: "68px",
                        padding: "10px 24px",
                        borderTop: "1px solid #EAECF0",
                      }}
                      className="hover:bg-[#F9FAFB] dark:hover:bg-slate-900/40 transition-colors"
                    >
                      {/* Company Avatar & Symbol */}
                      <div className="flex items-center gap-3">
                        <span className="w-9 h-9 rounded-[10px] bg-[#F2F4F7] dark:bg-slate-800 text-[#344054] dark:text-slate-300 text-xs font-bold grid place-items-center shrink-0">
                          {h.symbol.slice(0, 2)}
                        </span>
                        <div>
                          <div className="text-[14.5px] font-bold tracking-[0.01em] text-slate-900 dark:text-white">
                            {h.symbol}
                          </div>
                          <div className="text-xs text-[#667085] dark:text-slate-400 mt-0.5 truncate max-w-[190px]">
                            {h.companyName}
                          </div>
                        </div>
                      </div>

                      {/* Qty */}
                      <div className="text-right text-sm font-medium tabular-nums text-slate-800 dark:text-slate-200">
                        {h.shares}
                      </div>

                      {/* Avg Cost */}
                      <div className="text-right text-sm font-medium tabular-nums text-slate-800 dark:text-slate-200">
                        ₹{h.buyPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>

                      {/* LTP */}
                      <div className="text-right text-sm font-medium tabular-nums text-slate-800 dark:text-slate-200">
                        ₹{h.currentPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>

                      {/* Current Value */}
                      <div className="text-right text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                        ₹{h.currentValue.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>

                      {/* Weight with progress bar */}
                      <div className="text-right">
                        <div className="text-sm font-medium tabular-nums text-slate-800 dark:text-slate-200">
                          {weightPct.toFixed(2)}%
                        </div>
                        <div className="w-16 h-1 bg-[#EAECF0] dark:bg-slate-800 rounded-full mt-1.5 ml-auto overflow-hidden">
                          <i
                            className="block h-full bg-[#1F5EFF] rounded-full"
                            style={{ width: `${Math.min(100, weightPct)}%` }}
                          />
                        </div>
                      </div>

                      {/* Day Change */}
                      <div className="text-right">
                        <div
                          className={`text-sm font-medium tabular-nums ${
                            isDayUp ? "text-[#067647] dark:text-emerald-400" : "text-[#B42318] dark:text-rose-400"
                          }`}
                        >
                          {isDayUp ? "+" : ""}₹
                          {Math.abs(h.dayGain).toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                        <div
                          className={`text-xs tabular-nums mt-0.5 ${
                            isDayUp ? "text-[#067647] dark:text-emerald-400" : "text-[#B42318] dark:text-rose-400"
                          }`}
                        >
                          {isDayUp ? "+" : ""}
                          {h.dayChangePercent.toFixed(2)}%
                        </div>
                      </div>

                      {/* Total P&L */}
                      <div className="text-right">
                        <div
                          className={`text-sm font-semibold tabular-nums ${
                            isTotalUp ? "text-[#067647] dark:text-emerald-400" : "text-[#B42318] dark:text-rose-400"
                          }`}
                        >
                          {isTotalUp ? "+" : ""}₹
                          {Math.abs(h.totalPnL).toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                        <div
                          className={`text-xs tabular-nums mt-0.5 ${
                            isTotalUp ? "text-[#067647] dark:text-emerald-400" : "text-[#B42318] dark:text-rose-400"
                          }`}
                        >
                          {isTotalUp ? "+" : ""}
                          {h.totalPnLPercent.toFixed(2)}%
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(h)}
                          className="w-7 h-7 grid place-items-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all cursor-pointer"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteId(h.id)}
                          className="w-7 h-7 grid place-items-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}


              {/* Full-width Add Holding Row Button (only when holdings exist) */}
              {holdings.length > 0 && (
                <button
                  type="button"
                  onClick={openAddModal}
                  className="flex items-center justify-center gap-2 w-full h-14 border-0 border-t border-[#EAECF0] dark:border-slate-800 bg-white dark:bg-[#111622] text-[#1849A9] dark:text-blue-400 text-sm font-semibold hover:bg-[#EFF4FF] dark:hover:bg-slate-800/80 cursor-pointer active:scale-[0.99] transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add holding</span>
                </button>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* ─── ADD / EDIT HOLDING MODAL ─── */}
      {modalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-2xs animate-in fade-in duration-100"
        >
          <div className="bg-white dark:bg-[#111622] border border-[#E5E8EE] dark:border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingHolding ? "Edit holding" : "Add holding"}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveHolding} className="flex flex-col gap-3.5">
              {!editingHolding && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Stock / Symbol *
                  </label>
                  {!selectedStock ? (
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search stock (e.g. RELIANCE, TCS, INFY)..."
                        value={modalSearch}
                        onChange={(e) => setModalSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:border-[#1F5EFF] font-semibold"
                        autoFocus
                      />

                      {searchResults.length > 0 && (
                        <div className="absolute left-0 right-0 top-full mt-1.5 max-h-48 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-20 divide-y divide-slate-100 dark:divide-slate-800">
                          {searchResults.map((res) => (
                            <button
                              type="button"
                              key={`${res.exchange}:${res.symbol}`}
                              onClick={() => {
                                setSelectedStock(res);
                                setFormPrice(res.price.toString());
                              }}
                              className="w-full px-3 py-2 text-left flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/80 cursor-pointer active:scale-[0.99] transition-all"
                            >
                              <div>
                                <span className="font-bold text-xs text-slate-900 dark:text-white">
                                  {res.symbol}
                                </span>
                                <span className="text-[11px] text-slate-500 ml-2">
                                  {res.companyName}
                                </span>
                              </div>
                              <div className="text-right text-xs font-semibold tabular-nums text-slate-900 dark:text-white">
                                ₹{res.price.toFixed(2)}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white">
                          {selectedStock.symbol}
                        </div>
                        <div className="text-slate-500">{selectedStock.companyName}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold tabular-nums">₹{selectedStock.price.toFixed(2)}</span>
                        <button
                          type="button"
                          onClick={() => setSelectedStock(null)}
                          className="p-1 hover:bg-blue-200/50 rounded cursor-pointer active:scale-95 transition-all"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Quantity (Shares) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="1"
                    placeholder="e.g. 50"
                    value={formShares}
                    onChange={(e) => setFormShares(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:border-[#1F5EFF] tabular-nums font-semibold"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Avg. Purchase Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    placeholder="e.g. 2450.00"
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:border-[#1F5EFF] tabular-nums font-semibold"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Purchase Date
                </label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:border-[#1F5EFF] tabular-nums"
                />
              </div>

              {formShares && formPrice && !isNaN(parseFloat(formShares)) && !isNaN(parseFloat(formPrice)) && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 tabular-nums text-xs flex justify-between">
                  <span className="text-slate-500">Total Investment:</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    ₹{(parseFloat(formShares) * parseFloat(formPrice)).toLocaleString("en-IN", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer active:scale-[0.98] transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!editingHolding && !selectedStock}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-[#1F5EFF] hover:bg-[#1849A9] text-white disabled:opacity-50 cursor-pointer shadow-sm active:scale-[0.98] transition-all"
                >
                  {editingHolding ? "Update" : "Add holding"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── IMPORT CSV MODAL ─── */}
      {csvModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setCsvModalOpen(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-2xs animate-in fade-in duration-100"
        >
          <div className="bg-white dark:bg-[#111622] border border-[#E5E8EE] dark:border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Import Portfolio from CSV
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Upload a CSV file or paste rows: Symbol, Shares, BuyPrice, [BuyDate].
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCsvModalOpen(false)}
                className="w-8 h-8 rounded-lg grid place-items-center text-slate-400 hover:text-slate-600 active:scale-95 transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {csvError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-400">
                {csvError}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <input
                type="file"
                ref={fileInputRef}
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2.5 px-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-[#1F5EFF] text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] transition-all"
              >
                <Upload className="w-4 h-4 text-blue-600" />
                <span>Upload CSV File</span>
              </button>

              <textarea
                rows={5}
                placeholder="Or paste CSV rows here:&#10;RELIANCE, 40, 2450.00, 2024-03-15&#10;TCS, 15, 3520.00, 2024-05-20&#10;HDFCBANK, 60, 1610.00, 2024-02-10"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className="w-full p-3 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl tabular-nums focus:outline-none focus:border-[#1F5EFF]"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setCsvModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 cursor-pointer active:scale-[0.98] transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportCsv}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-[#1F5EFF] hover:bg-[#1849A9] text-white cursor-pointer active:scale-[0.98] transition-all shadow-sm"
              >
                Import Holdings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── DELETE CONFIRMATION ─── */}
      {deleteId && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteId(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-2xs animate-in fade-in duration-100"
        >
          <div className="bg-white dark:bg-[#111622] border border-[#E5E8EE] dark:border-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-xl flex flex-col gap-3.5">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Delete Holding?
            </h3>
            <p className="text-xs text-slate-500">
              Are you sure you want to remove this stock from your portfolio? It will be removed from your Firebase portfolio record.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 cursor-pointer active:scale-[0.98] transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deleteId)}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white cursor-pointer active:scale-[0.98] transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
