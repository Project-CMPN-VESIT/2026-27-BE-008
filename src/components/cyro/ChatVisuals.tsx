"use client";

import { useEffect, useMemo, useState } from "react";
import type { CompareVisual, MetricUnit, RankingVisual, StockVisual, Visual } from "./useCyroChat";

/* ───────────── formatting ───────────── */

const inr = (v: number, digits = 2) => v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function formatMetric(value: number, unit: MetricUnit) {
  switch (unit) {
    case "crore": return value >= 100000 ? `₹${inr(value / 100000, 2)} L Cr` : `₹${inr(value, 0)} Cr`;
    case "x": return `${inr(value, 2)}x`;
    case "pct": return `${inr(value, 2)}%`;
    case "signed_pct": return `${value >= 0 ? "+" : ""}${inr(value, 2)}%`;
  }
}

const tone = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : "flat");

/** Scores are 0 to 100. Colour follows the model's own bands rather than inventing thresholds. */
const bandClass = (band: string) => {
  const b = band.toLowerCase();
  if (b.includes("excellent") || b.includes("strong")) return "great";
  if (b.includes("good")) return "good";
  if (b.includes("moderate") || b.includes("fair")) return "mid";
  return "low";
};

/* ───────────── price chart (real daily closes, fetched from the same feed as the dashboards) ───────────── */

type Series = { closes: number[]; first: number; last: number };

function PriceChart({ symbol }: { symbol: string }) {
  const [series, setSeries] = useState<Series | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    fetch(`/api/tv-chart?symbol=${encodeURIComponent(symbol)}&timeframe=D&range=90`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const closes: number[] = (j?.data?.candles ?? []).map((c: { close: number }) => c.close).filter((n: number) => Number.isFinite(n));
        if (closes.length < 5) setFailed(true);
        else setSeries({ closes, first: closes[0], last: closes[closes.length - 1] });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [symbol]);

  const geometry = useMemo(() => {
    if (!series) return null;
    const W = 560, H = 120, pad = 6;
    const min = Math.min(...series.closes), max = Math.max(...series.closes), span = max - min || 1;
    const pts = series.closes.map((v, i) => [pad + (i / (series.closes.length - 1)) * (W - pad * 2), pad + (1 - (v - min) / span) * (H - pad * 2)]);
    const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return { W, H, line, area: `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`, min, max };
  }, [series]);

  if (failed) return null;
  if (!series || !geometry) return <div className="cv-chart cv-chart-skel" aria-hidden />;

  const change = ((series.last - series.first) / series.first) * 100;
  return (
    <div className="cv-chart">
      <div className="cv-chart-head">
        <span>Last 90 trading days</span>
        <b className={tone(change)}>{change >= 0 ? "+" : ""}{inr(change, 2)}%</b>
      </div>
      <svg viewBox={`0 0 ${geometry.W} ${geometry.H}`} role="img" aria-label={`${symbol} price over the last 90 trading days`} preserveAspectRatio="none">
        <path d={geometry.area} className={`cv-area ${tone(change)}`} />
        <path d={geometry.line} className={`cv-line ${tone(change)}`} />
      </svg>
      <div className="cv-chart-foot"><span>Low ₹{inr(geometry.min)}</span><span>High ₹{inr(geometry.max)}</span></div>
    </div>
  );
}

/* ───────────── cards ───────────── */

function StockCard({ v }: { v: StockVisual }) {
  return (
    <section className="cv-card" aria-label={`${v.symbol} at a glance`}>
      <header className="cv-head">
        <div>
          <div className="cv-title">{v.name || v.symbol} <span className="cv-sym">{v.symbol}</span></div>
          <div className="cv-sub">{[v.sector, v.size].filter(Boolean).join(" · ")}</div>
        </div>
        {typeof v.price === "number" && <div className="cv-price">₹{inr(v.price)}</div>}
      </header>

      <PriceChart symbol={v.symbol} />

      {v.metrics.length > 0 && (
        <div className="cv-tiles">
          {v.metrics.map((m, mi) => (
            <div key={`${m.label}-${mi}`} className="cv-tile">
              <span>{m.label}</span>
              <b className={m.unit === "signed_pct" ? tone(m.value) : undefined}>{formatMetric(m.value, m.unit)}</b>
            </div>
          ))}
        </div>
      )}

      {v.returns.length > 0 && (
        <div className="cv-returns" aria-label="Returns">
          {v.returns.map((r, ri) => (
            <div key={`${r.label}-${ri}`} className="cv-ret">
              <span>{r.label}</span>
              <b className={tone(r.value)}>{r.value >= 0 ? "+" : ""}{inr(r.value, 1)}%</b>
            </div>
          ))}
        </div>
      )}

      {v.scores.length > 0 && (
        <div className="cv-scores">
          <div className="cv-kicker">Investor-style scores (rule based, 0 to 100)</div>
          {v.scores.map((s, si) => (
            <div key={`${s.investor}-${si}`} className="cv-score">
              <span className="cv-score-name">{s.investor}</span>
              <div className="cv-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.score)} aria-label={s.investor}>
                <i className={bandClass(s.band)} style={{ width: `${Math.max(2, Math.min(100, s.score))}%` }} />
              </div>
              <span className="cv-score-val">{Math.round(s.score)} <em>{s.band}</em></span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CompareCard({ v }: { v: CompareVisual }) {
  const models = Array.from(new Set(v.rows.flatMap((r) => Object.keys(r.scores))));
  return (
    <section className="cv-card" aria-label="Side-by-side comparison">
      <div className="cv-kicker">Investor-style scores, side by side</div>
      <div className="cv-table-wrap">
        <table className="cv-table">
          <thead>
            <tr><th>Stock</th>{models.map((m) => <th key={m}>{m}</th>)}</tr>
          </thead>
          <tbody>
            {v.rows.map((r) => (
              <tr key={r.symbol}>
                <th scope="row">{r.symbol}<small>{r.size}</small></th>
                {models.map((m) => {
                  const s = r.scores[m];
                  const best = s != null && Math.max(...v.rows.map((x) => x.scores[m] ?? -1)) === s;
                  return <td key={m} className={best ? "best" : undefined}>{s == null ? "n/a" : Math.round(s)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RankingCard({ v }: { v: RankingVisual }) {
  const top = Math.max(...v.items.map((i) => i.score ?? 0), 1);
  return (
    <section className="cv-card" aria-label="Top matches">
      <div className="cv-kicker">Top matches</div>
      <ol className="cv-rank">
        {v.items.map((i) => (
          <li key={i.symbol}>
            <span className="cv-rank-name"><b>{i.symbol}</b><small>{[i.name, i.size].filter(Boolean).join(" · ")}</small></span>
            {typeof i.score === "number" && (
              <>
                <div className="cv-bar"><i className={bandClass(i.score >= 75 ? "excellent" : i.score >= 60 ? "good" : "moderate")} style={{ width: `${(i.score / top) * 100}%` }} /></div>
                <span className="cv-score-val">{Math.round(i.score)}</span>
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ChatVisuals({ items }: { items: Visual[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="cv-stack">
      {items.map((v, i) =>
        v.kind === "stock" ? <StockCard key={`${v.symbol}-${i}`} v={v} /> :
        v.kind === "compare" ? <CompareCard key={`c${i}`} v={v} /> :
        v.kind === "ranking" ? <RankingCard key={`r${i}`} v={v} /> : null,
      )}
    </div>
  );
}
