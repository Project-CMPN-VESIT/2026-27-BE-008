import React, { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'

const COLOR_MAP = {
  green: 'from-green/40 to-green',
  red:   'from-red/40 to-red',
  blue:  'from-blue/40 to-blue',
  amber: 'from-amber/40 to-amber',
  white: 'from-white/20 to-white/60',
}

function AnimatedValue({ target, delay = 0 }) {
  const count = useMotionValue(0)
  const rounded = useTransform(count, Math.round)
  
  useEffect(() => {
    const controls = animate(count, target, { duration: 0.9, delay: delay / 1000, ease: "easeOut" })
    return () => controls.stop()
  }, [target, delay])
  
  return <motion.span className="tabular-nums">{rounded}</motion.span>
}

export default function BarChart({ scene }) {
  const items = (scene.chart_data || []).slice(0, 5)

  return (
    <div className="absolute inset-0 flex flex-col px-4 pt-12 pb-20 z-10 gap-1">
      {/* Headline */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
        className="font-display text-[18px] tracking-[1.5px] text-white mb-4 leading-tight"
      >
        {scene.headline}
      </motion.div>

      {items.map((item, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, delay: 0.15 + i * 0.12, ease: 'easeOut' }}
          className="flex items-center gap-2 flex-1"
        >
          <div className="font-mono text-[9px] text-muted w-[54px] text-right shrink-0 leading-tight">
            {item.label}
          </div>
          <div className="flex-1 h-[22px] bg-white/5 rounded-[3px] overflow-hidden relative">
            <motion.div
              className={`h-full rounded-[3px] bg-gradient-to-r ${COLOR_MAP[item.color] || COLOR_MAP.green} shimmer-bar`}
              initial={{ width: '0%' }}
              animate={{ width: `${item.value || 0}%` }}
              transition={{ duration: 1, delay: 0.2 + i * 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
            />
          </div>
          <div className="font-mono text-[9px] text-[#e8eaf0] w-8 shrink-0">{item.display}</div>
        </motion.div>
      ))}
    </div>
  )
}
