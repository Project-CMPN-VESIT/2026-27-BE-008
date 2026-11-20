"use client";

import { ChangeEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";

type Hit = { symbol: string; companyName: string };

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Composer({
  busy,
  onSend,
  onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [hitIdx, setHitIdx] = useState(0);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);

  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // grow with content
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!value) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  // @mention lookup against the symbol search
  const mention = (() => {
    const m = /(?:^|\s)@([A-Za-z0-9&-]{1,15})$/.exec(value);
    return m ? m[1] : null;
  })();
  const shown = mention ? hits : [];

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!mention) return;
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/tv-search?q=${encodeURIComponent(mention)}`, { cache: "no-store" });
        const d = await r.json();
        setHits(((d.data ?? []) as Hit[]).slice(0, 6));
        setHitIdx(0);
      } catch {
        setHits([]);
      }
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [mention]);

  const pick = (h: Hit) => {
    setValue((v) => v.replace(/@[A-Za-z0-9&-]{1,15}$/, `@${h.symbol} `));
    setHits([]);
    ref.current?.focus();
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachedFile(file);

    // Read readable text files
    if (
      file.type.startsWith("text/") ||
      /\.(txt|csv|json|md|py|js|ts|tsx|jsx|html|css|xml|yaml|yml|log|tsv)$/i.test(file.name)
    ) {
      const reader = new FileReader();
      reader.onload = () => {
        setFileContent(typeof reader.result === "string" ? reader.result : null);
      };
      reader.readAsText(file);
    } else {
      setFileContent(null);
    }
  };

  const removeAttachment = () => {
    setAttachedFile(null);
    setFileContent(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = () => {
    const t = value.trim();
    if ((!t && !attachedFile) || busy) return;

    let messageToSend = t;
    if (attachedFile) {
      if (fileContent) {
        const preview =
          fileContent.length > 4000 ? fileContent.slice(0, 4000) + "\n...[file truncated]" : fileContent;
        messageToSend = t
          ? `${t}\n\n[Attached File: ${attachedFile.name}]\n\`\`\`\n${preview}\n\`\`\``
          : `[Attached File: ${attachedFile.name}]\n\`\`\`\n${preview}\n\`\`\``;
      } else {
        messageToSend = t
          ? `${t} [Attached: ${attachedFile.name} (${formatFileSize(attachedFile.size)})]`
          : `[Attached: ${attachedFile.name} (${formatFileSize(attachedFile.size)})]`;
      }
    }

    onSend(messageToSend);
    setValue("");
    setHits([]);
    removeAttachment();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shown.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHitIdx((i) => (i + 1) % shown.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHitIdx((i) => (i - 1 + shown.length) % shown.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(shown[hitIdx]);
        return;
      }
      if (e.key === "Escape") {
        setHits([]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="cy-composer-wrap">
      {attachedFile && (
        <div className="cy-attached-preview">
          <div className="cy-attached-badge">
            <Paperclip size={13} className="text-blue-500" />
            <span className="cy-attached-filename">{attachedFile.name}</span>
            <span className="cy-attached-filesize">({formatFileSize(attachedFile.size)})</span>
            <button
              type="button"
              className="cy-attached-remove"
              onClick={removeAttachment}
              title="Remove attachment"
              aria-label="Remove attachment"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      <div className="cy-composer" style={{ position: "relative" }}>
        {shown.length > 0 && (
          <div className="cy-mention" role="listbox">
            {shown.map((h, i) => (
              <button
                key={h.symbol}
                role="option"
                aria-selected={i === hitIdx}
                className={i === hitIdx ? "on" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(h);
                }}
              >
                <b>{h.symbol}</b>
                <small>{h.companyName}</small>
              </button>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />

        <button
          type="button"
          className="cy-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach file"
          title="Attach file"
        >
          <Paperclip size={17} strokeWidth={2.2} />
        </button>

        <textarea
          ref={ref}
          value={value}
          rows={1}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about a stock, a sector, or an investing idea…"
          aria-label="Message CYRO"
        />

        {busy ? (
          <button className="cy-send stop" onClick={onStop} aria-label="Stop">
            <Square size={14} fill="#ffffff" stroke="#ffffff" />
          </button>
        ) : (
          <button
            className="cy-send"
            onClick={submit}
            disabled={!value.trim() && !attachedFile}
            aria-label="Send"
          >
            <ArrowUp size={18} strokeWidth={2.6} stroke="#ffffff" color="#ffffff" className="text-white shrink-0" />
          </button>
        )}
      </div>
      <div className="cy-fine">
        CYRO is an AI research assistant, not investment advice. Check important figures before acting.
      </div>
    </div>
  );
}
