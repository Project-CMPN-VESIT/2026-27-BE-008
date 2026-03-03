"use client";

import { useState } from "react";
import {
  Send,
  Swords,
  FileText,
  Sparkles,
  ChevronDown,
  Search,
  ZoomIn,
  ZoomOut,
  Highlighter,
  BookOpen,
  Copy,
  RotateCcw,
  Bot,
  User,
} from "lucide-react";

interface Citation {
  id: string;
  label: string;
  page: number;
  text: string;
}

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

const initialMessages: Message[] = [
  {
    id: 1,
    role: "user",
    content: "Analyze the debt structure and risk profile of Adani Enterprises from its latest annual report.",
  },
  {
    id: 2,
    role: "assistant",
    content: `Based on the Annual Report FY2025 for Adani Enterprises Ltd (AEL), here is a comprehensive analysis of the debt structure and risk profile:

**Consolidated Debt Overview:**
The total consolidated borrowings stand at ₹47,320 Cr as of March 2025, reflecting a 12.3% YoY increase. The debt-to-equity ratio has risen to 2.14x from 1.87x in FY2024, which warrants close monitoring.

**Key Risk Factors Identified:**

1. **Leverage Concentration** — A significant portion of the debt (62%) is denominated in USD-linked instruments, exposing the group to foreign exchange volatility.

2. **Related Party Transactions** — The report discloses inter-corporate guarantees of ₹18,400 Cr across subsidiary entities. The auditor has flagged this as a material observation.

3. **Auditor Qualification** — The statutory auditor (Shah Dhandharia & Co.) has included an Emphasis of Matter paragraph regarding the group's dependence on continued refinancing of short-term commercial paper.

4. **Promoter Pledge Status** — 4.81% of promoter holdings remain pledged as collateral, down from 7.2% in FY2024 but still above the peer median of 1.2%.

**Debt Maturity Profile:**
Short-term obligations (< 1 year) account for 31% of total debt, creating a maturity concentration risk. The company will need to refinance approximately ₹14,700 Cr within the next 12 months.`,
    citations: [
      { id: "c1", label: "AR 2025, Pg 142", page: 142, text: "Total consolidated borrowings as at March 31, 2025 stood at ₹47,320 Crores (Previous Year: ₹42,140 Crores), representing an increase of 12.3% year-on-year. The debt-to-equity ratio stands at 2.14x compared to 1.87x in the prior year." },
      { id: "c2", label: "AR 2025, Pg 203", page: 203, text: "Inter-corporate guarantees and commitments: The Group has provided corporate guarantees aggregating ₹18,400 Crores to various subsidiary and associate entities for their borrowing facilities as detailed in Note 38." },
      { id: "c3", label: "AR 2025, Pg 267", page: 267, text: "Emphasis of Matter: We draw attention to Note 42 regarding the Group's reliance on continued access to short-term commercial paper markets for refinancing of current maturities. The management has represented that adequate arrangements are in place." },
      { id: "c4", label: "AR 2025, Pg 89", page: 89, text: "Promoter and Promoter Group shareholding: 4.81% of promoter holdings are pledged or otherwise encumbered (Previous Year: 7.2%). Details of shares pledged as per SEBI Regulation 31(1) are provided in Annexure-IV." },
    ],
  },
  {
    id: 3,
    role: "user",
    content: "What does the auditor specifically say about the refinancing risk?",
  },
  {
    id: 4,
    role: "assistant",
    content: `The statutory auditor's report contains a specific **Emphasis of Matter** paragraph that raises concerns about refinancing dependency:

The auditor notes that ₹14,700 Cr in commercial paper and short-term facilities mature within 12 months. Management has asserted that refinancing arrangements are "adequate," but the auditor explicitly states this is based on management's representation, **without independent verification** of the rollover commitments.

Additionally, the Independent Auditor's Report references SEBI's enhanced disclosure requirements under Regulation 33(1)(f), noting the company's working capital cycle has extended from 45 days to 67 days, creating additional liquidity pressure.

This is a significant finding because it signals that even the auditor is not fully comfortable with the refinancing assumptions baked into the going concern assessment.`,
    citations: [
      { id: "c5", label: "AR 2025, Pg 267", page: 267, text: "Emphasis of Matter: We draw attention to Note 42 regarding the Group's reliance on continued access to short-term commercial paper markets for refinancing of current maturities. The management has represented that adequate arrangements are in place." },
      { id: "c6", label: "AR 2025, Pg 271", page: 271, text: "Note 42: Short-term commercial paper outstanding as at March 31, 2025 amounts to ₹14,700 Crores with maturities within the next 12 months. Management considers the refinancing risk to be low based on the Group's established track record." },
      { id: "c7", label: "AR 2025, Pg 156", page: 156, text: "Working capital days have increased to 67 days from 45 days in the prior period primarily on account of extended receivable cycles from infrastructure project segments and increased inventory holding periods." },
    ],
  },
];

