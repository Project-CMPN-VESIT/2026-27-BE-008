import React from 'react'
import { motion } from 'framer-motion'

const container = {
  animate: { transition: { staggerChildren: 0.2, delayChildren: 0.1 } },
}

const scaleUp = {
  initial: { opacity: 0, scale: 0.8 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.5 } },
}

export default function OutroCard({ scene, disclaimer }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-5 z-10
                    bg-gradient-to-b from-[#0a1020] to-[#060810] overflow-hidden">

      {/* Radial glow behind logo */}
      <div
        className="absolute w-[200px] h-[200px] rounded-full opacity-20"
        style={{
          background: 'radial-gradient(circle, rgba(245,166,35,0.4) 0%, transparent 70%)',
          top: '50%', left: '50%', transform: 'translate(-50%, -60%)',
        }}
      />

      <motion.div
        variants={container}
        initial="initial"
        animate="animate"
        className="relative flex flex-col items-center z-10"
      >
        {/* Logo with shimmer */}
        <motion.div
          variants={scaleUp}
          className="font-display text-[36px] tracking-[4px] animate-logo-shimmer mb-1"
        >
          {scene.logo || 'FINPILOT'}
        </motion.div>

        <motion.div
          variants={fadeIn}
          className="font-mono text-[10px] tracking-[2px] text-muted mb-7"
        >
          FINPILOT · INTELLIGENCE · INDIA
        </motion.div>

        <motion.div
          variants={scaleUp}
          className="font-display text-[20px] tracking-[2px] text-white mb-6 text-center"
        >
          {scene.headline || 'Stay Ahead with FinPilot'}
        </motion.div>

        {/* Disclaimer with delayed fade */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.5 }}
          className="font-mono text-[8px] text-muted text-center leading-relaxed
                     px-3 py-[10px] border border-border rounded-lg bg-white/[0.02]"
        >
          {disclaimer || scene.subline || 'Educational commentary, not financial advice.'}
        </motion.div>
      </motion.div>
    </div>
  )
}
