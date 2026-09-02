"use client";

import React, { useState } from "react";
import { Plus, X, ListFilter, Trash2 } from "lucide-react";

export const METRICS = [
  { id: "market_cap", label: "Market Cap", format: "cr" },
  { id: "pe_ttm", label: "P/E Ratio", format: "num" },
  { id: "pb", label: "P/B Ratio", format: "num" },
  { id: "roe", label: "ROE (%)", format: "pct" },
  { id: "roce", label: "ROCE (%)", format: "pct" },
  { id: "debt_equity", label: "Debt / Equity", format: "num" },
  { id: "dividend_yield", label: "Div Yield (%)", format: "pct" },
  { id: "current_price", label: "Price (₹)", format: "num" },
  { id: "sales_growth_5y", label: "5Y Sales (%)", format: "pct" },
  { id: "profit_growth_5y", label: "5Y Profit (%)", format: "pct" },
];

const OPS = ["<", "<=", ">", ">=", "==", "!="];

interface QueryBuilderProps {
  queryAst: any;
  setQueryAst: (ast: any) => void;
  isOpen: boolean;
  onClose?: () => void;
}

export function QueryBuilder({ queryAst, setQueryAst, isOpen }: QueryBuilderProps) {
  const [selectedNewMetric, setSelectedNewMetric] = useState(METRICS[0].id);

  if (!isOpen) return null;

  const rules = queryAst.AND || [];

  const updateRuleValue = (idx: number, val: number) => {
    const newAst = JSON.parse(JSON.stringify(queryAst));
    newAst.AND[idx].value = val;
    setQueryAst(newAst);
  };

  const updateRuleOp = (idx: number, op: string) => {
    const newAst = JSON.parse(JSON.stringify(queryAst));
    newAst.AND[idx].op = op;
    setQueryAst(newAst);
  };

  const removeRule = (idx: number) => {
    const newAst = JSON.parse(JSON.stringify(queryAst));
    newAst.AND.splice(idx, 1);
    setQueryAst(newAst);
  };

  const addRule = () => {
    const newAst = JSON.parse(JSON.stringify(queryAst));
    if (!newAst.AND) newAst.AND = [];
    newAst.AND.push({ field: selectedNewMetric, op: ">", value: 0 });
    setQueryAst(newAst);
  };

  const clearAllRules = () => {
    setQueryAst({ AND: [] });
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-3 mb-3 shrink-0 animate-in fade-in slide-in-from-top-2 duration-150">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-100 dark:border-slate-800 text-xs">
        <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
          <ListFilter className="w-3.5 h-3.5 text-blue-500" />
          <span>Active Filter Conditions</span>
          <span className="text-slate-400 font-normal">({rules.length} active)</span>
        </div>

        {rules.length > 0 && (
          <button
            type="button"
            onClick={clearAllRules}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-500 transition-colors"
          >
            <Trash2 className="w-3 h-3" /> Clear all
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {rules.length === 0 ? (
          <span className="text-xs text-slate-400 italic py-1">
            No active conditions. All stocks are returned.
          </span>
        ) : (
          rules.map((rule: any, idx: number) => {
            const metricMeta = METRICS.find((m) => m.id === rule.field);
            return (
              <div
                key={idx}
                className="flex items-center bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs gap-1.5 shadow-sm"
              >
                <span className="font-semibold text-slate-800 dark:text-slate-200" title={rule.field}>
                  {metricMeta?.label || rule.field}
                </span>

                <select
                  className="bg-transparent font-bold text-blue-600 dark:text-blue-400 outline-none cursor-pointer text-center"
                  value={rule.op}
                  onChange={(e) => updateRuleOp(idx, e.target.value)}
                >
                  {OPS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  className="w-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 font-bold text-slate-900 dark:text-white outline-none focus:border-blue-500 text-right"
                  value={rule.value}
                  onChange={(e) => updateRuleValue(idx, Number(e.target.value))}
                />

                <button
                  type="button"
                  onClick={() => removeRule(idx)}
                  className="p-0.5 text-slate-400 hover:text-red-500 transition-colors ml-0.5"
                  title="Remove condition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}

        {/* Add condition inline */}
        <div className="flex items-center gap-1.5 ml-auto">
          <select
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs rounded-lg px-2 py-1 outline-none text-slate-700 dark:text-slate-200"
            value={selectedNewMetric}
            onChange={(e) => setSelectedNewMetric(e.target.value)}
          >
            {METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addRule}
            className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 border border-blue-200 dark:border-blue-900/60 text-blue-700 dark:text-blue-400 text-xs font-semibold rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>
    </div>
  );
}
