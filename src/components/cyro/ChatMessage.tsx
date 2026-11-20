"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Brain, Check, ChevronDown, Copy, Loader2, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { ResearchActivityPanel } from "@/components/research/ResearchActivityPanel";
import { CyroResearchReport, SourceCitation } from "./report";
import { CyroBotIcon } from "@/components/cyro-bot-icon";
import { ChatVisuals } from "./ChatVisuals";
import type { UiMessage } from "./useCyroChat";

function Markdown({ text }: { text: string }) {
  return (
    <div className="cy-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function Steps({ message }: { message: UiMessage }) {
  // Only the working steps for an in-flight answer; the "understanding" step is noise once the answer streams.
  const steps = message.steps.filter((s) => s.id !== "plan" || message.streaming);
  if (!message.streaming || steps.length === 0) return null;
  return (
    <div className="cy-steps" aria-live="polite">
      {steps.map((s) => (
        <span key={s.id} className={`cy-step ${s.status}`}>
          {s.status === "running" ? <Loader2 size={13} className="cy-spin" /> : s.status === "done" ? <Check size={13} /> : <AlertTriangle size={13} />}
          {s.label}
        </span>
      ))}
    </div>
  );
}

function ChatMessageView({
  message, isLast, busy, onSuggest, onToggleActivity, onReact, onOpenSource,
}: {
  message: UiMessage;
  isLast: boolean;
  busy: boolean;
  onSuggest: (text: string) => void;
  onToggleActivity: (key: string) => void;
  onReact: (key: string, kind: "like" | "dislike") => void;
  onOpenSource: (s: SourceCitation) => void;
}) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="cy-msg user">
        <div className="cy-bubble-user">{message.text}</div>
      </div>
    );
  }

  const isReport = message.kind === "report";
  const waiting = message.streaming && !message.text && !message.report;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.report?.summary ? `${message.text}\n\n${message.report.summary}` : message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="cy-msg">
      <div className="cy-avatar" aria-hidden><CyroBotIcon size={32} className="w-full h-full object-contain" /></div>
      <div className="cy-assistant">
        <Steps message={message} />

        {isReport && message.activity && (
          <div style={{ marginBottom: 12 }}>
            <ResearchActivityPanel state={message.activity} onToggleExpand={() => onToggleActivity(message.key)} />
          </div>
        )}

        {message.text && !(isReport && message.report) && (
          <div className={`cy-assistant-body ${message.error ? "cy-error" : ""}`}>
            <Markdown text={message.text} />
          </div>
        )}
        {!isReport && !message.streaming && message.visuals && message.visuals.length > 0 && <ChatVisuals items={message.visuals} />}
        {isReport && message.report && (
          <>
            {message.text && (
              <div className="cy-assistant-body bare" style={{ marginBottom: 12 }}>
                <Markdown text={message.text.split("\n\n")[0]} />
              </div>
            )}
            {message.visuals && message.visuals.length > 0 && <ChatVisuals items={message.visuals} />}
            <CyroResearchReport
              report={message.report}
              sources={message.reportSources ?? []}
              activityState={message.activity}
              domainClaims={message.domainClaims}
              onSourceClick={onOpenSource}
            />
          </>
        )}
        {waiting && <div className="cy-dots" aria-label="CYRO is thinking"><i /><i /><i /></div>}

        {message.learned.length > 0 && (
          <div className="cy-learned">
            <Brain size={14} />
            <span>
              Remembered: <b>{message.learned.map((l) => `${l.label} → ${Array.isArray(l.value) ? l.value.join(", ") : String(l.value).replace(/_/g, " ")}`).join(" · ")}</b>
            </span>
          </div>
        )}

        {message.sources.length > 0 && !message.streaming && (
          <details className="cy-sources">
            <summary><ChevronDown size={13} /> {message.sources.length} source{message.sources.length > 1 ? "s" : ""} used</summary>
            <div className="cy-source-list">
              {message.sources.map((s, i) => (
                <div key={`${s.label}-${i}`} className="cy-source">
                  <b>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}</b>
                  <em>{[s.type, s.detail].filter(Boolean).join(" · ")}</em>
                </div>
              ))}
            </div>
          </details>
        )}

        {isLast && !busy && message.suggestions.length > 0 && (
          <div className="cy-chips">
            {message.suggestions.map((s, i) => (
              <button key={`${s}-${i}`} className={`cy-chip ${i === 0 && /full research report/i.test(s) ? "primary" : ""}`} onClick={() => onSuggest(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        {!message.streaming && (message.text || message.report) && (
          <div className="cy-actions">
            <button className="cy-act" onClick={copy} aria-label="Copy answer"><Copy size={13} />{copied ? "Copied" : ""}</button>
            <button className={`cy-act ${message.liked ? "on" : ""}`} onClick={() => onReact(message.key, "like")} aria-label="Helpful"><ThumbsUp size={13} /></button>
            <button className={`cy-act ${message.disliked ? "on" : ""}`} onClick={() => onReact(message.key, "dislike")} aria-label="Not helpful"><ThumbsDown size={13} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatMessage = memo(ChatMessageView);
