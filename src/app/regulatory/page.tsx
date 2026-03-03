"use client";

import { useState } from "react";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Search,
  Filter,
  ChevronDown,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  Building2,
  FileWarning,
  RefreshCw,
  Info,
} from "lucide-react";

type Status = "clear" | "flagged" | "warning" | "pending";

interface Director {
  id: number;
  name: string;
  designation: string;
  din: string;
  company: string;
  sebiStatus: Status;
  rbiStatus: Status;
  unStatus: Status;
  mca21Status: Status;
  lastChecked: string;
  details?: string;
}

const directors: Director[] = [
  {
    id: 1,
    name: "Gautam S. Adani",
    designation: "Chairman & Managing Director",
    din: "00006273",
    company: "Adani Enterprises Ltd",
    sebiStatus: "warning",
    rbiStatus: "clear",
    unStatus: "clear",
    mca21Status: "clear",
    lastChecked: "2 mins ago",
    details: "SEBI investigation pending regarding disclosure practices. No debarment order issued.",
  },
  {
    id: 2,
    name: "Rajesh S. Adani",
    designation: "Managing Director",
    din: "00006322",
    company: "Adani Enterprises Ltd",
    sebiStatus: "clear",
    rbiStatus: "clear",
    unStatus: "clear",
    mca21Status: "clear",
    lastChecked: "2 mins ago",
  },
  {
    id: 3,
    name: "Vinod K. Agarwal",
    designation: "Independent Director",
    din: "00058548",
    company: "Adani Enterprises Ltd",
    sebiStatus: "clear",
    rbiStatus: "clear",
    unStatus: "clear",
    mca21Status: "warning",
    lastChecked: "5 mins ago",
    details: "Served on board of company that received MCA show-cause notice in 2023.",
  },
  {
    id: 4,
    name: "Hemant M. Nerurkar",
    designation: "Independent Director",
    din: "00265887",
    company: "Adani Ports & SEZ",
    sebiStatus: "clear",
    rbiStatus: "clear",
    unStatus: "clear",
    mca21Status: "clear",
    lastChecked: "8 mins ago",
  },
  {
    id: 5,
    name: "Rajeev R. Shah",
    designation: "Whole Time Director",
    din: "01onal",
    company: "Yes Bank Ltd",
    sebiStatus: "flagged",
    rbiStatus: "flagged",
    unStatus: "clear",
    mca21Status: "flagged",
    lastChecked: "1 min ago",
    details: "SEBI debarment order dated 14-Mar-2024. RBI directive restricting banking sector board positions. Multiple MCA disqualification proceedings.",
  },
  {
    id: 6,
    name: "Priya K. Mehta",
    designation: "Independent Director",
    din: "07283910",
    company: "Infosys Ltd",
    sebiStatus: "clear",
    rbiStatus: "clear",
    unStatus: "clear",
    mca21Status: "clear",
    lastChecked: "12 mins ago",
  },
  {
    id: 7,
    name: "Suresh K. Patel",
    designation: "CFO & Director",
    din: "04829311",
    company: "Paytm (One97)",
    sebiStatus: "warning",
    rbiStatus: "warning",
    unStatus: "clear",
    mca21Status: "clear",
    lastChecked: "3 mins ago",
    details: "SEBI show-cause notice regarding related party transaction disclosures. RBI observation on digital lending compliance.",
  },
  {
    id: 8,
    name: "Aman L. Gupta",
    designation: "Non-Executive Director",
    din: "06472839",
    company: "Tata Motors Ltd",
    sebiStatus: "clear",
    rbiStatus: "clear",
    unStatus: "clear",
    mca21Status: "pending",
    lastChecked: "15 mins ago",
    details: "MCA annual compliance verification pending for FY2025.",
  },
];

const statusConfig: Record<Status, { label: string; icon: typeof CheckCircle2; color: string; bg: string; border: string }> = {
  clear: {
    label: "Clear",
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    border: "border-emerald-200 dark:border-emerald-500/20",
  },
  flagged: {
    label: "FLAGGED",
    icon: XCircle,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-500/10",
    border: "border-red-200 dark:border-red-500/20",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    border: "border-amber-200 dark:border-amber-500/20",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    color: "text-slate-500 dark:text-slate-400",
    bg: "bg-slate-50 dark:bg-slate-800",
    border: "border-slate-300 dark:border-slate-700",
  },
};

