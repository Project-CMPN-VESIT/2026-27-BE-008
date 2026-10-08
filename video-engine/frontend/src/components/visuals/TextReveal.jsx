import React from 'react'
import { motion } from 'framer-motion'

export default function TextReveal({ scene }) {
  const words = (scene.headline || '').split(' ')

  return (
    <div className="absolute inset-0 flex flex-col justify-center px-[18px] pb-20 z-10">
      {/* Headline — word-by-word reveal */}
      <div className="font-display text-[26px] tracking-[2px] text-white leading-[1.15] mb-5 flex flex-wrap gap-x-[7px]">
        {words.map((word, i) => (
          <motion.span
            key={`${scene.id}-w-${i}`}
            initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.35, delay: 0.1 + i * 0.08, ease: 'easeOut' }}
          >
            {word}
          </motion.span>
        ))}
      </div>

      {/* Decorative line */}
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.5, delay: 0.3 + words.length * 0.06 }}
        className="w-[40px] h-[2px] bg-amber/50 mb-4 origin-left"
      />

      {/* Subline card */}
      <motion.div
        key={`${scene.id}-card`}
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.4 + words.length * 0.06 }}
        className="bg-amber/[0.06] border border-amber/20 rounded-lg px-[14px] py-3 backdrop-blur-sm"
      >
        <div className="font-sans text-[12.5px] text-white/80 leading-relaxed">
          {scene.subline}
        </div>
      </motion.div>
    </div>
  )
}
