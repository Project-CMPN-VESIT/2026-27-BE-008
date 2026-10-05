import React from "react";
import { CheckCircle2, AlertTriangle, XCircle, Circle } from "lucide-react";
import { ResearchStageStatus } from "./researchEventMapper";

interface TimelineNodeProps {
  label: string;
  summary?: string;
  status: ResearchStageStatus;
  children?: React.ReactNode;
  isLast?: boolean;
}

export function ResearchTimelineNode({ label, summary, status, children, isLast }: TimelineNodeProps) {
  let color = "text-slate-400 dark:text-slate-500";
  let bg = "bg-white dark:bg-[#0f141f]";

  if (status === "running") {
    color = "text-blue-500";
  } else if (status === "done") {
    color = "text-emerald-500";
  } else if (status === "warning") {
    color = "text-amber-500";
  } else if (status === "error") {
    color = "text-red-500";
  }

  return (
    <div className="relative pl-6 pb-4 last:pb-0">
      {/* Vertical Line */}
      {!isLast && (
        <div className="absolute left-[7px] top-[18px] bottom-[-4px] w-[2px] bg-slate-300 dark:bg-slate-700"></div>
      )}

      {/* Node Icon */}
      <div className={`absolute left-0 top-1 w-4 h-4 flex items-center justify-center ${bg}`}>
        {status === "done" && <CheckCircle2 className={`w-3.5 h-3.5 ${color}`} />}
        {status === "running" && (
          <div className="relative flex items-center justify-center w-4 h-4">
            <span className="absolute inline-flex w-full h-full rounded-full bg-blue-400 opacity-25 animate-ping"></span>
            <Circle className={`w-2.5 h-2.5 fill-blue-500 text-blue-500`} />
          </div>
        )}
        {status === "warning" && <AlertTriangle className={`w-3.5 h-3.5 ${color}`} />}
        {status === "error" && <XCircle className={`w-3.5 h-3.5 ${color}`} />}
        {status === "pending" && <Circle className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500" />}
      </div>

      {/* Content */}
      <div className="pt-0.5">
        <div className={`text-xs font-medium ${status === "pending" ? "text-slate-400 dark:text-slate-500" : "text-slate-700 dark:text-slate-200"}`}>
          {label}
        </div>
        {summary && (
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
            {summary}
          </div>
        )}
        {children && (
          <div className="mt-2">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
