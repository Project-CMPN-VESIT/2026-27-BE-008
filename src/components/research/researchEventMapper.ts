export type ResearchStageStatus = "pending" | "running" | "done" | "warning" | "error";

export type MilestoneKey = 
  | "intent" 
  | "evidence" 
  | "validation" 
  | "specialists" 
  | "risk" 
  | "committee"
  | "final";

export interface SubStatus {
  id: string;
  label: string;
  status: ResearchStageStatus;
}

export interface ResearchMilestone {
  key: MilestoneKey;
  label: string;
  status: ResearchStageStatus;
  subStatuses?: SubStatus[];
  summary?: string;
  order: number;
}

export interface NormalizedEvent {
  type: "milestone_update" | "sub_update" | "error" | "complete" | "summary_update" | "ticker_resolved" | "noop";
  milestoneKey?: MilestoneKey;
  subId?: string;
  status?: ResearchStageStatus;
  message?: string;
  ticker?: string;
}

function getSpecialistLabel(id: string): string {
  if (id.includes("fundamental")) return "Fundamental";
  if (id.includes("governance") || id.includes("filing")) return "Governance";
  if (id.includes("technical")) return "Technical";
  if (id.includes("sector") || id.includes("macro")) return "Sector / Macro";
  if (id.includes("news") || id.includes("catalyst")) return "News / Catalyst";
  return "Analyst";
}

export function normalizeResearchEvent(rawType: string, payload: Record<string, unknown>): NormalizedEvent {
  if (rawType === "started") {
    return { type: "milestone_update", milestoneKey: "intent", status: "running" };
  }
  if (rawType === "ticker_resolved") {
    return { type: "ticker_resolved", ticker: payload.ticker as string };
  }

  if (rawType === "error") {
    return { type: "error", message: payload.message as string };
  }

  if (rawType === "done" || rawType === "final_decision") {
    return { type: "complete" };
  }

  if (rawType === "analyst_start" || rawType === "analyst_done" || rawType === "analyst_update") {
    const analystRaw = (payload.analyst as string) || "";
    const a = analystRaw.toLowerCase();
    
    let status: ResearchStageStatus = "running";
    if (rawType === "analyst_done") {
      const verdict = (payload.verdict as string || "").toLowerCase();
      status = (verdict === "failed" || verdict === "unavailable" || verdict === "error" || verdict === "pass_with_warnings") ? "warning" : "done";
    }

    if (a.includes("intent")) return { type: "milestone_update", milestoneKey: "intent", status };
    if (a.includes("context")) return { type: "milestone_update", milestoneKey: "evidence", status };
    if (a.includes("quality")) return { type: "milestone_update", milestoneKey: "validation", status };
    if (a.includes("risk") || a.includes("contradiction")) return { type: "milestone_update", milestoneKey: "risk", status };
    if (a.includes("committee")) return { type: "milestone_update", milestoneKey: "committee", status };

    // Otherwise, it's one of the specialists (Agents 4-8)
    return { 
      type: "sub_update", 
      milestoneKey: "specialists", 
      subId: analystRaw, 
      status,
      message: getSpecialistLabel(a)
    };
  }

  return { type: "noop" };
}
