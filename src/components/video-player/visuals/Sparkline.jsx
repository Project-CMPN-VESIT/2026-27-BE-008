import React from 'react'
import { motion } from 'framer-motion'

/**
 * Sparkline — Compact animated sparklines for multi-stock comparison
 * scene.sparkline_data = [{ label: "RELIANCE", value: 3.2, trend: "up", points: [40,42,38,45,50,...] }, ...]
 */

function MiniSparkSvg({ points = [], trend = 'up', delay = 0 }) {
  const W = 80, H = 24
  if (points.length < 2) return null

  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1

  const coords = points.map((v, i) => ({
    x: (i / (points.length - 1)) * W,
    y: H - ((v - min) / range) * H * 0.85 - H * 0.075,
  }))

  let d = `M ${coords[0].x} ${coords[0].y}`
  for (let i = 1; i < coords.length; i++) {
    const cpx = (coords[i - 1].x + coords[i].x) / 2
    d += ` C ${cpx} ${coords[i - 1].y}, ${cpx} ${coords[i].y}, ${coords[i].x} ${coords[i].y}`
  }

  const color = trend === 'up' ? '#1fd97a' : '#ff4d4d'

  return (
    <motion.svg
      width={W} height={H} viewBox={`0 0 ${W} ${H}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: delay + 0.3, duration: 0.4 }}
    >
      <motion.path
        d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: delay + 0.4, duration: 1, ease: 'easeInOut' }}
      />
      {/* End dot */}
      <motion.circle
        cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y}
        r="2" fill={color}
        initial={{ scale: 0 }} animate={{ scale: 1 }}
        transition={{ delay: delay + 1.3, type: 'spring' }}
      />
    </motion.svg>
  )
}

const container = {
  animate: { transition: { staggerChildren: 0.15, delayChildren: 0.1 } },
}

const rowVariant = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.35 } },
}

export default function Sparkline({ scene }) {
  const items = (scene.sparkline_data || []).slice(0, 4)

  return (
    <div className="absolute inset-0 flex flex-col px-4 pt-10 pb-16 z-10">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-display text-[17px] tracking-[1.5px] text-white mb-4 leading-tight"
      >
        {scene.headline}
      </motion.div>

      <motion.div
        className="flex flex-col gap-[6px] flex-1 justify-center"
        variants={container}
        initial="initial"
        animate="animate"
      >
        {items.map((item, i) => (
          <motion.div
            key={i}
            variants={rowVariant}
            className="flex items-center gap-2 bg-white/[0.03] rounded-lg px-3 py-[7px] border border-white/[0.04]"
          >
            {/* Symbol */}
            <div className="font-mono text-[10px] text-white font-medium w-[60px] shrink-0 truncate">
              {item.label}
            </div>

            {/* Sparkline */}
            <div className="flex-1">
              <MiniSparkSvg
                points={item.points || []}
                trend={item.trend || 'up'}
                delay={i * 0.15}
              />
            </div>

            {/* Value */}
            <div className={`font-mono text-[11px] font-semibold w-[45px] text-right shrink-0 ${
              (item.trend || 'up') === 'up' ? 'text-green' : 'text-red'
            }`}>
              {(item.trend === 'up' ? '+' : '') + (item.value || 0)}%
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
