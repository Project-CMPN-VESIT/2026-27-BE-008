"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, Briefcase, Compass, FileText, Sparkles, X } from "lucide-react";
import { ChatMessage } from "@/components/cyro/ChatMessage";
import { Composer } from "@/components/cyro/Composer";
import { ContextPanel } from "@/components/cyro/ContextPanel";
import { SessionSidebar } from "@/components/cyro/SessionSidebar";
import type { SourceCitation } from "@/components/cyro/report";
import { useCyroChat } from "@/components/cyro/useCyroChat";
import "@/components/cyro/cyro.css";
import { CyroBotIcon } from "@/components/cyro-bot-icon";
import { PanelLeftToggle, PanelRightToggle } from "@/components/cyro/PanelIcons";

const STARTERS = [
  { icon: BarChart3, title: "Ask about a stock", text: "Is TCS or Reliance expensive right now?" },
  { icon: Compass, title: "Find stocks", text: "Find high-quality mid & small cap stocks" },
  { icon: FileText, title: "Deep research report", text: "Run forensic research on Infosys" },
  { icon: Briefcase, title: "Review portfolio", text: "Analyze concentration & risk exposure" },
];

export default function CyroPage() {
  const chat = useCyroChat();
  const [source, setSource] = useState<SourceCitation | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [ctxOpen, setCtxOpen] = useState(true);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (window.matchMedia("(max-width: 820px)").matches) {
        setSideOpen(false);
        setCtxOpen(false);
      }
    }
  }, []);

  // keep the newest content in view unless the user has scrolled up to read
  const onScroll = () => {
    const el = threadRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (chat.messages.length === 0) el.scrollTop = 0; // welcome screen starts at the top
    else if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);
  useEffect(() => {
    stickRef.current = true;
  }, [chat.activeId]);

  const title = chat.sessions.find((s) => s.id === chat.activeId)?.title ?? "New chat";
  const empty = chat.messages.length === 0;
  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className={`cyro-root ${sideOpen ? "" : "side-off"} ${ctxOpen ? "ctx-on" : "ctx-off"}`}>
      {(sideOpen || ctxOpen) && (
        <div
          className="cy-drawer-backdrop"
          onClick={() => {
            setSideOpen(false);
            setCtxOpen(false);
          }}
          aria-hidden="true"
        />
      )}
      <SessionSidebar
        sessions={chat.sessions}
        activeId={chat.activeId}
        onNew={() => {
          chat.newChat();
          setSource(null);
          if (typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches) {
            setSideOpen(false);
          }
        }}
        onOpen={(id) => {
          setSource(null);
          chat.openSession(id);
          if (typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches) {
            setSideOpen(false);
          }
        }}
        onRename={chat.rename}
        onDelete={chat.remove}
      />

      <main className="cy-main">
        <header className="cy-head">
          <button
            className="cy-icon-btn"
            onClick={() => setSideOpen((v) => !v)}
            aria-label={sideOpen ? "Hide chats" : "Show chats"}
            title={sideOpen ? "Hide chats" : "Show chats"}
          >
            <PanelLeftToggle isOpen={sideOpen} size={17} />
          </button>
          <div className="cy-head-title">
            <span>{empty ? "CYRO" : title}</span>
          </div>
          {chat.focus.length > 0 && (
            <div className="cy-focus" aria-label="Companies in this chat">
              {chat.focus.map((f) => (
                <span key={f} className="cy-focus-chip">{f}</span>
              ))}
            </div>
          )}
          <button
            className="cy-icon-btn"
            style={chat.focus.length ? undefined : { marginLeft: "auto" }}
            onClick={() => setCtxOpen((v) => !v)}
            aria-label={ctxOpen ? "Hide sources panel" : "Show sources panel"}
            title={ctxOpen ? "Hide sources panel" : "Show sources panel"}
          >
            <PanelRightToggle isOpen={ctxOpen} size={17} />
          </button>
        </header>

        {chat.notice && (
          <div role="alert" className="cy-card warn" style={{ margin: "10px 20px 0", display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span className="cy-card-text" style={{ marginTop: 0 }}>{chat.notice}</span>
            <button className="cy-act" onClick={() => chat.setNotice("")} aria-label="Dismiss"><X size={13} /></button>
          </div>
        )}

        <div className={`cy-thread ${empty ? "is-empty" : ""}`} ref={threadRef} onScroll={onScroll}>
          {empty ? (
            <div className="cy-welcome">
              <div className="cy-avatar" style={{ margin: "0 auto 10px", width: 68, height: 68, borderRadius: 20, padding: 8, boxShadow: "0 8px 24px rgba(36, 89, 214, 0.14)" }}>
                <CyroBotIcon size={52} className="w-full h-full object-contain" />
              </div>
              <h1 className="cy-welcome-hero">
                Hello, I&apos;m <span className="cyro-text-gradient">CYRO</span>
              </h1>
              <h2 className="cy-welcome-title">What would you like to research?</h2>
              <p className="cy-welcome-sub">Analyze company fundamentals, forensic audits, and market catalysts.</p>
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
