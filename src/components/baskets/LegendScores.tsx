"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, Info, Loader2, Sparkles } from "lucide-react";

/* ───────────────────────────── types ───────────────────────────── */

type Breakdown = {
  key: string;
  label: string;
  weight: number;
  display: string | null;
  subscore: number | null;
};

type LegendScore = {
  model: string;
  label: string;
  investor: string;
  philosophy: string;
  score: number | null;
  band: string;
  coverage: number | null;
  tags_pos: string[];
  tags_neg: string[];
  breakdown: Breakdown[];
};

type Peer = {
  symbol: string;
  name: string | null;
  cap_class: string | null;
  scores: Record<string, number | null>;
};

type Insight = {
  symbol: string;
  name: string | null;
  sector: string | null;
  cap_class: string | null;
  price: number | null;
  scores: LegendScore[];
  in_baskets: { id: string; name: string }[];
  best_fit: { model: string; label: string; score: number } | null;
  peers: Peer[];
  disclaimer: string;
  detail?: string;
};

type AiSummary = {
  summary: string;
  positives: string[];
  negatives: string[];
  source: "llm" | "fallback";
  note: string;
  detail?: string;
};

/* ───────────────────────────── helpers ───────────────────────────── */

export const scoreColor = (s: number | null | undefined) =>
  s == null ? "#94a3b8" : s >= 80 ? "#10b981" : s >= 65 ? "#22c55e" : s >= 50 ? "#f59e0b" : s >= 35 ? "#f97316" : "#f43f5e";

const pillClass = (s: number | null | undefined) =>
  s == null
    ? "bg-slate-100 text-slate-400 dark:bg-slate-800"
    : s >= 80
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
      : s >= 65
        ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
        : s >= 50
          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
          : s >= 35
            ? "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
            : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300";

