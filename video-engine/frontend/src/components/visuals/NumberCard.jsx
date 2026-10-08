import React, { useEffect, useState } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'

/**
 * NumberCard — Large animated number display for key metrics
 * scene.number_data = { value: 21243, prefix: "₹", suffix: "Cr", label: "Net Profit" }
 */

function formatNumber(n) {
  const s = String(n)
  if (s.length <= 3) return s
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  const formatted = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return formatted + ',' + last3
}

function AnimatedNumber({ target, duration = 1600 }) {
  const count = useMotionValue(0)
  const rounded = useTransform(count, Math.round)
  const formatted = useTransform(rounded, v => formatNumber(v))
  
  useEffect(() => {
    const num = typeof target === 'number' ? target : parseFloat(String(target).replace(/[^0-9.\-]/g, '')) || 0
    const controls = animate(count, num, { duration: duration / 1000, ease: "easeOut", delay: 0.15 })
    return () => controls.stop()
  }, [target, duration])

  return <motion.span className="font-display text-[52px] text-white leading-none tabular-nums">{formatted}</motion.span>
}

export default function NumberCard({ scene }) {
  const nd = scene.number_data || {}
  const targetValue = typeof nd.value === 'number' ? nd.value : parseFloat(String(nd.value).replace(/[^0-9.\-]/g, '')) || 0

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-5 z-10">
      {/* Subtle radial glow */}
      <div className="absolute w-[180px] h-[180px] rounded-full opacity-15"
        style={{
          background: 'radial-gradient(circle, rgba(245,166,35,0.4) 0%, transparent 70%)',
          top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        }}
      />

      {/* Label */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="font-mono text-[9px] tracking-[2px] text-amber uppercase mb-4 relative z-10"
      >
        {nd.label || scene.headline}
      </motion.div>

      {/* Number */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.15, type: 'spring', stiffness: 200 }}
        className="relative z-10 flex items-baseline gap-1"
      >
        {nd.prefix && (
          <span className="font-display text-[24px] text-white/50">{nd.prefix}</span>
        )}
        <AnimatedNumber target={targetValue} duration={1800} />
        {nd.suffix && (
          <motion.span
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.8, duration: 0.3 }}
            className="font-display text-[18px] text-white/50 ml-1"
          >
            {nd.suffix}
          </motion.span>
        )}
      </motion.div>

      {/* Headline */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.4 }}
        className="font-display text-[15px] tracking-[1.5px] text-white/60 mt-4 text-center relative z-10"
      >
        {nd.label ? scene.headline : ''}
      </motion.div>

      {/* Subline */}
      {scene.subline && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.4 }}
          className="font-sans text-[11px] text-white/40 mt-2 text-center leading-relaxed relative z-10"
        >
          {scene.subline}
        </motion.div>
      )}

      {/* Particle burst */}
      <div className="absolute inset-0 pointer-events-none z-0">
        {[...Array(8)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-[3px] h-[3px] rounded-full bg-amber/40"
            style={{ left: '50%', top: '50%' }}
            initial={{ x: 0, y: 0, opacity: 0.8 }}
            animate={{
              x: (Math.cos(i * Math.PI / 4) * 60) + 'px',
              y: (Math.sin(i * Math.PI / 4) * 60) + 'px',
              opacity: 0,
            }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 1.8 }}
          />
        ))}
      </div>
    </div>
  )
}
