import React from 'react'
import { motion } from 'framer-motion'

/**
 * ComparisonTable — Animated row-by-row comparison
 * scene.comparison_data = {
 *   col_a: "Q4 FY25",
 *   col_b: "Q3 FY25",
 *   rows: [{ label: "Revenue", a: "₹1,20,000 Cr", b: "₹1,05,000 Cr", highlight: "a" }, ...]
 * }
 */

const container = {
  animate: { transition: { staggerChildren: 0.12, delayChildren: 0.2 } },
}

const rowSlide = (i) => ({
  initial: { opacity: 0, x: i % 2 === 0 ? -30 : 30 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.35, ease: 'easeOut' } },
})

export default function ComparisonTable({ scene }) {
  const data = scene.comparison_data || {}
  const rows = (data.rows || []).slice(0, 6)

  return (
    <div className="absolute inset-0 flex flex-col px-3 pt-10 pb-14 z-10">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-display text-[16px] tracking-[1.5px] text-white mb-3 leading-tight text-center"
      >
        {scene.headline}
      </motion.div>

      {/* Column headers */}
      <motion.div
        initial={{ opacity: 0, scaleX: 0 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ delay: 0.15, duration: 0.3 }}
        className="grid grid-cols-[1fr_1fr_1fr] gap-1 mb-2 origin-center"
      >
        <div className="font-mono text-[8px] text-muted uppercase tracking-[1px] text-center">Metric</div>
        <div className="font-mono text-[8px] text-amber uppercase tracking-[1px] text-center">
          {data.col_a || 'Current'}
        </div>
        <div className="font-mono text-[8px] text-muted uppercase tracking-[1px] text-center">
          {data.col_b || 'Previous'}
        </div>
      </motion.div>

      {/* Divider */}
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="h-px bg-gradient-to-r from-transparent via-border to-transparent mb-1 origin-center"
      />

      {/* Rows */}
      <motion.div
        className="flex flex-col gap-[3px] flex-1 justify-center"
        variants={container}
        initial="initial"
        animate="animate"
      >
        {rows.map((row, i) => {
          const v = rowSlide(i)
          const highlightA = row.highlight === 'a'
          const highlightB = row.highlight === 'b'
          return (
            <motion.div
              key={i}
              variants={v}
              className="grid grid-cols-[1fr_1fr_1fr] gap-1 py-[5px] px-2 rounded-md bg-white/[0.02] border border-white/[0.03]"
            >
              <div className="font-mono text-[9px] text-white/70 truncate">{row.label}</div>
              <div className={`font-mono text-[9px] text-center font-medium ${
                highlightA ? 'text-green' : 'text-white/80'
              }`}>
                {row.a}
                {highlightA && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 + i * 0.1 }}
                    className="ml-1 text-green/60"
                  >▲</motion.span>
                )}
              </div>
              <div className={`font-mono text-[9px] text-center ${
                highlightB ? 'text-green' : 'text-white/50'
              }`}>
                {row.b}
              </div>
            </motion.div>
          )
        })}
      </motion.div>
    </div>
  )
}
