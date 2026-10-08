import { useState, useCallback, useRef, useEffect } from 'react'

export interface UseVoiceoverOptions {
  enabled?: boolean
  preference?: string
  onEnd?: () => void
}

/**
 * Dedicated voiceover hook with Edge-TTS audio file support & browser TTS fallback.
 * Fixes: Never cascades or triggers premature onEnd on speech cancellation.
 */
export function useVoiceover({
  enabled = true,
  preference = 'en-IN',
  onEnd
}: UseVoiceoverOptions = {}) {
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false)
  const [progress, setProgress] = useState<number>(0)
  const uttRef = useRef<SpeechSynthesisUtterance | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const isCancellingRef = useRef<boolean>(false)
  const endCb = useRef<(() => void) | undefined>(onEnd)

  // Keep callback ref fresh
  useEffect(() => {
    endCb.current = onEnd
  }, [onEnd])

  // Select voice based on user preference
  const getVoice = useCallback((): SpeechSynthesisVoice | null => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return null
    const voices = window.speechSynthesis.getVoices()

    // 1. Exact or en-IN match
    let match = voices.find((v) => v.lang === preference || v.lang === 'en-IN' || v.lang === 'en_IN')
    if (match) return match

    // 2. Named Indian voices (e.g. Microsoft Neerja/Heera, Google English India)
    match = voices.find((v) => {
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

    // 3. Any voice ending with -IN
    match = voices.find((v) => v.lang.endsWith('-IN') || v.lang.includes('-IN'))
    if (match) return match

    // 4. Any English voice
    match = voices.find((v) => v.lang.startsWith('en'))
    if (match) return match

    return voices[0] || null
  }, [preference])

  const stop = useCallback(() => {
    isCancellingRef.current = true
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    if (audioRef.current) {
      audioRef.current.ontimeupdate = null
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }
    setProgress(0)
    setIsSpeaking(false)
    setTimeout(() => {
      isCancellingRef.current = false
    }, 60)
  }, [])

  const speak = useCallback(
    (text?: string | null, audioUrl?: string | null) => {
      if (!enabled || (!text && !audioUrl)) {
        setProgress(0)
        return
      }

      // Cancel any ongoing speech without triggering premature onEnd
      stop()

      // 1. If backend provided a real audio file, play it
      if (audioUrl) {
        try {
          const audio = new Audio(audioUrl)
          audioRef.current = audio
          setProgress(0)

          audio.onplay = () => {
            if (!isCancellingRef.current) setIsSpeaking(true)
          }

          audio.ontimeupdate = () => {
            if (isCancellingRef.current) return
            const d = Number(audio.duration)
            if (Number.isFinite(d) && d > 0) {
              setProgress(Math.min(audio.currentTime / d, 1))
            }
          }

          audio.onended = () => {
            if (isCancellingRef.current) return
            setProgress(1)
            setIsSpeaking(false)
            if (endCb.current) endCb.current()
          }

          audio.onerror = () => {
            if (isCancellingRef.current) return
            console.warn('Could not load audio file, falling back to browser TTS:', audioUrl)
            // Fall back to browser speech synthesis
            if (text) {
              speak(text, null)
            }
          }

          audio.play().catch((err) => {
            if (isCancellingRef.current) return
            console.warn('Audio play prevented, falling back to browser TTS:', err)
            if (text) {
              speak(text, null)
            }
          })
          return
        } catch (e) {
          console.warn('Audio initialization error:', e)
        }
      }

      // 2. Fallback to browser TTS (for previews or if audio file missing)
      if (typeof window === 'undefined' || !window.speechSynthesis || !text) {
        return
      }

      const utt = new SpeechSynthesisUtterance(text)
      utt.rate = 1.05
      utt.pitch = 1.0
      setProgress(0)

      const voice = getVoice()
      if (voice) utt.voice = voice

      utt.onstart = () => {
        if (!isCancellingRef.current) setIsSpeaking(true)
      }

      utt.onboundary = (event) => {
        if (isCancellingRef.current) return
        if (event && typeof event.charIndex === 'number' && text.length > 0) {
          setProgress(Math.min(event.charIndex / text.length, 1))
        }
      }

      utt.onend = () => {
        if (isCancellingRef.current) return
        setProgress(1)
        setIsSpeaking(false)
        if (endCb.current) endCb.current()
      }

      utt.onerror = (event: SpeechSynthesisErrorEvent) => {
        if (isCancellingRef.current || event?.error === 'canceled' || event?.error === 'interrupted') {
          return
        }
        setProgress(0)
        setIsSpeaking(false)
        if (endCb.current) endCb.current()
      }

      uttRef.current = utt
      window.speechSynthesis.speak(utt)
    },
    [enabled, getVoice, stop]
  )

  // Instant preview mode without triggering onEnd callback
  const preview = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !window.speechSynthesis || !text) return
      stop()
      const utt = new SpeechSynthesisUtterance(text)
      const voice = getVoice()
      if (voice) utt.voice = voice
      utt.rate = 1.05
      window.speechSynthesis.speak(utt)
    },
    [getVoice, stop]
  )

  // Cleanup on unmount
  useEffect(() => () => stop(), [stop])

  return { speak, preview, stop, isSpeaking, progress }
}
