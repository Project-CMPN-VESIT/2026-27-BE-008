import React, { useState } from "react";
import { X, Brain, AlertTriangle } from "lucide-react";

type TradingModalProps = {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;
  action: "BUY" | "SELL";
  quantity: number;
  currentPrice: number;
  onExecute: (thesis: string, feedback: string) => void;
};

export default function TradingModal({
  isOpen, onClose, ticker, action, quantity, currentPrice, onExecute
}: TradingModalProps) {
  const [thesis, setThesis] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [evaluated, setEvaluated] = useState(false);

  if (!isOpen) return null;

  const handleAudit = async () => {
    if (!thesis.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/paper-trading/mentor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          quantity,
          ticker,
          userThesis: thesis,
          rkScore: 40,
          plScore: 75
        })
      });
      const data = await res.json();
      if (data.ok) {
        setFeedback(data.critique);
        setEvaluated(true);
      }
    } catch (e) {
      setFeedback("Mentor evaluation failed. Proceed with caution.");
      setEvaluated(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-bold">
            <Brain className="h-5 w-5 text-blue-400" />
            AI Mentor Gatekeeper
          </div>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-slate-800">
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <div className="mb-6 rounded-lg bg-slate-800 p-4">
          <div className="text-sm text-slate-400">Proposed Trade</div>
          <div className="mt-1 text-xl font-semibold">
            <span className={action === "BUY" ? "text-emerald-400" : "text-rose-400"}>{action}</span> {quantity} {ticker}
          </div>
          <div className="mt-1 text-sm text-slate-400">Est. Request Sent Immediately</div>
        </div>

        {!evaluated ? (
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                What is your thesis for this trade?
              </label>
              <textarea
                value={thesis}
                onChange={(e) => setThesis(e.target.value)}
                placeholder="e.g. The company is undervalued due to temporary market overreaction..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200 outline-none focus:border-blue-500"
                rows={3}
              />
            </div>
            <button
              onClick={handleAudit}
              disabled={loading || !thesis.trim()}
              className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {loading ? "Analyzing..." : "Submit to Mentor"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-amber-500">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-semibold">Mentor Critique</span>
              </div>
              <p className="text-sm leading-relaxed text-slate-300">{feedback}</p>
              <p className="text-sm font-semibold text-rose-400 mt-3">— Do you still want to execute this trade?</p>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-slate-600 bg-transparent py-3 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition"
              >
                Cancel Trade
              </button>
              <button
                onClick={() => {
                  onExecute(thesis, feedback);
                  onClose();
                }}
                className="flex-1 rounded-lg bg-rose-600 py-3 text-sm font-semibold text-white hover:bg-rose-700 transition"
              >
                Override & Execute
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
