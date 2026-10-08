import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import PriceTicker      from './visuals/PriceTicker'
import BarChart         from './visuals/BarChart'
import Gauge            from './visuals/Gauge'
import TextReveal       from './visuals/TextReveal'
import OutroCard        from './visuals/OutroCard'
import IntroScene       from './visuals/IntroScene'
import LineChart        from './visuals/LineChart'
import Sparkline        from './visuals/Sparkline'
import ComparisonTable  from './visuals/ComparisonTable'
import NumberCard       from './visuals/NumberCard'
import SceneTransition  from './SceneTransition'
import { useUnsplashImage } from '@/hooks/useUnsplashImage'

const TONE_STYLES = {
  bullish:  'bg-green/10 text-green border-green/30',
  bearish:  'bg-red/10 text-red border-red/30',
  neutral:  'bg-muted/10 text-muted border-muted/30',
  urgent:   'bg-red/10 text-red border-red/30',
  exciting: 'bg-amber/10 text-amber border-amber/30',
}

function buildSceneImageQuery(scene) {
  if (scene?.image_query) return scene.image_query
  if (scene?.headline) return scene.headline
  return 'stock market trading terminal screens'
}

function buildSingleLineSubtitle(scene) {
  return String(scene?.narration || scene?.subline || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildProgressSubtitle(scene, progress) {
  const text = buildSingleLineSubtitle(scene)
  if (!text) return ''

  const words = text.split(' ').filter(Boolean)
  if (words.length <= 8) return text

  const chunkSize = 7
  const chunkCount = Math.max(Math.ceil(words.length / chunkSize), 1)
  const normalized = Math.min(Math.max((progress || 0) / 100, 0), 1)
  const chunkIndex = Math.min(Math.floor(normalized * chunkCount), chunkCount - 1)
  const start = chunkIndex * chunkSize
  const end = start + chunkSize

  return words.slice(start, end).join(' ')
}

function Visual({ scene, tone, format, disclaimer }) {
  const vt = scene.visual_type

  if (vt === 'price_ticker')                          return <PriceTicker      scene={scene} />
  if (vt === 'bar_chart')                             return <BarChart         scene={scene} />
  if (vt === 'gauge')                                 return <Gauge            scene={scene} />
  if (vt === 'line_chart')                            return <LineChart        scene={scene} />
  if (vt === 'sparkline')                             return <Sparkline        scene={scene} />
  if (vt === 'comparison_table')                      return <ComparisonTable  scene={scene} />
  if (vt === 'number_card')                           return <NumberCard       scene={scene} />
  if (vt === 'outro_card')                            return <OutroCard        scene={scene} disclaimer={disclaimer} />
  if (vt === 'text_reveal' && scene.type === 'intro') return <IntroScene       scene={scene} format={format} />
  if (scene.type === 'intro')                         return <IntroScene       scene={scene} format={format} />
  return <TextReveal scene={scene} />
}

function UnsplashBackground({ scene }) {
  const query = buildSceneImageQuery(scene)
  const { imageUrl } = useUnsplashImage(scene?.image_url ? null : query)
  const finalImage = scene?.image_url || imageUrl
  if (!finalImage) return null
  return (
    <div
      className="scene-bg-image"
      style={{ backgroundImage: `url(${finalImage})` }}
    >
      <img
        src={finalImage}
        alt=""
        className="w-full h-full object-cover"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        loading="eager"
      />
    </div>
  )
}

function SceneSubtitle({ scene, progress }) {
  const subtitle = buildProgressSubtitle(scene, progress)
  if (!subtitle) return null

  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-10 z-30 w-[90%] pointer-events-none">
      <div className="scene-subtitle">{subtitle}</div>
    </div>
  )
}

function SceneDots({ total, current }) {
  if (total <= 1) return null
  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-[5px] z-30">
      {Array.from({ length: total }).map((_, i) => (
        <motion.div
          key={i}
          className="rounded-full"
          animate={{
            width:  i === current ? 14 : 4,
            height: 4,
            backgroundColor: i === current ? '#f5a623' : 'rgba(255,255,255,0.2)',
          }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

export default function SceneCanvas({
  scene,
  tone,
  format,
  disclaimer,
  sceneIndex,
  totalScenes,
  subtitleProgress = 0,
}) {
  if (!scene) return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-3
                    bg-gradient-to-br from-[#0d1117] to-[#111828]">
      <div className="text-4xl opacity-20">▶</div>
      <div className="font-mono text-[11px] text-muted text-center leading-relaxed">
        FINPILOT VIDEO ENGINE<br/>Waiting for scene data
      </div>
    </div>
  )

  return (
    <div className="relative w-full h-full overflow-hidden bg-gradient-to-br from-[#0d1520] to-[#060a10]">

      {/* Unsplash background image */}
      {(scene.image_url || scene.image_query || scene.headline || scene.subline) && <UnsplashBackground scene={scene} />}

      {/* Watermark */}
      <div className="absolute top-3 left-3 font-display text-[13px] tracking-[2px] text-amber opacity-90 z-20">
        {scene.logo || 'FINPILOT'}
      </div>

      {/* Tone badge */}
      <div className={`absolute top-3 right-3 font-mono text-[8px] tracking-[1px] uppercase
                       px-[7px] py-[3px] rounded-[3px] border z-20
                       ${TONE_STYLES[tone] || TONE_STYLES.neutral}`}>
        {tone}
      </div>

      {/* Visual with AnimatePresence transition */}
      <AnimatePresence mode="wait">
        <SceneTransition scene={scene} sceneIndex={sceneIndex}>
          <Visual scene={scene} tone={tone} format={format} disclaimer={disclaimer} />
        </SceneTransition>
      </AnimatePresence>

      {/* Scene progress dots */}
      <SceneDots total={totalScenes || 0} current={sceneIndex || 0} />

      {/* Single-line subtitle to avoid caption clutter */}
      <SceneSubtitle scene={scene} progress={subtitleProgress} />

      {/* Subtle scanlines */}
      <div className="scanlines absolute inset-0 pointer-events-none z-30" />
      {/* Soft vignette */}
      <div className="absolute inset-0 pointer-events-none z-25"
           style={{ background: 'radial-gradient(ellipse at center, transparent 65%, rgba(0,0,0,0.5) 100%)' }} />
    </div>
  )
}
