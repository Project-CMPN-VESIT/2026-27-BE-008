"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, Layers, Loader2, RefreshCw } from "lucide-react";

/* ───────────────────────────── types ───────────────────────────── */

type TopHolding = { symbol: string; name: string; weight_pct: number };

type BasketCard = {
  id: string;
  name: string;
  description: string;
  model: string;
  model_label: string;
  investor: string;
  caps: string[];
  cap_label: string;
  target_holdings: number;
  built: boolean;
  return_pct: number | null;
  return_basis: "live" | "simulated_1y" | "none";
  spark: number[];
  holdings_count: number;
  top_holdings: TopHolding[];
  created_on: string | null;
  last_rebalance: string | null;
  next_rebalance: string | null;
};

type Pipeline = {
  state?: string;
  stage?: string | null;
  progress?: { done: number; total: number };
  message?: string;
  ready: boolean;
  universe_size?: number;
  fundamentals_ok?: number;
  baskets_built?: number;
  baskets_total?: number;
  last_price_date?: string | null;
  last_success_at?: string | null;
};

type ListResponse = {
  baskets: BasketCard[];
  disclaimer: string;
  pipeline: Pipeline;
  filters: {
    caps: { id: string; label: string }[];
    models: { id: string; label: string; investor: string }[];
  };
  detail?: string;
};

type Holding = {
  symbol: string;
  name: string;
  sector: string | null;
  cap_class: string | null;
  weight_pct: number;
  score: number | null;
  price: number | null;
  entry_price: number | null;
  return_since_entry_pct: number | null;
  tags_pos: string[];
  tags_neg: string[];
};

type Point = { date: string; basket: number; nifty: number | null; fd: number; live: boolean };

type BasketDetail = BasketCard & {
  range: string;
  ranges: string[];
  notional: number;
  performance: { basket_pct: number | null; nifty_pct: number | null; fd_pct: number | null };
  series: Point[];
  holdings: Holding[];
  live_days: number;
  simulated_until: string | null;
  methodology: string;
  disclaimer: string;
  fd_rate_pct: number;
  detail?: string;
};

/* ───────────────────────────── helpers ───────────────────────────── */

const MODEL_STYLE: Record<string, string> = {
  canslim: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  jhunjhunwala: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  lynch: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  hundred_baggers: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  buffett: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
};

const RANGES = ["7D", "1M", "3M", "6M", "1Y", "ALL"];

const inr = (v: number | null | undefined) =>
  v == null ? "--" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

const pct = (v: number | null | undefined, digits = 2) =>
  v == null ? "--" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;

const tone = (v: number | null | undefined) =>
  v == null ? "text-slate-400" : v >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "--";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <div className="h-8 w-20" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-20" preserveAspectRatio="none" aria-hidden>
      <polyline fill="none" stroke={up ? "#10b981" : "#f43f5e"} strokeWidth="2" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

