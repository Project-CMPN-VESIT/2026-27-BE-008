import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Dedicated voiceover hook — extracted from App.jsx for clean separation.
 * Returns controls for speaking, stopping, and tracking speech state.
 * Calls onEnd when narration finishes (for scene-sync).
 */
export function useVoiceover({ enabled = true, preference = 'en-IN', onEnd = null }) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [progress, setProgress] = useState(0)
  const uttRef  = useRef(null)
  const audioRef = useRef(null)
  const endCb   = useRef(onEnd)

  // Keep callback ref fresh
  useEffect(() => { endCb.current = onEnd }, [onEnd])

  // Select voice based on user preference, with sensible fallbacks
  const getVoice = useCallback(() => {
    if (!window.speechSynthesis) return null
    const voices = window.speechSynthesis.getVoices()
    
    // 1. Exact or en-IN match
    let match = voices.find(v => v.lang === preference || v.lang === 'en-IN' || v.lang === 'en_IN')
    if (match) return match
    
    // 2. Named Indian voices
    match = voices.find(v => {
      const name = v.name.toLowerCase()
      const lang = v.lang.toLowerCase()
      return (
        name.includes('india') ||
        name.includes('neerja') ||
        name.includes('prabhat') ||
        name.includes('heera') ||
        name.includes('ravi') ||
        lang === 'en-in' ||
        lang.endsWith('-in')
      )
    })
    if (match) return match

    // 3. Fallback to any Indian voice
    match = voices.find(v => v.lang.endsWith('-IN') || v.lang.includes('-IN'))
    if (match) return match
    
    // 4. Fallback to any english voice
    match = voices.find(v => v.lang.startsWith('en'))
    if (match) return match
    
    // 5. Default
    return voices[0] || null
  }, [preference])

  const stop = useCallback(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    if (audioRef.current) {
      audioRef.current.ontimeupdate = null
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setProgress(0)
    setIsSpeaking(false)
  }, [])

  const speak = useCallback((text, audioUrl = null) => {
    if (!enabled || (!text && !audioUrl)) {
      setProgress(0)
      if (endCb.current) endCb.current()
      return
    }

    // Cancel any ongoing speech
    stop()

    // 1. If backend provided a real audio file, play it
    if (audioUrl) {
      const audio = new Audio(audioUrl)
      audioRef.current = audio
      setProgress(0)
      
      audio.onplay = () => setIsSpeaking(true)
      audio.ontimeupdate = () => {
        const d = Number(audio.duration)
        if (Number.isFinite(d) && d > 0) {
          setProgress(Math.min(audio.currentTime / d, 1))
        }
      }
      audio.onended = () => {
        setProgress(1)
        setIsSpeaking(false)
        if (endCb.current) endCb.current()
      }
      audio.onerror = () => {
        console.error("Failed to play scene audio:", audioUrl)
        setProgress(0)
        setIsSpeaking(false)
        if (endCb.current) endCb.current()
      }
      
      audio.play().catch(err => {
        console.error("Audio playback prevented:", err)
        setProgress(0)
        setIsSpeaking(false)
        if (endCb.current) endCb.current()
      })
      return
    }

    // 2. Fallback to browser TTS (for previews or if backend failed)
    if (!window.speechSynthesis) {
      if (endCb.current) endCb.current()
      return
    }

    const utt = new SpeechSynthesisUtterance(text)
    utt.rate  = 1.05
    utt.pitch = 1.0
    setProgress(0)

    const voice = getVoice()
    if (voice) utt.voice = voice

    utt.onstart = () => setIsSpeaking(true)
    utt.onboundary = (event) => {
      if (event && typeof event.charIndex === 'number' && text.length > 0) {
        setProgress(Math.min(event.charIndex / text.length, 1))
      }
    }
    utt.onend   = () => {
      setProgress(1)
      setIsSpeaking(false)
      if (endCb.current) endCb.current()
    }
    utt.onerror = () => {
      setProgress(0)
      setIsSpeaking(false)
      if (endCb.current) endCb.current()
    }

    uttRef.current = utt
    window.speechSynthesis.speak(utt)
  }, [enabled, getVoice])
  
  // Instant preview mode without triggering onEnd callback
  const preview = useCallback((text) => {
    if (!window.speechSynthesis || !text) return
    window.speechSynthesis.cancel()
    const utt = new SpeechSynthesisUtterance(text)
    const voice = getVoice()
    if (voice) utt.voice = voice
    utt.rate = 1.05
    window.speechSynthesis.speak(utt)
  }, [getVoice])

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop])

  return { speak, preview, stop, isSpeaking, progress }
}
