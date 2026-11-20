"use client";

import React, { useState, useEffect } from "react";
import MentorMarkdown from "@/components/MentorMarkdown";
import { X, Brain, AlertTriangle, Loader2, ArrowUpRight, ArrowDownRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type TradingModalProps = {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;
  initialAction?: "BUY" | "SELL";
  initialQuantity?: number;
  availableCash?: number;
  existingPosition?: { quantity: number; averageBuy: number } | null;
  onExecute: (thesis: string, feedback: string, action: "BUY" | "SELL", quantity: number) => void;
};

export default function TradingModal({
  isOpen,
  onClose,
  ticker,
  initialAction = "BUY",
  initialQuantity = 10,
  availableCash = 957237.6,
  existingPosition = null,
  onExecute,
}: TradingModalProps) {
  const [action, setAction] = useState<"BUY" | "SELL">(initialAction);
  const [quantity, setQuantity] = useState<number>(initialQuantity);
  const [thesis, setThesis] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [evaluated, setEvaluated] = useState(false);
  const [quote, setQuote] = useState<{
    ltp: number;
    dayChange: number;
    dayChangePerc: number;
    company?: string;
  } | null>(null);
  const [isQuoteLoading, setIsQuoteLoading] = useState(true);

  useEffect(() => {
    setAction(initialAction);
  }, [initialAction]);

  useEffect(() => {
    setQuantity(initialQuantity);
  }, [initialQuantity]);

  useEffect(() => {
    if (!isOpen || !ticker) return;

    setQuote(null);
    setIsQuoteLoading(true);
    setEvaluated(false);
    setFeedback("");
    setThesis("");

    let isMounted = true;

    const fetchQuote = async () => {
      try {
        const cleanSymbol = ticker.trim().replace(/^NSE_/, "").replace(/[-&]/g, "_");
        const res = await fetch(`/api/live-quote?symbol=NSE_${cleanSymbol}`);
        const data = await res.json();
        if (isMounted && data.ok && data.data) {
          setQuote({
            ltp: Number(data.data.ltp) || 0,
            dayChange: Number(data.data.dayChange) || 0,
            dayChangePerc: Number(data.data.dayChangePerc) || 0,
            company: data.data.company || cleanSymbol,
          });
        }
      } catch (e) {
        console.error("Failed to fetch live quote:", e);
      } finally {
        if (isMounted) setIsQuoteLoading(false);
      }
    };

    fetchQuote();

    return () => {
      isMounted = false;
    };
  }, [isOpen, ticker]);

  if (!isOpen) return null;

  const currentPrice = quote?.ltp || 0;
  const estimatedTotal = quantity * currentPrice;
  const isPositiveDay = (quote?.dayChange ?? 0) >= 0;

  const isMarketOpen = () => {
    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const day = istTime.getDay();
    if (day === 0 || day === 6) return false;
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const timeInMinutes = hours * 60 + minutes;
    return timeInMinutes >= 9 * 60 + 15 && timeInMinutes <= 15 * 60 + 30;
  };

  const marketOpen = isMarketOpen();

  const handleAudit = async () => {
    if (!thesis.trim()) return;
    setLoading(true);
    try {
      const res = await authenticatedFetch("/api/paper-trading/mentor", {
        method: "POST",
        body: JSON.stringify({
          action,
          quantity,
          ticker,
          userThesis: thesis,
          rkScore: 45,
          plScore: 78,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setFeedback(data.critique);
        setEvaluated(true);
      } else {
        throw new Error(data.error || "Mentor evaluation failed");
      }
    } catch {
      setFeedback(
        "Mentor audit notes: Verify your margin of safety, competitive moat, and risk limits before confirming this order."
      );
      setEvaluated(true);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmOrder = (orderAction: "BUY" | "SELL") => {
    if (!marketOpen) {
      alert("Market is closed. Paper trading is only allowed during Indian market hours (09:15 AM - 03:30 PM IST on weekdays).");
      return;
    }
    onExecute(thesis || "Direct order via search modal", feedback, orderAction, quantity);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-[495px] rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 max-h-[92vh] overflow-y-auto custom-scrollbar font-sans"
        style={{ fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
      >
        {/* Modal Header */}
        <div className="mb-3.5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center font-bold text-sm text-slate-700 dark:text-slate-300">
              {ticker.slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white uppercase tracking-tight">
                  {ticker}
                </h2>
              </div>
              <div className="text-xs text-slate-500 font-medium truncate max-w-[280px]">
                {quote?.company || "NSE Equity"}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Live Market Price & Holdings */}
        <div className="mb-3.5 flex items-center justify-between">
          <div>
            {isQuoteLoading ? (
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Fetching Quote...
              </div>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                  ₹{currentPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span
                  className={`text-xs font-semibold tabular-nums ${
                    isPositiveDay ? "text-emerald-500" : "text-rose-500"
                  }`}
                >
                  {isPositiveDay ? "+" : ""}₹{(quote?.dayChange ?? 0).toFixed(2)} ({(quote?.dayChangePerc ?? 0).toFixed(2)}%)
                </span>
              </div>
            )}
          </div>
          {existingPosition ? (
            <div className="text-right bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 rounded-xl border border-slate-100 dark:border-slate-800">
              <span className="text-[9px] font-bold text-slate-400 uppercase block mb-0.5">Your Holding</span>
              <span className="text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                {existingPosition.quantity} sh
              </span>
            </div>
          ) : null}
        </div>

        {/* Order Quantity */}
        <div className="mb-3.5 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2">
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
            Quantity
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuantity((prev) => Math.max(1, prev - 1))}
              className="w-8 h-8 flex items-center justify-center bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-lg font-bold text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white shadow-sm transition-colors"
            >
              -
            </button>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-16 text-center bg-transparent text-lg font-bold tabular-nums text-slate-900 dark:text-white outline-none"
            />
            <button
              type="button"
              onClick={() => setQuantity((prev) => prev + 1)}
              className="w-8 h-8 flex items-center justify-center bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-lg font-bold text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white shadow-sm transition-colors"
            >
              +
            </button>
          </div>
        </div>

        {/* AI Mentor Thesis Input */}
        {!evaluated ? (
          <div className="mb-3.5">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              <Brain className="w-4 h-4 text-blue-500" />
              Trade Thesis (Optional)
            </label>
            <textarea
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
              placeholder="Why are you making this trade? (e.g. Breakout above resistance...)"
              className="w-full bg-white dark:bg-slate-950 border-2 border-slate-400 dark:border-slate-500 rounded-xl p-3 text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none transition-all shadow-sm"
              rows={3}
            />
          </div>
        ) : (
          <div className="mb-3.5 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-500 uppercase tracking-wider">
              <AlertTriangle className="h-3.5 w-3.5" />
              Mentor Feedback
            </div>
            <div className="max-h-64 overflow-y-auto pr-1 text-amber-900 dark:text-amber-200"><MentorMarkdown text={feedback} /></div>
          </div>
        )}

        {/* Trade Value & Margin */}
        <div className="flex items-center justify-between px-2 mb-4">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Order Value</span>
            <span className="text-base font-bold tabular-nums text-slate-900 dark:text-white">
              ₹{estimatedTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex flex-col text-right">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Available Cash</span>
            <span className="text-base font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              ₹{availableCash.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Market Status Warning */}
        {!marketOpen && (
          <div className="mb-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-400 text-xs font-semibold px-4 py-2 rounded-xl flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Market is closed. Orders will be queued for 09:15 AM IST.
          </div>
        )}

        {/* Action Buttons */}
        {!evaluated && thesis.trim().length > 5 ? (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setAction("BUY");
                handleAudit();
              }}
              disabled={isQuoteLoading || loading}
              className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading && action === "BUY" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              Review Buy
            </button>
            <button
              type="button"
              onClick={() => {
                setAction("SELL");
                handleAudit();
              }}
              disabled={isQuoteLoading || loading || quantity > (existingPosition?.quantity || 0)}
              className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading && action === "SELL" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              Review Sell
            </button>
          </div>
        ) : !evaluated ? (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setAction("BUY");
                handleConfirmOrder("BUY");
              }}
              disabled={isQuoteLoading || !marketOpen}
              className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="h-5 w-5" />
              <span className="tabular-nums">BUY {quantity}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAction("SELL");
                handleConfirmOrder("SELL");
              }}
              disabled={isQuoteLoading || !marketOpen || quantity > (existingPosition?.quantity || 0)}
              className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold shadow-lg shadow-rose-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="h-5 w-5" />
              <span className="tabular-nums">SELL {quantity}</span>
            </button>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setEvaluated(false)}
              className="px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-bold transition-all hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleConfirmOrder(action)}
              disabled={isQuoteLoading}
              className={`flex-1 py-3 rounded-xl text-sm font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                action === "BUY"
                  ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20"
                  : "bg-rose-600 hover:bg-rose-500 shadow-rose-600/20"
              }`}
            >
              <CheckCircle2 className="h-5 w-5" />
              <span className="tabular-nums">Confirm {action} {quantity}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
