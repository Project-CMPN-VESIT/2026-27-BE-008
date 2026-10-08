import React, { useEffect, useState, useRef } from 'react'
import { motion } from 'framer-motion'

/**
 * LineChart — Animated SVG line chart with gradient fill
 * Used for stock price trends, revenue history, etc.
 * scene.line_data = [{ label: "Q1", value: 42 }, ...]
 */

const COLORS = {
  green: { stroke: '#1fd97a', fill: 'rgba(31,217,122,0.15)' },
  red:   { stroke: '#ff4d4d', fill: 'rgba(255,77,77,0.15)' },
  blue:  { stroke: '#4d9fff', fill: 'rgba(77,159,255,0.15)' },
  amber: { stroke: '#f5a623', fill: 'rgba(245,166,35,0.15)' },
}

function buildPath(points, width, height, padding) {
  if (!points.length) return { line: '', area: '', coords: [] }
  const maxVal = Math.max(...points.map(p => p.value), 1)
  const minVal = Math.min(...points.map(p => p.value), 0)
  const range = maxVal - minVal || 1

  const coords = points.map((p, i) => ({
    x: padding + (i / Math.max(points.length - 1, 1)) * (width - padding * 2),
    y: padding + (1 - (p.value - minVal) / range) * (height - padding * 2),
    ...p,
  }))

  // Smooth curve using cardinal spline
  let line = `M ${coords[0].x} ${coords[0].y}`
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1]
    const curr = coords[i]
    const cpx = (prev.x + curr.x) / 2
    line += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`
  }

  // Area fill path
  const area = `${line} L ${coords[coords.length - 1].x} ${height - padding} L ${coords[0].x} ${height - padding} Z`

  return { line, area, coords }
}

export default function LineChart({ scene }) {
  const points = (scene.line_data || []).slice(0, 10)
  const color = COLORS[scene.gauge_data?.color] || COLORS.green

  const W = 230, H = 160, PAD = 15
  const { line, area, coords } = buildPath(points, W, H, PAD)

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-3 z-10">
      {/* Headline */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="font-display text-[17px] tracking-[1.5px] text-white mb-1 text-center leading-tight"
      >
        {scene.headline}
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="font-mono text-[9px] text-muted uppercase tracking-[1px] mb-3"
      >
        {scene.subline?.slice(0, 50)}
      </motion.div>

      {/* Chart SVG */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2, duration: 0.4 }}
      >
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(f => (
            <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)}
              stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          ))}

          {/* Area fill */}
          <motion.path
            d={area}
            fill={color.fill}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 1.8 }}
          />

          {/* Line */}
          <motion.path 
            d={line} fill="none" stroke={color.stroke}
            strokeWidth="2.5" strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.5, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          />

          {/* Data points */}
          {coords.map((c, i) => (
            <motion.g key={i}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 + i * 0.1, type: 'spring', stiffness: 300 }}
            >
              <circle cx={c.x} cy={c.y} r="3" fill={color.stroke} />
              {i === coords.length - 1 && (
                <circle cx={c.x} cy={c.y} r="5" fill="none" stroke={color.stroke}
                  strokeWidth="1.5" opacity="0.5" className="animate-pulse" />
              )}
            </motion.g>
          ))}

          {/* X-axis labels */}
          {coords.map((c, i) => (
            <motion.text key={`l-${i}`} x={c.x} y={H - 2} textAnchor="middle"
              fill="rgba(255,255,255,0.4)" fontSize="7" fontFamily="IBM Plex Mono"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ delay: 0.3 + i * 0.08 }}
            >
              {c.label}
            </motion.text>
          ))}
        </svg>
      </motion.div>
    </div>
  )
}
