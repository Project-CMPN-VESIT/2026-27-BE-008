import React from 'react'
import { motion } from 'framer-motion'

// ── Transition variant presets (Remotion-inspired) ──────────────────────────

const VARIANTS = {
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit:    { opacity: 0 },
  },
  slideLeft: {
    initial: { opacity: 0, x: 60 },
    animate: { opacity: 1, x: 0 },
    exit:    { opacity: 0, x: -60 },
  },
  slideUp: {
    initial: { opacity: 0, y: 40 },
    animate: { opacity: 1, y: 0 },
    exit:    { opacity: 0, y: -30 },
  },
  zoomIn: {
    initial: { opacity: 0, scale: 0.82 },
    animate: { opacity: 1, scale: 1 },
    exit:    { opacity: 0, scale: 1.12 },
  },
  zoomOut: {
    initial: { opacity: 0, scale: 1.15 },
    animate: { opacity: 1, scale: 1 },
    exit:    { opacity: 0, scale: 0.88 },
  },
  wipe: {
    initial: { opacity: 0, clipPath: 'inset(0 100% 0 0)' },
    animate: { opacity: 1, clipPath: 'inset(0 0% 0 0)' },
    exit:    { opacity: 0, clipPath: 'inset(0 0 0 100%)' },
  },
  crossFade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit:    { opacity: 0 },
  },
  pushLeft: {
    initial: { x: '100%', opacity: 1 },
    animate: { x: '0%',   opacity: 1 },
    exit:    { x: '-100%', opacity: 1 },
  },
  reveal: {
    initial: { clipPath: 'circle(0% at 50% 50%)', opacity: 1 },
    animate: { clipPath: 'circle(75% at 50% 50%)', opacity: 1 },
    exit:    { clipPath: 'circle(0% at 50% 50%)',  opacity: 0 },
  },
}

// ── Transition timing per type ──────────────────────────────────────────────

const TRANSITION_CONFIG = {
  fade:      { duration: 0.5,  ease: [0.25, 0.46, 0.45, 0.94] },
  slideLeft: { duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] },
  slideUp:   { duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] },
  zoomIn:    { duration: 0.6,  ease: [0.16, 1, 0.3, 1] },
  zoomOut:   { duration: 0.6,  ease: [0.16, 1, 0.3, 1] },
  wipe:      { duration: 0.6,  ease: [0.65, 0, 0.35, 1] },
  crossFade: { duration: 0.7,  ease: 'easeInOut' },
  pushLeft:  { duration: 0.5,  ease: [0.33, 1, 0.68, 1] },
  reveal:    { duration: 0.7,  ease: [0.65, 0, 0.35, 1] },
}

// ── Map scene types to ideal transition ─────────────────────────────────────

const SCENE_TRANSITION_MAP = {
  intro:  'zoomIn',
  stock:  'slideLeft',
  sector: 'pushLeft',
  ipo:    'reveal',
  chart:  'slideLeft',
  outro:  'zoomOut',
}

function getTransitionType(scene) {
  if (scene?.transition_type && VARIANTS[scene.transition_type]) {
    return scene.transition_type
  }
  return SCENE_TRANSITION_MAP[scene?.type] || 'crossFade'
}

export default function SceneTransition({ scene, children, sceneIndex }) {
  const type = getTransitionType(scene)
  const variant = VARIANTS[type]
  const timing = TRANSITION_CONFIG[type] || TRANSITION_CONFIG.crossFade

  return (
    <motion.div
      key={`scene-${sceneIndex}`}
      initial={variant.initial}
      animate={variant.animate}
      exit={variant.exit}
      transition={timing}
      className="absolute inset-0"
    >
      {children}
    </motion.div>
  )
}

export { getTransitionType, VARIANTS }
