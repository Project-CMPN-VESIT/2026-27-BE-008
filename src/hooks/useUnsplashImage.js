import { useState, useEffect } from 'react'

/**
 * Hook that returns a background image URL for a given query.
 * Uses Unsplash's source endpoint with a sanitized query so results are relevant.
 */
const GENERIC_TERMS = new Set([
  'image', 'photo', 'picture', 'background', 'random', 'nice', 'beautiful', 'analysis',
  'business', 'market', 'finance', 'financial', 'stock', 'stocks', 'india', 'indian',
])

const FINANCE_HINTS = new Set([
  'ipo', 'earnings', 'revenue', 'profit', 'loss', 'bank', 'nifty', 'sensex', 'shares',
  'equity', 'trade', 'trading', 'chart', 'broker', 'investor', 'investment', 'economy',
  'inflation', 'growth', 'fmcg', 'it', 'pharma', 'auto', 'energy',
])

function sanitizeQuery(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildRelevantQuery(query) {
  const sanitized = sanitizeQuery(query)
  if (!sanitized) return 'stock market trading terminal screens'

  const tokens = sanitized.split(' ').filter(Boolean)
  // If the query is already well-formed and under 7 words, keep it intact
  if (tokens.length >= 2 && tokens.length <= 6) {
    return tokens.join(' ')
  }

  // Filter out pure noise terms and cap at 5 meaningful keywords
  const noise = new Set(['image', 'photo', 'picture', 'background', 'random', 'nice', 'screen', 'view', 'video'])
  const meaningful = tokens.filter((t) => t.length > 2 && !noise.has(t)).slice(0, 5)

  if (!meaningful.length) return 'stock market trading terminal screens'
  return meaningful.join(' ')
}

export function useUnsplashImage(query, width = 400, height = 720) {
  const [imageUrl, setImageUrl] = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  useEffect(() => {
    if (!query || query.trim() === '') {
      setImageUrl(null)
      return
    }

    setLoading(true)
    setError(null)

    const searchQuery = buildRelevantQuery(query)
    const fallbackQuery = 'stock market trading terminal screens'
    const candidates = [searchQuery, fallbackQuery]
    const controller = new AbortController()
    let cancelled = false

    const load = async () => {
      for (const candidateQuery of candidates) {
        if (cancelled) return

        try {
          const params = new URLSearchParams({
            query: candidateQuery,
            width: String(width),
            height: String(height),
          })

          const res = await fetch(`/api/images/unsplash?${params.toString()}`, {
            signal: controller.signal,
          })

          if (!res.ok) continue

          const payload = await res.json()
          if (payload?.image_url) {
            setImageUrl(payload.image_url)
            setLoading(false)
            return
          }
        } catch (e) {
          if (e?.name === 'AbortError') return
        }
      }

      if (cancelled) return
      setError('Failed to load Unsplash image')
      setImageUrl(null)
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [query, width, height])

  return { imageUrl, loading, error }
}
