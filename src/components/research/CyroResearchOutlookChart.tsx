"use client";

import type { KeyboardEvent } from "react";

export type OutlookSource = {
  evidenceId?: string;
  agent: string;
  tool_name: string;
  source_type: string;
  label: string;
  input_args: Record<string, unknown>;
  excerpt: string;
  timestamp: string;
};

export type OutlookDomain = {
  id: string;
  label: string;
  status: string;
  tone: "positive" | "negative" | "neutral" | "limited" | "unavailable" | "not-assessed";
  detail: string;
  source?: OutlookSource;
};

type Props = {
  symbol: string;
  horizon: string;
  decision: string;
  driver: string;
  domains: OutlookDomain[];
  onSourceClick: (source: OutlookSource) => void;
};

const TONES: Record<OutlookDomain["tone"], string> = {
  positive: "var(--green)",
  negative: "var(--red)",
  neutral: "var(--accent)",
  limited: "#b7791f",
  unavailable: "var(--text-3)",
  "not-assessed": "var(--text-3)",
};

const MARKER_POSITIONS: Record<OutlookDomain["tone"], number> = {
  positive: 0.82,
  negative: 0.24,
  neutral: 0.56,
  limited: 0.36,
  unavailable: 0.27,
  "not-assessed": 0.12,
};

const GAUGE_MARKERS: Record<string, { x: number; y: number; color: string }> = {
  sell: { x: 100, y: 139, color: "var(--red)" },
  strong_sell: { x: 88, y: 157, color: "var(--red)" },
  cautious: { x: 143, y: 82, color: "#b7791f" },
  hold: { x: 196, y: 70, color: "var(--accent)" },
  neutral: { x: 196, y: 70, color: "var(--accent)" },
  indeterminate: { x: 196, y: 70, color: "var(--text-3)" },
  "watch for confirmation": { x: 196, y: 70, color: "#b7791f" },
  constructive: { x: 249, y: 82, color: "var(--green)" },
  buy: { x: 292, y: 139, color: "var(--green)" },
  strong_buy: { x: 304, y: 157, color: "var(--green)" },
};

