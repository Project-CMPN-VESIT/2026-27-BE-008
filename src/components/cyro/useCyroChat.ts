"use client";

/**
 * useCyroChat: server-backed chat sessions, streaming turns, and user memory for the CYRO agent.
 *
 *  - sessions and messages live on the backend (no more localStorage-only history)
 *  - a turn is one POST whose response is an SSE stream: steps, answer text, sources, suggestions,
 *    learned memory, and (only when the agent decides) the full research report events
 *  - the browser keeps just an anonymous client id so the backend can scope sessions and memory
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  initialResearchState,
  researchActivityReducer,
  ResearchActivityState,
} from "@/components/research/researchActivityReducer";
import { normalizeResearchEvent } from "@/components/research/researchEventMapper";
import { FinalResearchReport, ReportClaim, SourceCitation, domainKeyForAgent, normalizeSource } from "./report";
import { useAuth } from "@/lib/auth-context";

/* ───────────────────────────── types ───────────────────────────── */

export type Step = { id: string; label: string; status: "running" | "done" | "failed" };
export type ChatSource = { label: string; type: string; detail?: string; url?: string };
export type LearnedItem = { key: string; label: string; value: unknown };

export type UiMessage = {
  key: string;
  serverId?: number;
  role: "user" | "assistant";
  kind: "text" | "report";
  text: string;
  steps: Step[];
  sources: ChatSource[];
  suggestions: string[];
  learned: LearnedItem[];
  streaming: boolean;
  error?: boolean;
  liked?: boolean;
  disliked?: boolean;
  // research report (only when the agent decided one was warranted)
  report?: FinalResearchReport;
  reportSources?: SourceCitation[];
  activity?: ResearchActivityState;
  domainClaims?: Record<string, ReportClaim[]>;
};

export type SessionSummary = {
  id: string;
  title: string;
  focus: string[];
  updated_at: string;
  message_count?: number;
  preview?: string;
};

export type MemoryItem = {
  key: string;
  label: string;
  value: string | string[];
  kind: "choice" | "list" | "text";
  options: string[];
};

type ServerMessage = {
  id: number;
  role: "user" | "assistant";
  kind: "text" | "report";
  content: string;
  payload?: {
    sources?: ChatSource[];
    suggestions?: string[];
    memory_changed?: LearnedItem[];
    events?: Record<string, unknown>[];
    error?: boolean;
  };
};

/* ───────────────────────────── helpers ───────────────────────────── */

let counter = 0;
const nextKey = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

const blank = (role: "user" | "assistant", text = ""): UiMessage => ({
  key: nextKey(), role, kind: "text", text, steps: [], sources: [], suggestions: [], learned: [], streaming: false,
});

/** Fold one research-pipeline event into a message (shared by live streaming and stored-report replay). */
function applyReportEvent(m: UiMessage, ev: Record<string, unknown>): UiMessage {
  const type = String(ev.type ?? "");
  let next = { ...m };
  const norm = normalizeResearchEvent(type, ev);
  if (norm.type !== "noop") {
    next.activity = researchActivityReducer(next.activity ?? { ...initialResearchState }, { type: "PROCESS_EVENT", payload: norm });
  }
  if (type === "agent_claims_ready") {
    const domain = domainKeyForAgent(String(ev.agent ?? ""));
    if (domain) next.domainClaims = { ...(next.domainClaims ?? {}), [domain]: Array.isArray(ev.claims) ? (ev.claims as ReportClaim[]) : [] };
  } else if (type === "final_report") {
    const report = ev.report as FinalResearchReport | undefined;
    if (report?.symbol) {
      next = { ...next, kind: "report", report, reportSources: (report.sources ?? []).map(normalizeSource) };
    }
  }
  return next;
}

