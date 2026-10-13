"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ExternalLink, Search, Trophy, X } from "lucide-react";
import LegendScores, { scoreColor } from "@/components/baskets/LegendScores";

type Row = {
  rank: number;
  symbol: string;
  name: string | null;
  sector: string | null;
  cap_class: string | null;
  price: number | null;
  score: number;
  coverage: number;
  tags_pos: string[];
  tags_neg: string[];
};

type Ranking = {
  model: string;
  label: string;
  philosophy?: string;
  cap: string | null;
  results: Row[];
  disclaimer: string;
  detail?: string;
};

const MODELS = [
  { id: "buffett", label: "Warren Buffett", style: "Value investing" },
  { id: "lynch", label: "Peter Lynch", style: "GARP investing" },
  { id: "jhunjhunwala", label: "Rakesh Jhunjhunwala", style: "Market trends & growth" },
  { id: "hundred_baggers", label: "100 Baggers", style: "Christopher Mayer" },
  { id: "canslim", label: "CANSLIM", style: "William O'Neil" },
];

const CAPS = [
  { id: "all", label: "All sizes" },
  { id: "large", label: "Large Cap" },
  { id: "mid", label: "Mid Cap" },
  { id: "small", label: "Small Cap" },
];

const inr = (v: number | null) => (v == null ? "--" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

export default function InvestLikePage() {
  // useSearchParams needs a Suspense boundary
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading…</div>}>
      <InvestLike />
    </Suspense>
  );
}

function InvestLike() {
  const params = useSearchParams();
  const initialModel = MODELS.some((x) => x.id === params.get("model")) ? (params.get("model") as string) : "buffett";
  const [model, setModel] = useState(initialModel);
  const [cap, setCap] = useState("all");
  const [sector, setSector] = useState("all");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Ranking | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  // deep link: /invest-like?model=lynch&symbol=TCS
  const [drawer, setDrawer] = useState<string | null>(params.get("symbol")?.toUpperCase() ?? null);
  const key = `${model}|${cap}`;
  const loading = loadedKey !== key;

  const syncUrl = useCallback((m: string, s: string | null) => {
    const p = new URLSearchParams();
    p.set("model", m);
    if (s) p.set("symbol", s);
    window.history.replaceState(null, "", `/invest-like?${p.toString()}`);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const qs = new URLSearchParams({ model, limit: "200" });
    if (cap !== "all") qs.set("cap", cap);
    fetch(`/api/baskets/stocks/ranking?${qs}`, { cache: "no-store", signal: ac.signal })
      .then(async (res) => {
        const body = (await res.json()) as Ranking;
        if (!res.ok) throw new Error(body.detail ?? `HTTP ${res.status}`);
        setData(body);
        setError("");
        setLoadedKey(`${model}|${cap}`);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Could not load the ranking");
        setLoadedKey(`${model}|${cap}`);
      });
    return () => ac.abort();
  }, [model, cap]);

  const sectors = useMemo(() => Array.from(new Set((data?.results ?? []).map((r) => r.sector).filter(Boolean) as string[])).sort(), [data]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.results ?? [])
      .filter((r) => sector === "all" || r.sector === sector)
      .filter((r) => !term || r.symbol.toLowerCase().includes(term) || (r.name ?? "").toLowerCase().includes(term))
      .slice(0, 100);
  }, [data, q, sector]);

  const active = MODELS.find((m) => m.id === model)!;

  const openDrawer = (s: string | null) => {
    setDrawer(s);
    syncUrl(model, s);
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-slate-50 p-4 font-sans dark:bg-slate-950 lg:p-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Trophy className="h-6 w-6 text-amber-500" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Invest Like…</h1>
            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
              NIFTY 500 RANKED
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Every stock scored through five investing legends&apos; rules. Pick an investor to see which stocks fit their style best, then open any stock for the reasons.
          </p>
        </div>

        {/* investor tabs */}
        <div className="flex flex-wrap gap-2">
          {MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setModel(m.id);
                syncUrl(m.id, drawer);
              }}
              className={`rounded-xl border px-4 py-2 text-left transition ${
                model === m.id
                  ? "border-blue-500 bg-blue-600 text-white shadow"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              }`}
            >
              <div className="text-sm font-bold">{m.label}</div>
              <div className={`text-[10px] ${model === m.id ? "text-blue-100" : "text-slate-400"}`}>{m.style}</div>
            </button>
          ))}
        </div>
        {data?.philosophy && (
          <p className="rounded-xl bg-white px-4 py-3 text-xs text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
            <span className="font-bold">{active.label} looks for:</span> {data.philosophy}.
          </p>
        )}

        {/* filters */}
        <div className="flex flex-wrap items-center gap-2">
          {CAPS.map((c) => (
            <button
              key={c.id}
              onClick={() => setCap(c.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                cap === c.id
                  ? "bg-blue-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              }`}
            >
              {c.label}
            </button>
          ))}
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            aria-label="Sector"
          >
            <option value="all">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search company or symbol…"
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* ranking */}
        <div className={`overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${loading ? "opacity-60" : ""}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400 dark:bg-slate-950">
                <tr>
                  <th className="w-12 px-4 py-3">#</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Size</th>
                  <th className="w-44 px-4 py-3">{active.label} score</th>
                  <th className="px-4 py-3">Why it fits</th>
                  <th className="px-4 py-3">Watch-outs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r) => (
                  <tr
                    key={r.symbol}
                    onClick={() => openDrawer(r.symbol)}
                    className="cursor-pointer text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-4 py-3 font-semibold text-slate-400">{r.rank}</td>
                    <td className="px-4 py-3">
                      <div className="font-bold">{r.symbol}</div>
                      <div className="max-w-[220px] truncate text-[10px] text-slate-400">
                        {r.name}{r.sector ? ` · ${r.sector}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize">{r.cap_class}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-7 text-sm font-extrabold">{Math.round(r.score)}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className="h-full rounded-full" style={{ width: `${r.score}%`, background: scoreColor(r.score) }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.tags_pos.map((t) => (
                          <span key={t} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.tags_neg.map((t) => (
                          <span key={t} className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{t}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                      {data?.results.length === 0 ? "Scores aren't built yet. Open AI Baskets to start the first data build." : "No stocks match these filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400">
          {data?.disclaimer} Showing the top {rows.length} of {data?.results.length ?? 0} matching stocks with enough data to be scored.
        </p>
      </div>

      {/* stock drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => openDrawer(null)} />
          <div className="relative h-full w-full max-w-5xl overflow-y-auto bg-slate-50 p-5 shadow-2xl dark:bg-slate-950">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xl font-bold text-slate-900 dark:text-white">{drawer}</div>
                <div className="text-xs text-slate-500">
                  {data?.results.find((r) => r.symbol === drawer)?.name ?? ""}
                  {(() => {
                    const p = data?.results.find((r) => r.symbol === drawer)?.price;
                    return p != null ? ` · ${inr(p)}` : "";
                  })()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/company/${drawer}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                  Company page <ExternalLink className="h-3 w-3" />
                </Link>
                <button onClick={() => openDrawer(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800" aria-label="Close drawer">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <LegendScores symbol={drawer} onPickPeer={(s) => openDrawer(s)} />
          </div>
        </div>
      )}
    </div>
  );
}
