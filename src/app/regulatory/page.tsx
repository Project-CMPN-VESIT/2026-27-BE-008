"use client";

import { useState, useEffect } from "react";
import {
  Shield,
  ShieldAlert,
  Search,
  Filter,
  ExternalLink,
  Users,
  Building2,
  FileWarning,
  RefreshCw,
  Info,
  Calendar,
  XCircle,
  Play
} from "lucide-react";

interface ScrapedEntity {
  id: number;
  source_id: string;
  name: string;
  din_number?: string;
  pan_number?: string;
  cin_number?: string;
  date_of_publish?: string;
  link_to_circular?: string;
  issuing_body?: string;
  circular_number?: string;
}

export default function RegulatoryPage() {
  const [entities, setEntities] = useState<ScrapedEntity[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<ScrapedEntity | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEntities = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("http://localhost:8000/v1/entities?page_size=5000");
      if (!response.ok) throw new Error("Failed to fetch entities");
      const data = await response.json();
      setEntities(data.entities || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to connect to Scrapper API");
    } finally {
      setIsLoading(false);
    }
  };

  const [isRunningPipeline, setIsRunningPipeline] = useState(false);

  const runPipeline = async () => {
    setIsRunningPipeline(true);
    setError(null);
    try {
      const response = await fetch("http://localhost:8000/v1/pipeline/run", {
        method: "POST"
      });
      if (!response.ok) throw new Error("Failed to run pipeline");
      await fetchEntities();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to run pipeline");
    } finally {
      setIsRunningPipeline(false);
    }
  };

  useEffect(() => {
    fetchEntities();
  }, []);

  const filteredEntities = entities.filter((e) => {
    const searchContext = `${e.name} ${e.din_number || ""} ${e.pan_number || ""} ${e.cin_number || ""} ${e.issuing_body || ""}`.toLowerCase();
    const matchesSearch = searchContext.includes(searchQuery.toLowerCase());
    const matchesFilter = filterSource === "all" || e.source_id === filterSource;
    return matchesSearch && matchesFilter;
  });

  const getSourceLabel = (sourceId: string) => {
    switch (sourceId) {
      case "sebi_debarred": return "SEBI Debarred";
      case "rbi_standalone_circulars": return "RBI Default/Actions";
      case "un_sanctions_consolidated": return "UN Sanctions";
      default: return sourceId.replace("_", " ").toUpperCase();
    }
  };

  const getActualLink = (entity: ScrapedEntity) => {
    if (entity.source_id === "un_sanctions_consolidated" || entity.link_to_circular?.endsWith(".xml")) {
      return `https://www.google.com/search?q=${encodeURIComponent('UN Security Council Sanctions "' + entity.name + '"')}`;
    }
    return entity.link_to_circular;
  };

  const getSourceBadgeColor = (sourceId: string) => {
    switch (sourceId) {
      case "sebi_debarred": return "bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20";
      case "rbi_standalone_circulars": return "bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20";
      case "un_sanctions_consolidated": return "bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/20";
      default: return "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700";
    }
  };

  const stats = {
    total: entities.length,
    sebi: entities.filter(e => e.source_id === "sebi_debarred").length,
    rbi: entities.filter(e => e.source_id === "rbi_standalone_circulars").length,
    un: entities.filter(e => e.source_id === "un_sanctions_consolidated").length,
  };

  const availableSources = ["all", ...Array.from(new Set(entities.map(e => e.source_id)))];

  return (
    <div className="p-6 space-y-6 bg-grid-pattern min-h-screen">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">SEBI Regulatory Shield</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Live automated feed from Indian regulatory bodies and global sanctions lists
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchEntities} disabled={isLoading || isRunningPipeline} className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium transition-colors border border-slate-300 dark:border-slate-700 ${(isLoading || isRunningPipeline) ? "opacity-50 cursor-not-allowed" : ""}`}>
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            {isLoading ? "Fetching data..." : "Refresh Feed"}
          </button>
          <button onClick={runPipeline} disabled={isLoading || isRunningPipeline} className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors shadow-sm ${(isLoading || isRunningPipeline) ? "opacity-50 cursor-not-allowed" : ""}`}>
            <Play className={`w-4 h-4 ${isRunningPipeline ? "animate-pulse" : ""}`} />
            {isRunningPipeline ? "Running Pipeline..." : "Run Pipeline"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-4 shadow-sm">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Extracted</span><Users className="w-4 h-4 text-slate-400" /></div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{stats.total}</div>
          <p className="text-xs text-slate-400 mt-1">Flagged Entities & Orgs</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-rose-200 dark:border-rose-500/20 p-4 shadow-sm glow-rose">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-rose-600 dark:text-rose-400 uppercase tracking-wider">SEBI Actions</span><ShieldAlert className="w-4 h-4 text-rose-500" /></div>
          <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">{stats.sebi}</div>
          <p className="text-xs text-rose-500/70 mt-1">Debarred / Banned</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-500/20 p-4 shadow-sm glow-amber">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">RBI Defaulters</span><Building2 className="w-4 h-4 text-amber-500" /></div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{stats.rbi}</div>
          <p className="text-xs text-amber-500/70 mt-1">Wilful & Large Defaults</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-purple-200 dark:border-purple-500/20 p-4 shadow-sm glow-purple">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-purple-600 dark:text-purple-400 uppercase tracking-wider">Global Sanctions</span><XCircle className="w-4 h-4 text-purple-500" /></div>
          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">{stats.un}</div>
          <p className="text-xs text-purple-500/70 mt-1">UN & International Lists</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl flex items-start gap-2 text-sm">
          <FileWarning className="w-5 h-5 shrink-0" />
          <div className="flex-1 mt-0.5">{error}</div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus-within:border-blue-400 dark:focus-within:border-blue-500 transition-colors shadow-sm">
          <Search className="w-4 h-4 text-slate-400" />
          <input type="text" placeholder="Search entities by name, DIN, PAN..." className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400 mx-1" />
          {availableSources.map((f) => (
            <button key={f} onClick={() => setFilterSource(f)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterSource === f ? "bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"}`}>
              {f === 'all' ? 'All Sources' : getSourceLabel(f)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-300 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Entity Details</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Identifiers</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Source Database</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400">Publish Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {filteredEntities.map((entity) => (
                <tr key={`${entity.id}-${entity.source_id}`} onClick={() => {
                  const link = getActualLink(entity);
                  if (link) {
                    window.open(link, '_blank', 'noopener,noreferrer');
                  }
                  setSelectedEntity(selectedEntity?.id === entity.id ? null : entity);
                }} className={`group cursor-pointer transition-colors ${selectedEntity?.id === entity.id ? "bg-slate-50 dark:bg-slate-800/50" : "hover:bg-slate-50/70 dark:hover:bg-slate-800/30"}`}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-sm font-bold text-slate-600 dark:text-slate-300">
                        {entity.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-white capitalize group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{entity.name.toLowerCase()}</div>
                        {entity.issuing_body && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[280px]">Body: {entity.issuing_body}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="space-y-1">
                      {entity.din_number && <div className="text-[11px]"><span className="text-slate-400">DIN:</span> <span className="font-mono text-slate-700 dark:text-slate-300">{entity.din_number}</span></div>}
                      {entity.pan_number && <div className="text-[11px]"><span className="text-slate-400">PAN:</span> <span className="font-mono text-slate-700 dark:text-slate-300">{entity.pan_number}</span></div>}
                      {entity.cin_number && <div className="text-[11px]"><span className="text-slate-400">CIN:</span> <span className="font-mono text-slate-700 dark:text-slate-300">{entity.cin_number}</span></div>}
                      {!entity.din_number && !entity.pan_number && !entity.cin_number && <span className="text-[11px] text-slate-400">—</span>}
                    </div>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold tracking-wide ${getSourceBadgeColor(entity.source_id)}`}>
                      {getSourceLabel(entity.source_id)}
                    </span>
                  </td>
                  <td className="px-5 py-4 align-top">
                    <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400"><Calendar className="w-3.5 h-3.5 text-slate-400" />{entity.date_of_publish || "N/A"}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredEntities.length === 0 && !isLoading && (
            <div className="px-5 py-8 text-center text-sm text-slate-500">No matching entities found.</div>
          )}
        </div>
      </div>

      {selectedEntity && (
        <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-300 dark:border-slate-700 p-5 shadow-sm animate-fade-in relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-emerald-400 to-teal-500"></div>
          <div className="flex gap-4">
            <div className="w-12 h-12 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
              <FileWarning className="w-6 h-6 text-slate-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h3 className="text-base font-bold text-slate-900 dark:text-white capitalize">{selectedEntity.name.toLowerCase()}</h3>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold ${getSourceBadgeColor(selectedEntity.source_id)}`}>{getSourceLabel(selectedEntity.source_id)}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                {selectedEntity.din_number && <div><div className="text-[10px] font-medium text-slate-500 uppercase">DIN Number</div><div className="text-sm font-mono text-slate-700 dark:text-slate-300 mt-1">{selectedEntity.din_number}</div></div>}
                {selectedEntity.pan_number && <div><div className="text-[10px] font-medium text-slate-500 uppercase">PAN</div><div className="text-sm font-mono text-slate-700 dark:text-slate-300 mt-1">{selectedEntity.pan_number}</div></div>}
                {selectedEntity.cin_number && <div><div className="text-[10px] font-medium text-slate-500 uppercase">CIN</div><div className="text-sm font-mono text-slate-700 dark:text-slate-300 mt-1">{selectedEntity.cin_number}</div></div>}
                {selectedEntity.circular_number && <div><div className="text-[10px] font-medium text-slate-500 uppercase">Order/Circular No.</div><div className="text-sm font-mono text-slate-700 dark:text-slate-300 mt-1">{selectedEntity.circular_number}</div></div>}
              </div>
              {getActualLink(selectedEntity) && (
                <div className="mt-5 pt-5 border-t border-slate-200 dark:border-slate-700/50">
                  <a href={getActualLink(selectedEntity)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-medium text-blue-600 dark:text-blue-400 hover:border-blue-300 dark:hover:border-blue-500/50 transition-colors shadow-sm"><ExternalLink className="w-4 h-4" />Open Original Source</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