const pdfContent: Record<number, string[]> = {
  89: [
    "SHAREHOLDING PATTERN",
    "",
    "Table 4.3: Promoter and Promoter Group Holdings",
    "",
    "Category: Promoter and Promoter Group",
    "Total Shares Held: 1,84,92,47,510",
    "Percentage of Total: 72.63%",
    "",
    "Promoter and Promoter Group shareholding: 4.81% of promoter",
    "holdings are pledged or otherwise encumbered (Previous Year:",
    "7.2%). Details of shares pledged as per SEBI Regulation 31(1)",
    "are provided in Annexure-IV.",
    "",
    "The reduction in pledge from 7.2% to 4.81% was achieved through",
    "partial release of pledged shares following the prepayment of",
    "₹3,200 Crores of promoter-level debt during Q3 FY2025.",
    "",
    "Note: Peer median pledge ratio as of March 2025 stands at 1.2%",
    "for companies in the Nifty 50 index.",
  ],
  142: [
    "CONSOLIDATED FINANCIAL STATEMENTS",
    "",
    "Note 21: Borrowings",
    "",
    "21.1 Long-term Borrowings",
    "  Secured Term Loans from Banks: ₹22,840 Cr",
    "  Unsecured Non-Convertible Debentures: ₹8,120 Cr",
    "  External Commercial Borrowings (USD): ₹6,460 Cr",
    "",
    "21.2 Short-term Borrowings",
    "  Working Capital Facilities: ₹4,200 Cr",
    "  Commercial Paper: ₹5,700 Cr",
    "",
    "Total consolidated borrowings as at March 31, 2025 stood at",
    "₹47,320 Crores (Previous Year: ₹42,140 Crores), representing",
    "an increase of 12.3% year-on-year. The debt-to-equity ratio",
    "stands at 2.14x compared to 1.87x in the prior year.",
    "",
    "Currency-wise composition: INR denominated: 38%, USD denominated:",
    "62% of total borrowings as at reporting date.",
  ],
  156: [
    "MANAGEMENT DISCUSSION AND ANALYSIS",
    "",
    "6.3 Working Capital Management",
    "",
    "The Group's working capital management showed the following",
    "key metrics during the reporting period:",
    "",
    "Working capital days have increased to 67 days from 45 days",
    "in the prior period primarily on account of extended receivable",
    "cycles from infrastructure project segments and increased",
    "inventory holding periods.",
    "",
    "Management is actively working on optimizing the cash conversion",
    "cycle through the following initiatives:",
    "  (a) Renegotiation of payment terms with key customers",
    "  (b) Implementation of dynamic discounting programs",
    "  (c) Centralized treasury management system deployment",
    "",
    "Expected improvement in working capital days: 15-20 days",
    "improvement targeted by Q2 FY2026.",
  ],
  203: [
    "NOTES TO CONSOLIDATED FINANCIAL STATEMENTS",
    "",
    "Note 38: Related Party Disclosures",
    "",
    "38.4 Inter-Corporate Guarantees and Commitments",
    "",
    "The Group has provided corporate guarantees aggregating",
    "₹18,400 Crores to various subsidiary and associate entities",
    "for their borrowing facilities as detailed below:",
    "",
    "Entity                          | Guarantee (₹ Cr) | Purpose",
    "-----------------------------------------------------------",
    "Adani Green Energy Ltd          | 6,200            | Project",
    "Adani Ports and SEZ Ltd         | 4,800            | Expansion",
    "Adani Transmission Ltd          | 3,600            | Capex",
    "Adani Power Ltd                 | 2,400            | Refinancing",
    "Others (Subsidiaries)           | 1,400            | Various",
    "",
    "The statutory auditor has included this as a material",
    "observation in the audit report (Refer: Auditor's Report,",
    "Section on Key Audit Matters).",
  ],
  267: [
    "INDEPENDENT AUDITOR'S REPORT",
    "",
    "To the Members of Adani Enterprises Limited",
    "",
    "Report on the Audit of Consolidated Financial Statements",
    "",
    "Emphasis of Matter:",
    "",
    "We draw attention to Note 42 regarding the Group's reliance",
    "on continued access to short-term commercial paper markets",
    "for refinancing of current maturities. The management has",
    "represented that adequate arrangements are in place for",
    "refinancing the short-term borrowings upon maturity.",
    "",
    "Our opinion is not modified in respect of this matter.",
    "",
    "We further note that the Group's working capital cycle has",
    "extended during the current period, and draw attention to",
    "disclosure requirements under SEBI Regulation 33(1)(f).",
    "",
    "For Shah Dhandharia & Co.",
    "Chartered Accountants",
    "Firm Registration No: 118585W",
  ],
  271: [
    "NOTES TO CONSOLIDATED FINANCIAL STATEMENTS (Continued)",
    "",
    "Note 42: Refinancing Risk — Commercial Paper Program",
    "",
    "Note 42: Short-term commercial paper outstanding as at March",
    "31, 2025 amounts to ₹14,700 Crores with maturities within",
    "the next 12 months. Management considers the refinancing risk",
    "to be low based on the Group's established track record of",
    "successful rollovers and the availability of committed backup",
    "credit facilities.",
    "",
    "Details of Commercial Paper Program:",
    "  Outstanding amount: ₹14,700 Cr",
    "  Weighted average rate: 7.2% p.a.",
    "  Average tenure: 90 days",
    "  Credit rating: CRISIL A1+ / ICRA A1+",
    "",
    "Maturity Schedule:",
    "  Q1 FY2026: ₹5,200 Cr",
    "  Q2 FY2026: ₹4,100 Cr",
    "  Q3 FY2026: ₹3,800 Cr",
    "  Q4 FY2026: ₹1,600 Cr",
  ],
};

