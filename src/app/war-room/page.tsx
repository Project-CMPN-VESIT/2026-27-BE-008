"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bot,
  FileText,
  Highlighter,
  Send,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  User,
} from "lucide-react";

interface Citation {
  id: string;
  label: string;
  page: number;
  text: string;
}

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

interface LiveQuote {
  symbol: string;
  company: string;
  ltp: number;
  dayChange?: number;
  dayChangePerc?: number;
  source: "live" | "fallback";
  updatedAt?: string;
}

const starterMessages: Message[] = [
  {
    id: 1,
    role: "assistant",
    content:
      "Welcome to CYRO War Room. Ask for debt risk, valuation stress, governance checks, or filing-based red flags. I will keep every claim source-linked.",
  },
];

const starterSuggestions = [
  "Analyze debt maturity risk for next 12 months",
  "Summarize top 3 governance risks from latest annual report",
  "Create bull vs bear case for this stock",
  "Give me a committee-ready investment verdict with confidence",
];

const cannedCitations: Citation[] = [
  {
    id: "c1",
    label: "AR 2025, Pg 142",
    page: 142,
    text: "Total consolidated borrowings stood at Rs 47,320 Cr with debt-to-equity at 2.14x.",
  },
  {
    id: "c2",
    label: "AR 2025, Pg 267",
    page: 267,
    text: "Auditor Emphasis of Matter highlights reliance on short-term refinancing.",
  },
  {
    id: "c3",
    label: "AR 2025, Pg 271",
    page: 271,
    text: "Commercial paper outstanding is Rs 14,700 Cr maturing within 12 months.",
  },
];

const companySymbolMap: Record<string, string> = {
  "Adani Enterprises Ltd": "NSE_ADANIENT",
  "Reliance Industries Ltd": "NSE_RELIANCE",
  "Infosys Ltd": "NSE_INFY",
  "HDFC Bank Ltd": "NSE_HDFCBANK",
};

const mockAssistantReply = (prompt: string): Message => {
  return {
    id: Date.now(),
    role: "assistant",
    content:
      "Initial stock analysis ready. I see elevated refinancing and leverage concentration risk. Next, I can deep dive into liquidity stress scenarios, covenant sensitivity, or valuation downside if refinancing costs rise.",
    citations: prompt.toLowerCase().includes("debt") || prompt.toLowerCase().includes("risk") ? cannedCitations : [cannedCitations[0]],
  };
};

