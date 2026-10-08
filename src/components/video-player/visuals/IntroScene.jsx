import React from 'react'
import { motion } from 'framer-motion'

const FORMAT_LABELS = {
  nifty_short: 'Nifty 50 Daily Short',
  daily_wrap:  'Daily Market Wrap',
  breakout:    'Breakout Alert',
  sector:      'Sector Rotation',
  ipo:         'IPO Tracker',
  earnings:    'Earnings Result',
}

const container = {
  animate: {
    transition: { staggerChildren: 0.18, delayChildren: 0.1 },
  },
}

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
}

const slideDown = {
  initial: { opacity: 0, y: -20, scale: 0.9 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: 'easeOut' } },
}

const lineExpand = {
  initial: { scaleX: 0 },
  animate: { scaleX: 1, transition: { duration: 0.6, delay: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
}

export default function IntroScene({ scene, format }) {
  return (
    <div className="absolute inset-0 z-10 overflow-hidden">
      {/* Animated gradient background */}
      <div
        className="absolute inset-0 animate-gradient-sweep"
        style={{
          background: 'linear-gradient(135deg, #0d1520 0%, #0a1628 25%, #111828 50%, #0d1520 75%, #060a10 100%)',
        }}
      />

      {/* Floating ambient particles */}
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-amber/20"
          style={{
            width:  `${3 + Math.random() * 4}px`,
            height: `${3 + Math.random() * 4}px`,
            left:   `${10 + Math.random() * 80}%`,
            top:    `${20 + Math.random() * 60}%`,
            animation: `float ${3 + Math.random() * 3}s ease-in-out ${Math.random() * 2}s infinite`,
          }}
        />
      ))}

      {/* Content */}
      <motion.div
        className="relative flex flex-col items-center justify-center h-full px-6 z-10"
        variants={container}
        initial="initial"
        animate="animate"
      >
        {/* Format badge */}
        <motion.div
          variants={slideDown}
          className="font-mono text-[9px] tracking-[2px] text-amber uppercase
                     border border-amber/30 px-[10px] py-[3px] rounded-sm mb-4
                     bg-amber/5 backdrop-blur-sm"
        >
          {FORMAT_LABELS[format] || format || 'Nifty 50 Short'}
        </motion.div>

        {/* Headline — word by word stagger */}
        <motion.div
          className="font-display text-[28px] tracking-[2px] text-white text-center leading-[1.15] mb-4 flex flex-wrap justify-center gap-x-[8px]"
        >
          {(scene.headline || '').split(' ').map((word, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.3 + i * 0.1, ease: 'easeOut' }}
            >
              {word}
            </motion.span>
          ))}
        </motion.div>

        {/* Decorative line */}
        <motion.div
          variants={lineExpand}
          className="w-[60px] h-[2px] bg-gradient-to-r from-transparent via-amber to-transparent mb-4 origin-center"
        />

        {/* Subline */}
        <motion.div
          variants={fadeUp}
          className="font-sans text-[12px] text-white/60 text-center leading-relaxed max-w-[220px]"
        >
          {scene.subline}
        </motion.div>
      </motion.div>
    </div>
  )
}