export function ScoreRing({ score, size = 64 }: { score: number | null; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const frac = score == null ? 0 : Math.max(0, Math.min(1, score / 100));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="5" className="stroke-slate-200 dark:stroke-slate-800" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          stroke={scoreColor(score)}
          strokeDasharray={`${c * frac} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-lg font-extrabold text-slate-900 dark:text-white">
        {score == null ? "--" : Math.round(score)}
      </div>
    </div>
  );
}

/* ───────────────────────────── component ───────────────────────────── */

export default function LegendScores({
  symbol,
  onPickPeer,
}: {
  symbol: string;
  /** when given, peers are buttons that call this (e.g. open another drawer); otherwise they link to the company page */
  onPickPeer?: (symbol: string) => void;
}) {
  const [insight, setInsight] = useState<Insight | null>(null);
  const [error, setError] = useState("");
  const [notCovered, setNotCovered] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, AiSummary | "loading" | "error">>({});
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    setInsight(null);
    setError("");
    setNotCovered(false);
    setSummaries({});
    fetch(`/api/baskets/stocks/${encodeURIComponent(symbol)}/scores`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as Insight;
        if (!alive) return;
        if (res.status === 404) return setNotCovered(true);
        if (!res.ok) throw new Error(data.detail ?? `HTTP ${res.status}`);
        setInsight(data);
        setSelected(data.best_fit?.model ?? data.scores[0]?.model ?? null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load investor scores"));
    return () => {
      alive = false;
    };
  }, [symbol]);

  const loadSummary = useCallback(
    async (model: string) => {
      setSelected(model);
      setSummaries((s) => (s[model] && s[model] !== "error" ? s : { ...s, [model]: "loading" }));
      if (summaries[model] && summaries[model] !== "error" && summaries[model] !== "loading") return;
      try {
        const res = await fetch(`/api/baskets/stocks/${encodeURIComponent(symbol)}/summary?model=${model}`, { cache: "no-store" });
        const data = (await res.json()) as AiSummary;
        if (!res.ok) throw new Error(data.detail ?? "failed");
        setSummaries((s) => ({ ...s, [model]: data }));
      } catch {
        setSummaries((s) => ({ ...s, [model]: "error" }));
      }
      setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
    },
    [symbol, summaries],
  );

  if (notCovered) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        Investor scores cover the Nifty 500 (large, mid and small caps). {symbol} isn&apos;t in that universe.
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
      </div>
    );
  }
  if (!insight) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-44 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/50" />
        ))}
      </div>
    );
  }

  const sel = insight.scores.find((s) => s.model === selected) ?? null;
  const sum = selected ? summaries[selected] : undefined;

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {insight.cap_class && (
          <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {insight.cap_class} cap
          </span>
        )}
        {insight.sector && <span className="text-slate-500">{insight.sector}</span>}
        {insight.best_fit && (
          <span className="rounded-md bg-blue-50 px-2 py-1 font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
            Best fit: {insight.best_fit.label} ({Math.round(insight.best_fit.score)})
          </span>
        )}
        {insight.in_baskets.map((b) => (
          <Link key={b.id} href="/baskets" className="rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-700 hover:underline dark:bg-emerald-500/10 dark:text-emerald-300">
            In basket: {b.name}
          </Link>
        ))}
      </div>

      {/* five score cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {insight.scores.map((s) => {
          const active = s.model === selected;
          return (
            <div
              key={s.model}
              className={`flex flex-col rounded-2xl border bg-white p-4 transition dark:bg-slate-900 ${
                active ? "border-blue-500 shadow-md ring-1 ring-blue-500/30" : "border-slate-200 dark:border-slate-800"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold leading-tight text-slate-900 dark:text-white">{s.label}</div>
                  <div className="mt-0.5 text-[10px] text-slate-400">{s.investor}</div>
                </div>
                <ScoreRing score={s.score} size={54} />
              </div>
              <div className={`mt-2 inline-flex w-fit rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${pillClass(s.score)}`}>
                {s.band}
              </div>
              <ul className="mt-3 flex-1 space-y-1">
                {s.tags_pos.map((t) => (
                  <li key={t} className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-700 dark:text-slate-300">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" /> {t}
                  </li>
                ))}
                {s.tags_neg.map((t) => (
                  <li key={t} className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-700 dark:text-slate-300">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" /> {t}
                  </li>
                ))}
                {s.tags_pos.length + s.tags_neg.length === 0 && <li className="text-[11px] text-slate-400">No standout strengths or weaknesses</li>}
              </ul>
              <button
                onClick={() => loadSummary(s.model)}
                className={`mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${
                  active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                <BookOpen className="h-3 w-3" /> Read summary
              </button>
            </div>
          );
        })}
      </div>

      {/* selected investor detail */}
      {sel && (
        <div ref={panelRef} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {sel.label} <span className="font-medium text-slate-400">· {sel.investor}</span>
              </h3>
              <p className="mt-1 max-w-3xl text-xs text-slate-500 dark:text-slate-400">Looks for: {sel.philosophy}.</p>
            </div>
            <div className={`rounded-lg px-3 py-1.5 text-sm font-extrabold ${pillClass(sel.score)}`}>
              {sel.score == null ? "--" : Math.round(sel.score)} / 100 · {sel.band}
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400">
              <Sparkles className="h-3 w-3" /> AI summary
            </div>
            {sum === undefined && (
              <p className="text-sm text-slate-500">Click &ldquo;Read summary&rdquo; on a card to generate this investor&apos;s take.</p>
            )}
            {sum === "loading" && (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading the numbers through {sel.label}&apos;s eyes…
              </p>
            )}
            {sum === "error" && (
              <p className="text-sm text-rose-600">
                Couldn&apos;t generate the summary.{" "}
                <button onClick={() => loadSummary(sel.model)} className="font-semibold underline">Retry</button>
              </p>
            )}
            {sum && sum !== "loading" && sum !== "error" && (
              <div>
                <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">{sum.summary}</p>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  {sum.positives.length > 0 && (
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-600">The positives</div>
                      <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                        {sum.positives.map((p) => (
                          <li key={p} className="flex gap-1.5"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {sum.negatives.length > 0 && (
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-rose-600">The watch-outs</div>
                      <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                        {sum.negatives.map((p) => (
                          <li key={p} className="flex gap-1.5"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <p className="mt-3 text-[10px] text-slate-400">{sum.note}</p>
              </div>
            )}
          </div>

          {/* why this score */}
          <div className="mt-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">How this score is built</div>
            <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400 dark:bg-slate-950">
                  <tr>
                    <th className="px-3 py-2">What we measure</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-3 py-2 text-right">Weight</th>
                    <th className="w-32 px-3 py-2">Rule score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sel.breakdown.map((b) => (
                    <tr key={b.key} className="text-slate-700 dark:text-slate-200">
                      <td className="px-3 py-1.5">{b.label}</td>
                      <td className="px-3 py-1.5 text-right font-semibold">{b.display ?? <span className="font-normal text-slate-400">n/a</span>}</td>
                      <td className="px-3 py-1.5 text-right text-slate-400">{b.weight}</td>
                      <td className="px-3 py-1.5">
                        {b.subscore == null ? (
                          <span className="text-slate-400">no data</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                              <div className="h-full rounded-full" style={{ width: `${b.subscore}%`, background: scoreColor(b.subscore) }} />
                            </div>
                            <span className="w-6 text-right font-semibold">{b.subscore}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sel.coverage != null && sel.coverage < 1 && (
              <p className="mt-1.5 text-[10px] text-slate-400">Based on {Math.round(sel.coverage * 100)}% of this model&apos;s factors; missing data is left out rather than guessed.</p>
            )}
          </div>
        </div>
      )}

      {/* peers */}
      {insight.peers.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Compare with similar stocks</div>
          <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400 dark:bg-slate-950">
                <tr>
                  <th className="px-3 py-2">Investor lens</th>
                  <th className="px-3 py-2 text-center font-extrabold text-slate-700 dark:text-slate-200">{insight.symbol}</th>
                  {insight.peers.map((p) => (
                    <th key={p.symbol} className="px-3 py-2 text-center">
                      {onPickPeer ? (
                        <button onClick={() => onPickPeer(p.symbol)} className="font-bold text-blue-600 hover:underline dark:text-blue-400">{p.symbol}</button>
                      ) : (
                        <Link href={`/company/${p.symbol}`} className="font-bold text-blue-600 hover:underline dark:text-blue-400">{p.symbol}</Link>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {insight.scores.map((s) => (
                  <tr key={s.model}>
                    <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{s.label}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`rounded-md px-2 py-0.5 font-bold ${pillClass(s.score)}`}>{s.score == null ? "--" : Math.round(s.score)}</span>
                    </td>
                    {insight.peers.map((p) => (
                      <td key={p.symbol} className="px-3 py-2 text-center">
                        <span className={`rounded-md px-2 py-0.5 font-bold ${pillClass(p.scores[s.model])}`}>
                          {p.scores[s.model] == null ? "--" : Math.round(p.scores[s.model] as number)}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="flex gap-2 text-[11px] leading-relaxed text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {insight.disclaimer}
      </p>
    </div>
  );
}
