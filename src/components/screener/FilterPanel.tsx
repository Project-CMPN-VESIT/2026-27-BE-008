"use client";

import React, { useMemo } from "react";
import { Plus, X } from "lucide-react";
import { FieldMeta, ScreenerMeta, UiCondition, newId } from "@/lib/stock-screener";

const NUM_OPS: { op: string; label: string }[] = [
  { op: ">=", label: "at least" },
  { op: "<=", label: "at most" },
  { op: ">", label: "more than" },
  { op: "<", label: "less than" },
  { op: "between", label: "between" },
  { op: "==", label: "equal to" },
];
const CAT_OPS = [
  { op: "==", label: "is" },
  { op: "!=", label: "is not" },
];

const inputCls =
  "h-9 rounded-lg border border-[#D0D5DD] dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-[13px] text-[#0F172A] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1F5EFF]/40";

interface Props {
  meta: ScreenerMeta;
  conditions: UiCondition[];
  onChange: (next: UiCondition[]) => void;
}

export function FilterPanel({ meta, conditions, onChange }: Props) {
  const fields = useMemo(() => {
    const map = new Map<string, FieldMeta>();
    meta.groups.forEach((g) => g.fields.forEach((f) => map.set(f.key, f)));
    return map;
  }, [meta]);

  const update = (id: string, patch: Partial<UiCondition>) =>
    onChange(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const defaultFor = (f: FieldMeta): Pick<UiCondition, "op" | "value"> => {
    if (f.kind === "bool") return { op: "==", value: true };
    if (f.kind === "cat") return { op: "==", value: f.key === "sector" ? meta.sectors[0] ?? "" : "large" };
    return { op: ">=", value: NaN as unknown as number };
  };

  const changeField = (c: UiCondition, key: string) => {
    const f = fields.get(key);
    if (f) update(c.id, { field: key, ...defaultFor(f) });
  };

  const add = () => {
    const f = fields.get("roe") ?? [...fields.values()][0];
    onChange([...conditions, { id: newId(), field: f.key, ...defaultFor(f) }]);
  };

  const numStr = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");

  return (
    <div className="flex flex-col gap-3">
      {conditions.length === 0 && (
        <p className="m-0 text-[13px] text-[#475467] dark:text-slate-400">
          No filters yet. Pick a preset above, or add a condition to narrow the {meta.universe} stocks.
        </p>
      )}

      {conditions.map((c) => {
        const f = fields.get(c.field);
        if (!f) return null;
        const between = c.op === "between";
        const pair = Array.isArray(c.value) ? (c.value as [number, number]) : [NaN, NaN];
        return (
          <div
            key={c.id}
            className="rounded-xl border border-[#EAECF0] dark:border-slate-800 bg-[#F9FAFB] dark:bg-slate-900/60 p-2.5 flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <select
                aria-label="Field"
                value={c.field}
                onChange={(e) => changeField(c, e.target.value)}
                className={`${inputCls} flex-1 min-w-0`}
              >
                {meta.groups.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.fields.map((ff) => (
                      <option key={ff.key} value={ff.key}>
                        {ff.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Remove ${f.label} filter`}
                onClick={() => onChange(conditions.filter((x) => x.id !== c.id))}
                className="h-9 w-9 shrink-0 grid place-items-center rounded-lg text-[#667085] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {f.kind === "num" && (
                <>
                  <select
                    aria-label="Comparison"
                    value={c.op}
                    onChange={(e) => {
                      const op = e.target.value;
                      update(c.id, {
                        op,
                        value:
                          op === "between"
                            ? ([NaN, NaN] as unknown as [number, number])
                            : Array.isArray(c.value)
                              ? (NaN as unknown as number)
                              : c.value,
                      });
                    }}
                    className={`${inputCls} w-[104px] shrink-0`}
                  >
                    {NUM_OPS.map((o) => (
                      <option key={o.op} value={o.op}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {between ? (
                    <>
                      <input
                        aria-label="From"
                        type="number"
                        inputMode="decimal"
                        value={numStr(pair[0])}
                        onChange={(e) => update(c.id, { value: [e.target.value === "" ? NaN : Number(e.target.value), pair[1]] })}
                        className={`${inputCls} w-full min-w-0`}
                        placeholder="from"
                      />
                      <span className="text-xs text-[#667085]">and</span>
                      <input
                        aria-label="To"
                        type="number"
                        inputMode="decimal"
                        value={numStr(pair[1])}
                        onChange={(e) => update(c.id, { value: [pair[0], e.target.value === "" ? NaN : Number(e.target.value)] })}
                        className={`${inputCls} w-full min-w-0`}
                        placeholder="to"
                      />
                    </>
                  ) : (
                    <input
                      aria-label="Value"
                      type="number"
                      inputMode="decimal"
                      value={numStr(c.value)}
                      onChange={(e) => update(c.id, { value: e.target.value === "" ? (NaN as unknown as number) : Number(e.target.value) })}
                      className={`${inputCls} w-full min-w-0`}
                      placeholder="value"
                    />
                  )}
                  {f.unit && <span className="text-xs text-[#667085] dark:text-slate-400 shrink-0 w-9">{f.unit}</span>}
                </>
              )}

              {f.kind === "bool" && (
                <select
                  aria-label="Value"
                  value={c.value === true ? "yes" : "no"}
                  onChange={(e) => update(c.id, { op: "==", value: e.target.value === "yes" })}
                  className={`${inputCls} w-full`}
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              )}

              {f.kind === "cat" && (
                <>
                  <select
                    aria-label="Comparison"
                    value={c.op}
                    onChange={(e) => update(c.id, { op: e.target.value })}
                    className={`${inputCls} w-[84px] shrink-0`}
                  >
                    {CAT_OPS.map((o) => (
                      <option key={o.op} value={o.op}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Value"
                    value={String(c.value)}
                    onChange={(e) => update(c.id, { value: e.target.value })}
                    className={`${inputCls} w-full min-w-0`}
                  >
                    {(f.key === "sector" ? meta.sectors : meta.caps).map((v) => (
                      <option key={v} value={v}>
                        {f.key === "cap_class" ? `${v[0].toUpperCase()}${v.slice(1)} cap` : v}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
            {f.hint && <p className="m-0 text-[11px] text-[#667085] dark:text-slate-500">{f.hint}</p>}
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed border-[#B2CCFF] dark:border-blue-800 text-[13px] font-semibold text-[#1F5EFF] dark:text-blue-400 hover:bg-[#EFF4FF] dark:hover:bg-blue-950/30"
      >
        <Plus className="w-4 h-4" /> Add condition
      </button>
    </div>
  );
}