function fromServer(m: ServerMessage): UiMessage {
  const base: UiMessage = {
    ...blank(m.role, m.content), serverId: m.id, kind: m.kind,
    sources: m.payload?.sources ?? [], suggestions: m.payload?.suggestions ?? [],
    learned: m.payload?.memory_changed ?? [], error: !!m.payload?.error,
  };
  if (m.kind === "report" && m.payload?.events) {
    let msg: UiMessage = { ...base, activity: { ...initialResearchState, expanded: false } };
    for (const ev of m.payload.events) msg = applyReportEvent(msg, ev);
    return { ...msg, activity: msg.activity ? { ...msg.activity, expanded: false } : msg.activity };
  }
  return base;
}

/* ───────────────────────────── hook ───────────────────────────── */

export function useCyroChat() {
  const { user, isLoading: authLoading, getIdToken } = useAuth();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const api = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getIdToken();
      const res = await fetch(`/api/cyro-agent${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { detail?: string }).detail ?? `HTTP ${res.status}`);
      return data;
    },
    [getIdToken],
  );

  const refreshSessions = useCallback(async () => {
    try {
      const d = await api("/sessions");
      setSessions(d.sessions ?? []);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not load chats");
    }
  }, [api]);

  const refreshMemory = useCallback(async () => {
    try {
      const d = await api("/memory");
      setMemory(d.items ?? []);
    } catch {
      /* memory panel is optional */
    }
  }, [api]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setSessions([]);
      setActiveId(null);
      setMessages([]);
      setMemory([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSessions([]);
    setActiveId(null);
    setMessages([]);
    (async () => {
      await Promise.all([refreshSessions(), refreshMemory()]);
      setLoading(false);
    })();
  }, [user?.id, authLoading, refreshSessions, refreshMemory]);

  const openSession = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      setBusy(false);
      setActiveId(id);
      try {
        const d = await api(`/sessions/${id}/messages`);
        if (activeRef.current !== id) return;
        setMessages((d.messages as ServerMessage[]).map(fromServer));
        setNotice("");
      } catch (e) {
        setMessages([]);
        setNotice(e instanceof Error ? e.message : "Could not open this chat");
      }
    },
    [api],
  );

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
    setActiveId(null);
    setMessages([]);
    setNotice("");
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  }, []);

  const send = useCallback(
    async (text: string, ticker?: string) => {
      const msg = text.trim();
      if (!msg || busy) return;
      const user = blank("user", msg);
      const ai: UiMessage = { ...blank("assistant"), streaming: true };
      setMessages((prev) => [...prev, user, ai]);
      setBusy(true);
      setNotice("");

      const ac = new AbortController();
      abortRef.current = ac;
      const patch = (fn: (m: UiMessage) => UiMessage) =>
        setMessages((prev) => prev.map((m) => (m.key === ai.key ? fn(m) : m)));
      let sid = activeRef.current;

      try {
        const res = await fetch("/api/cyro-agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${await getIdToken()}` },
          body: JSON.stringify({ message: msg, session_id: sid, ticker }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => ({}));
          throw new Error((d as { detail?: string }).detail ?? `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let receivedAnswer = false;
        for (;;) {
          const { value, done } = await reader.read();
          buf += done ? dec.decode() : dec.decode(value, { stream: true });
          // SSE permits LF, CRLF, and CR line endings. Normalize before
          // splitting so chunk boundaries or CRLF framing cannot hide events.
          buf = buf.replace(/\r\n?/g, "\n");
          if (done && buf.trim()) buf += "\n\n"; // dispatch a final unterminated frame
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const line = raw.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            const type = String(ev.type);
            if (type === "session") {
              const id = String(ev.session_id);
              sid = id;
              activeRef.current = id;
              setActiveId(id);
              setSessions((prev) => {
                const rest = prev.filter((s) => s.id !== id);
                const old = prev.find((s) => s.id === id);
                return [{ id, title: String(ev.title ?? old?.title ?? "New chat"), focus: old?.focus ?? [],
                          updated_at: new Date().toISOString() }, ...rest];
              });
            } else if (type === "step") {
              const step: Step = { id: String(ev.id), label: String(ev.label), status: ev.status as Step["status"] };
              patch((m) => ({
                ...m,
                steps: m.steps.some((s) => s.id === step.id)
                  ? m.steps.map((s) => (s.id === step.id ? step : s))
                  : [...m.steps, step],
              }));
            } else if (type === "delta") {
              const delta = String(ev.text ?? "");
              if (delta) receivedAnswer = true;
              patch((m) => ({ ...m, text: m.text + delta }));
            } else if (type === "final_text") {
              const finalText = String(ev.text ?? "");
              if (finalText) receivedAnswer = true;
              patch((m) => ({ ...m, text: finalText || m.text }));
            } else if (type === "sources") {
              patch((m) => ({ ...m, sources: (ev.items as ChatSource[]) ?? [] }));
            } else if (type === "suggestions") {
              patch((m) => ({ ...m, suggestions: (ev.items as string[]) ?? [] }));
            } else if (type === "memory") {
              const items = (ev.items as LearnedItem[]) ?? [];
              patch((m) => ({ ...m, learned: items }));
              refreshMemory();
            } else if (type === "plan") {
              if (ev.wants_report) patch((m) => ({ ...m, kind: "report", activity: m.activity ?? { ...initialResearchState } }));
            } else if (type === "message") {
              const saved = ev.message as { id?: number; content?: string } | undefined;
              if (saved?.content) receivedAnswer = true;
              // Deltas are the normal streaming path, but use the persisted
              // server content if a provider completed without emitting text.
              patch((m) => ({ ...m, serverId: saved?.id, text: m.text || saved?.content || "" }));
            } else if (type === "error") {
              patch((m) => ({ ...m, text: m.text || String(ev.message ?? "Something went wrong."), error: true }));
            } else if (type === "done") {
              patch((m) => ({ ...m, streaming: false }));
            } else {
              // research pipeline passthrough (started, analyst_*, agent_claims_ready, final_report, ...)
              patch((m) => applyReportEvent(m, ev));
            }
          }
          if (done) break;
        }
        if (!receivedAnswer && !ac.signal.aborted) {
          patch((m) => ({
            ...m,
            text: "CYRO ended the response without returning an answer. Please try again.",
            error: true,
          }));
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          const message = e instanceof Error ? e.message : "Connection lost";
          patch((m) => ({ ...m, text: m.text || `I couldn't reach the CYRO backend. ${message}`, error: true }));
        }
      } finally {
        patch((m) => ({ ...m, streaming: false }));
        setBusy(false);
        refreshSessions();
      }
    },
    [busy, getIdToken, refreshMemory, refreshSessions],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
      try {
        await api(`/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
      } catch {
        refreshSessions();
      }
    },
    [api, refreshSessions],
  );

  const remove = useCallback(
    async (id: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeRef.current === id) newChat();
      try {
        await api(`/sessions/${id}`, { method: "DELETE" });
      } catch {
        refreshSessions();
      }
    },
    [api, newChat, refreshSessions],
  );

  const saveMemory = useCallback(
    async (key: string, value: unknown) => {
      try {
        const d = await api("/memory", { method: "PUT", body: JSON.stringify({ key, value }) });
        setMemory(d.items ?? []);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Could not save");
      }
    },
    [api],
  );

  const forget = useCallback(
    async (key?: string) => {
      await api(`/memory${key ? `?key=${encodeURIComponent(key)}` : ""}`, { method: "DELETE" });
      refreshMemory();
    },
    [api, refreshMemory],
  );

  const toggleActivity = useCallback((key: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.key === key && m.activity
          ? { ...m, activity: researchActivityReducer(m.activity, { type: "TOGGLE_EXPAND" }) }
          : m,
      ),
    );
  }, []);

  const react = useCallback((key: string, kind: "like" | "dislike") => {
    setMessages((prev) =>
      prev.map((m) =>
        m.key === key
          ? { ...m, liked: kind === "like" ? !m.liked : false, disliked: kind === "dislike" ? !m.disliked : false }
          : m,
      ),
    );
  }, []);

  const focus = sessions.find((s) => s.id === activeId)?.focus ?? [];

  return {
    sessions, activeId, messages, busy, memory, loading, notice, focus,
    send, stop, newChat, openSession, rename, remove, saveMemory, forget, refreshMemory, toggleActivity, react,
    setNotice,
  };
}
