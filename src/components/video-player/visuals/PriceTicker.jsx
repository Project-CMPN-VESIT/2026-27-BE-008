import React, { useEffect } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'

const container = {
  animate: { transition: { staggerChildren: 0.2, delayChildren: 0.1 } },
}

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: 'easeOut' } },
}

function AnimatedPrice({ target, duration = 1200 }) {
  const count = useMotionValue(0)
  const rounded = useTransform(count, v => v.toFixed(2))

  useEffect(() => {
    const num = parseFloat(String(target).replace(/[^0-9.]/g, '')) || 0
    const controls = animate(count, num, { duration: duration / 1000, ease: "easeOut" })
    return () => controls.stop()
  }, [target, duration])

  return <motion.span>{rounded}</motion.span>
}

export default function PriceTicker({ scene }) {
  const td   = scene.ticker_data || {}
  const isUp = td.direction === 'up' || (td.change && td.change.startsWith('+'))

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center px-5 z-10"
      variants={container}
      initial="initial"
      animate="animate"
    >
      {/* Symbol */}
      <motion.div
        variants={fadeUp}
        className="font-display text-[36px] tracking-[4px] text-white mb-1"
      >
        {td.symbol || 'NSE'}
      </motion.div>

      {/* Exchange */}
      <motion.div
        variants={fadeUp}
        className="font-mono text-[9px] tracking-[2px] text-muted uppercase mb-5"
      >
        NSE / BSE
      </motion.div>

      {/* Price — counting animation */}
      <motion.div
        variants={fadeUp}
        className="font-display text-[50px] text-white leading-none mb-3 tabular-nums"
      >
        ₹<AnimatedPrice target={td.price} duration={1400} />
      </motion.div>

      {/* Change with glow pulse */}
      <motion.div
        variants={fadeUp}
        className={`flex items-center gap-2 font-mono text-[18px] font-semibold ${isUp ? 'text-green' : 'text-red'}`}
      >
        <motion.span
          className="animate-glow-pulse"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.8, type: 'spring', stiffness: 300, damping: 15 }}
        >
          {isUp ? '▲' : '▼'}
        </motion.span>
        <span>{td.change || '—'}</span>
      </motion.div>

      {/* Headline */}
      {scene.headline && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.5 }}
          className="mt-5 font-display text-[16px] tracking-[1.5px] text-white/60 text-center leading-tight"
        >
          {scene.headline}
        </motion.div>
      )}
    </motion.div>
  )
}
