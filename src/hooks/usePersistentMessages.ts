/**
 * src/hooks/usePersistentMessages.ts
 * ────────────────────────────────────
 * Persists CYRO War Room chat messages to localStorage, keyed by sessionId.
 *
 * Usage:
 *   const [messages, setMessages] = usePersistentMessages(sessionId, []);
 *
 * - On first mount, loads any saved messages for that session.
 * - On every setMessages call, writes the latest messages back to localStorage.
 * - Trims to MAX_STORED_MESSAGES to prevent storage bloat.
 * - Strips streaming: true flag before saving (no partial messages survive reloads).
 */

"use client";

import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY_PREFIX = "cyro_session_";
const MAX_STORED_MESSAGES = 80; // per session

type Setter<T> = Dispatch<SetStateAction<T>>;

function storageKey(sessionId: number | string): string {
  return `${STORAGE_KEY_PREFIX}${sessionId}`;
}

function loadMessages<T>(sessionId: number | string, fallback: T[]): T[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveMessages<T extends Record<string, unknown>>(
  sessionId: number | string,
  messages: T[]
): void {
  if (typeof window === "undefined") return;
  try {
    // Never persist in-flight streaming messages
    const clean = messages
      .filter((m) => !m.streaming)
      .slice(-MAX_STORED_MESSAGES);
    localStorage.setItem(storageKey(sessionId), JSON.stringify(clean));
  } catch {
    // Storage quota exceeded — clear oldest sessions
    try {
      const keysToDelete: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(STORAGE_KEY_PREFIX)) keysToDelete.push(k);
      }
      // Delete all but the current session
      keysToDelete
        .filter((k) => k !== storageKey(sessionId))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Drop-in replacement for useState<T[]> that persists to localStorage.
 *
 * @param sessionId  - Session key (changes when user switches sessions)
 * @param initialValue - Default value when no saved data exists
 */
export function usePersistentMessages<T extends Record<string, unknown>>(
  sessionId: number | string,
  initialValue: T[]
): [T[], Setter<T[]>] {
  const [messages, setMessagesRaw] = useState<T[]>(initialValue);
  const [mounted, setMounted] = useState(false);
  const lastSessionId = useRef(sessionId);

  // Hydrate on mount
  useEffect(() => {
    setMounted(true);
    setMessagesRaw(loadMessages<T>(sessionId, initialValue));
  }, []);

  // When sessionId changes (user switches sessions), reload from storage
  useEffect(() => {
    if (!mounted) return;
    if (lastSessionId.current !== sessionId) {
      lastSessionId.current = sessionId;
      setMessagesRaw(loadMessages<T>(sessionId, initialValue));
    }
  }, [sessionId, initialValue, mounted]);

  // Write to storage whenever messages change
  useEffect(() => {
    if (!mounted) return;
    saveMessages(sessionId, messages);
  }, [sessionId, messages, mounted]);

  // Stable setter wrapper
  const setMessages = useCallback<Setter<T[]>>(
    (action) => {
      setMessagesRaw((prev) => {
        const next =
          typeof action === "function" ? (action as (p: T[]) => T[])(prev) : action;
        return next;
      });
    },
    []
  );

  return [messages, setMessages];
}

/** Remove all stored messages for a session (e.g. "Clear History"). */
export function clearSessionMessages(sessionId: number | string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKey(sessionId));
  } catch {
    /* ignore */
  }
}

/** List all session IDs that have stored messages. */
export function listStoredSessions(): string[] {
  if (typeof window === "undefined") return [];
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(STORAGE_KEY_PREFIX)) {
        ids.push(k.replace(STORAGE_KEY_PREFIX, ""));
      }
    }
  } catch {
    /* ignore */
  }
  return ids;
}
