"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, Briefcase, Compass, FileText, PanelLeft, PanelRight, Sparkles, X } from "lucide-react";
import { ChatMessage } from "@/components/cyro/ChatMessage";
import { Composer } from "@/components/cyro/Composer";
import { ContextPanel } from "@/components/cyro/ContextPanel";
import { SessionSidebar } from "@/components/cyro/SessionSidebar";
import type { SourceCitation } from "@/components/cyro/report";
import { useCyroChat } from "@/components/cyro/useCyroChat";
import "@/components/cyro/cyro.css";

const STARTERS = [
  { icon: BarChart3, title: "Ask about a stock", text: "Is TCS expensive right now?" },
  { icon: Compass, title: "Find stocks", text: "Find me high-quality small cap stocks" },
  { icon: FileText, title: "Full research report", text: "Run a full research report on Infosys for the long term" },
  { icon: Briefcase, title: "Review my portfolio", text: "Where is my portfolio concentrated?" },
];

export default function CyroPage() {
  const chat = useCyroChat();
  const [source, setSource] = useState<SourceCitation | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  // null = automatic (shown on wide screens only); true/false once the user picks
  const [ctxOpen, setCtxOpen] = useState<boolean | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // keep the newest content in view unless the user has scrolled up to read
  const onScroll = () => {
    const el = threadRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (chat.messages.length === 0) el.scrollTop = 0;          // welcome screen starts at the top
    else if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);
  useEffect(() => {
    stickRef.current = true;
  }, [chat.activeId]);

  const title = chat.sessions.find((s) => s.id === chat.activeId)?.title ?? "New chat";
  const empty = chat.messages.length === 0;
  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className={`cyro-root ${sideOpen ? "" : "side-off"} ${ctxOpen === true ? "ctx-on" : ctxOpen === false ? "ctx-off" : ""}`}>
      <SessionSidebar
        sessions={chat.sessions}
        activeId={chat.activeId}
        onNew={() => { chat.newChat(); setSource(null); }}
        onOpen={(id) => { setSource(null); chat.openSession(id); }}
        onRename={chat.rename}
        onDelete={chat.remove}
      />

      <main className="cy-main">
        <header className="cy-head">
          <button className="cy-icon-btn" onClick={() => setSideOpen((v) => !v)} aria-label={sideOpen ? "Hide chats" : "Show chats"} title={sideOpen ? "Hide chats" : "Show chats"}>
            <PanelLeft size={17} />
          </button>
          <div className="cy-head-title">{empty ? "CYRO" : title}</div>
          {chat.focus.length > 0 && (
            <div className="cy-focus" aria-label="Companies in this chat">
              {chat.focus.map((f) => (
                <span key={f} className="cy-focus-chip">{f}</span>
              ))}
            </div>
          )}
          <button className="cy-icon-btn" style={chat.focus.length ? undefined : { marginLeft: "auto" }}
                  onClick={() => setCtxOpen((v) => (v === null ? !window.matchMedia("(min-width: 1500px)").matches : !v))}
                  aria-label="Toggle sources panel" title="Sources, memory and market">
            <PanelRight size={17} />
          </button>
        </header>

        {chat.notice && (
          <div role="alert" className="cy-card warn" style={{ margin: "10px 20px 0", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span className="cy-card-text" style={{ marginTop: 0 }}>{chat.notice}</span>
            <button className="cy-act" onClick={() => chat.setNotice("")} aria-label="Dismiss"><X size={13} /></button>
          </div>
        )}

        <div className="cy-thread" ref={threadRef} onScroll={onScroll}>
          {empty ? (
            <div className="cy-welcome">
              <div className="cy-avatar" style={{ margin: "0 auto", width: 40, height: 40, borderRadius: 12 }}><Sparkles size={20} /></div>
              <h1>What would you like to research?</h1>
              <p>Ask about a company, a sector, an investing idea, or your portfolio.</p>
              <div className="cy-starters">
                {STARTERS.map((s) => (
                  <button key={s.title} className="cy-starter" onClick={() => chat.send(s.text)} disabled={chat.busy}>
                    <div className="cy-starter-ico"><s.icon size={15} /></div>
                    <div className="cy-starter-body">
                      <b>{s.title}</b>
                      <span>{s.text}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="cy-col">
              {chat.messages.map((m) => (
                <ChatMessage
                  key={m.key}
                  message={m}
                  isLast={m.key === lastAssistant?.key}
                  busy={chat.busy}
                  onSuggest={(t) => chat.send(t)}
                  onToggleActivity={chat.toggleActivity}
                  onReact={chat.react}
                  onOpenSource={setSource}
                />
              ))}
            </div>
          )}
        </div>

        <Composer busy={chat.busy} onSend={(t) => chat.send(t)} onStop={chat.stop} />
      </main>

      <ContextPanel
        messages={chat.messages}
        focus={chat.focus}
        memory={chat.memory}
        selectedSource={source}
        onClearSource={() => setSource(null)}
        onSaveMemory={chat.saveMemory}
        onForget={chat.forget}
      />
    </div>
  );
}
