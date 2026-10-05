import { NormalizedEvent, ResearchMilestone, MilestoneKey } from "./researchEventMapper";

export interface ResearchActivityState {
  status: "IDLE" | "RUNNING" | "COMPLETED" | "WARNING" | "FAILED";
  expanded: boolean;
  startedAt?: number;
  completedAt?: number;
  elapsedMs: number;
  milestones: Record<MilestoneKey, ResearchMilestone>;
  ticker?: string;
}

export const INITIAL_MILESTONES: Record<MilestoneKey, ResearchMilestone> = {
  intent: { key: "intent", label: "Understanding", summary: "Identifying your research horizon", status: "pending", order: 1 },
  evidence: { key: "evidence", label: "Evidence", summary: "Gathering relevant market evidence", status: "pending", order: 2 },
  validation: { key: "validation", label: "Validation", summary: "Checking relevance & freshness", status: "pending", order: 3 },
  specialists: { key: "specialists", label: "Specialist Analysis", summary: "Perspectives working in parallel", status: "pending", subStatuses: [], order: 4 },
  risk: { key: "risk", label: "Risk & Contradictions", summary: "Cross-checking risks", status: "pending", order: 5 },
  committee: { key: "committee", label: "Investment Committee", summary: "Synthesizing the final view", status: "pending", order: 6 },
  final: { key: "final", label: "Final View", summary: "Ready", status: "pending", order: 7 }
};

export const initialResearchState: ResearchActivityState = {
  status: "IDLE",
  expanded: true,
  elapsedMs: 0,
  milestones: INITIAL_MILESTONES,
};

export type ResearchAction = 
  | { type: "PROCESS_EVENT"; payload: NormalizedEvent }
  | { type: "TOGGLE_EXPAND" }
  | { type: "TICK"; payload: number };

export function researchActivityReducer(state: ResearchActivityState, action: ResearchAction): ResearchActivityState {
  switch (action.type) {
    case "TOGGLE_EXPAND":
      return { ...state, expanded: !state.expanded };

    case "TICK": {
      if (state.status === "RUNNING" && state.startedAt) {
        return { ...state, elapsedMs: action.payload - state.startedAt };
      }
      return state;
    }

    case "PROCESS_EVENT": {
      const event = action.payload;
      const now = Date.now();
      let newState = { ...state };

      if (newState.status === "IDLE" && event.type !== "noop") {
        newState.status = "RUNNING";
        newState.startedAt = now;
        newState.expanded = true;
      }

      if (event.type === "ticker_resolved") {
        newState.ticker = event.ticker;
      }

      if (event.type === "milestone_update" && event.milestoneKey) {
        const ms = { ...newState.milestones[event.milestoneKey] };
        ms.status = event.status || "running";
        
        newState.milestones = { ...newState.milestones, [event.milestoneKey]: ms };
      }

      if (event.type === "sub_update" && event.milestoneKey === "specialists" && event.subId) {
        const ms = { ...newState.milestones.specialists };
        const subs = [...(ms.subStatuses || [])];
        
        const existingIdx = subs.findIndex(s => s.id === event.subId);
        if (existingIdx >= 0) {
          subs[existingIdx] = { ...subs[existingIdx], status: event.status || "running" };
        } else {
          subs.push({ id: event.subId, label: event.message || event.subId, status: event.status || "running" });
        }
        
        ms.subStatuses = subs;
        
        const anyRunning = subs.some(s => s.status === "running" || s.status === "pending");
        const anyWarning = subs.some(s => s.status === "warning");
        
        if (anyRunning) ms.status = "running";
        else if (anyWarning) ms.status = "warning";
        else ms.status = "done";

        newState.milestones = { ...newState.milestones, specialists: ms };
      }

      if (event.type === "error") {
        newState.status = "FAILED";
        newState.completedAt = now;
      }

      if (event.type === "complete") {
        if (newState.status !== "FAILED") {
          const anyWarning = Object.values(newState.milestones).some(m => m.status === "warning");
          newState.status = anyWarning ? "WARNING" : "COMPLETED";
          if (newState.milestones.committee) {
             newState.milestones.committee.status = "done";
          }
        }
        newState.completedAt = now;
        newState.expanded = false; 
      }

      if (newState.startedAt) {
        newState.elapsedMs = (newState.completedAt || now) - newState.startedAt;
      }

      return newState;
    }

    default:
      return state;
  }
}
