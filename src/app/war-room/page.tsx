"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistentMessages, clearSessionMessages } from "@/hooks/usePersistentMessages";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bell,
  Bookmark,
  ChartColumn,
  ChevronDown,
  Copy,
  Edit3,
  File,
  FileText,
  FileSearch,
  Globe,
  Mic,
  Moon,
  Newspaper,
  Paperclip,
  Plus,
  Search,
  Send,
  Share2,
  Shield,
  Sparkles,
  Sun,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wallet,
} from "lucide-react";

type SourceCitation = {
  agent: string;
  tool_name: string;
  source_type: string;
  label: string;
  input_args: Record<string, unknown>;
  excerpt: string;
  timestamp: string;
};

type AnalystStatus = {
  name: string;
  status: "pending" | "running" | "done" | "error";
  verdict?: string;
  confidence?: number;
  key_points?: string[];
};

type ScorecardData = {
  weighted_total: number;
  verdict: string;
  agreement: number;
  conflicts: string[];
  scores: Record<string, number>;
};

type DebateCard = {
  type: "round" | "rebuttal" | "facilitator";
  round?: number;
  bull?: string;
  bear?: string;
  winner?: string;
  summary?: string;
};

type TradePlan = {
  strategy?: string;
  entry?: string;
  stop_loss?: string;
  target?: string;
  risk_reward?: string;
  position?: string;
};

type CyroMode = "normal" | "reasoning";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  time: string;
  liked?: boolean;
  disliked?: boolean;
  // CYRO-specific fields
  streaming?: boolean;
  signal?: "BUY" | "SELL" | "HOLD" | "STRONG_BUY" | string;
  citations?: SourceCitation[];
  analystStatuses?: AnalystStatus[];
  scorecard?: ScorecardData;
  debateCards?: DebateCard[];
  tradePlans?: Record<string, TradePlan>;
  ragUsed?: boolean;
};

type FiiDiiData = {
  fii_dii_rows?: Array<{ date?: string; fii_net?: number; dii_net?: number }>;
  flow_intel?: Record<string, unknown>;
  market_breadth?: Record<string, unknown>;
  vix?: number | null;
};

type OptionsData = {
  symbol?: string;
  pcr?: number | null;
  pcr_interpretation?: string;
  max_pain?: number | null;
  iv_rank?: number | null;
  iv_interpretation?: string;
};

type RagCheckData = {
  indexed?: boolean;
  fresh?: boolean;
  chunk_count?: number;
  age_hours?: number;
  message?: string;
};

type NewsItem = {
  title: string;
  source: string;
  published_at?: string;
  url?: string;
  summary?: string;
};

type AlertItem = {
  type: "info" | "warn" | "error";
  title: string;
  message: string;
};

type RightPanelLive = {
  fiiDii?: FiiDiiData | null;
  options?: OptionsData | null;
  ragCheck?: RagCheckData | null;
  news?: { news: NewsItem[], announcements: NewsItem[] } | null;
  alerts?: AlertItem[] | null;
  loading?: boolean;
};

const nifty50TickerOptions = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "ITC", "SBIN",
  "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK", "MARUTI", "ASIANPAINT", "BAJFINANCE",
  "HCLTECH", "TITAN", "WIPRO", "NTPC", "POWERGRID", "SUNPHARMA", "ULTRACEMCO",
  "BAJAJFINSV", "NESTLEIND", "TECHM", "M&M", "ADANIENT", "ONGC", "COALINDIA", "JSWSTEEL",
  "GRASIM", "TATASTEEL", "DRREDDY", "DIVISLAB", "CIPLA", "TATAMOTORS", "HINDALCO",
  "APOLLOHOSP", "LTIM", "BPCL", "HEROMOTOCO", "INDUSINDBK", "EICHERMOT", "TATACONSUM",
  "BRITANNIA", "HDFCLIFE", "SBILIFE", "BAJAJ-AUTO", "UPL", "ADANIPORTS"
];

type Session = {
  id: number;
  title: string;
  tag: "Bullish" | "Bearish" | "Neutral";
  time: string;
};

type LiveQuote = {
  symbol: string;
  company: string;
  ltp: number;
  dayChange?: number;
  dayChangePerc?: number;
  source: "live" | "fallback";
  updatedAt?: string;
};

type StockDocData = {
  symbol: string;
  available: boolean;
  summaryText?: string | null;
  pipelineRunAt?: string | null;
  annualReportLinks?: Array<{ year?: string; label?: string; url?: string }>;
  metrics?: {
    peRatio?: number | null;
    pbRatio?: number | null;
    roePct?: number | null;
  };
  counts?: {
    announcements?: number;
    quarterlyRows?: number;
    insiderTrades?: number;
  };
};

const initialSessions: Session[] = [];

