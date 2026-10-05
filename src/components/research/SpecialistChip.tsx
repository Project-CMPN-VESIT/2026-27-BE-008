import React from "react";
import { Calculator, FileText, Activity, Network, Newspaper, Brain, CheckCircle2, Circle, Loader2, AlertTriangle, XCircle, Bot } from "lucide-react";
import { SubStatus } from "./researchEventMapper";

interface SpecialistChipProps {
  subStatus: SubStatus;
}

export function SpecialistChip({ subStatus }: SpecialistChipProps) {
  let Icon = Bot;
  const name = subStatus.label.toLowerCase();
  
  if (name.includes("fundamental")) Icon = Calculator;
  else if (name.includes("governance") || name.includes("filing")) Icon = FileText;
  else if (name.includes("technical")) Icon = Activity;
  else if (name.includes("sector") || name.includes("macro")) Icon = Network;
  else if (name.includes("news") || name.includes("catalyst")) Icon = Newspaper;

  const { status } = subStatus;

  let StatusIcon = Circle;
  let statusColor = "text-slate-300 dark:text-slate-600";
  
  if (status === "running") {
    StatusIcon = Loader2;
    statusColor = "text-blue-500 animate-spin";
  } else if (status === "done") {
    StatusIcon = CheckCircle2;
    statusColor = "text-emerald-500";
  } else if (status === "warning") {
    StatusIcon = AlertTriangle;
    statusColor = "text-amber-500";
  } else if (status === "error") {
    StatusIcon = XCircle;
    statusColor = "text-red-500";
  }

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-medium transition-colors
      ${status === "pending" 
        ? "bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800/30 dark:border-slate-700 dark:text-slate-400" 
        : "bg-white border-slate-300 text-slate-700 shadow-sm dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200"}
    `}>
      <Icon className="w-3 h-3 text-slate-400 dark:text-slate-500" />
      <span>{subStatus.label}</span>
      <StatusIcon className={`w-2.5 h-2.5 ml-0.5 ${statusColor}`} />
    </div>
  );
}
