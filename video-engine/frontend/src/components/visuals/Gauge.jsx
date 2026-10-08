import React, { useEffect } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'

const COLOR_MAP = {
  green: '#1fd97a',
  red:   '#ff4d4d',
  blue:  '#4d9fff',
  amber: '#f5a623',
}

const CIRCUMFERENCE = 219.9

const container = {
  animate: { transition: { staggerChildren: 0.15, delayChildren: 0.1 } },
}

const fadeUp = {
  initial: { opacity: 0, y: 15 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45 } },
}

export default function Gauge({ scene }) {
  const gd     = scene.gauge_data || {}
  const target = Math.min(Math.max(Number(gd.value) || 0, 0), 100)
  const color  = COLOR_MAP[gd.color] || COLOR_MAP.amber

  const count = useMotionValue(0)
  const rounded = useTransform(count, Math.round)
  const offset = useTransform(count, v => CIRCUMFERENCE - (v / 100) * CIRCUMFERENCE)

  useEffect(() => {
    const controls = animate(count, target, { duration: 1.5, delay: 0.4, ease: "easeOut" })
    return () => controls.stop()
  }, [target])

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center px-5 z-10"
      variants={container}
      initial="initial"
      animate="animate"
    >
      <motion.div
        variants={fadeUp}
        className="font-display text-[20px] tracking-[2px] text-white mb-1 text-center leading-tight"
      >
        {scene.headline}
      </motion.div>
      <motion.div
        variants={fadeUp}
        className="font-mono text-[9px] tracking-[1px] text-muted uppercase mb-5 text-center"
      >
        {gd.label}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="relative w-[160px] h-[80px] mb-2"
      >
        <svg viewBox="0 0 160 80" className="w-full h-full">
          {/* Track */}
          <path
            d="M10 80 A70 70 0 0 1 150 80"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="12"
            strokeLinecap="round"
          />
          {/* Fill with glow filter */}
          <defs>
            <filter id="gauge-glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <motion.path
            d="M10 80 A70 70 0 0 1 150 80"
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            style={{ strokeDashoffset: offset }}
            filter="url(#gauge-glow)"
          />
        </svg>
        <motion.div
           className="absolute bottom-[-8px] left-1/2 -translate-x-1/2 font-display text-[30px] text-white leading-none tabular-nums"
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           transition={{ delay: 0.5 }}
        >
          <motion.span>{rounded}</motion.span><span className="text-[14px] text-muted">%</span>
        </motion.div>
      </motion.div>

      <motion.div
        variants={fadeUp}
        className="flex justify-between w-[160px] font-mono text-[9px] text-muted mt-4"
      >
        <span>{gd.low || '0x'}</span>
        <span>{gd.high || '100x'}</span>
      </motion.div>

      {scene.subline && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.5 }}
          className="font-sans text-[12px] text-white/60 text-center mt-3 leading-relaxed px-2"
        >
          {scene.subline}
        </motion.div>
      )}
    </motion.div>
  )
}
