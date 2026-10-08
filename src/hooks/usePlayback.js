import { useState, useRef, useCallback, useEffect } from 'react'

export function usePlayback(scenes, { onSceneChange } = {}) {
  const [currentScene, setCurrentScene]   = useState(0)
  const [isPlaying, setIsPlaying]         = useState(false)
  const [sceneProgress, setSceneProgress] = useState(0)
  const [totalProgress, setTotalProgress] = useState(0)
  const [elapsed, setElapsed]             = useState(0)

  const timerRef         = useRef(null)
  const sceneElapRef     = useRef(0)
  const totalElapRef     = useRef(0)
  const onSceneChangeCb  = useRef(onSceneChange)

  useEffect(() => { onSceneChangeCb.current = onSceneChange }, [onSceneChange])

  const totalDuration = scenes?.reduce((s, sc) => s + (sc.duration_seconds || 5), 0) || 0

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }

  const startTimer = useCallback((sceneIdx) => {
    clearTimer()
    const sceneDur = scenes?.[sceneIdx]?.duration_seconds || 5

    timerRef.current = setInterval(() => {
      sceneElapRef.current += 0.1
      totalElapRef.current += 0.1

      setSceneProgress(Math.min((sceneElapRef.current / sceneDur) * 100, 100))
      setTotalProgress(Math.min((totalElapRef.current / totalDuration) * 100, 100))
      setElapsed(Math.floor(totalElapRef.current))

      // Advance strictly based on time (backend handles exact TTS duration)
      if (sceneElapRef.current >= sceneDur) {
        sceneElapRef.current = 0
        setCurrentScene(prev => {
          const next = prev + 1
          if (next >= scenes.length) {
            clearTimer()
            setIsPlaying(false)
            return prev
          }
          return next
        })
      }
    }, 100)
  }, [scenes, totalDuration])

  // When scene changes and we're playing, restart timer + fire callback
  useEffect(() => {
    if (isPlaying && scenes?.length) {
      sceneElapRef.current = 0
      startTimer(currentScene)
    }
    if (onSceneChangeCb.current) {
      onSceneChangeCb.current(currentScene)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScene])

  const play = useCallback(() => {
    if (!scenes?.length) return
    setIsPlaying(true)
    startTimer(currentScene)
    if (onSceneChangeCb.current) onSceneChangeCb.current(currentScene)
  }, [scenes, currentScene, startTimer])

  const pause = useCallback(() => {
    setIsPlaying(false)
    clearTimer()
  }, [])

  const togglePlay = useCallback(() => {
    isPlaying ? pause() : play()
  }, [isPlaying, play, pause])


  const jumpTo = useCallback((idx) => {
    clearTimer()
    sceneElapRef.current = 0
    const before = scenes?.slice(0, idx).reduce((s, sc) => s + sc.duration_seconds, 0) || 0
    totalElapRef.current = before
    setCurrentScene(idx)
    setSceneProgress(0)
    setTotalProgress(totalDuration ? (before / totalDuration) * 100 : 0)
    setElapsed(before)
    if (isPlaying) startTimer(idx)
  }, [scenes, totalDuration, isPlaying, startTimer])

  const markNarrationDone = useCallback(() => {
    if (!isPlaying || !scenes?.length) return

    if (currentScene < scenes.length - 1) {
      jumpTo(currentScene + 1)
      return
    }

    // End of final scene.
    setSceneProgress(100)
    setTotalProgress(100)
    setElapsed(Math.floor(totalDuration))
    pause()
  }, [isPlaying, scenes, currentScene, jumpTo, totalDuration, pause])

  const reset = useCallback(() => {
    clearTimer()
    setCurrentScene(0)
    setIsPlaying(false)
    setSceneProgress(0)
    setTotalProgress(0)
    setElapsed(0)
    sceneElapRef.current = 0
    totalElapRef.current = 0
  }, [])

  useEffect(() => () => clearTimer(), [])

  return {
    currentScene,
    isPlaying,
    sceneProgress,
    totalProgress,
    elapsed,
    totalDuration,
    play,
    pause,
    togglePlay,
    jumpTo,
    prev: () => currentScene > 0 && jumpTo(currentScene - 1),
    next: () => currentScene < (scenes?.length ?? 1) - 1 && jumpTo(currentScene + 1),
    reset,
    markNarrationDone,
  }
}