const nowTime = () =>
  new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export default function WarRoomPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState("ADANIENT");
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [stockDocData, setStockDocData] = useState<StockDocData | null>(null);
  const [stockDocError, setStockDocError] = useState("");
  // activeSessionId must be declared before usePersistentMessages which uses it
  const [activeSessionId, setActiveSessionId] = useState<number>(1);
  // Session-persistent messages — survives page reloads, keyed by activeSessionId
  const [messages, setMessages] = usePersistentMessages<Message>(activeSessionId, []);
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [sessionFilter, setSessionFilter] = useState("");
  const [input, setInput] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [attachName, setAttachName] = useState("");
  const [activeTab, setActiveTab] = useState<"news" | "alerts" | "flow" | "source">("source");
  const [quickOn, setQuickOn] = useState<Record<string, boolean>>({
    live: false,
    news: false,
    fundamentals: false,
    chart: false,
  });
  const [toastText, setToastText] = useState("");
  const [toastOn, setToastOn] = useState(false);
  // CYRO streaming state
  const [cyroMode, setCyroMode] = useState<CyroMode>("normal");
  const [isStreaming, setIsStreaming] = useState(false);
  // @ mention picker state
  const [atPickerOpen, setAtPickerOpen] = useState(false);
  const [atPickerFilter, setAtPickerFilter] = useState("");
  const [taggedTicker, setTaggedTicker] = useState<string | null>(null);
  // Right panel live data (Week 5)
  const [rightPanel, setRightPanel] = useState<RightPanelLive>({});
  const [selectedSource, setSelectedSource] = useState<SourceCitation | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const msgWrapRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    // Hydrate state from localStorage after initial render to avoid hydration mismatch
    try {
      const rawAct = localStorage.getItem("cyro_active_session");
      if (rawAct) setActiveSessionId(Number(rawAct) || 1);
    } catch {}
    try {
      const rawSess = localStorage.getItem("cyro_sessions");
      const parsedSess = rawSess ? (JSON.parse(rawSess) as Session[]) : null;
      if (Array.isArray(parsedSess) && parsedSess.length > 0) {
        setSessions(parsedSess);
      }
    } catch {}
  }, []);

  // Persist sessions list and active session ID on every change
  useEffect(() => {
    if (!mounted) return;
    try { localStorage.setItem("cyro_sessions", JSON.stringify(sessions)); } catch { /* quota */ }
  }, [sessions, mounted]);

  useEffect(() => {
    if (!mounted) return;
    try { localStorage.setItem("cyro_active_session", String(activeSessionId)); } catch { /* quota */ }
  }, [activeSessionId, mounted]);

  const activeSymbol = `NSE_${selectedTicker}`;


  // ── Week 5: Load right-panel live data whenever ticker changes ──
  useEffect(() => {
    let alive = true;
    setRightPanel({ loading: true });

    const loadRightPanel = async () => {
      try {
        const [fiiRes, optRes, ragRes, newsRes, alertsRes] = await Promise.allSettled([
          fetch(`/api/cyro-market?endpoint=fii-dii&days=5`, { cache: "no-store" }),
          fetch(`/api/cyro-market?endpoint=options&ticker=${selectedTicker}`, { cache: "no-store" }),
          fetch(`/api/cyro-market?endpoint=rag-check&ticker=${selectedTicker}`, { cache: "no-store" }),
          fetch(`/api/cyro-market?endpoint=news&ticker=${selectedTicker}`, { cache: "no-store" }),
          fetch(`/api/cyro-market?endpoint=alerts&ticker=${selectedTicker}`, { cache: "no-store" }),
        ]);

        if (!alive) return;

        const fiiData = fiiRes.status === "fulfilled" && fiiRes.value.ok
          ? (await fiiRes.value.json()).data as FiiDiiData
          : null;
        const optData = optRes.status === "fulfilled" && optRes.value.ok
          ? (await optRes.value.json()).data as OptionsData
          : null;
        const ragData = ragRes.status === "fulfilled" && ragRes.value.ok
          ? (await ragRes.value.json()).data as RagCheckData
          : null;
        const newsData = newsRes.status === "fulfilled" && newsRes.value.ok
          ? (await newsRes.value.json()).data as { news: NewsItem[], announcements: NewsItem[] }
          : null;
        const alertsData = alertsRes.status === "fulfilled" && alertsRes.value.ok
          ? (await alertsRes.value.json()).data.alerts as AlertItem[]
          : null;

        setRightPanel({ fiiDii: fiiData, options: optData, ragCheck: ragData, news: newsData, alerts: alertsData, loading: false });
      } catch {
        if (alive) setRightPanel({ loading: false });
      }
    };

    loadRightPanel();
    // Refresh every 60s
    const t = setInterval(loadRightPanel, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [selectedTicker]);

  // ── @ mention picker filter ────────────────────────────────────
  const filteredAtOptions = useMemo(() =>
    atPickerFilter
      ? nifty50TickerOptions.filter(t => t.toLowerCase().includes(atPickerFilter.toLowerCase())).slice(0, 8)
      : nifty50TickerOptions.slice(0, 12),
  [atPickerFilter]);

  const handleInputChange = (val: string) => {
    setInput(val);
    // Detect @ trigger
    const lastAt = val.lastIndexOf("@");
    if (lastAt !== -1) {
      const query = val.slice(lastAt + 1);
      setAtPickerFilter(query);
      setAtPickerOpen(true);
    } else {
      setAtPickerOpen(false);
      setAtPickerFilter("");
    }
  };

  const selectAtTicker = (ticker: string) => {
    // Replace the @... fragment at the end of input with @TICKER
    const lastAt = input.lastIndexOf("@");
    const newInput = lastAt !== -1
      ? input.slice(0, lastAt) + `@${ticker} `
      : input + `@${ticker} `;
    setInput(newInput);
    setTaggedTicker(ticker);
    setSelectedTicker(ticker);
    setAtPickerOpen(false);
    setAtPickerFilter("");
    inputRef.current?.focus();
  };

  useEffect(() => {
    let alive = true;
    let inFlight = false;

    const loadQuote = async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;

      try {
        const response = await fetch(`/api/live-quote?symbol=${activeSymbol}&company=${encodeURIComponent(selectedTicker)}&_ts=${Date.now()}`, {
          cache: "no-store",
        });
        const data = await response.json();

        if (!alive) return;

        if (!response.ok || !data.ok) {
          setQuoteError(data.error ?? "Unable to load quote");
          return;
        }

        setQuote(data.data as LiveQuote);
        setQuoteError("");
      } catch {
        if (alive) setQuoteError("Unable to connect to quote service");
      } finally {
        inFlight = false;
      }
    };

    loadQuote();
    const timer = setInterval(loadQuote, 1000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [activeSymbol, selectedTicker]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    const loadStockDocData = async () => {
      try {
        const response = await fetch(`/api/stock-docs?symbol=${encodeURIComponent(activeSymbol)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();

        if (!alive) {
          return;
        }

        if (!response.ok || !payload.ok) {
          setStockDocData(null);
          setStockDocError(payload.error ?? "Unable to load doc data");
          return;
        }

        setStockDocData((payload.data ?? null) as StockDocData | null);
        setStockDocError("");
      } catch {
        if (!alive) {
          return;
        }
        setStockDocData(null);
        setStockDocError("Unable to connect to doc data service");
      }
    };

    setStockDocData(null);
    loadStockDocData();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [activeSymbol]);

  useEffect(() => {
    if (!msgWrapRef.current) return;
    msgWrapRef.current.scrollTop = msgWrapRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = (msg: string) => {
    setToastText(msg);
    setToastOn(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastOn(false), 2000);
  };

  const filteredSessions = useMemo(() => {
    if (!sessionFilter.trim()) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(sessionFilter.toLowerCase()));
  }, [sessions, sessionFilter]);

  const sendMsg = useCallback((e?: FormEvent) => {
    if (e) e.preventDefault();
    const txt = input.trim();
    if (!txt || isStreaming) return;

    // Close any existing stream
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const userMsgId = Date.now();
    const aiMsgId = userMsgId + 1;

    const userMsg: Message = { id: userMsgId, role: "user", text: txt, time: nowTime() };
    const aiMsg: Message = {
      id: aiMsgId,
      role: "assistant",
      text: "",
      time: nowTime(),
      streaming: true,
      citations: [],
      analystStatuses: cyroMode === "reasoning"
        ? ["TechnicalAnalyst","FundamentalAnalyst","OptionsAnalyst",
           "NewsMacroAnalyst","SentimentAnalyst","SectorRotationAnalyst","RiskManager"]
            .map(n => ({ name: n, status: "pending" as const }))
        : [],
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    // Auto-update session title from first user message (only if still default)
    setSessions((prev) => prev.map((s) =>
      s.id === activeSessionId && messages.filter(m => m.role === "user").length === 0
        ? { ...s, title: txt.slice(0, 50) }
        : s
    ));

    setInput("");
    setAttachName("");
    setTaggedTicker(null);

    setIsStreaming(true);

    let finalTicker = taggedTicker;
    // Extract @TICKER manually from text if user typed it without selecting from dropdown
    const atMatch = txt.match(/@([A-Za-z0-9_]+)/);
    if (atMatch) {
      finalTicker = atMatch[1].toUpperCase();
      setSelectedTicker(finalTicker);
    }
    
    const params = new URLSearchParams({
      message: txt,
      mode: cyroMode,
      session_id: String(activeSessionId),
      ...(finalTicker ? { ticker: finalTicker } : selectedTicker ? { ticker: selectedTicker } : {}),
    });
    const url = `/api/cyro-chat?${params.toString()}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as Record<string, unknown>;
        const type = event.type as string;

        if (type === "ticker_resolved") {
          // Update selected ticker if backend resolved a different one
          const resolved = event.ticker as string;
          if (resolved && resolved !== "NIFTY") setSelectedTicker(resolved);
        }

        else if (type === "analyst_start") {
          const analyst = event.analyst as string;
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiMsgId) return m;
            const statuses = (m.analystStatuses ?? []).map((s) =>
              s.name === analyst ? { ...s, status: "running" as const } : s
            );
            return { ...m, analystStatuses: statuses, text: m.text || `🔍 Analysing ${analyst}...` };
          }));
        }

        else if (type === "analyst_done") {
          const analyst = event.analyst as string;
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiMsgId) return m;
            const statuses = (m.analystStatuses ?? []).map((s) =>
              s.name === analyst
                ? { ...s, status: "done" as const, verdict: event.verdict as string, confidence: event.confidence as number }
                : s
            );
            return { ...m, analystStatuses: statuses };
          }));
        }

        else if (type === "source_captured") {
          const citation = event.citation as SourceCitation;
          setMessages((prev) => prev.map((m) =>
            m.id === aiMsgId
              ? { ...m, citations: [...(m.citations ?? []), citation] }
              : m
          ));
        }

        else if (type === "phase") {
          const phase = event.phase as string;
          const label = phase === "debate" ? "⚔️ Bull vs Bear debate..." :
                        phase === "synthesis" ? "🧠 Synthesising final decision..." :
                        `📊 ${phase}...`;
          setMessages((prev) => prev.map((m) =>
            m.id === aiMsgId ? { ...m, text: label } : m
          ));
        }

        else if (type === "scorecard") {
          const sc = event as unknown as ScorecardData;
          setMessages((prev) => prev.map((m) =>
            m.id === aiMsgId ? { ...m, scorecard: sc } : m
          ));
        }

        else if (type === "debate_token") {
          const step = event.step as string;
          const token = event.token as string;
          
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiMsgId) return m;
            
            const currentCards = m.debateCards ?? [];
            let updatedCards = [...currentCards];
            
            if (step === "bull_r1" || step === "bear_r1") {
              let r1Card = updatedCards.find(c => c.type === "round" && c.round === 1);
              if (!r1Card) {
                r1Card = { type: "round", round: 1, bull: "", bear: "" };
                updatedCards.push(r1Card);
              }
              if (step === "bull_r1") r1Card.bull = (r1Card.bull || "") + token;
              if (step === "bear_r1") r1Card.bear = (r1Card.bear || "") + token;
            } 
            else if (step === "bull_r2" || step === "bear_r2") {
              let r2Card = updatedCards.find(c => c.type === "rebuttal" && c.round === 2);
              if (!r2Card) {
                r2Card = { type: "rebuttal", round: 2, bull: "", bear: "" };
                updatedCards.push(r2Card);
              }
              if (step === "bull_r2") r2Card.bull = (r2Card.bull || "") + token;
              if (step === "bear_r2") r2Card.bear = (r2Card.bear || "") + token;
            }
            else if (step === "facilitator") {
              let facCard = updatedCards.find(c => c.type === "facilitator");
              if (!facCard) {
                facCard = { type: "facilitator", summary: "", winner: "" };
                updatedCards.push(facCard);
              }
              facCard.summary = (facCard.summary || "") + token;
              if (facCard.summary.toUpperCase().includes("WINNER: BULL")) facCard.winner = "BULL";
              else if (facCard.summary.toUpperCase().includes("WINNER: BEAR")) facCard.winner = "BEAR";
            }
            
            return { ...m, debateCards: updatedCards, text: m.text || "⚔️ Bull vs Bear debate underway..." };
          }));
        }

        else if (type === "final_decision") {
          const signal = (event.signal as string) ?? "HOLD";
          const summary = (event.summary as string) ?? "";
          const sources = (event.sources_used as SourceCitation[]) ?? [];
          const tradePlans = (event.trade_plans as Record<string, TradePlan>) ?? {};
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiMsgId) return m;
            return {
              ...m,
              text: summary,
              signal,
              streaming: false,
              citations: [...(m.citations ?? []), ...sources],
              tradePlans,
              ragUsed: !!(event.rag_used),
            };
          }));
        }

        else if (type === "error") {
          const errMsg = (event.message as string) ?? "Unknown error";
          setMessages((prev) => prev.map((m) => {
            if (m.id !== aiMsgId) return m;
            
            const isBrokerError = errMsg.includes("401") || errMsg.toLowerCase().includes("unauthorized") || errMsg.toLowerCase().includes("fyers");
            
            return {
              ...m,
              text: isBrokerError 
                ? `❌ **Broker Connection Failed**\n\nThe CYRO engine encountered an authentication error with your broker. This usually happens when your access token has expired. Please click the **Broker Settings** button in the sidebar to re-authenticate.\n\n_Technical details: ${errMsg}_`
                : `❌ ${errMsg}`,
              streaming: false
            };
          }));
          setIsStreaming(false);
          es.close();
        }

        else if (type === "done") {
          setIsStreaming(false);
          setMessages((prev) => prev.map((m) =>
            m.id === aiMsgId ? { ...m, streaming: false } : m
          ));
          es.close();
          esRef.current = null;
        }
      } catch {
        // Ignore malformed events
      }
    };

    es.onerror = () => {
      setIsStreaming(false);
      setMessages((prev) => prev.map((m) =>
        m.id === aiMsgId && m.streaming
          ? { ...m, text: m.text || "Connection to CYRO backend lost. Is india-trade-cli running on port 8765?", streaming: false }
          : m
      ));
      es.close();
      esRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isStreaming, cyroMode, selectedTicker, activeSessionId]);

  const copyMessage = async (id: number) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg) return;
    try {
      await navigator.clipboard.writeText(msg.text);
      showToast("Copied");
    } catch {
      showToast("Unable to copy");
    }
  };

  const deleteMessage = (id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    showToast("Message deleted");
  };

  const editMessage = (id: number) => {
    const msg = messages.find((m) => m.id === id && m.role === "user");
    if (!msg) return;
    setInput(msg.text);
    setMessages((prev) => prev.filter((m) => m.id !== id));
    showToast("Message moved to editor");
  };

  const regenerateLastAssistant = () => {
    const lastAssistantIndex = [...messages].reverse().findIndex((m) => m.role === "assistant");
    if (lastAssistantIndex === -1) return;
    const actualIndex = messages.length - 1 - lastAssistantIndex;
    const base = messages[actualIndex - 1];

    setMessages((prev) => {
      const next = [...prev];
      next.splice(actualIndex, 1);
      next.push({
        id: Date.now(),
        role: "assistant",
        text: `Regenerated response for: ${base?.text ?? "latest query"}. Updated brief can include valuation bands, risk map, catalysts, and position sizing notes.`,
        time: nowTime(),
      });
      return next;
    });

    showToast("Response regenerated");
  };

  const rateMessage = (id: number, positive: boolean) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              liked: positive,
              disliked: !positive,
            }
          : m,
      ),
    );
    showToast(positive ? "Marked helpful" : "Feedback noted");
  };

  const newChat = () => {
    // Clear stored history for the current session before switching
    clearSessionMessages(activeSessionId);
    setMessages([]);
    const id = Date.now();
    const next: Session = {
      id,
      title: "New research session",
      tag: "Neutral",
      time: "now",
    };
    setSessions((prev) => [next, ...prev]);
    setActiveSessionId(id);
    showToast("New research session");
  };

  const onAttach = () => fileRef.current?.click();

  const onFileChange = (file?: File | null) => {
    if (!file) return;
    setAttachName(file.name);
    showToast("Attachment added");
  };

  const onExport = () => {
    if (!messages.length) {
      showToast("No messages to export");
      return;
    }
    const lines = messages.map((m) => `${m.role.toUpperCase()} (${m.time})\n${m.text}\n`).join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cyro-chat-export.txt";
    a.click();
    showToast("Chat exported");
  };

  const onCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Link copied");
    } catch {
      showToast("Unable to copy link");
    }
  };

  const latestAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");
  const latestSources = latestAssistantMsg?.citations || [];

  const visibleTheme = mounted ? (resolvedTheme === "dark" ? "dark" : "light") : "light";
  const priceUp = (quote?.dayChangePerc ?? 0) >= 0;

  return (
    <div className="cyro-page" data-theme={visibleTheme}>
      <div id="toast" className={toastOn ? "on" : ""}>
        {toastText}
      </div>

      <div className="shell">
        <aside className="sidebar">
          <div className="sb-head">
            <div className="sb-brand">
              <span className="sb-brand-name">CYRO AI</span>
              <span className="sb-brand-badge">PRO</span>
            </div>
            <button className="new-chat-btn" onClick={newChat}>
              <Plus size={14} />
              New Research
            </button>
          </div>

          <div className="wl-block">
            <div className="wl-top">
              <span className="block-label">Live Quote</span>
              <button className="wl-add-btn" onClick={() => showToast("Add watch item")}>+
              </button>
            </div>
            <div className="wl-chip-wrap">
              <div className={`wl-chip ${priceUp ? "up" : "dn"}`}>
                {quote?.symbol ?? "NSE_ADANIENT"}
                <span>{quote?.dayChangePerc !== undefined ? `${priceUp ? "+" : ""}${quote.dayChangePerc.toFixed(2)}%` : "--"}</span>
              </div>
            </div>
          </div>

          <div className="sb-search">
            <div className="sf">
              <Search size={13} />
              <input
                value={sessionFilter}
                onChange={(e) => setSessionFilter(e.target.value)}
                placeholder="Search sessions..."
              />
            </div>
          </div>

          <div className="chat-list">
            {filteredSessions.map((s) => (
              <button
                key={s.id}
                className={`ci ${activeSessionId === s.id ? "on" : ""}`}
                onClick={() => setActiveSessionId(s.id)}
              >
                <div className={`ci-dot ${s.tag === "Bullish" ? "bull" : s.tag === "Bearish" ? "bear" : "neut"}`} />
                <div className="ci-body">
                  <div className="ci-title">{s.title}</div>
                  <div className="ci-sub">{s.tag} · {s.time}</div>
                </div>
                <span
                  className="xbtn"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    clearSessionMessages(s.id);
                    setSessions((prev) => prev.filter((x) => x.id !== s.id));
                    showToast("Session removed");
                  }}
                >
                  <Trash2 size={11} />
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="chat-main">
          <div className="topbar">
            <div className="tb-l">
              <div className="live-ticker">
                <span className="dot" />
                <span className="sym">{quote?.symbol ?? "NSE_ADANIENT"}</span>
                <span className="price">{quote?.ltp ? `Rs ${quote.ltp.toFixed(2)}` : "--"}</span>
                <span className={`chg ${priceUp ? "up" : "dn"}`}>
                  {quote?.dayChangePerc !== undefined ? `${priceUp ? "+" : ""}${quote.dayChangePerc.toFixed(2)}%` : "--"}
                </span>
              </div>
              <div className="model-pill" onClick={() => showToast("Model switched")}>CYRO Analyst <ChevronDown size={12} /></div>
              <select
                value={selectedTicker}
                onChange={(e) => setSelectedTicker(e.target.value)}
                className="company-picker"
              >
                {nifty50TickerOptions.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <div className="tb-r">
              <button className="tb-btn" onClick={() => showToast("Search chat")}
              ><Search size={15} /></button>
              <button className="tb-btn" onClick={onExport}><File size={15} /></button>
              <button className="tb-btn" onClick={onCopyLink}><Share2 size={15} /></button>
              <button className="tb-btn" onClick={() => showToast("Notifications")}><Bell size={15} /></button>
              <button
                className="tb-btn"
                onClick={() => setTheme(visibleTheme === "dark" ? "light" : "dark")}
                aria-label="Toggle theme"
              >
                {visibleTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
              </button>
            </div>
          </div>

          <div className="messages" ref={msgWrapRef}>
            {messages.length === 0 ? (
              <div className="empty-state">Conversation is empty. Start with the input below.</div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`msg-row ${msg.role === "user" ? "user-row" : ""}`}>
                  <div className={`msg-av ${msg.role === "assistant" ? "ai-av" : "u-av"}`}>
                    {msg.role === "assistant" ? <span className="av-mark av-cy">CY</span> : <span className="av-mark av-you">YU</span>}
                  </div>
                  <div className="msg-col">
                    <div className="msg-sender">
                      {msg.role === "assistant" ? "CYRO" : "You"} · {msg.time}
                      {msg.signal && (
                        <span className={`signal-badge signal-${msg.signal.toLowerCase()}`}>
                          {msg.signal.replace("_", " ")}
                        </span>
                      )}
                      {msg.streaming && <span className="streaming-dot">●</span>}
                    </div>

                    {/* Analyst progress pills (reasoning mode) */}
                    {msg.analystStatuses && msg.analystStatuses.length > 0 && (
                      <div className="analyst-pills">
                        {msg.analystStatuses.map((s) => (
                          <span key={s.name} className={`a-pill a-pill-${s.status}`} title={s.verdict ? `${s.verdict} (${s.confidence}%)` : s.name}>
                            {s.name.replace("Analyst", "").replace("Manager", " Mgr")}
                            {s.status === "done" && s.verdict && (
                              <span className={`a-pill-verdict ${s.verdict?.toLowerCase()}`}> {s.verdict}</span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className={`bubble markdown-content ${msg.role === "assistant" ? "ai-bubble" : "user-bubble"}`}>
                      {msg.text ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.text}
                        </ReactMarkdown>
                      ) : (msg.streaming ? <span className="thinking">Thinking...</span> : "")}
                    </div>

                    {/* Source Citation Cards */}
                    {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
                      <div className="citations">
                        <div className="cite-label">Sources used ({msg.citations.length})</div>
                        <div className="cite-list">
                          {msg.citations.slice(0, 6).map((c, i) => (
                            <div key={i} className="cite-card" onClick={() => { setSelectedSource(c); setActiveTab("source"); }}>
                              <div className="cite-agent">{c.agent}</div>
                              <div className="cite-source">{c.label}</div>
                              {c.excerpt && <div className="cite-excerpt">{c.excerpt.slice(0, 120)}…</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Scorecard (reasoning mode) */}
                    {msg.role === "assistant" && msg.scorecard && (
                      <div className="scorecard-card">
                        <div className="sc-header">
                          <span className="sc-title">📊 Scorecard</span>
                          <span className={`sc-verdict sc-${msg.scorecard.verdict.toLowerCase()}`}>{msg.scorecard.verdict}</span>
                          <span className="sc-agree">{msg.scorecard.agreement.toFixed(0)}% agreement</span>
                        </div>
                        <div className="sc-scores">
                          {Object.entries(msg.scorecard.scores).map(([name, score]) => (
                            <div key={name} className="sc-row">
                              <span className="sc-name">{name}</span>
                              <div className="sc-bar-wrap">
                                <div className={`sc-bar ${score > 0 ? "bull" : score < 0 ? "bear" : "neut"}`}
                                  style={{ width: `${Math.min(Math.abs(score), 100)}%` }} />
                              </div>
                              <span className={`sc-val ${score > 0 ? "pos" : score < 0 ? "neg" : ""}`}>{score > 0 ? "+" : ""}{score.toFixed(0)}</span>
                            </div>
                          ))}
                        </div>
                        {msg.scorecard.conflicts.length > 0 && (
                          <div className="sc-conflicts">⚠️ {msg.scorecard.conflicts.join(" | ")}</div>
                        )}
                      </div>
                    )}

                    {/* Debate Cards (reasoning mode) */}
                    {msg.role === "assistant" && msg.debateCards && msg.debateCards.length > 0 && (
                      <div className="debate-section">
                        {msg.debateCards.map((card, i) => (
                          <div key={i} className={`debate-card dc-${card.type}`}>
                            {card.type === "round" && (
                              <>
                                <div className="dc-label">⚔️ Bull vs Bear — Round {card.round}</div>
                                <div className="dc-row">
                                  <div className="dc-side bull">
                                    <div className="dc-side-label">🟢 Bull</div>
                                    <div className="dc-text">{card.bull}</div>
                                  </div>
                                  <div className="dc-side bear">
                                    <div className="dc-side-label">🔴 Bear</div>
                                    <div className="dc-text">{card.bear}</div>
                                  </div>
                                </div>
                              </>
                            )}
                            {card.type === "rebuttal" && (
                              <>
                                <div className="dc-label">🔄 Rebuttals — Round {card.round}</div>
                                <div className="dc-row">
                                  <div className="dc-side bull"><div className="dc-side-label">Bull Rebuttal</div><div className="dc-text">{card.bull}</div></div>
                                  <div className="dc-side bear"><div className="dc-side-label">Bear Rebuttal</div><div className="dc-text">{card.bear}</div></div>
                                </div>
                              </>
                            )}
                            {card.type === "facilitator" && (
                              <>
                                <div className="dc-label">⚖️ Facilitator Summary — Winner: <strong>{card.winner}</strong></div>
                                <div className="dc-text">{card.summary}</div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Trade Plans (reasoning mode final decision) */}
                    {msg.role === "assistant" && msg.tradePlans && Object.keys(msg.tradePlans).length > 0 && (
                      <div className="trade-plans">
                        <div className="tp-label">💼 Trade Plans</div>
                        <div className="tp-grid">
                          {Object.entries(msg.tradePlans).map(([key, plan]) => plan && (
                            <div key={key} className="tp-card">
                              <div className="tp-profile">{key}</div>
                              {plan.strategy && <div className="tp-row"><span>Strategy</span><span>{plan.strategy}</span></div>}
                              {plan.entry && <div className="tp-row"><span>Entry</span><span>{plan.entry}</span></div>}
                              {plan.stop_loss && <div className="tp-row"><span>Stop</span><span className="neg">{plan.stop_loss}</span></div>}
                              {plan.target && <div className="tp-row"><span>Target</span><span className="pos">{plan.target}</span></div>}
                              {plan.risk_reward && <div className="tp-row"><span>R:R</span><span>{plan.risk_reward}</span></div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className={`msg-foot ${msg.role === "assistant" ? "assistant-foot" : "user-foot"}`}>
                      {msg.role === "assistant" ? (
                        <div className="m-acts assistant">
                          <button className="act-btn" onClick={() => copyMessage(msg.id)} title="Copy"><Copy size={11} /></button>
                          <button className={`act-btn ${msg.liked ? "liked" : ""}`} onClick={() => rateMessage(msg.id, true)} title="Helpful"><ThumbsUp size={11} /></button>
                          <button className={`act-btn ${msg.disliked ? "disliked" : ""}`} onClick={() => rateMessage(msg.id, false)} title="Not helpful"><ThumbsDown size={11} /></button>
                          <button className="act-btn" onClick={regenerateLastAssistant} title="Regenerate"><RefreshCw size={11} /></button>
                        </div>
                      ) : (
                        <div className="m-acts user">
                          <button className="act-btn" onClick={() => copyMessage(msg.id)} title="Copy"><Copy size={11} /></button>
                          <button className="act-btn" onClick={() => editMessage(msg.id)} title="Edit"><Edit3 size={11} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <form className="input-area" onSubmit={sendMsg}>
            <div className="quick-bar">
              {/* Mode toggle */}
              <button
                type="button"
                className={`q-pill mode-pill ${cyroMode === "normal" ? "on" : ""}`}
                onClick={() => setCyroMode("normal")}
                title="Normal mode: fast single-analyst research (~15s)"
              >
                ⚡ Normal
              </button>
              <button
                type="button"
                className={`q-pill mode-pill ${cyroMode === "reasoning" ? "on reasoning" : ""}`}
                onClick={() => setCyroMode("reasoning")}
                title="Reasoning mode: 7 analysts + debate (~3min)"
              >
                🧠 Deep
              </button>
              <div className="q-divider" />
              <button
                type="button"
                className={`q-pill ${quickOn.live ? "on" : ""}`}
                onClick={() => setQuickOn((p) => ({ ...p, live: !p.live }))}
              >
                <Globe size={11} /> Live Data
              </button>
              <button
                type="button"
                className={`q-pill ${quickOn.news ? "on" : ""}`}
                onClick={() => setQuickOn((p) => ({ ...p, news: !p.news }))}
              >
                <Newspaper size={11} /> News
              </button>
              <button
                type="button"
                className={`q-pill ${quickOn.fundamentals ? "on" : ""}`}
                onClick={() => setQuickOn((p) => ({ ...p, fundamentals: !p.fundamentals }))}
              >
                <Wallet size={11} /> Fundamentals
              </button>
              <button
                type="button"
                className={`q-pill ${quickOn.chart ? "on" : ""}`}
                onClick={() => setQuickOn((p) => ({ ...p, chart: !p.chart }))}
              >
                <ChartColumn size={11} /> Chart
              </button>
              <button type="button" className="q-pill" onClick={onAttach}><Paperclip size={11} /> Attach</button>
              <button type="button" className="q-pill" onClick={() => showToast("Screener module")}><FileSearch size={11} /> Screener</button>
            </div>

            {attachName ? <div className="att-prev">{attachName}</div> : null}

            {/* @ mention picker dropdown */}
            {atPickerOpen && (
              <div className="at-picker">
                <div className="at-picker-hint">@ Tag a stock</div>
                {filteredAtOptions.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="at-item"
                    onMouseDown={(e) => { e.preventDefault(); selectAtTicker(t); }}
                  >
                    <span className="at-sym">{t}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="input-shell">
              <button type="button" className="in-left" onClick={onAttach}>
                <Plus size={18} />
              </button>
              <input
                ref={inputRef}
                className="msg-inp"
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setAtPickerOpen(false); return; }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!atPickerOpen) sendMsg();
                  }
                }}
                placeholder="Ask CYRO about a stock... (type @ to tag a ticker)"
              />
              <div className="inp-right">
                {isStreaming && (
                  <button
                    type="button"
                    className="r-btn stop-btn"
                    title="Stop"
                    onClick={() => {
                      esRef.current?.close();
                      esRef.current = null;
                      setIsStreaming(false);
                      showToast("Stopped");
                    }}
                  >
                    ■
                  </button>
                )}
                <button
                  type="button"
                  className={`r-btn ${micOn ? "rec" : ""}`}
                  onClick={() => {
                    setMicOn((p) => !p);
                    showToast(!micOn ? "Listening..." : "Mic stopped");
                  }}
                ><Mic size={15} /></button>
                <button type="submit" disabled={isStreaming} className={`send-btn ${input.trim() && !isStreaming ? "" : "off"}`}><Send size={14} /></button>
              </div>
            </div>

            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={(e) => {
                onFileChange(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
            />
          </form>
        </main>

        <aside className="rpanel">
          <div className="rp-tabs">
            <button className={`rp-tab ${activeTab === "source" ? "on" : ""}`} onClick={() => setActiveTab("source")}>Source</button>
            <button className={`rp-tab ${activeTab === "flow" ? "on" : ""}`} onClick={() => setActiveTab("flow")}>Flow</button>
            <button className={`rp-tab ${activeTab === "news" ? "on" : ""}`} onClick={() => setActiveTab("news")}>News</button>
            <button className={`rp-tab ${activeTab === "alerts" ? "on" : ""}`} onClick={() => setActiveTab("alerts")}>Alerts</button>
          </div>
          <div className="rp-body">


            {/* Week 5: Flow Intelligence Tab */}
            {activeTab === "flow" ? (
              <>
                {rightPanel.loading && <div className="txt">Loading flow data…</div>}
                {/* VIX */}
                {rightPanel.fiiDii?.vix != null && (
                  <div className="card">
                    <div className="lbl">🌡️ India VIX</div>
                    <div className="val">{rightPanel.fiiDii.vix.toFixed(2)}</div>
                  </div>
                )}
                {/* FII/DII last 3 rows */}
                {(rightPanel.fiiDii?.fii_dii_rows ?? []).slice(0, 3).map((row, i) => (
                  <div key={i} className="card">
                    <div className="lbl">📊 FII/DII {row.date ?? ""}</div>
                    <div className="txt">
                      FII: <span className={`${(row.fii_net ?? 0) > 0 ? "pos" : "neg"}`}>{(row.fii_net ?? 0) > 0 ? "+" : ""}{row.fii_net?.toFixed(0)} Cr</span>
                      {" · "}
                      DII: <span className={`${(row.dii_net ?? 0) > 0 ? "pos" : "neg"}`}>{(row.dii_net ?? 0) > 0 ? "+" : ""}{row.dii_net?.toFixed(0)} Cr</span>
                    </div>
                  </div>
                ))}
                {/* Options data */}
                {rightPanel.options && (
                  <div className="card">
                    <div className="lbl">📈 Options — {selectedTicker}</div>
                    <div className="txt">
                      PCR: <strong>{rightPanel.options.pcr?.toFixed(2) ?? "--"}</strong> · {rightPanel.options.pcr_interpretation}
                    </div>
                    {rightPanel.options.max_pain != null && (
                      <div className="txt">Max Pain: Rs {rightPanel.options.max_pain.toFixed(2)}</div>
                    )}
                    {rightPanel.options.iv_rank != null && (
                      <div className="txt">IV Rank: {rightPanel.options.iv_rank} — {rightPanel.options.iv_interpretation}</div>
                    )}
                  </div>
                )}
                {!rightPanel.loading && !rightPanel.fiiDii && (
                  <div className="txt">Flow data unavailable (CYRO backend offline?)</div>
                )}
              </>
            ) : null}
            {activeTab === "alerts" ? (
              <>
                {rightPanel.loading && <div className="txt">Loading alerts…</div>}
                {rightPanel.alerts && rightPanel.alerts.length > 0 ? (
                  rightPanel.alerts.map((alert, i) => (
                    <div key={i} className={`card ${alert.type === 'warn' ? 'warn' : 'info'}`}>
                      <div className="lbl">
                        {alert.type === 'warn' ? <Bell size={12} /> : <Shield size={12} />} {alert.title}
                      </div>
                      <div className="txt">{alert.message}</div>
                    </div>
                  ))
                ) : (
                  !rightPanel.loading && <div className="txt">No active alerts for {selectedTicker}.</div>
                )}
              </>
            ) : null}
            {activeTab === "news" ? (
              <>
                {rightPanel.loading && <div className="txt">Loading news…</div>}
                {rightPanel.news?.announcements && rightPanel.news.announcements.length > 0 && (
                  <div className="card">
                    <div className="lbl">📣 Recent Announcements</div>
                    {rightPanel.news.announcements.map((a, i) => (
                      <div key={i} className="src-item" style={{ cursor: "default", border: "none", padding: "4px 0", background: "transparent" }}>
                        <strong style={{color: "var(--text-1)"}}>{a.title}</strong>
                        {a.summary && <div className="txt" style={{marginTop: "2px"}}>{a.summary}</div>}
                        <div className="txt" style={{fontSize: "9px", color: "var(--text-3)"}}>{a.published_at}</div>
                      </div>
                    ))}
                  </div>
                )}
                {rightPanel.news?.news && rightPanel.news.news.length > 0 && (
                  <div className="card">
                    <div className="lbl"><Newspaper size={12} /> Latest News</div>
                    {rightPanel.news.news.map((n, i) => (
                      <a key={i} href={n.url || "#"} target="_blank" rel="noreferrer" className="src-item" style={{ display: "block", cursor: n.url ? "pointer" : "default" }}>
                        <strong style={{color: "var(--text-1)"}}>{n.title}</strong>
                        {n.summary && <div className="txt" style={{marginTop: "2px"}}>{n.summary}</div>}
                        <div className="txt" style={{fontSize: "9px", color: "var(--text-3)", marginTop: "4px"}}>{n.source} {n.published_at ? `· ${n.published_at}` : ""}</div>
                      </a>
                    ))}
                  </div>
                )}
                {!rightPanel.loading && !rightPanel.news?.news?.length && !rightPanel.news?.announcements?.length && (
                  <div className="txt">No recent news or announcements found.</div>
                )}
              </>
            ) : null}
            {activeTab === "source" ? (
              <>
                {selectedSource ? (
                  <div className="card">
                    <div className="lbl"><FileText size={12} /> Source Details</div>
                    <div className="txt"><strong>Agent:</strong> {selectedSource.agent}</div>
                    <div className="txt"><strong>Tool:</strong> {selectedSource.tool_name}</div>
                    <div className="txt"><strong>Type:</strong> {selectedSource.source_type}</div>
                    <div className="txt"><strong>Label:</strong> {selectedSource.label}</div>
                    {selectedSource.input_args && Object.keys(selectedSource.input_args).length > 0 && (
                      <div className="txt">
                        <strong>Input Args:</strong>
                        <pre style={{ background: 'var(--bg-surface)', padding: '6px', borderRadius: '4px', fontSize: '10px', overflowX: 'auto', marginTop: '4px' }}>
                          {JSON.stringify(selectedSource.input_args, null, 2)}
                        </pre>
                      </div>
                    )}
                    {selectedSource.excerpt && (
                      <div className="txt">
                        <strong>Excerpt:</strong>
                        <div style={{ marginTop: '4px', padding: '6px', background: 'var(--bg-surface)', borderRadius: '4px', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', fontSize: '11px' }}>
                          {selectedSource.excerpt}
                        </div>
                      </div>
                    )}
                    {selectedSource.timestamp && (
                      <div className="txt" style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '8px' }}>
                        Retrieved at: {selectedSource.timestamp}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="txt" style={{ marginBottom: '10px' }}>Click on a source snippet in the chat to view complete details here.</div>
                )}

                <div className="card src">
                  <div className="lbl"><FileText size={12} /> Source Snippets</div>
                  {latestSources.length > 0 ? (
                    latestSources.map((c, i) => (
                      <div key={i} className="src-item" onClick={() => setSelectedSource(c)}>
                        <strong>{c.agent}</strong> | {c.label}
                        <div className="txt" style={{ marginTop: '4px', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', fontSize: '10px', color: 'var(--text-3)' }}>
                          {c.excerpt ? c.excerpt.slice(0, 150) + "..." : "No excerpt available"}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="txt">No source snippets used in the latest response.</div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </aside>
      </div>

      <style jsx>{`
        .cyro-page {
          height: calc(100vh - 56px);
          overflow: hidden;
          font-family: Manrope, sans-serif;
        }
        .cyro-page * {
          box-sizing: border-box;
        }
        .cyro-page [data-theme="dark"],
        .cyro-page[data-theme="dark"] {
          --bg-base: #080c14;
          --bg-surface: #0c1220;
          --bg-raised: #111827;
          --bg-hover: #161e2e;
          --bg-active: #1a2438;
          --bg-input: #0e1624;
          --border-faint: #1a2438;
          --border-mid: #1e2d47;
          --text-1: #f0f4ff;
          --text-2: #8b9dc8;
          --text-3: #4a5880;
          --accent: #3b82f6;
          --accent-dim: rgba(59, 130, 246, 0.12);
          --green: #10b981;
          --red: #ef4444;
        }
        .cyro-page [data-theme="light"],
        .cyro-page[data-theme="light"] {
          --bg-base: #f4f6fb;
          --bg-surface: #ffffff;
          --bg-raised: #f8fafd;
          --bg-hover: #f0f4fa;
          --bg-active: #e8eef8;
          --bg-input: #ffffff;
          --border-faint: #e2e8f2;
          --border-mid: #d0daea;
          --text-1: #0f1729;
          --text-2: #3d5278;
          --text-3: #7a90b8;
          --accent: #2563eb;
          --accent-dim: rgba(37, 99, 235, 0.1);
          --green: #059669;
          --red: #dc2626;
        }
        .shell {
          display: grid;
          grid-template-columns: 250px 1fr 290px;
          height: 100%;
          background: var(--bg-base);
          color: var(--text-1);
        }
        .sidebar,
        .chat-main,
        .rpanel {
          min-height: 0;
        }
        .sidebar {
          border-right: 1px solid var(--border-faint);
          background: var(--bg-surface);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .sb-head {
          padding: 14px;
          border-bottom: 1px solid var(--border-faint);
        }
        .sb-brand {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }
        .sb-brand-name {
          font-size: 14px;
          font-weight: 800;
        }
        .sb-brand-badge {
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 8px;
          background: var(--accent-dim);
          color: var(--accent);
          border: 1px solid var(--border-mid);
        }
        .new-chat-btn {
          width: 100%;
          border: none;
          border-radius: 9px;
          background: var(--accent);
          color: #fff;
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: center;
          padding: 9px 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }
        .wl-block,
        .sb-search {
          padding: 10px 14px;
          border-bottom: 1px solid var(--border-faint);
        }
        .wl-top {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .block-label {
          font-size: 10px;
          color: var(--text-3);
          text-transform: uppercase;
          font-weight: 700;
        }
        .wl-add-btn {
          border: none;
          background: transparent;
          color: var(--text-3);
          cursor: pointer;
        }
        .wl-chip-wrap {
          display: flex;
        }
        .wl-chip {
          font-size: 11px;
          border-radius: 14px;
          padding: 5px 9px;
          font-weight: 700;
          display: inline-flex;
          gap: 6px;
          align-items: center;
        }
        .wl-chip.up {
          color: var(--green);
          background: rgba(16, 185, 129, 0.12);
        }
        .wl-chip.dn {
          color: var(--red);
          background: rgba(239, 68, 68, 0.12);
        }
        .sf {
          border: 1px solid var(--border-faint);
          border-radius: 8px;
          padding: 7px 9px;
          display: flex;
          gap: 7px;
          align-items: center;
          color: var(--text-3);
          background: var(--bg-input);
        }
        .sf input {
          width: 100%;
          border: none;
          background: transparent;
          outline: none;
          color: var(--text-1);
          font-size: 12px;
        }
        .chat-list {
          flex: 1;
          overflow: auto;
          padding: 8px;
        }
        .ci {
          width: 100%;
          border: none;
          background: transparent;
          text-align: left;
          border-radius: 8px;
          display: flex;
          gap: 8px;
          padding: 9px;
          margin-bottom: 6px;
          cursor: pointer;
          color: var(--text-2);
        }
        .ci:hover,
        .ci.on {
          background: var(--bg-hover);
        }
        .ci-dot {
          width: 8px;
          height: 8px;
          margin-top: 5px;
          border-radius: 999px;
          flex-shrink: 0;
        }
        .ci-dot.bull { background: var(--green); }
        .ci-dot.bear { background: var(--red); }
        .ci-dot.neut { background: #f59e0b; }
        .ci-body { flex: 1; min-width: 0; }
        .ci-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-1);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ci-sub {
          font-size: 10px;
          color: var(--text-3);
          margin-top: 3px;
        }
        .xbtn {
          color: var(--text-3);
          cursor: pointer;
          align-self: start;
          padding: 2px;
        }
        .chat-main {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--bg-base);
        }
        .topbar {
          border-bottom: 1px solid var(--border-faint);
          background: var(--bg-surface);
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          gap: 10px;
        }
        .tb-l,
        .tb-r {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .live-ticker,
        .model-pill {
          border: 1px solid var(--border-faint);
          background: var(--bg-raised);
          border-radius: 9px;
          padding: 6px 9px;
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 12px;
          color: var(--text-2);
        }
        .company-picker {
          border: 1px solid var(--border-faint);
          background: var(--bg-raised);
          color: var(--text-2);
          border-radius: 9px;
          padding: 6px 9px;
          font-size: 12px;
          max-width: 240px;
          outline: none;
        }
        .sym,
        .price {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px;
        }
        .sym { color: var(--text-1); font-weight: 700; }
        .chg.up { color: var(--green); }
        .chg.dn { color: var(--red); }
        .dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: var(--green);
        }
        .tb-btn {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: var(--text-2);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .tb-btn:hover {
          background: var(--bg-hover);
        }
        .messages {
          flex: 1;
          overflow: auto;
          padding: 16px 0;
        }
        .empty-state {
          margin: 10px auto;
          width: min(760px, calc(100% - 28px));
          border: 1px dashed var(--border-mid);
          border-radius: 12px;
          background: var(--bg-surface);
          color: var(--text-3);
          font-size: 13px;
          text-align: center;
          padding: 20px;
        }
        .msg-row {
          display: flex;
          gap: 10px;
          width: min(760px, calc(100% - 28px));
          margin: 0 auto 10px;
        }
        .msg-row.user-row {
          flex-direction: row-reverse;
        }
        .msg-av {
          width: 30px;
          height: 30px;
          border-radius: 999px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          border: 1px solid rgba(148, 163, 184, 0.25);
        }
        .ai-av { background: radial-gradient(circle at 25% 20%, #67e8f9 0%, #3b82f6 45%, #1e3a8a 100%); }
        .u-av { background: radial-gradient(circle at 20% 20%, #fde68a 0%, #fb7185 45%, #7c3aed 100%); }
        .av-mark {
          font-size: 9px;
          line-height: 1;
          font-weight: 800;
          letter-spacing: 0.04em;
          color: #ffffff;
          text-shadow: 0 1px 2px rgba(15, 23, 42, 0.45);
          transform: translateY(0.2px);
        }
        .av-cy {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .av-you {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .msg-col { max-width: 80%; }
        .msg-sender { font-size: 11px; color: var(--text-3); margin-bottom: 3px; }
        .bubble {
          border-radius: 14px;
          padding: 11px 13px;
          font-size: 13px;
          line-height: 1.6;
          border: 1px solid var(--border-faint);
          white-space: pre-wrap;
        }
        .ai-bubble {
          background: transparent;
          color: var(--text-1);
          border: none;
          padding: 2px 0;
          border-radius: 0;
        }
        .markdown-content {
          white-space: normal;
          word-break: break-word;
        }
        .markdown-content p {
          margin: 0 0 0.75rem 0;
        }
        .markdown-content p:last-child {
          margin-bottom: 0;
        }
        .markdown-content ul,
        .markdown-content ol {
          margin: 0 0 0.75rem 0;
          padding-left: 1.25rem;
        }
        .markdown-content li {
          margin-bottom: 0.25rem;
        }
        .markdown-content li > p {
          margin: 0;
        }
        .markdown-content h1,
        .markdown-content h2,
        .markdown-content h3 {
          margin: 1.25rem 0 0.5rem 0;
          font-weight: 700;
          line-height: 1.3;
        }
        .markdown-content h1:first-child,
        .markdown-content h2:first-child,
        .markdown-content h3:first-child {
          margin-top: 0;
        }
        .markdown-content code {
          background: var(--bg-raised);
          padding: 2px 4px;
          border-radius: 4px;
          font-family: ui-monospace, monospace;
          font-size: 0.9em;
        }
        .user-bubble {
          background: var(--accent);
          color: #fff;
          border-color: transparent;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1);
        }
        .msg-foot {
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 20px;
        }
        .msg-foot.user-foot {
          justify-content: flex-end;
        }
        .m-acts {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .m-acts.user {
          visibility: hidden;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.15s ease;
        }
        .msg-row.user-row:hover .m-acts.user {
          visibility: visible;
          opacity: 1;
          pointer-events: auto;
        }
        .act-btn {
          width: 20px;
          height: 20px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--text-3);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0.8;
        }
        .act-btn:hover {
          color: var(--text-1);
          opacity: 1;
          background: transparent;
        }
        .act-btn.liked {
          color: var(--green);
          opacity: 1;
        }
        .act-btn.disliked {
          color: var(--red);
          opacity: 1;
        }
        .input-area {
          border-top: none;
          background: transparent;
          padding: 8px 14px 10px;
        }
        .quick-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 8px;
        }
        .q-pill {
          border: 1px solid var(--border-faint);
          background: transparent;
          color: var(--text-2);
          border-radius: 14px;
          padding: 4px 9px;
          font-size: 11px;
          font-weight: 600;
          display: inline-flex;
          gap: 5px;
          align-items: center;
          cursor: pointer;
        }
        .q-pill.on,
        .q-pill:hover {
          background: var(--accent-dim);
          color: var(--accent);
          border-color: var(--border-mid);
        }
        .q-divider {
          width: 1px;
          height: 16px;
          background: var(--border-faint);
          margin: 0 2px;
          align-self: center;
        }
        .mode-pill {
          font-weight: 700;
          letter-spacing: 0.01em;
        }
        .mode-pill.on.reasoning {
          background: rgba(139, 92, 246, 0.15);
          color: #a78bfa;
          border-color: rgba(139, 92, 246, 0.3);
        }
        /* BUY/SELL/HOLD signal badge */
        .signal-badge {
          display: inline-block;
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          vertical-align: middle;
        }
        .signal-buy, .signal-strong_buy { background: rgba(16,185,129,0.15); color: #10b981; }
        .signal-sell { background: rgba(239,68,68,0.15); color: #ef4444; }
        .signal-hold { background: rgba(234,179,8,0.15); color: #eab308; }
        /* Streaming indicator */
        .streaming-dot {
          display: inline-block;
          margin-left: 6px;
          color: var(--accent);
          animation: pulse 1.2s infinite;
          font-size: 8px;
          vertical-align: middle;
        }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        .thinking { color: var(--text-3); font-style: italic; font-size: 13px; }
        /* Stop button */
        .stop-btn {
          font-size: 12px;
          background: rgba(239,68,68,0.12) !important;
          color: #ef4444 !important;
          border: 1px solid rgba(239,68,68,0.25) !important;
        }
        /* Analyst progress pills */
        .analyst-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin: 6px 0 4px;
        }
        .a-pill {
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 10px;
          font-weight: 600;
          border: 1px solid var(--border-faint);
          background: var(--bg-raised);
          color: var(--text-3);
          transition: all 0.2s;
        }
        .a-pill-running {
          border-color: var(--accent);
          color: var(--accent);
          background: var(--accent-dim);
          animation: pulse 1.5s infinite;
        }
        .a-pill-done {
          border-color: rgba(16,185,129,0.3);
          background: rgba(16,185,129,0.08);
          color: #10b981;
        }
        .a-pill-error {
          border-color: rgba(239,68,68,0.3);
          color: #ef4444;
        }
        .a-pill-verdict { font-size: 9px; opacity: 0.85; }
        /* Citation cards */
        .citations {
          margin-top: 8px;
          border-top: 1px solid var(--border-faint);
          padding-top: 8px;
        }
        .cite-label {
          font-size: 9px;
          color: var(--text-3);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 6px;
        }
        .cite-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .cite-card {
          background: var(--bg-raised);
          border: 1px solid var(--border-faint);
          border-radius: 7px;
          padding: 5px 8px;
          max-width: 220px;
          min-width: 120px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .cite-card:hover {
          background: var(--bg-hover);
          border-color: var(--border-mid);
        }
        .cite-agent {
          font-size: 9px;
          color: var(--accent);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .cite-source {
          font-size: 10px;
          color: var(--text-2);
          font-weight: 600;
          margin-top: 1px;
        }
        .cite-excerpt {
          font-size: 9px;
          color: var(--text-3);
          margin-top: 3px;
          line-height: 1.4;
          font-family: ui-monospace, monospace;
        }
        .att-prev {
          border: 1px solid var(--border-faint);
          background: var(--bg-raised);
          border-radius: 8px;
          padding: 7px 10px;
          font-size: 12px;
          color: var(--text-2);
          margin-bottom: 7px;
        }
        .input-shell {
          border: 1px solid var(--border-mid);
          background: var(--bg-surface);
          border-radius: 999px;
          padding: 8px 10px;
          display: flex;
          gap: 8px;
          align-items: center;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
        }
        .in-left {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 999px;
          background: transparent;
          color: var(--text-1);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .in-left:hover {
          background: var(--bg-hover);
        }
        .msg-inp {
          width: 100%;
          border: none;
          background: transparent;
          color: var(--text-1);
          font-size: 16px;
          outline: none;
          height: 34px;
          line-height: 34px;
        }
        .msg-inp::placeholder {
          color: var(--text-3);
        }
        .inp-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .r-btn,
        .send-btn {
          width: 36px;
          height: 36px;
          border: none;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .r-btn {
          color: var(--text-3);
          background: transparent;
        }
        .r-btn:hover { background: var(--bg-hover); }
        .r-btn.rec { color: var(--red); }
        .send-btn {
          background: #0b0b0b;
          color: #fff;
        }
        .send-btn.off {
          background: #d6dbe8;
          color: #94a3b8;
        }
        .rpanel {
          border-left: 1px solid var(--border-faint);
          background: var(--bg-surface);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .rp-tabs {
          border-bottom: 1px solid var(--border-faint);
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          background: var(--bg-raised);
        }
        .rp-tab {
          border: none;
          background: transparent;
          color: var(--text-3);
          font-size: 11px;
          font-weight: 700;
          padding: 10px 4px;
          cursor: pointer;
        }
        .rp-tab.on {
          color: var(--accent);
          border-bottom: 2px solid var(--accent);
        }
        .rp-body {
          flex: 1;
          overflow: auto;
          padding: 11px;
        }
        .card {
          border: 1px solid var(--border-faint);
          background: var(--bg-raised);
          border-radius: 10px;
          padding: 10px;
          margin-bottom: 8px;
        }
        .card.big .val {
          font-size: 20px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          color: var(--text-1);
          font-weight: 700;
          margin-top: 5px;
        }
        .lbl {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-3);
          text-transform: uppercase;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          letter-spacing: 0.08em;
        }
        .txt {
          margin-top: 6px;
          font-size: 12px;
          line-height: 1.45;
          color: var(--text-2);
        }
        .warn {
          border-color: rgba(239, 68, 68, 0.25);
          background: rgba(239, 68, 68, 0.08);
        }
        .info {
          border-color: rgba(16, 185, 129, 0.25);
          background: rgba(16, 185, 129, 0.08);
        }
        .src-item {
          width: 100%;
          border: 1px solid var(--border-faint);
          background: var(--bg-surface);
          color: var(--text-2);
          border-radius: 7px;
          padding: 7px 8px;
          text-align: left;
          font-size: 11px;
          margin-top: 6px;
          cursor: pointer;
        }
        .src-item:hover {
          border-color: var(--border-mid);
        }
        #toast {
          position: fixed;
          left: 50%;
          bottom: 20px;
          transform: translateX(-50%) translateY(44px);
          opacity: 0;
          pointer-events: none;
          background: var(--bg-raised);
          border: 1px solid var(--border-mid);
          color: var(--text-1);
          border-radius: 20px;
          padding: 8px 14px;
          font-size: 12px;
          z-index: 90;
          transition: all 0.2s ease;
        }
        #toast.on {
          transform: translateX(-50%) translateY(0);
          opacity: 1;
        }
        @media (max-width: 1380px) {
          .shell { grid-template-columns: 250px 1fr; }
          .rpanel { display: none; }
        }
        @media (max-width: 1024px) {
          .shell { grid-template-columns: 1fr; }
          .sidebar {
            display: none;
          }
        }

        /* ─ @ mention picker ──────────────────────────────────── */
        .at-picker {
          position: absolute;
          bottom: 100%;
          left: 0;
          right: 0;
          margin-bottom: 4px;
          background: var(--bg-surface);
          border: 1px solid var(--border-mid);
          border-radius: 12px;
          padding: 6px;
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          z-index: 20;
          box-shadow: 0 4px 24px rgba(0,0,0,0.18);
          max-height: 140px;
          overflow-y: auto;
        }
        .at-picker-hint {
          width: 100%;
          font-size: 10px;
          color: var(--text-3);
          padding: 2px 4px 4px;
          border-bottom: 1px solid var(--border-faint);
          margin-bottom: 2px;
        }
        .at-item {
          background: var(--bg-raised);
          border: 1px solid var(--border-faint);
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 600;
          color: var(--accent);
          cursor: pointer;
          transition: background 0.15s;
        }
        .at-item:hover {
          background: var(--accent-dim);
          border-color: var(--accent);
        }
        .input-area {
          position: relative;
        }

        /* ─ Scorecard card ────────────────────────────────────── */
        .scorecard-card {
          margin-top: 10px;
          background: var(--bg-raised);
          border: 1px solid var(--border-mid);
          border-radius: 12px;
          padding: 12px;
        }
        .sc-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }
        .sc-title { font-size: 12px; font-weight: 600; color: var(--text-1); }
        .sc-verdict {
          font-size: 10px;
          font-weight: 700;
          border-radius: 4px;
          padding: 2px 6px;
          text-transform: uppercase;
        }
        .sc-verdict.sc-strong_buy, .sc-verdict.sc-buy { background: rgba(16,185,129,0.15); color: var(--green); }
        .sc-verdict.sc-sell, .sc-verdict.sc-strong_sell { background: rgba(239,68,68,0.15); color: var(--red); }
        .sc-verdict.sc-hold { background: rgba(139,157,200,0.15); color: var(--text-2); }
        .sc-agree { margin-left: auto; font-size: 10px; color: var(--text-3); }
        .sc-scores { display: flex; flex-direction: column; gap: 5px; }
        .sc-row { display: flex; align-items: center; gap: 6px; font-size: 11px; }
        .sc-name { width: 120px; color: var(--text-2); flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sc-bar-wrap { flex: 1; background: var(--bg-surface); border-radius: 4px; height: 5px; overflow: hidden; }
        .sc-bar { height: 100%; border-radius: 4px; transition: width 0.4s ease; }
        .sc-bar.bull { background: var(--green); }
        .sc-bar.bear { background: var(--red); }
        .sc-bar.neut { background: var(--text-3); }
        .sc-val { width: 28px; text-align: right; font-weight: 600; flex-shrink: 0; }
        .sc-conflicts { margin-top: 8px; font-size: 10px; color: var(--red); background: rgba(239,68,68,0.08); border-radius: 6px; padding: 4px 8px; }

        /* ─ Debate cards ──────────────────────────────────────── */
        .debate-section { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
        .debate-card {
          background: var(--bg-raised);
          border: 1px solid var(--border-mid);
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 12px;
        }
        .dc-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-2);
          margin-bottom: 8px;
        }
        .dc-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .dc-side { background: var(--bg-surface); border-radius: 8px; padding: 8px; border: 1px solid var(--border-faint); }
        .dc-side.bull { border-color: rgba(16,185,129,0.25); }
        .dc-side.bear { border-color: rgba(239,68,68,0.25); }
        .dc-side-label { font-size: 10px; font-weight: 700; margin-bottom: 4px; color: var(--text-3); }
        .dc-side.bull .dc-side-label { color: var(--green); }
        .dc-side.bear .dc-side-label { color: var(--red); }
        .dc-text { font-size: 11px; line-height: 1.5; color: var(--text-2); }
        .dc-facilitator .dc-text { font-size: 11px; line-height: 1.6; color: var(--text-1); }

        /* ─ Trade plans grid ──────────────────────────────────── */
        .trade-plans { margin-top: 10px; }
        .tp-label { font-size: 11px; font-weight: 600; color: var(--text-2); margin-bottom: 8px; }
        .tp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .tp-card {
          background: var(--bg-raised);
          border: 1px solid var(--border-mid);
          border-radius: 10px;
          padding: 8px;
          font-size: 11px;
        }
        .tp-profile {
          font-weight: 700;
          color: var(--accent);
          font-size: 10px;
          text-transform: uppercase;
          margin-bottom: 6px;
          border-bottom: 1px solid var(--border-faint);
          padding-bottom: 4px;
        }
        .tp-row { display: flex; justify-content: space-between; gap: 4px; margin-top: 3px; color: var(--text-2); }
        .tp-row span:first-child { color: var(--text-3); }
        .pos { color: var(--green); }
        .neg { color: var(--red); }

        /* ─ Right panel action button ─────────────────────────── */
        .rp-action-btn {
          margin-top: 6px;
          width: 100%;
          padding: 6px;
          font-size: 11px;
          border-radius: 7px;
          border: 1px solid var(--accent);
          background: var(--accent-dim);
          color: var(--accent);
          cursor: pointer;
          transition: background 0.15s;
        }
        .rp-action-btn:hover { background: var(--accent); color: #fff; }
      `}</style>
    </div>
  );
}