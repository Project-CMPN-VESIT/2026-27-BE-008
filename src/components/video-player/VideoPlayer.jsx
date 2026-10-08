import React from 'react'
import SceneCanvas from './SceneCanvas'

function fmt(secs) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function AudioWaveIndicator() {
  return (
    <div className="flex items-center gap-[2px]">
      {[0, 0.15, 0.3, 0.1, 0.25].map((delay, i) => (
        <div
          key={i}
          className="audio-wave-bar"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </div>
  )
}

export default function VideoPlayer({
  videoBrief,
  currentScene,
  isPlaying,
  sceneProgress,
  voiceProgress,
  totalProgress,
  elapsed,
  voiceOn,
  isSpeaking,
  onTogglePlay,
  onPrev,
  onNext,
  onVoiceToggle,
}) {
  const scene        = videoBrief?.scenes?.[currentScene] ?? null
  const totalScenes  = videoBrief?.scenes?.length ?? 0
  const totalDur     = videoBrief?.scenes?.reduce((s, sc) => s + sc.duration_seconds, 0) ?? 0
  const subtitleProgress = (voiceOn && isSpeaking)
    ? Math.min(Math.max((voiceProgress || 0) * 100, 0), 100)
    : sceneProgress

  return (
    <div className="flex flex-col items-center gap-4 py-7 px-6 bg-surface border-l border-border">

      {/* Phone Frame */}
      <div className="relative w-[260px] h-[462px] rounded-[32px] border-2 border-border
                      overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.8),inset_0_0_0_1px_rgba(255,255,255,0.04)]
                      bg-black">
        {videoBrief?.video_url ? (
          <video 
            src={videoBrief.video_url} 
            className="w-full h-full object-cover"
            controls
            autoPlay
            loop
            playsInline
          />
        ) : (
          <SceneCanvas
            scene={scene}
            tone={videoBrief?.tone}
            format={videoBrief?.format}
            disclaimer={videoBrief?.disclaimer}
            sceneIndex={currentScene}
            totalScenes={totalScenes}
            subtitleProgress={subtitleProgress}
          />
        )}
      </div>

      {/* Global timeline */}
      <div className="w-[260px]">
        <div className="h-[3px] bg-border rounded-full overflow-hidden mb-[5px]">
          <div
            className="h-full bg-gradient-to-r from-amber to-green rounded-full transition-[width] duration-100 ease-linear"
            style={{ width: `${totalProgress}%` }}
          />
        </div>
        <div className="flex justify-between font-mono text-[9px] text-muted">
          <span>{fmt(elapsed)}</span>
          <span>{fmt(totalDur)}</span>
        </div>
      </div>

      {/* Per-scene timer */}
      <div className="w-[260px] flex items-center gap-2">
        <div className="flex-1 h-[2px] bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-amber rounded-full transition-[width] duration-100 ease-linear"
            style={{ width: `${sceneProgress}%` }}
          />
        </div>
        <div className="font-mono text-[10px] text-muted whitespace-nowrap">
          {videoBrief ? `${currentScene + 1}/${totalScenes}` : '–/–'}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <CtrlBtn onClick={onPrev} disabled={!videoBrief || currentScene === 0}>◀</CtrlBtn>
        <CtrlBtn
          onClick={onTogglePlay}
          disabled={!videoBrief}
          primary
        >
          {isPlaying ? '⏸' : '▶'}
        </CtrlBtn>
        <CtrlBtn onClick={onNext} disabled={!videoBrief || currentScene >= totalScenes - 1}>▶▶</CtrlBtn>
      </div>

      {/* Voice toggle + audio indicator */}
      <div className="flex items-center gap-3 font-mono text-[10px] text-muted">
        <Toggle checked={voiceOn} onChange={onVoiceToggle} />
        <span>Voiceover</span>
        {isSpeaking && <AudioWaveIndicator />}
      </div>

    </div>
  )
}

function CtrlBtn({ onClick, disabled, primary, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        flex items-center justify-center rounded-[6px] border cursor-pointer
        transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed
        ${primary
          ? 'w-[42px] h-[42px] text-[16px] bg-amber border-amber text-bg hover:bg-amber/80'
          : 'w-[36px] h-[36px] text-[13px] bg-card border-border text-[#e8eaf0] hover:border-amber hover:bg-border'
        }
      `}
    >
      {children}
    </button>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <label className="relative w-8 h-[18px] cursor-pointer">
      <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
      <div className={`absolute inset-0 rounded-full transition-colors duration-200 ${checked ? 'bg-amber' : 'bg-border'}`} />
      <div className={`absolute top-[2px] w-[14px] h-[14px] bg-white rounded-full transition-all duration-200 ${checked ? 'left-[17px]' : 'left-[2px]'}`} />
    </label>
  )
}