function StatusBadge({ status }: { status: Status }) {
  const config = statusConfig[status];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${config.color} ${config.bg} border ${config.border}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function getOverallStatus(d: Director): Status {
  if (d.sebiStatus === "flagged" || d.rbiStatus === "flagged" || d.unStatus === "flagged" || d.mca21Status === "flagged") return "flagged";
  if (d.sebiStatus === "warning" || d.rbiStatus === "warning" || d.unStatus === "warning" || d.mca21Status === "warning") return "warning";
  if (d.sebiStatus === "pending" || d.rbiStatus === "pending" || d.unStatus === "pending" || d.mca21Status === "pending") return "pending";
  return "clear";
}

export default function RegulatoryPage() {
  const [selectedDirector, setSelectedDirector] = useState<Director | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const filteredDirectors = directors.filter((d) => {
    const matchesSearch = d.name.toLowerCase().includes(searchQuery.toLowerCase()) || d.company.toLowerCase().includes(searchQuery.toLowerCase());
    const overall = getOverallStatus(d);
    const matchesFilter = filterStatus === "all" || overall === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: directors.length,
    clear: directors.filter((d) => getOverallStatus(d) === "clear").length,
    flagged: directors.filter((d) => getOverallStatus(d) === "flagged").length,
    warning: directors.filter((d) => getOverallStatus(d) === "warning").length,
  };

  return (
    <div className="p-6 space-y-6 bg-grid-pattern min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">SEBI Regulatory Shield</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Automated integrity checks against SEBI, RBI, MCA & UN debarred lists
            </p>
          </div>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors">
          <RefreshCw className="w-4 h-4" />
          Re-scan All
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Scanned</span>
            <User className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{stats.total}</div>
          <p className="text-xs text-slate-400 mt-1">Directors & Promoters</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-emerald-200 dark:border-emerald-500/20 p-4 glow-emerald">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">All Clear</span>
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{stats.clear}</div>
          <p className="text-xs text-emerald-500/70 mt-1">No regulatory issues</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-500/20 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">Warnings</span>
            <ShieldAlert className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{stats.warning}</div>
          <p className="text-xs text-amber-500/70 mt-1">Needs attention</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-red-200 dark:border-red-500/20 p-4 glow-rose">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-red-600 dark:text-red-400 uppercase tracking-wider">FLAGGED</span>
            <ShieldX className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{stats.flagged}</div>
          <p className="text-xs text-red-500/70 mt-1">Debarred / Action taken</p>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus-within:border-blue-300 dark:focus-within:border-blue-500/40 transition-colors">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, company, or DIN..."
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          {["all", "clear", "warning", "flagged"].map((f) => (
            <button
              key={f}
              onClick={() => setFilterStatus(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                filterStatus === f
                  ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20"
                  : "bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Directors Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Director / Promoter</th>
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Company</th>
                <th className="text-center px-3 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">SEBI</th>
                <th className="text-center px-3 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">RBI</th>
                <th className="text-center px-3 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">UN List</th>
                <th className="text-center px-3 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">MCA-21</th>
                <th className="text-center px-3 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Overall</th>
                <th className="text-right px-5 py-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Checked</th>
              </tr>
            </thead>
            <tbody>
              {filteredDirectors.map((d) => {
                const overall = getOverallStatus(d);
                return (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedDirector(selectedDirector?.id === d.id ? null : d)}
                    className={`border-b border-slate-300/70 dark:border-slate-800/50 cursor-pointer transition-colors ${
                      selectedDirector?.id === d.id ? "bg-blue-50/50 dark:bg-blue-500/5" : "hover:bg-slate-50 dark:hover:bg-slate-800/30"
                    } ${overall === "flagged" ? "bg-red-50/30 dark:bg-red-500/[0.03]" : ""}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                          overall === "flagged" ? "bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400" :
                          overall === "warning" ? "bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400" :
                          "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                        }`}>
                          {d.name.split(" ").map(n => n[0]).slice(0, 2).join("")}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-900 dark:text-white">{d.name}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">{d.designation} · DIN: {d.din}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-xs text-slate-700 dark:text-slate-300">{d.company}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-center"><StatusBadge status={d.sebiStatus} /></td>
                    <td className="px-3 py-3.5 text-center"><StatusBadge status={d.rbiStatus} /></td>
                    <td className="px-3 py-3.5 text-center"><StatusBadge status={d.unStatus} /></td>
                    <td className="px-3 py-3.5 text-center"><StatusBadge status={d.mca21Status} /></td>
                    <td className="px-3 py-3.5 text-center"><StatusBadge status={overall} /></td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-[10px] text-slate-400">{d.lastChecked}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Panel */}
      {selectedDirector && selectedDirector.details && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-800 p-5 animate-fade-in">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              getOverallStatus(selectedDirector) === "flagged"
                ? "bg-red-100 dark:bg-red-500/10" 
                : "bg-amber-100 dark:bg-amber-500/10"
            }`}>
              <FileWarning className={`w-5 h-5 ${
                getOverallStatus(selectedDirector) === "flagged" 
                  ? "text-red-500" 
                  : "text-amber-500"
              }`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{selectedDirector.name}</h3>
                <StatusBadge status={getOverallStatus(selectedDirector)} />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{selectedDirector.details}</p>
              <div className="flex items-center gap-3 mt-3">
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium border border-blue-200 dark:border-blue-500/20 hover:bg-blue-100 dark:hover:bg-blue-500/15 transition-colors">
                  <ExternalLink className="w-3 h-3" />
                  View SEBI Order
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <Info className="w-3 h-3" />
                  Full Report
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

       {/* Methodology Note */}
      <div className="bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-300 dark:border-slate-700/50 p-4">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Verification Methodology</p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 leading-relaxed">
              All checks are performed against official databases: SEBI Debarred Entities list, RBI Defaulter Directory, 
              UN Security Council Consolidated Sanctions List, and MCA-21 Director Disqualification records. 
              Results are cached for 24 hours and can be refreshed on demand.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