function displayHorizon(horizon: string) {
  return horizon.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function truncateDriver(driver: string) {
  const normalized = driver.replace(/\s+/g, " ").trim();
  return normalized.length > 112 ? `${normalized.slice(0, 109).trimEnd()}…` : normalized;
}

function activateSource(event: KeyboardEvent<SVGGElement>, source?: OutlookSource, onSourceClick?: (source: OutlookSource) => void) {
  if (source && onSourceClick && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    onSourceClick(source);
  }
}

export function CyroResearchOutlookChart({ symbol, horizon, decision, driver, domains, onSourceClick }: Props) {
  const gauge = GAUGE_MARKERS[decision.toLowerCase()] ?? GAUGE_MARKERS.indeterminate;
  const trackStart = 493;
  const trackEnd = 642;

  return (
    <figure className="outlook" aria-label={`CYRO research outlook for ${symbol}`}>
      <svg viewBox="0 0 700 320" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="outlook-title outlook-description" style={{ userSelect: "none" }}>
        <title id="outlook-title">CYRO research outlook</title>
        <desc id="outlook-description">A qualitative investment-stance gauge and six evidence-derived specialist tracks.</desc>
        <rect x="1" y="1" width="698" height="318" rx="14" className="card" />
        <text x="28" y="29" className="kicker" aria-hidden="true">CYRO RESEARCH OUTLOOK</text>
        <text x="28" y="49" className="subtitle" aria-hidden="true">{symbol} · {displayHorizon(horizon)}</text>

        <g aria-label={`Investment stance ${decision}`}>
          <path d="M 92 176 A 104 104 0 0 1 300 176" className="gauge-base" />
          <path d="M 92 176 A 104 104 0 0 1 300 176" className="gauge-active" />
          <line x1="98" y1="160" x2="105" y2="158" className="gauge-tick" />
          <line x1="137" y1="91" x2="142" y2="97" className="gauge-tick" />
          <line x1="196" y1="71" x2="196" y2="79" className="gauge-tick" />
          <line x1="255" y1="91" x2="250" y2="97" className="gauge-tick" />
          <line x1="294" y1="160" x2="287" y2="158" className="gauge-tick" />
          <line x1="196" y1="176" x2={gauge.x} y2={gauge.y + 6} stroke={gauge.color} strokeWidth="2.5" strokeLinecap="round" className="needle" />
          <circle cx="196" cy="176" r="5" fill="var(--bg-raised)" stroke={gauge.color} strokeWidth="2.5" />
          <circle cx={gauge.x} cy={gauge.y} r="4" fill={gauge.color} className="needle-marker" />
          <text x="196" y="207" textAnchor="middle" className="decision" aria-hidden="true">{decision.toUpperCase()}</text>
          <text x="196" y="226" textAnchor="middle" className="decision-caption" aria-hidden="true">
            {decision.toLowerCase() === "indeterminate" ? "Insufficient directional conviction" : "Committee investment stance"}
          </text>
          <text x="92" y="195" className="edge-label" aria-hidden="true">SELL</text>
          <text x="300" y="195" textAnchor="end" className="edge-label" aria-hidden="true">BUY</text>
        </g>

        <line x1="341" x2="341" y1="69" y2="237" className="divider" />
        <text x="365" y="83" className="tracks-heading" aria-hidden="true">EVIDENCE SIGNALS</text>
        {domains.map((domain, index) => {
          const y = 111 + index * 22;
          const color = TONES[domain.tone];
          const markerX = trackStart + (trackEnd - trackStart) * MARKER_POSITIONS[domain.tone];
          const interactive = Boolean(domain.source);
          return (
            <g
              key={domain.id}
              className={interactive ? "domain interactive" : "domain"}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? `${domain.label}: ${domain.status}. Open supporting source.` : `${domain.label}: ${domain.status}.`}
              onClick={() => domain.source && onSourceClick(domain.source)}
              onKeyDown={(event) => activateSource(event, domain.source, onSourceClick)}
            >
              <title>{domain.detail}</title>
              <text x="365" y={y + 4} className="domain-label" aria-hidden="true">{domain.label}</text>
              <line x1={trackStart} x2={trackEnd} y1={y} y2={y} className="track-base" />
              <line x1={trackStart} x2={markerX} y1={y} y2={y} stroke={color} strokeWidth="2.5" strokeLinecap="round" className="track-fill" />
              <circle cx={markerX} cy={y} r="4.5" fill={color} className="track-marker" />
              <text x="672" y={y + 4} textAnchor="end" fill={color} className="domain-status" aria-hidden="true">{domain.status}</text>
            </g>
          );
        })}

        <rect x="28" y="258" width="644" height="38" rx="8" className="driver-surface" />
        <text x="42" y="275" className="driver-label" aria-hidden="true">MAIN DRIVER</text>
        <text x="137" y="275" className="driver-text" aria-hidden="true">{truncateDriver(driver)}</text>
        <text x="42" y="288" className="driver-hint" aria-hidden="true">Derived from the committee summary and specialist evidence.</text>
      </svg>
      <style jsx>{`
        .outlook { width: min(100%, 700px); margin: 0; }
        .outlook svg { display: block; width: 100%; height: auto; overflow: visible; }
        .card { fill: var(--bg-raised); stroke: var(--border-mid); stroke-width: 1.25; }
        .kicker, .tracks-heading, .driver-label { fill: var(--text-3); font-size: 10px; font-weight: 750; letter-spacing: 1.18px; }
        .subtitle { fill: var(--text-2); font-size: 12px; font-weight: 650; }
        .gauge-base { fill: none; stroke: var(--border-faint); stroke-width: 10; stroke-linecap: round; }
        .gauge-active { fill: none; stroke: var(--accent); stroke-opacity: .55; stroke-width: 2; stroke-linecap: round; stroke-dasharray: 327; animation: gauge-draw 420ms ease-out both; }
        .gauge-tick { stroke: var(--border-mid); stroke-width: 1.5; stroke-linecap: round; }
        .needle { animation: needle-enter 420ms ease-out both; transform-origin: 196px 176px; }
        .needle-marker { animation: marker-enter 420ms ease-out both; transform-origin: center; }
        .decision { fill: var(--text-1); font-size: 16px; font-weight: 780; letter-spacing: .35px; }
        .decision-caption, .edge-label { fill: var(--text-3); font-size: 9.5px; font-weight: 620; }
        .divider, .track-base { stroke: var(--border-faint); stroke-width: 1; }
        .domain-label { fill: var(--text-2); font-size: 11px; font-weight: 650; }
        .domain-status { font-size: 10px; font-weight: 720; }
        .interactive { cursor: pointer; outline: none; }
        .interactive:hover .domain-label, .interactive:focus .domain-label { fill: var(--text-1); }
        .interactive:hover .track-base, .interactive:focus .track-base { stroke: var(--border-mid); }
        .driver-surface { fill: var(--bg-surface); stroke: var(--border-faint); stroke-width: 1; }
        .driver-text { fill: var(--text-2); font-size: 10.5px; font-weight: 600; }
        .driver-hint { fill: var(--text-3); font-size: 9px; }
        @keyframes gauge-draw { from { stroke-dashoffset: 327; } to { stroke-dashoffset: 0; } }
        @keyframes needle-enter { from { opacity: 0; transform: rotate(-28deg); } to { opacity: 1; transform: rotate(0); } }
        @keyframes marker-enter { from { opacity: 0; transform: scale(.45); } to { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) { .gauge-active, .needle, .needle-marker { animation: none; } }
      `}</style>
    </figure>
  );
}