function ModelChip({ model, label }: { model: string; label: string }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${MODEL_STYLE[model] ?? "bg-slate-100 text-slate-600"}`}>
      {label}
    </span>
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export default function BasketsPage() {
  const [list, setList] = useState<ListResponse | null>(null);
  const [listError, setListError] = useState("");
  const [cap, setCap] = useState("all");
  const [model, setModel] = useState("all");
  const [sort, setSort] = useState<"default" | "return">("default");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [range, setRange] = useState("ALL");
  const [detail, setDetail] = useState<BasketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const detailAbort = useRef<AbortController | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/baskets", { cache: "no-store" });
      const data = (await res.json()) as ListResponse;
      if (!res.ok) throw new Error(data.detail ?? `HTTP ${res.status}`);
      setList(data);
      setListError("");
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Could not load baskets");
    }
  }, []);

  // list: load now, then poll (fast while data is being built, slow otherwise)
  const building = !list?.pipeline?.ready || list?.pipeline?.state === "running";
  useEffect(() => {
    loadList();
    const t = setInterval(loadList, building ? 8_000 : 300_000);
    return () => clearInterval(t);
  }, [loadList, building]);

  const visible = useMemo(() => {
    let rows = list?.baskets ?? [];
    if (cap !== "all") rows = rows.filter((b) => b.caps.includes(cap));
    if (model !== "all") rows = rows.filter((b) => b.model === model);
    if (sort === "return") rows = [...rows].sort((a, b) => (b.return_pct ?? -1e9) - (a.return_pct ?? -1e9));
    return rows;
  }, [list, cap, model, sort]);

  // keep a valid selection
  useEffect(() => {
    if (!visible.length) return;
    if (!selectedId || !visible.some((b) => b.id === selectedId)) {
      setSelectedId((visible.find((b) => b.built) ?? visible[0]).id);
    }
  }, [visible, selectedId]);

  // detail
  useEffect(() => {
    if (!selectedId) return;
    detailAbort.current?.abort();
    const ac = new AbortController();
    detailAbort.current = ac;
    setDetailLoading(true);
    fetch(`/api/baskets/${selectedId}?range=${range}`, { cache: "no-store", signal: ac.signal })
      .then(async (res) => {
        const data = (await res.json()) as BasketDetail;
        if (!res.ok) throw new Error(data.detail ?? `HTTP ${res.status}`);
        setDetail(data);
        setDetailError("");
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setDetailError(e instanceof Error ? e.message : "Could not load basket");
      })
      .finally(() => {
        if (!ac.signal.aborted) setDetailLoading(false);
      });
    return () => ac.abort();
  }, [selectedId, range, list?.pipeline?.last_success_at]);

  const refreshData = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/baskets/refresh", { method: "POST" });
      await loadList();
    } finally {
      setRefreshing(false);
    }
  };

  /* chart data: simulated part dashed, live part solid, joined at the creation point */
  const chartData = useMemo(() => {
    const s = detail?.series ?? [];
    return s.map((p, i) => ({
      date: p.date,
      sim: !p.live || (s[i + 1] && s[i + 1].live && !p.live) ? p.basket : i > 0 && !s[i - 1].live && p.live ? p.basket : null,
      live: p.live ? p.basket : null,
      nifty: p.nifty,
      fd: p.fd,
    }));
  }, [detail]);

  const pipeline = list?.pipeline;
  const pctDone = pipeline?.progress && pipeline.progress.total ? Math.round((pipeline.progress.done / pipeline.progress.total) * 100) : 0;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-slate-50 p-4 font-sans dark:bg-slate-950 lg:p-6">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-4">
        {/* header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Layers className="h-6 w-6 text-blue-600" />
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">AI Baskets</h1>
              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                NIFTY 500 UNIVERSE
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Rule-based stock baskets inspired by Buffett, Lynch, Jhunjhunwala, 100-Baggers and CANSLIM, rebuilt automatically from live market data.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {pipeline?.last_price_date && <span>Prices as of {fmtDate(pipeline.last_price_date)}</span>}
            <button
              onClick={refreshData}
              disabled={refreshing || pipeline?.state === "running"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing || pipeline?.state === "running" ? "animate-spin" : ""}`} />
              Refresh data
            </button>
          </div>
        </div>

        {/* building banner */}
        {pipeline && (pipeline.state === "running" || !pipeline.ready) && !listError && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-800 dark:text-blue-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              {pipeline.state === "running"
                ? `Building baskets: ${pipeline.stage ?? "starting"}…`
                : "Baskets are not built yet. The first build takes about 10 minutes and starts automatically."}
            </div>
            {pipeline.state === "running" && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/40">
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${pctDone}%` }} />
              </div>
            )}
            <p className="mt-2 text-xs text-blue-700/80 dark:text-blue-300/70">
              {pipeline.fundamentals_ok ?? 0}/{pipeline.universe_size ?? 500} companies analysed. You can leave this page; it updates by itself.
            </p>
          </div>
        )}

        {listError && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {listError}
              <button onClick={loadList} className="ml-2 font-semibold underline">Retry</button>
            </div>
          </div>
        )}

        {/* filters */}
        <div className="flex flex-wrap items-center gap-2">
          {[{ id: "all", label: "All sizes" }, ...(list?.filters.caps ?? [])].map((c) => (
            <button
              key={c.id}
              onClick={() => setCap(c.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                cap === c.id
                  ? "bg-blue-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              }`}
            >
              {c.label}
            </button>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-slate-200 dark:bg-slate-800 sm:block" />
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            aria-label="Investor style"
          >
            <option value="all">All investor styles</option>
            {list?.filters.models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "default" | "return")}
            className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            aria-label="Sort"
          >
            <option value="default">Featured order</option>
            <option value="return">Highest return</option>
          </select>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* ── basket list ── */}
          <div className="flex flex-col gap-3">
            {!list && !listError && Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/50" />
            ))}
            {list && visible.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                No baskets match these filters.
              </div>
            )}
            {visible.map((b) => {
              const active = b.id === selectedId;
              return (
                <button
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    active
                      ? "border-blue-500 bg-white shadow-md ring-1 ring-blue-500/30 dark:bg-slate-900"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold leading-snug text-slate-900 dark:text-white">{b.name}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {b.cap_label}
                        </span>
                        <ModelChip model={b.model} label={b.model_label} />
                        {b.built && <span className="text-[10px] text-slate-400">{b.holdings_count} stocks</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {b.built && <Sparkline values={b.spark} up={(b.return_pct ?? 0) >= 0} />}
                      <div className="text-right">
                        <div className={`text-base font-extrabold ${tone(b.return_pct)}`}>
                          {b.built ? pct(b.return_pct) : "--"}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {b.return_basis === "live" ? "since creation" : b.return_basis === "simulated_1y" ? "1Y simulated*" : "building"}
                        </div>
                      </div>
                    </div>
                  </div>
                  {b.built && b.top_holdings.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {b.top_holdings.map((h) => (
                        <span key={h.symbol} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {h.symbol} {h.weight_pct}%
                        </span>
                      ))}
                    </div>
                  )}
                  {!b.built && <p className="mt-2 text-xs text-slate-400">{b.description}</p>}
                </button>
              );
            })}
            {visible.some((b) => b.return_basis === "simulated_1y") && (
              <p className="px-1 text-[11px] leading-relaxed text-slate-400">
                * Simulated: today&apos;s holdings applied to the past year of prices. This is not live performance and
                looks better than reality for momentum styles (the stocks were picked because they already rose). Live
                tracking starts from each basket&apos;s creation date and replaces this after 60 days.
              </p>
            )}
          </div>

          {/* ── detail ── */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            {detailError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
                {detailError}
              </div>
            )}
            {!detail && !detailError && selectedId && (
              <div className="h-96 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/50" />
            )}
            {detail && (
              <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-opacity dark:border-slate-800 dark:bg-slate-900 ${detailLoading ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">{detail.name}</h2>
                    <p className="mt-0.5 max-w-xl text-xs text-slate-500 dark:text-slate-400">{detail.description}</p>
                  </div>
                  <div className="flex gap-2 text-[11px]">
                    <div className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-center dark:bg-slate-800">
                      <div className="font-bold text-slate-800 dark:text-slate-100">{detail.model_label}</div>
                      <div className="text-slate-400">Model</div>
                    </div>
                    <div className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-center dark:bg-slate-800">
                      <div className="font-bold text-slate-800 dark:text-slate-100">{detail.cap_label}</div>
                      <div className="text-slate-400">Categorization</div>
                    </div>
                  </div>
                </div>

                {!detail.built ? (
                  <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                    This basket is still being built. It appears automatically once the data refresh finishes.
                  </div>
                ) : (
                  <>
                    {/* performance */}
                    <div className="mt-4 rounded-xl border border-slate-100 p-4 dark:border-slate-800">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-semibold uppercase tracking-wide">Performance</span>
                        <span>Invested {inr(detail.notional)}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                        {[
                          { label: "This basket", pct: detail.performance.basket_pct, color: "text-emerald-600 dark:text-emerald-400" },
                          { label: `FD @ ${detail.fd_rate_pct.toFixed(0)}%`, pct: detail.performance.fd_pct, color: "text-amber-600 dark:text-amber-400" },
                          { label: "NIFTY 50", pct: detail.performance.nifty_pct, color: "text-sky-600 dark:text-sky-400" },
                        ].map((x) => (
                          <div key={x.label}>
                            <div className={`text-lg font-extrabold ${x.color}`}>
                              {x.pct == null ? "--" : inr(detail.notional * (1 + x.pct / 100))}
                            </div>
                            <div className={`text-xs font-semibold ${tone(x.pct)}`}>{pct(x.pct)}</div>
                            <div className="text-[10px] text-slate-400">{x.label}</div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10 }} minTickGap={36} />
                            <YAxis
                              domain={["auto", "auto"]}
                              tick={{ fontSize: 10 }}
                              width={52}
                              tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                            />
                            <Tooltip
                              formatter={(v, name) => [inr(typeof v === "number" ? v : null), String(name)]}
                              labelFormatter={(l) => fmtDate(String(l))}
                              contentStyle={{ fontSize: 12, borderRadius: 8 }}
                            />
                            {detail.simulated_until && chartData.some((d) => d.date === detail.simulated_until) && (
                              <ReferenceLine x={detail.simulated_until} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "Created", fontSize: 10, fill: "#94a3b8", position: "insideTopRight" }} />
                            )}
                            <Line type="monotone" dataKey="fd" name="FD" stroke="#f59e0b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="nifty" name="NIFTY 50" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="sim" name="Basket (simulated)" stroke="#10b981" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="live" name="Basket (live)" stroke="#10b981" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex gap-1">
                          {RANGES.map((r) => (
                            <button
                              key={r}
                              onClick={() => setRange(r)}
                              className={`rounded-md px-2.5 py-1 text-[11px] font-bold ${
                                range === r ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                              }`}
                            >
                              {r === "ALL" ? "Overall" : r}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-slate-400">
                          <span className="inline-flex items-center gap-1"><span className="inline-block h-0 w-4 border-t-2 border-dashed border-emerald-500" />Simulated</span>
                          <span className="inline-flex items-center gap-1"><span className="inline-block h-0 w-4 border-t-2 border-emerald-500" />Live</span>
                        </div>
                      </div>
                    </div>

                    {/* holdings */}
                    <div className="mt-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Basket details · {detail.holdings.length} stocks
                      </div>
                      <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400 dark:bg-slate-950">
                            <tr>
                              <th className="px-3 py-2">Company</th>
                              <th className="px-3 py-2 text-right">Weight</th>
                              <th className="px-3 py-2 text-right">Score</th>
                              <th className="hidden px-3 py-2 text-right sm:table-cell">Since added</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {detail.holdings.map((h) => (
                              <tr key={h.symbol} className="text-slate-700 dark:text-slate-200">
                                <td className="px-3 py-2">
                                  <a href={`/invest-like?symbol=${h.symbol}`} className="font-bold hover:text-blue-600 hover:underline">{h.symbol}</a>
                                  <div className="max-w-[220px] truncate text-[10px] text-slate-400">
                                    {h.name}{h.sector ? ` · ${h.sector}` : ""}
                                  </div>
                                  {h.tags_pos.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {h.tags_pos.slice(0, 2).map((t) => (
                                        <span key={t} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                                          {t}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="font-semibold">{h.weight_pct.toFixed(1)}%</div>
                                  <div className="ml-auto mt-1 h-1 w-14 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                    <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, h.weight_pct * 7)}%` }} />
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right font-semibold">{h.score == null ? "--" : h.score.toFixed(1)}</td>
                                <td className={`hidden px-3 py-2 text-right font-semibold sm:table-cell ${tone(h.return_since_entry_pct)}`}>
                                  <span className="inline-flex items-center gap-0.5">
                                    {h.return_since_entry_pct != null && (h.return_since_entry_pct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)}
                                    {pct(h.return_since_entry_pct, 1)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                        {[
                          { label: "Basket created on", value: fmtDate(detail.created_on) },
                          { label: "Last rebalance", value: fmtDate(detail.last_rebalance) },
                          { label: "Next rebalance due", value: fmtDate(detail.next_rebalance) },
                        ].map((x) => (
                          <div key={x.label} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-950">
                            <div className="text-[10px] text-slate-400">{x.label}</div>
                            <div className="font-semibold text-slate-700 dark:text-slate-200">{x.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2 rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <div>
                        <p>{detail.methodology}</p>
                        <p className="mt-1.5">{detail.disclaimer}</p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