export default function WarRoomPage() {
  const [messages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState("");
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [activePageNum, setActivePageNum] = useState<number>(142);
  const [zoom, setZoom] = useState(100);

  const handleCitationClick = (citation: Citation) => {
    setActiveCitation(citation);
    setActivePageNum(citation.page);
  };

  const currentPageContent = pdfContent[activePageNum] || pdfContent[142];

  return (
    <div className="h-screen flex flex-col">
      {/* Header Bar */}
      <div className="h-14 px-5 flex items-center justify-between border-b border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center">
            <Swords className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 dark:text-white">War Room</h1>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">CYRO AI Research Interface</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20">
            <Sparkles className="w-3.5 h-3.5 text-violet-500" />
            <span className="text-xs font-medium text-violet-700 dark:text-violet-400">CYRO Online</span>
          </div>
          <select className="px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
            <option>Adani Enterprises Ltd</option>
            <option>Reliance Industries Ltd</option>
            <option>Infosys Ltd</option>
            <option>HDFC Bank Ltd</option>
          </select>
        </div>
      </div>

      {/* Split Screen */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Chat */}
        <div className="w-1/2 flex flex-col border-r border-slate-300 dark:border-slate-800">
          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                )}
                <div className={`max-w-[85%] ${msg.role === "user" ? "order-first" : ""}`}>
                  <div
                    className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white ml-auto"
                        : "bg-slate-50 dark:bg-slate-800/70 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700"
                    }`}
                  >
                    {msg.content.split("\n").map((line, i) => (
                      <p key={i} className={`${line === "" ? "h-2" : ""} ${line.startsWith("**") ? "font-semibold" : ""}`}>
                        {line.replace(/\*\*/g, "")}
                      </p>
                    ))}
                  </div>
                  {/* Citation badges */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 mr-1 self-center">Sources:</span>
                      {msg.citations.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => handleCitationClick(c)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                            activeCitation?.id === c.id
                              ? "bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-500/30 ring-2 ring-violet-200 dark:ring-violet-500/20"
                              : "bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:text-violet-700 dark:hover:text-violet-300 hover:border-violet-200 dark:hover:border-violet-500/20"
                          }`}
                        >
                          <FileText className="w-3 h-3" />
                          [{c.label}]
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2.5 focus-within:border-blue-300 dark:focus-within:border-blue-500/40 focus-within:ring-2 focus-within:ring-blue-100 dark:focus-within:ring-blue-500/10 transition-all">
                <input
                  type="text"
                  placeholder="Ask CYRO about filings, risks, financials..."
                  className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                />
                <ChevronDown className="w-4 h-4 text-slate-400 ml-2" />
              </div>
              <button className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors shrink-0">
                <Send className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-4 mt-2 px-1">
              <span className="text-[10px] text-slate-400">Grounded in: Annual Report FY2025 (342 pages)</span>
              <span className="text-[10px] text-slate-400">|</span>
              <span className="text-[10px] text-emerald-500 font-medium">All claims citation-verified</span>
            </div>
          </div>
        </div>

        {/* Right Panel - PDF Viewer */}
        <div className="w-1/2 flex flex-col bg-slate-50 dark:bg-slate-925">
          {/* PDF Toolbar */}
          <div className="h-11 px-4 flex items-center justify-between border-b border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Adani Enterprises — Annual Report FY2025
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setZoom(Math.max(70, zoom - 10))} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <ZoomOut className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <span className="text-[10px] font-medium text-slate-500 w-8 text-center">{zoom}%</span>
              <button onClick={() => setZoom(Math.min(150, zoom + 10))} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <ZoomIn className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
              <button className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <Search className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <button className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <Copy className="w-3.5 h-3.5 text-slate-500" />
              </button>
            </div>
          </div>

          {/* Page Navigation */}
          <div className="px-4 py-2 flex items-center gap-2 border-b border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
            <span className="text-[10px] text-slate-400">Jump to page:</span>
            {Object.keys(pdfContent).map((p) => {
              const pageNum = Number(p);
              return (
                <button
                  key={p}
                  onClick={() => setActivePageNum(pageNum)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    activePageNum === pageNum
                      ? "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-500/25"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                  }`}
                >
                  Pg {p}
                </button>
              );
            })}
          </div>

          {/* PDF Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div
              className="max-w-2xl mx-auto bg-white dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-800 shadow-sm"
              style={{ fontSize: `${zoom}%` }}
            >
              {/* Page header */}
              <div className="px-8 pt-6 pb-2 border-b border-slate-300/60 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-medium">
                    ADANI ENTERPRISES LIMITED — Annual Report 2024-25
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    Page {activePageNum}
                  </span>
                </div>
              </div>

              {/* Page content */}
              <div className="px-8 py-6 font-mono text-xs leading-6 text-slate-700 dark:text-slate-300">
                {currentPageContent.map((line, i) => {
                  const isHighlighted =
                    activeCitation &&
                    activeCitation.page === activePageNum &&
                    activeCitation.text.includes(line.trim()) &&
                    line.trim().length > 10;

                  return (
                    <div
                      key={i}
                      className={`${
                        isHighlighted
                          ? "bg-yellow-100 dark:bg-yellow-500/15 border-l-2 border-yellow-400 dark:border-yellow-500 pl-3 -ml-3 rounded-r transition-all duration-300"
                          : ""
                      } ${line === "" ? "h-3" : ""} ${
                        i === 0 ? "text-sm font-bold text-slate-900 dark:text-white" : ""
                      }`}
                    >
                      {line}
                    </div>
                  );
                })}
              </div>

              {/* Page footer */}
              <div className="px-8 py-3 border-t border-slate-300/60 dark:border-slate-800 flex items-center justify-between">
                <span className="text-[9px] text-slate-300 dark:text-slate-600">
                  CONFIDENTIAL — For authorized use only
                </span>
                <span className="text-[9px] text-slate-300 dark:text-slate-600">
                  {activePageNum} / 342
                </span>
              </div>
            </div>

            {/* Highlight Info */}
            {activeCitation && activeCitation.page === activePageNum && (
              <div className="max-w-2xl mx-auto mt-3 px-4 py-3 rounded-lg bg-yellow-50 dark:bg-yellow-500/5 border border-yellow-200 dark:border-yellow-500/20 animate-fade-in">
                <div className="flex items-start gap-2">
                  <Highlighter className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-medium text-yellow-700 dark:text-yellow-400">
                      Highlighted: {activeCitation.label}
                    </div>
                    <p className="text-[11px] text-yellow-600 dark:text-yellow-400/80 mt-1 leading-relaxed">
                      {activeCitation.text}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
