"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { FieldMeta, ScreenRow, formatValue } from "@/lib/stock-screener";

interface Props {
  rows: ScreenRow[];
  columns: FieldMeta[];
  fields: Map<string, FieldMeta>;
  sortBy: string;
  sortDesc: boolean;
  onSort: (key: string) => void;
  selected: string[];
  onToggle: (symbol: string) => void;
  loading: boolean;
}

const capLabel: Record<string, string> = { large: "Large", mid: "Mid", small: "Small" };

function tone(f: FieldMeta, v: number | boolean | null | undefined) {
  if (typeof v !== "number") return "";
  if (f.key.startsWith("ret_") || f.key === "rel_strength_12m" || f.key === "promoter_change_qoq")
    return v > 0 ? "text-emerald-600 dark:text-emerald-400" : v < 0 ? "text-red-600 dark:text-red-400" : "";
  return "";
}

export function ResultsTable({ rows, columns, fields, sortBy, sortDesc, onSort, selected, onToggle, loading }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  const th = (key: string, label: string, align: "left" | "right" = "right") => (
    <th
      key={key}
      scope="col"
      aria-sort={sortBy === key ? (sortDesc ? "descending" : "ascending") : "none"}
      className={`px-3 py-2.5 font-semibold text-[11px] uppercase tracking-[0.06em] text-[#475467] dark:text-slate-400 whitespace-nowrap ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button type="button" onClick={() => onSort(key)} className="inline-flex items-center gap-1 hover:text-[#1F5EFF] dark:hover:text-blue-400">
        {label}
        {sortBy === key && (sortDesc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
      </button>
    </th>
  );

  if (!loading && rows.length === 0) {
    return (
      <div className="rounded-2xl border border-[#EAECF0] dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center">
        <p className="m-0 text-[15px] font-semibold text-[#0F172A] dark:text-white">No stocks match these conditions</p>
        <p className="mt-1.5 mb-0 text-[13px] text-[#475467] dark:text-slate-400">
          Relax a threshold or remove a condition. Stocks with no data for a filtered field never match it.
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-[#EAECF0] dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className="overflow-auto max-h-[calc(100vh-330px)] min-h-[260px]">
        <table className="w-full text-[13px] border-collapse">
          <thead className="sticky top-0 z-10 bg-[#F9FAFB] dark:bg-slate-900 shadow-[0_1px_0_#EAECF0] dark:shadow-[0_1px_0_#1e293b]">
            <tr>
              <th className="w-9 px-3" aria-label="Select" />
              {th("symbol", "Stock", "left")}
              {columns.map((c) => th(c.key, c.label))}
              <th className="w-9" aria-label="Why it matched" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = open === r.symbol;
              const checked = selected.includes(r.symbol);
              return (
                <React.Fragment key={r.symbol}>
                  <tr className="border-t border-[#F2F4F7] dark:border-slate-800 hover:bg-[#F9FAFB] dark:hover:bg-slate-800/40">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.symbol} to compare`}
                        checked={checked}
                        onChange={() => onToggle(r.symbol)}
                        className="w-4 h-4 accent-[#1F5EFF]"
                      />
                    </td>
                    <td className="px-3 py-2 min-w-[210px]">
                      <Link href={`/company/${encodeURIComponent(r.symbol)}`} className="font-semibold text-[#0F172A] dark:text-white hover:text-[#1F5EFF] dark:hover:text-blue-400">
                        {r.symbol}
                      </Link>
                      <div className="text-[11.5px] text-[#667085] dark:text-slate-400 truncate max-w-[260px]">
                        {r.name}
                        {r.sector ? ` · ${r.sector}` : ""}
                        {r.cap_class ? ` · ${capLabel[r.cap_class] ?? r.cap_class}` : ""}
                      </div>
                    </td>
                    {columns.map((c) => {
                      const v = r.metrics[c.key];
                      return (
                        <td key={c.key} className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${tone(c, v)}`}>
                          {c.key === "pe" && typeof v === "number" && v <= 0 ? "n/m" : formatValue(c, v)}
                        </td>
                      );
                    })}
                    <td className="px-2">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`Why ${r.symbol} matched`}
                        onClick={() => setOpen(isOpen ? null : r.symbol)}
                        className="w-7 h-7 grid place-items-center rounded-md text-[#667085] hover:bg-[#F2F4F7] dark:hover:bg-slate-800"
                      >
                        <ChevronRight className={`w-4 h-4 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-[#F9FAFB] dark:bg-slate-900/70">
                      <td />
                      <td colSpan={columns.length + 2} className="px-3 py-3">
                        {r.why.length === 0 ? (
                          <span className="text-[12.5px] text-[#667085] dark:text-slate-400">No conditions are applied, so every stock is shown.</span>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {r.why.map((w, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1.5 rounded-full border border-[#ABEFC6] dark:border-emerald-800/60 bg-[#ECFDF3] dark:bg-emerald-950/30 px-2.5 py-1 text-[12px] text-[#067647] dark:text-emerald-400"
                              >
                                {w.text}
                                <strong className="font-semibold">
                                  {"→ "}
                                  {formatValue(fields.get(w.field), w.actual as number | boolean | string | null)}
                                </strong>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
