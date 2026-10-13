"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

type Hit = { symbol: string; companyName: string };

export function Composer({
  busy, onSend, onStop,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [hitIdx, setHitIdx] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // grow with content
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!value) {                       // empty: let the stylesheet's single-row height apply
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

  const submit = () => {
    const t = value.trim();
    if (!t || busy) return;
    onSend(t);
    setValue("");
    setHits([]);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shown.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHitIdx((i) => (i + 1) % shown.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHitIdx((i) => (i - 1 + shown.length) % shown.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(shown[hitIdx]); return; }
      if (e.key === "Escape") { setHits([]); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="cy-composer-wrap">
      <div className="cy-composer" style={{ position: "relative" }}>
        {shown.length > 0 && (
          <div className="cy-mention" role="listbox">
            {shown.map((h, i) => (
              <button key={h.symbol} role="option" aria-selected={i === hitIdx} className={i === hitIdx ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); pick(h); }}>
                <b>{h.symbol}</b>
                <small>{h.companyName}</small>
              </button>
            ))}
          </div>
        )}
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
          <button className="cy-send stop" onClick={onStop} aria-label="Stop"><Square size={14} fill="currentColor" /></button>
        ) : (
          <button className="cy-send" onClick={submit} disabled={!value.trim()} aria-label="Send"><ArrowUp size={18} /></button>
        )}
      </div>
      <div className="cy-fine">CYRO is an AI research assistant, not investment advice. Check important figures before acting.</div>
    </div>
  );
}
