"use client";

import React, { useState } from "react";
import { Plus, X, ListFilter, AlertCircle } from "lucide-react";

export const METRICS = [
  { id: "market_cap", label: "Market Cap" },
  { id: "pe_ttm", label: "P/E Ratio" },
  { id: "pb", label: "P/B Ratio" },
  { id: "roe", label: "Return on Equity (%)" },
  { id: "roce", label: "ROCE (%)" },
  { id: "debt_equity", label: "Debt to Equity" },
  { id: "dividend_yield", label: "Dividend Yield (%)" },
  { id: "sales_growth_5y", label: "Sales Growth 5Y (%)" },
  { id: "profit_growth_5y", label: "Profit Growth 5Y (%)" },
  { id: "current_price", label: "Current Price (₹)" }
];

const OPS = ["<", "<=", ">", ">=", "==", "!="];

interface QueryBuilderProps {
  queryAst: any;
  setQueryAst: (ast: any) => void;
}

export function QueryBuilder({ queryAst, setQueryAst }: QueryBuilderProps) {
  const [selectedNewMetric, setSelectedNewMetric] = useState(METRICS[0].id);

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

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden mb-6">
      <div className="bg-slate-50 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <ListFilter className="w-4 h-4 text-blue-500" /> Advanced Query Builder
        </h3>
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 px-2 py-1 rounded font-medium border border-amber-200 dark:border-amber-900/50">
          <AlertCircle className="w-3.5 h-3.5" /> Flat AND logic enforced for Phase 1
        </div>
      </div>
      
      <div className="p-5">
        {rules.length === 0 ? (
          <div className="text-sm text-slate-500 italic p-4 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
            No active filters. All companies will be shown.
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {rules.map((rule: any, idx: number) => {
              const metricMeta = METRICS.find(m => m.id === rule.field);
              return (
                <div 
                  key={idx} 
                  className="group flex items-center bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-full pl-3 pr-1 py-1 shadow-sm hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500"
                >
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate" title={rule.field}>
                    {metricMeta?.label || rule.field}
                  </span>
                  
                  <select 
                    className="appearance-none bg-transparent text-sm font-bold text-blue-600 dark:text-blue-400 px-2 outline-none cursor-pointer text-center hover:bg-slate-50 dark:hover:bg-slate-800 rounded"
                    value={rule.op}
                    onChange={(e) => updateRuleOp(idx, e.target.value)}
                  >
                    {OPS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  
                  <input 
                    type="number"
                    className="w-20 bg-transparent text-sm font-bold text-slate-900 dark:text-white outline-none placeholder-slate-300"
                    value={rule.value}
                    onChange={(e) => updateRuleValue(idx, Number(e.target.value))}
                  />
                  
                  <button 
                    onClick={() => removeRule(idx)}
                    className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 dark:hover:bg-red-500 rounded-full transition-colors ml-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3">
          <select 
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm w-64"
            value={selectedNewMetric}
            onChange={(e) => setSelectedNewMetric(e.target.value)}
          >
            {METRICS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <button 
            onClick={addRule}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-semibold rounded-lg transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" /> Add Condition
          </button>
        </div>
      </div>
    </div>
  );
}
