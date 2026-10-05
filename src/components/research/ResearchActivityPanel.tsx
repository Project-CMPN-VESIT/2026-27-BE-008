import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { ResearchActivityState } from "./researchActivityReducer";
import { ResearchTimelineNode } from "./ResearchTimelineNode";
import { SpecialistChip } from "./SpecialistChip";
import { MilestoneKey } from "./researchEventMapper";

interface PanelProps {
  state: ResearchActivityState;
  onToggleExpand: () => void;
}

export function ResearchActivityPanel({ state, onToggleExpand }: PanelProps) {
  const [localElapsed, setLocalElapsed] = useState(0);

  useEffect(() => {
    let tickId: NodeJS.Timeout;
    if (state.status === "RUNNING" && state.startedAt) {
      tickId = setInterval(() => {
        setLocalElapsed(Date.now() - state.startedAt!);
      }, 100); // 100ms for smoother timer
    }
    return () => clearInterval(tickId);
  }, [state.status, state.startedAt, state.elapsedMs]);

  const formatTime = (ms: number) => (ms / 1000).toFixed(1) + "s";

  const { status, expanded, milestones, ticker } = state;
  const displayElapsed = status === "RUNNING" ? localElapsed : state.elapsedMs;

  let titleStr = "CYRO RESEARCH";
  if (status === "COMPLETED") titleStr = "CYRO Research";

  let subtitleStr = ticker ? `${ticker} · Investment view` : `Research process`;
  
  if (status === "COMPLETED") {
    subtitleStr = ticker ? `${ticker} · completed in ${formatTime(displayElapsed)}` : `Completed in ${formatTime(displayElapsed)}`;
  } else if (status === "WARNING") {
    subtitleStr = ticker ? `${ticker} · completed with limitations` : `Completed with limitations`;
  } else if (status === "FAILED") {
    subtitleStr = ticker ? `${ticker} · failed after ${formatTime(displayElapsed)}` : `Failed after ${formatTime(displayElapsed)}`;
  }

  const orderOfMilestones: MilestoneKey[] = [
    "intent", 
    "evidence", 
    "validation", 
    "specialists", 
    "risk", 
    "committee"
  ];

  // A stage only becomes visible after the backend has emitted a real event for it.
  // This keeps unrouted specialists and unused workflow stages out of the activity UI.
  const visibleTopLevel = orderOfMilestones
    .map(key => milestones[key])
    .filter(m => m !== undefined && m.status !== "pending");

  return (
    <div className="w-full max-w-xl bg-transparent border border-slate-300 dark:border-slate-700 rounded-lg transition-all duration-300 mb-2">
      
      <button 
        onClick={onToggleExpand}
        className="w-full flex items-start justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors focus:outline-none rounded-t-lg"
        aria-expanded={expanded}
      >
        <div className="flex items-start gap-2.5 text-left">
          <div className="mt-0.5">
            <Sparkles className="w-4 h-4 text-indigo-500" />
          </div>
          <div>
            <div className={`text-[10px] font-bold tracking-widest uppercase mb-0.5 ${status === "RUNNING" ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"}`}>
              ✦ {titleStr}
            </div>
            <div className="text-xs text-slate-700 dark:text-slate-300 font-medium">
              {subtitleStr}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-slate-400 mt-0.5">
          {status === "RUNNING" && (
            <div className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">
              {formatTime(displayElapsed)}
            </div>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-4 pt-1.5 animate-in slide-in-from-top-2 fade-in duration-300 border-t border-slate-200 dark:border-slate-700">
          <div className="pt-2">
            {visibleTopLevel.map((m, idx) => {
              const isLast = idx === visibleTopLevel.length - 1;
              const isSpecialistNode = m.key === "specialists";
              
              // Only render specialist chips that have started
              const activeSubs = m.subStatuses?.filter(s => s.status !== "pending") || [];
              
              // Hide the overall specialist node entirely if it's broad but hasn't started yet? 
              // Wait, the prompt says "Do NOT display unused: Fundamental..." which we do by filtering pending chips.
              // But if the specialist node itself is completely empty (no subs) and still pending, we still render the ○ empty circle to show it's coming.
              
              return (
                <ResearchTimelineNode 
                  key={m.key} 
                  label={m.label} 
                  summary={m.summary} 
                  status={m.status}
                  isLast={isLast}
                >
                  {isSpecialistNode && activeSubs.length > 0 && (
                    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/70 p-2 dark:border-slate-700 dark:bg-slate-800/30">
                      <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">Specialist analysis</div>
                      <div className="flex flex-wrap gap-2">
                      {activeSubs.map(sub => (
                        <SpecialistChip key={sub.id} subStatus={sub} />
                      ))}
                      </div>
                    </div>
                  )}
                </ResearchTimelineNode>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
