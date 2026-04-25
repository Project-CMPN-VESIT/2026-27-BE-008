"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
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

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  time: string;
  liked?: boolean;
  disliked?: boolean;
};

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

const nifty50TickerOptions = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "HINDUNILVR", "ITC", "SBIN",
  "BHARTIARTL", "KOTAKBANK", "LT", "AXISBANK", "MARUTI", "ASIANPAINT", "BAJFINANCE",
  "HCLTECH", "TITAN", "WIPRO", "NTPC", "POWERGRID", "SUNPHARMA", "ULTRACEMCO",
  "BAJAJFINSV", "NESTLEIND", "TECHM", "M&M", "ADANIENT", "ONGC", "COALINDIA", "JSWSTEEL",
  "GRASIM", "TATASTEEL", "DRREDDY", "DIVISLAB", "CIPLA", "TATAMOTORS", "HINDALCO",
  "APOLLOHOSP", "LTIM", "BPCL", "HEROMOTOCO", "INDUSINDBK", "EICHERMOT", "TATACONSUM",
  "BRITANNIA", "HDFCLIFE", "SBILIFE", "BAJAJ-AUTO", "UPL", "ADANIPORTS"
];

const initialSessions: Session[] = [
  { id: 1, title: "Adani leverage and covenant risk", tag: "Bearish", time: "2h ago" },
  { id: 2, title: "Infosys margin durability", tag: "Neutral", time: "5h ago" },
  { id: 3, title: "Reliance growth drivers", tag: "Bullish", time: "1d ago" },
];

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<Session[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState<number>(1);
  const [sessionFilter, setSessionFilter] = useState("");
  const [input, setInput] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [attachName, setAttachName] = useState("");
  const [activeTab, setActiveTab] = useState<"portfolio" | "news" | "alerts">("portfolio");
  const [quickOn, setQuickOn] = useState<Record<string, boolean>>({
    live: false,
    news: false,
    fundamentals: false,
    chart: false,
  });
  const [toastText, setToastText] = useState("");
  const [toastOn, setToastOn] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const msgWrapRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeSymbol = `NSE_${selectedTicker}`;

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

  const sendMsg = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const txt = input.trim();
    if (!txt) return;

    const userMsg: Message = {
      id: Date.now(),
      role: "user",
      text: txt,
      time: nowTime(),
    };

    const aiMsg: Message = {
      id: Date.now() + 1,
      role: "assistant",
      text: "Received. I can now generate a full research brief with valuation, catalysts, risks, and BUY/HOLD/SELL logic for this request.",
      time: nowTime(),
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput("");
    setAttachName("");
  };

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
                    <div className="msg-sender">{msg.role === "assistant" ? "CYRO" : "You"} · {msg.time}</div>
                    <div className={`bubble ${msg.role === "assistant" ? "ai-bubble" : "user-bubble"}`}>{msg.text}</div>
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

            <div className="input-shell">
              <button type="button" className="in-left" onClick={onAttach}>
                <Plus size={18} />
              </button>
              <input
                className="msg-inp"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendMsg();
                  }
                }}
                placeholder="Ask CYRO about a stock..."
              />
              <div className="inp-right">
                <button
                  type="button"
                  className={`r-btn ${micOn ? "rec" : ""}`}
                  onClick={() => {
                    setMicOn((p) => !p);
                    showToast(!micOn ? "Listening..." : "Mic stopped");
                  }}
                ><Mic size={15} /></button>
                <button type="submit" className={`send-btn ${input.trim() ? "" : "off"}`}><Send size={14} /></button>
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
            <button className={`rp-tab ${activeTab === "portfolio" ? "on" : ""}`} onClick={() => setActiveTab("portfolio")}>Portfolio</button>
            <button className={`rp-tab ${activeTab === "news" ? "on" : ""}`} onClick={() => setActiveTab("news")}>News</button>
            <button className={`rp-tab ${activeTab === "alerts" ? "on" : ""}`} onClick={() => setActiveTab("alerts")}>Alerts</button>
          </div>
          <div className="rp-body">
            {activeTab === "portfolio" ? (
              <>
                <div className="card big">
                  <div className="lbl"><Wallet size={12} /> Portfolio Value</div>
                  <div className="val">Rs 10,24,500</div>
                </div>
                <div className="card"><div className="lbl">Risk Heat</div><div className="txt">Elevated leverage concentration</div></div>
                <div className="card"><div className="lbl">Momentum</div><div className="txt">{quote?.dayChangePerc !== undefined ? `${priceUp ? "+" : ""}${quote.dayChangePerc.toFixed(2)}%` : "Pending"}</div></div>
              </>
            ) : null}

            {activeTab === "news" ? (
              <>
                <div className="card">
                  <div className="lbl"><Newspaper size={12} /> Market Pulse</div>
                  <div className="txt">Rate-sensitive sectors remain reactive to macro commentary.</div>
                </div>
                <div className="card">
                  <div className="lbl"><Sparkles size={12} /> Filing Cue</div>
                  <div className="txt">Cash flow improves while refinancing watch stays active.</div>
                </div>
              </>
            ) : null}

            {activeTab === "alerts" ? (
              <>
                <div className="card warn">
                  <div className="lbl"><Bell size={12} /> Risk Alert</div>
                  <div className="txt">Debt maturity concentration may pressure near-term liquidity.</div>
                </div>
                <div className="card info">
                  <div className="lbl"><Shield size={12} /> Compliance Watch</div>
                  <div className="txt">Track filing cadence and management disclosure consistency.</div>
                </div>
              </>
            ) : null}

            <div className="card src">
              <div className="lbl"><FileText size={12} /> Source Snippets</div>
              {stockDocError ? (
                <div className="txt">{stockDocError}</div>
              ) : stockDocData?.available ? (
                <>
                  <div className="txt">
                    {stockDocData.summaryText ?? "Doc pipeline summary is not available for this symbol."}
                  </div>
                  <div className="txt">
                    Announcements: {stockDocData.counts?.announcements ?? 0} · Quarterly Rows: {stockDocData.counts?.quarterlyRows ?? 0}
                  </div>
                  <div className="txt">
                    P/E: {stockDocData.metrics?.peRatio ?? "--"} · P/B: {stockDocData.metrics?.pbRatio ?? "--"} · ROE: {stockDocData.metrics?.roePct ?? "--"}
                  </div>
                  {(stockDocData.annualReportLinks ?? []).slice(0, 3).map((item, idx) => (
                    <a
                      key={`${item.url ?? "ar"}-${idx}`}
                      className="src-item"
                      href={item.url || "#"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.year ?? "Annual Report"} {item.label ? `| ${item.label}` : ""}
                    </a>
                  ))}
                  {stockDocData.pipelineRunAt ? (
                    <div className="txt">Pipeline Run: {new Date(stockDocData.pipelineRunAt).toLocaleString()}</div>
                  ) : null}
                </>
              ) : (
                <div className="txt">No S3 doc pipeline payload found for this stock yet.</div>
              )}
            </div>
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
          grid-template-columns: repeat(3, minmax(0, 1fr));
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
      `}</style>
    </div>
  );
}