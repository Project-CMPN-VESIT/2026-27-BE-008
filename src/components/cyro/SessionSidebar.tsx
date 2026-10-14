"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import type { SessionSummary } from "./useCyroChat";

function normalizeDate(iso: string): Date {
  if (!iso) return new Date();
  if (/[Z+-]\d\d(?::?\d\d)?$/i.test(iso) || iso.endsWith("Z")) {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(`${iso}Z`);
  return isNaN(d.getTime()) ? new Date(iso) : d;
}

function bucket(iso: string): string {
  const d = normalizeDate(iso);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dTime = d.getTime();
  const daysDiff = Math.floor((todayStart - dTime) / 86_400_000);

  if (dTime >= todayStart) return "Today";
  if (daysDiff === 0) return "Yesterday";
  if (daysDiff < 7) return "Previous 7 days";
  return "Older";
}

export function SessionSidebar({
  sessions, activeId, onNew, onOpen, onRename, onDelete,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = sessions.filter((s) => !term || s.title.toLowerCase().includes(term) || (s.preview ?? "").toLowerCase().includes(term));
    const order = ["Today", "Yesterday", "Previous 7 days", "Older"];
    const map = new Map<string, SessionSummary[]>();
    rows.forEach((s) => map.set(bucket(s.updated_at), [...(map.get(bucket(s.updated_at)) ?? []), s]));
    return order.filter((g) => map.has(g)).map((g) => ({ name: g, items: map.get(g)! }));
  }, [sessions, q]);

  const commit = (id: string) => {
    const t = draft.trim();
    if (t) onRename(id, t);
    setEditing(null);
  };

  return (
    <aside className="cy-side" aria-label="Chats">
      <div className="cy-brand">
        <div className="cy-brand-mark"><Sparkles size={16} /></div>
        <div>
          <div className="cy-brand-name">CYRO</div>
          <div className="cy-brand-sub">AI research analyst</div>
        </div>
      </div>
      <button className="cy-new" onClick={onNew}><Plus size={15} /> New chat</button>
      <div className="cy-search">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
      </div>
      <div className="cy-list">
        {groups.length === 0 && (
          <div className="cy-empty-list">{q ? "No chats match your search." : "Your conversations will appear here."}</div>
        )}
        {groups.map((g) => (
          <div key={g.name}>
            <div className="cy-group">{g.name}</div>
            {g.items.map((s) => (
              <div key={s.id} className={`cy-item ${s.id === activeId ? "on" : ""}`} onClick={() => editing !== s.id && onOpen(s.id)}
                   onDoubleClick={() => { setEditing(s.id); setDraft(s.title); }} role="button" tabIndex={0}
                   onKeyDown={(e) => e.key === "Enter" && editing !== s.id && onOpen(s.id)}>
                {editing === s.id ? (
                  <input className="cy-item-edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                         onBlur={() => commit(s.id)} onClick={(e) => e.stopPropagation()}
                         onKeyDown={(e) => { if (e.key === "Enter") commit(s.id); if (e.key === "Escape") setEditing(null); }} />
                ) : (
                  <>
                    <div className="cy-item-title">{s.title}</div>
                    <div className="cy-item-sub">{s.focus.length ? s.focus.join(" · ") : s.preview || "No messages yet"}</div>
                  </>
                )}
                {editing !== s.id && (
                  <div className="cy-item-acts">
                    <button aria-label={`Rename ${s.title}`} title="Rename"
                            onClick={(e) => { e.stopPropagation(); setEditing(s.id); setDraft(s.title); }}>
                      <Pencil size={13} />
                    </button>
                    <button className="del" aria-label={`Delete ${s.title}`} title="Delete"
                            onClick={(e) => { e.stopPropagation(); if (confirm("Delete this chat?")) onDelete(s.id); }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
