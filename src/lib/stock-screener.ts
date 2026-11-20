import { authenticatedFetch } from "@/lib/authenticated-fetch";

export type FieldMeta = { key: string; label: string; unit: string; kind: "num" | "bool" | "cat"; hint?: string };
export type Condition = { field: string; op: string; value: number | boolean | string | string[] | [number, number] };
export type UiCondition = Condition & { id: string };
export type Preset = { id: string; name: string; blurb: string; conditions: Condition[]; matches: number };

export type ScreenerMeta = {
  universe: number;
  as_of: string | null;
  sectors: string[];
  caps: string[];
  groups: { group: string; fields: FieldMeta[] }[];
  default_columns: string[];
  presets: Preset[];
  note: string;
};

export type ScreenRow = {
  symbol: string;
  name: string;
  sector: string | null;
  cap_class: string | null;
  metrics: Record<string, number | boolean | null>;
  why: { text: string; field: string; actual: number | boolean | string | null }[];
};

export type ScreenResponse = {
  total_universe: number;
  matched: number;
  returned: number;
  results: ScreenRow[];
  summary: { median: Record<string, number | null>; sectors: { sector: string; count: number }[]; caps: Record<string, number> };
  as_of: string | null;
};

async function parse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `Request failed (${res.status})`);
  return data as T;
}

export async function fetchScreenerMeta(): Promise<ScreenerMeta> {
  return parse<ScreenerMeta>(await authenticatedFetch("/api/screener/meta", { cache: "no-store" }));
}

export async function runScreen(body: {
  conditions: Condition[];
  search?: string;
  sort_by?: string;
  sort_desc?: boolean;
  limit?: number;
  offset?: number;
  symbols?: string[];
}): Promise<ScreenResponse> {
  return parse<ScreenResponse>(
    await authenticatedFetch("/api/screener/run", { method: "POST", body: JSON.stringify(body) }),
  );
}

/** Conditions without the UI-only id, and only those that are complete enough to run. */
export function toRequest(conds: UiCondition[]): Condition[] {
  return conds
    .filter((c) => {
      if (c.op === "between") return Array.isArray(c.value) && c.value.every((x) => typeof x === "number" && Number.isFinite(x));
      if (typeof c.value === "number") return Number.isFinite(c.value);
      if (Array.isArray(c.value)) return c.value.length > 0;
      return c.value !== "" && c.value !== undefined && c.value !== null;
    })
    .map(({ field, op, value }) => ({ field, op, value }));
}

let seq = 0;
export const newId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;
export const withIds = (conds: Condition[]): UiCondition[] => conds.map((c) => ({ ...c, id: newId() }));

export function formatValue(f: FieldMeta | undefined, v: number | boolean | string | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v;
  if (!f) return String(v);
  switch (f.unit) {
    case "Rs":
      return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
    case "Rs Cr":
      return v >= 100000 ? `₹${(v / 100000).toFixed(2)} L Cr` : `₹${Math.round(v).toLocaleString("en-IN")} Cr`;
    case "%":
      return `${v.toFixed(1)}%`;
    case "x":
      return v.toFixed(2);
    default:
      return String(v);
  }
}

const SAVED_KEY = "finpilot.screens.v1";
export type SavedScreen = { name: string; conditions: Condition[] };

export function loadSavedScreens(): SavedScreen[] {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.name === "string" && Array.isArray(s.conditions)) : [];
  } catch {
    return [];
  }
}

export function storeSavedScreens(list: SavedScreen[]) {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    /* storage can be blocked; saving is a convenience only */
  }
}