export default function WarRoomPage() {
  const [messages, setMessages] = useState<Message[]>(starterMessages);
  const [inputValue, setInputValue] = useState("");
  const [company, setCompany] = useState("Adani Enterprises Ltd");
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string>("");

  const canSend = inputValue.trim().length > 0;

  const activeSymbol = companySymbolMap[company] ?? "NSE_ADANIENT";

  useEffect(() => {
    let isMounted = true;

    const loadQuote = async () => {
      try {
        const response = await fetch(`/api/live-quote?symbol=${activeSymbol}&company=${encodeURIComponent(company)}`, {
          cache: "no-store",
        });
        const data = await response.json();

        if (!isMounted) {
          return;
        }

        if (!response.ok || !data.ok) {
          setQuoteError(data.error ?? "Unable to load live quote");
          return;
        }

        setLiveQuote(data.data as LiveQuote);
        setQuoteError("");
      } catch {
        if (isMounted) {
          setQuoteError("Unable to connect to quote service");
        }
      }
    };

    loadQuote();
    const timer = setInterval(loadQuote, 20000);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [activeSymbol, company]);

  const quickStats = useMemo(() => {
    const pct = liveQuote?.dayChangePerc;
    const momentumTone = pct === undefined ? "text-amber-600 dark:text-amber-300" : pct >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300";
    const momentumText = pct === undefined ? "Data pending" : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
    const quoteText = liveQuote?.ltp !== undefined ? `Rs ${liveQuote.ltp.toFixed(2)}` : "Rs --";

    return [
      { label: "Risk Heat", value: "Elevated", icon: ShieldAlert, tone: "text-rose-600 dark:text-rose-300" },
      { label: "Momentum", value: momentumText, icon: TrendingUp, tone: momentumTone },
      { label: "LTP", value: quoteText, icon: BarChart3, tone: "text-sky-600 dark:text-sky-300" },
    ];
  }, [liveQuote]);

  const handleSend = (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;

    const userMessage: Message = {
      id: Date.now() - 1,
      role: "user",
      content: inputValue.trim(),
    };

    const assistantMessage = mockAssistantReply(inputValue.trim());
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInputValue("");
  };

  const applySuggestion = (suggestion: string) => {
    setInputValue(suggestion);
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[linear-gradient(to_bottom,#f8fafc,#f1f5f9_35%,#f8fafc)] dark:bg-[linear-gradient(to_bottom,#020617,#0b1222_35%,#020617)]">
      <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-6">
        <div className="rounded-2xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-950/90">
          <div className="border-b border-slate-200 p-4 dark:border-slate-800 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100 md:text-lg">CYRO War Room Chat</h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Clean analyst chat for stock decision support with source-linked answers</p>
                </div>
              </div>

              <select
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              >
                <option>Adani Enterprises Ltd</option>
                <option>Reliance Industries Ltd</option>
                <option>Infosys Ltd</option>
                <option>HDFC Bank Ltd</option>
              </select>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {quickStats.map((item) => (
                <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                  <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <item.icon className={`h-3.5 w-3.5 ${item.tone}`} />
                    {item.label}
                  </div>
                  <div className={`text-sm font-semibold ${item.tone}`}>{item.value}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              {quoteError
                ? `Quote status: ${quoteError}`
                : liveQuote
                  ? `Quote source: ${liveQuote.source} | Symbol: ${liveQuote.symbol}${liveQuote.updatedAt ? ` | Updated: ${new Date(liveQuote.updatedAt).toLocaleTimeString()}` : ""}`
                  : "Quote status: loading..."}
            </div>
          </div>

          <div className="p-4 md:p-5">
            <div className="mb-3 flex flex-wrap gap-2">
              {starterSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => applySuggestion(suggestion)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition-colors hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-cyan-500/40 dark:hover:text-cyan-300"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <div className="max-h-[56vh] space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-925">
              {messages.map((msg) => (
                <article
                  key={msg.id}
                  className={`rounded-xl border p-3 ${
                    msg.role === "assistant"
                      ? "border-cyan-200 bg-white dark:border-cyan-500/30 dark:bg-slate-900"
                      : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold tracking-wide ${
                        msg.role === "assistant"
                          ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300"
                          : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {msg.role === "assistant" ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                      {msg.role === "assistant" ? "CYRO" : "You"}
                    </span>
                  </div>

                  <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{msg.content}</p>

                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {msg.citations.map((citation) => (
                        <button
                          key={citation.id}
                          onClick={() => setActiveCitation(citation)}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                            activeCitation?.id === citation.id
                              ? "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-500/35 dark:bg-cyan-500/20 dark:text-cyan-300"
                              : "border-slate-200 bg-white text-slate-600 hover:border-cyan-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-cyan-500/40"
                          }`}
                        >
                          <FileText className="h-3 w-3" />
                          {citation.label}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>

            {activeCitation && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  <Highlighter className="h-3.5 w-3.5" />
                  {activeCitation.label}
                </div>
                <p className="text-xs leading-relaxed text-amber-700/90 dark:text-amber-300/90">{activeCitation.text}</p>
              </div>
            )}

            <form onSubmit={handleSend} className="mt-4">
              <div className="rounded-xl border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  rows={3}
                  className="w-full resize-none bg-transparent px-2 py-1 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500"
                  placeholder="Ask CYRO to analyze this stock. Example: Evaluate debt rollover risk and give a buy/hold/sell verdict with confidence."
                />
                <div className="mt-2 flex items-center justify-between px-1">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">Mode: Evidence-first stock analysis</span>
                  <button
                    type="submit"
                    disabled={!canSend}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cyan-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Send
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
