"use client";

import { useEffect, useState } from "react";
import { BookOpen, Brain, Radar, X } from "lucide-react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import type { SourceCitation } from "./report";
import type { ChatSource, MemoryItem, UiMessage } from "./useCyroChat";

type Tab = "sources" | "memory" | "market";

type AlertItem = { type: "info" | "warn" | "error"; title: string; message: string; category?: string };
type NewsItem = { title: string; source?: string; published_at?: string; url?: string };

export function ContextPanel({
  messages, focus, memory, selectedSource, onClearSource, onSaveMemory, onForget,
}: {
  messages: UiMessage[];
  focus: string[];
  memory: MemoryItem[];
  selectedSource: SourceCitation | null;
  onClearSource: () => void;
  onSaveMemory: (key: string, value: unknown) => void;
  onForget: (key?: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("sources");
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [loadedFor, setLoadedFor] = useState("");
  const symbol = focus[0];
  // opening a source from a report always shows the Sources tab; picking another tab closes it
  const current: Tab = selectedSource ? "sources" : tab;
  const loadingMarket = current === "market" && !!symbol && loadedFor !== symbol;
  const selectTab = (id: Tab) => {
    if (selectedSource) onClearSource();
    setTab(id);
  };

  useEffect(() => {
    if (tab !== "market" || !symbol) return;
    let alive = true;
    Promise.allSettled([
      authenticatedFetch(`/api/cyro-market?endpoint=alerts&ticker=${symbol}`, { cache: "no-store" }).then((r) => r.json()),
      authenticatedFetch(`/api/cyro-market?endpoint=news&ticker=${symbol}`, { cache: "no-store" }).then((r) => r.json()),
    ]).then(([a, n]) => {
      if (!alive) return;
      setAlerts(a.status === "fulfilled" ? (a.value?.data?.alerts ?? []) : []);
      const nd = n.status === "fulfilled" ? n.value?.data : null;
      setNews([...(nd?.announcements ?? []), ...(nd?.news ?? [])].slice(0, 8));
      setLoadedFor(symbol);
    });
    return () => { alive = false; };
  }, [tab, symbol]);

  // sources behind the most recent answer
  const last = [...messages].reverse().find((m) => m.role === "assistant" && (m.sources.length > 0 || (m.reportSources?.length ?? 0) > 0));
  const chatSources: ChatSource[] = last?.sources ?? [];
  const reportSources = last?.reportSources ?? [];

  return (
    <aside className="cy-context" aria-label="Context">
      <div className="cy-tabs" role="tablist">
        {([["sources", "Sources", BookOpen], ["memory", "Memory", Brain], ["market", "Market", Radar]] as const).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={current === id} className={`cy-tab ${current === id ? "on" : ""}`} onClick={() => selectTab(id)}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      <div className="cy-ctx-body">
        {current === "sources" && (
          <>
            {selectedSource && (
              <div className="cy-card info">
                <div className="cy-card-kicker" style={{ display: "flex", justifyContent: "space-between" }}>
                  {selectedSource.source_type}
                  <button className="cy-act" onClick={onClearSource} aria-label="Close source"><X size={12} /></button>
                </div>
                <div className="cy-card-title">{selectedSource.label}</div>
                {selectedSource.excerpt && <div className="cy-card-text">{selectedSource.excerpt}</div>}
                {selectedSource.timestamp && <div className="cy-card-text" style={{ color: "var(--text-3)" }}>Fetched {selectedSource.timestamp}</div>}
              </div>
            )}
            {chatSources.map((s, i) => (
              <div key={`${s.label}-${i}`} className="cy-card">
                <div className="cy-card-kicker">{s.type}</div>
                <div className="cy-card-title">{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}</div>
                {s.detail && <div className="cy-card-text">{s.detail}</div>}
              </div>
            ))}
            {chatSources.length === 0 && reportSources.length === 0 && !selectedSource && (
              <div className="cy-ctx-empty">
                Sources for CYRO&apos;s answers appear here: the data behind each number, so you can check it.
              </div>
            )}
            {reportSources.map((s, i) => (
              <div key={`${s.source_type}:${s.label}:${i}`} className="cy-card">
                <div className="cy-card-kicker">{s.source_type}</div>
                <div className="cy-card-title">{s.label}</div>
                {s.excerpt && <div className="cy-card-text">{s.excerpt.slice(0, 180)}</div>}
              </div>
            ))}
          </>
        )}

        {current === "memory" && (
          <>
            <div className="cy-ctx-empty" style={{ paddingTop: 0 }}>
              What CYRO remembers about you, so answers fit your style. Tell it in chat (&ldquo;I&apos;m a conservative long-term investor&rdquo;) or edit here.
            </div>
            {memory.length === 0 && <div className="cy-card"><div className="cy-card-text">Nothing remembered yet.</div></div>}
            {memory.map((m) => (
              <div key={m.key} className="cy-mem-row">
                <label>{m.label}</label>
                {m.kind === "choice" && (
                  <select value={String(m.value)} onChange={(e) => onSaveMemory(m.key, e.target.value)}>
                    {m.options.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
                  </select>
                )}
                {m.kind === "text" && (
                  <input defaultValue={String(m.value)} onBlur={(e) => e.target.value !== m.value && onSaveMemory(m.key, e.target.value)} />
                )}
                {m.kind === "list" && (
                  <div className="cy-tags">
                    {(m.value as string[]).map((v, vi) => (
                      <span key={`${v}-${vi}`} className="cy-tag">
                        {v}
                        <button
                          aria-label={`Remove ${v}`}
                          onClick={() => {
                            const next = (m.value as string[]).filter((x) => x !== v);
                            if (next.length === 0) {
                              onForget(m.key);
                            } else {
                              onSaveMemory(m.key, next);
                            }
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {memory.length > 0 && (
              <button className="cy-link-btn danger" onClick={() => confirm("Forget everything CYRO remembers about you?") && onForget()}>
                Forget everything
              </button>
            )}
          </>
        )}

        {current === "market" && (
          <>
            {!symbol && <div className="cy-ctx-empty">Mention a company in the chat and its alerts and latest news show up here.</div>}
            {symbol && loadingMarket && <div className="cy-ctx-empty">Loading {symbol} signals…</div>}
            {symbol && !loadingMarket && (
              <>
                <div className="cy-card-kicker" style={{ padding: "0 2px" }}>{symbol} · alerts</div>
                {(alerts ?? []).length === 0 && <div className="cy-card"><div className="cy-card-text">No active alerts.</div></div>}
                {(alerts ?? []).map((a, i) => (
                  <div key={i} className={`cy-card ${a.type === "error" ? "error" : a.type === "warn" ? "warn" : "info"}`}>
                    <div className="cy-card-title">{a.title}</div>
                    <div className="cy-card-text">{a.message}</div>
                  </div>
                ))}
                <div className="cy-card-kicker" style={{ padding: "6px 2px 0" }}>{symbol} · latest news</div>
                {(news ?? []).length === 0 && <div className="cy-card"><div className="cy-card-text">No recent news found.</div></div>}
                {(news ?? []).map((n, i) => (
                  <div key={i} className="cy-card">
                    <div className="cy-card-title">{n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a> : n.title}</div>
                    <div className="cy-card-text">{[n.source, n.published_at].filter(Boolean).join(" · ")}</div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
