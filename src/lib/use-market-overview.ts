"use client";

import { useSyncExternalStore } from "react";

export type MarketRow = {
  name: string;
  id: string;
  value: number;
  change: number;
  pct: number;
  high?: number;
  low?: number;
  spark?: number[];
};

export type MarketOverview = {
  indices: MarketRow[];
  sectors: MarketRow[];
  trending: MarketRow[];
  breadth: { advances: number; declines: number; unchanged: number; universe: string };
  updatedAt: string;
};

const POLL_MS = 15_000;

// One shared poller for every component on the page (the ticker bar and the home page both read it).
let current: MarketOverview | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
const listeners = new Set<(data: MarketOverview | null) => void>();

async function refresh() {
  if (inFlight || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
  inFlight = true;
  try {
    const res = await fetch("/api/market-overview", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as MarketOverview & { ok?: boolean };
    if (data && Array.isArray(data.indices) && data.indices.length > 0) {
      current = data;
      listeners.forEach((fn) => fn(current));
    }
  } catch {
    // keep showing the last good numbers
  } finally {
    inFlight = false;
  }
}

function subscribe(onChange: () => void) {
  const listener = () => onChange();
  listeners.add(listener as (data: MarketOverview | null) => void);
  void refresh();
  if (!timer) timer = setInterval(refresh, POLL_MS);
  return () => {
    listeners.delete(listener as (data: MarketOverview | null) => void);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useMarketOverview(): MarketOverview | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

export const formatNumber = (value: number, digits = 2) =>
  value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const formatSigned = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${formatNumber(value, digits)}`;

/** SVG path (viewBox 0 0 200 40) for a series of closes. */
export function sparkPath(values: number[] | undefined) {
  if (!values || values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 200;
      const y = 36 - ((v - min) / span) * 32;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
