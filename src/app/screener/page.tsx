"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, GitCompareArrows, Info, Loader2, Save, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { FilterPanel } from "@/components/screener/FilterPanel";
import { ResultsTable } from "@/components/screener/ResultsTable";
import {
  FieldMeta,
  SavedScreen,
  ScreenResponse,
  ScreenerMeta,
  UiCondition,
  fetchScreenerMeta,
  loadSavedScreens,
  newId,
  runScreen,
  storeSavedScreens,
  toRequest,
  withIds,
} from "@/lib/stock-screener";

const MAX_COMPARE = 4;
const chip =
  "inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12.5px] font-semibold whitespace-nowrap transition-colors";

export default function ScreenerPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<ScreenerMeta | null>(null);
  const [metaError, setMetaError] = useState("");
  const [conds, setConds] = useState<UiCondition[]>([]);
  const [activePreset, setActivePreset] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("mcap_cr");
  const [sortDesc, setSortDesc] = useState(true);
  const [data, setData] = useState<ScreenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedScreen[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const reqId = useRef(0);

  useEffect(() => {
    setSaved(loadSavedScreens());
    fetchScreenerMeta()
      .then(setMeta)
      .catch((e: Error) => setMetaError(e.message));
  }, []);

  const fields = useMemo(() => {
    const m = new Map<string, FieldMeta>();
    meta?.groups.forEach((g) => g.fields.forEach((f) => m.set(f.key, f)));
    return m;
  }, [meta]);

  // default columns plus any numeric field the user is filtering on, so the filter is visible in the table
  const columns = useMemo(() => {
    if (!meta) return [];
    const keys = [...meta.default_columns];
    for (const c of conds) {
      const f = fields.get(c.field);
      if (f && f.kind !== "cat" && !keys.includes(c.field) && keys.length < meta.default_columns.length + 4) keys.push(c.field);
    }
    return keys.map((k) => fields.get(k)).filter((f): f is FieldMeta => !!f);
  }, [meta, conds, fields]);

  const apply = useCallback(
    async (list: UiCondition[], q: string, by: string, desc: boolean) => {
      const id = ++reqId.current;
      setLoading(true);
      setError("");
      try {
        const out = await runScreen({ conditions: toRequest(list), search: q, sort_by: by, sort_desc: desc, limit: 500 });
        if (id === reqId.current) setData(out);
      } catch (e) {
        if (id === reqId.current) setError(e instanceof Error ? e.message : "Screening failed");
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [],
  );

  // re-run shortly after any change (debounced so typing a number does not fire a request per keystroke)
  useEffect(() => {
    if (!meta) return;
    const t = setTimeout(() => apply(conds, search, sortBy, sortDesc), 300);
    return () => clearTimeout(t);
  }, [meta, conds, search, sortBy, sortDesc, apply]);

  const loadPreset = (id: string) => {
    const p = meta?.presets.find((x) => x.id === id);
    if (!p) return;
    setActivePreset(id);
    setConds(withIds(p.conditions));
  };

  const onConditionsChange = (next: UiCondition[]) => {
    setConds(next);
    setActivePreset("custom");
  };

  const onSort = (key: string) => {
    if (key === sortBy) setSortDesc((d) => !d);
    else {
      setSortBy(key);
      setSortDesc(key !== "symbol");
    }
  };

  const toggle = (symbol: string) =>
    setSelected((s) => (s.includes(symbol) ? s.filter((x) => x !== symbol) : s.length >= MAX_COMPARE ? s : [...s, symbol]));

  const saveScreen = () => {
    const name = saveName.trim();
    const conditions = toRequest(conds);
    if (!name) return;
    const next = [{ name, conditions }, ...saved.filter((s) => s.name !== name)];
    setSaved(next);
    storeSavedScreens(next);
    setSaving(false);
    setSaveName("");
    setActivePreset(`saved:${name}`);
  };

  const removeSaved = (name: string) => {
    const next = saved.filter((s) => s.name !== name);
    setSaved(next);
    storeSavedScreens(next);
  };

  const exportCsv = () => {
    if (!data?.results.length) return;
    const head = ["Symbol", "Name", "Sector", "Cap", ...columns.map((c) => `${c.label}${c.unit ? ` (${c.unit})` : ""}`)];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")];
    for (const r of data.results)
      lines.push([r.symbol, r.name, r.sector, r.cap_class, ...columns.map((c) => r.metrics[c.key])].map(esc).join(","));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `finpilot_screen_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const med = data?.summary.median;
  const stat = (label: string, value: string, sub?: string) => (
    <div className="rounded-xl border border-[#EAECF0] dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#475467] dark:text-slate-400">{label}</div>
      <div className="mt-1 text-[22px] font-bold tabular-nums leading-tight text-[#0F172A] dark:text-white">{value}</div>
      {sub && <div className="text-[11.5px] text-[#667085] dark:text-slate-500">{sub}</div>}
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-107px)] bg-[#F6F7F9] dark:bg-[#090d16] text-[#0F172A] dark:text-slate-100 font-sans antialiased">
      <div className="mx-auto max-w-[1680px] px-4 sm:px-8 pt-6 sm:pt-8 pb-10 flex flex-col gap-4">
        {/* header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <span className="w-[52px] h-[52px] rounded-[14px] bg-[#EFF4FF] dark:bg-blue-950/40 text-[#1F5EFF] dark:text-blue-400 border border-[#B2CCFF] dark:border-blue-800/60 grid place-items-center shrink-0">
              <SlidersHorizontal className="w-6 h-6" strokeWidth={1.8} />
            </span>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="m-0 text-[28px] font-bold tracking-[-0.02em]">Stock Screener</h1>
                <span className="px-2.5 py-1 border border-[#D0D5DD] dark:border-slate-700 rounded-full bg-white dark:bg-slate-800 text-[11px] font-semibold tracking-[0.1em] text-[#475467] dark:text-slate-300">
                  NIFTY 500
                </span>
              </div>
              <p className="mt-1.5 mb-0 text-[14.5px] text-[#475467] dark:text-slate-400">
                Filter {meta?.universe ?? 500} stocks on earnings, valuation, dividends, ownership and price trend.
                {meta?.as_of && <span className="text-[#667085] dark:text-slate-500"> Data as of {new Date(meta.as_of).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.</span>}
              </p>
            </div>
          </div>
          <div className="relative w-full sm:w-[300px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
            <input
              aria-label="Search by name or symbol"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or symbol"
              className="w-full h-11 pl-9 pr-3 rounded-xl border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#1F5EFF]/40"
            />
          </div>
        </div>

        {(metaError || error) && (
          <div role="alert" className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-sm">
            <strong className="font-semibold">Screener error:</strong> {metaError || error}
          </div>
        )}

        {/* presets */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Preset screens">
          {meta?.presets.map((p) => {
            const on = activePreset === p.id;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={on}
                title={p.blurb}
                onClick={() => loadPreset(p.id)}
                className={`${chip} ${on ? "bg-[#1F5EFF] border-[#1F5EFF] text-white" : "bg-white dark:bg-slate-900 border-[#D0D5DD] dark:border-slate-700 text-[#344054] dark:text-slate-200 hover:border-[#1F5EFF]"}`}
              >
                {p.name}
                <span className={`text-[11px] font-bold tabular-nums ${on ? "text-blue-100" : "text-[#667085] dark:text-slate-400"}`}>{p.matches}</span>
              </button>
            );
          })}
          {saved.map((s) => {
            const id = `saved:${s.name}`;
            const on = activePreset === id;
            return (
              <span key={id} className={`${chip} pr-1.5 ${on ? "bg-[#067647] border-[#067647] text-white" : "bg-[#ECFDF3] dark:bg-emerald-950/30 border-[#ABEFC6] dark:border-emerald-800/60 text-[#067647] dark:text-emerald-400"}`}>
                <button onClick={() => { setActivePreset(id); setConds(withIds(s.conditions)); }} className="font-semibold">
                  {s.name}
                </button>
                <button aria-label={`Delete saved screen ${s.name}`} onClick={() => removeSaved(s.name)} className="w-5 h-5 grid place-items-center rounded-full hover:bg-black/10">
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>

        {meta && activePreset !== "custom" && !activePreset.startsWith("saved:") && (
          <p className="m-0 -mt-1 text-[13px] text-[#475467] dark:text-slate-400">
            {meta.presets.find((p) => p.id === activePreset)?.blurb}
          </p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4 items-start">
          {/* filters */}
          <aside className="rounded-2xl border border-[#EAECF0] dark:border-slate-800 bg-white dark:bg-slate-900 p-4 lg:sticky lg:top-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="m-0 text-[13px] font-bold uppercase tracking-[0.07em] text-[#475467] dark:text-slate-300">
                Filters {conds.length > 0 && <span className="ml-1 text-[#1F5EFF] dark:text-blue-400">({conds.length})</span>}
              </h2>
              <div className="flex items-center gap-1">
                {conds.length > 0 && (
                  <button onClick={() => { setConds([]); setActivePreset("custom"); }} className="text-[12px] font-semibold text-[#667085] hover:text-red-600 px-2 h-7 rounded-md">
                    Clear
                  </button>
                )}
                <button onClick={() => setFiltersOpen((o) => !o)} className="lg:hidden text-[12px] font-semibold text-[#1F5EFF] px-2 h-7 rounded-md">
                  {filtersOpen ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            <div className={filtersOpen ? "block" : "hidden lg:block"}>
              {meta ? <FilterPanel meta={meta} conditions={conds} onChange={onConditionsChange} /> : <Loader />}
              <div className="mt-3 pt-3 border-t border-[#F2F4F7] dark:border-slate-800">
                {saving ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      aria-label="Name for this screen"
                      value={saveName}
                      maxLength={40}
                      onChange={(e) => setSaveName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveScreen(); if (e.key === "Escape") setSaving(false); }}
                      placeholder="Name this screen"
                      className="h-9 flex-1 min-w-0 rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1F5EFF]/40"
                    />
                    <button aria-label="Save" onClick={saveScreen} disabled={!saveName.trim()} className="h-9 w-9 grid place-items-center rounded-lg bg-[#1F5EFF] text-white disabled:opacity-40">
                      <Check className="w-4 h-4" />
                    </button>
                    <button aria-label="Cancel" onClick={() => setSaving(false)} className="h-9 w-9 grid place-items-center rounded-lg border border-[#D0D5DD] dark:border-slate-700">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setSaving(true)}
                    disabled={toRequest(conds).length === 0}
                    className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-[#D0D5DD] dark:border-slate-700 text-[13px] font-semibold text-[#344054] dark:text-slate-200 hover:border-[#1F5EFF] disabled:opacity-40"
                  >
                    <Save className="w-4 h-4" /> Save this screen
                  </button>
                )}
                <p className="mt-2 mb-0 text-[11px] text-[#667085] dark:text-slate-500">Saved screens are kept in this browser.</p>
              </div>
            </div>
          </aside>

          {/* results */}
          <section className="flex flex-col gap-3 min-w-0">
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {stat("Matches", loading && !data ? "…" : String(data?.matched ?? 0), `of ${data?.total_universe ?? meta?.universe ?? 500} stocks`)}
              {stat("Median P/E", med?.pe != null ? med.pe.toFixed(1) : "—", "among matches")}
              {stat("Median ROE", med?.roe != null ? `${med.roe.toFixed(1)}%` : "—", "among matches")}
              {stat("Median profit growth", med?.profit_cagr != null ? `${med.profit_cagr.toFixed(1)}%` : "—", "annual, multi-year")}
            </div>

            {data && data.summary.sectors.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap text-[12px] text-[#475467] dark:text-slate-400">
                <span className="font-semibold uppercase tracking-[0.06em] text-[11px]">Top sectors</span>
                {data.summary.sectors.slice(0, 5).map((s) => (
                  <button
                    key={s.sector}
                    onClick={() => onConditionsChange([...conds, { id: newId(), field: "sector", op: "==", value: s.sector }])}
                    title={`Filter to ${s.sector}`}
                    className="px-2.5 py-1 rounded-full bg-white dark:bg-slate-900 border border-[#EAECF0] dark:border-slate-800 hover:border-[#1F5EFF]"
                  >
                    {s.sector} <strong className="tabular-nums">{s.count}</strong>
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-[13px] text-[#475467] dark:text-slate-400 inline-flex items-center gap-2">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {data ? `Showing ${data.returned} of ${data.matched} matches` : "Loading…"}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => router.push(`/compare?symbols=${selected.join(",")}`)}
                  disabled={selected.length < 2}
                  className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg bg-[#1F5EFF] text-white text-[13px] font-semibold hover:bg-blue-600 disabled:opacity-40 disabled:hover:bg-[#1F5EFF]"
                  title={selected.length < 2 ? `Tick 2 to ${MAX_COMPARE} stocks to compare` : "Compare selected stocks"}
                >
                  <GitCompareArrows className="w-4 h-4" /> Compare{selected.length ? ` (${selected.length})` : ""}
                </button>
                {selected.length > 0 && (
                  <button onClick={() => setSelected([])} className="text-[12px] font-semibold text-[#667085] hover:text-red-600">Clear</button>
                )}
                <button onClick={exportCsv} disabled={!data?.results.length} className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 text-[13px] font-semibold disabled:opacity-40">
                  <Download className="w-4 h-4" /> CSV
                </button>
              </div>
            </div>

            <ResultsTable
              rows={data?.results ?? []}
              columns={columns}
              fields={fields}
              sortBy={sortBy}
              sortDesc={sortDesc}
              onSort={onSort}
              selected={selected}
              onToggle={toggle}
              loading={loading}
            />

            <p className="m-0 inline-flex items-start gap-2 text-[11.5px] leading-relaxed text-[#667085] dark:text-slate-500">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {meta?.note ?? "Screens are research aids, not investment recommendations."} Stocks missing a value for a filtered field are excluded.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Loader() {
  return (
    <div className="flex items-center gap-2 text-[13px] text-[#667085]">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading screener…
    </div>
  );
}
