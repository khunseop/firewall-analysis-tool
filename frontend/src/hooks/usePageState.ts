import { useState, useCallback } from 'react'

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function usePageState<T>(pageKey: string, defaultValue: T): [T, (value: T) => void] {
  const storageKey = `fat_${pageKey}_search`

  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return defaultValue
      const parsed = JSON.parse(raw)
      if (Date.now() - (parsed.timestamp ?? 0) > MAX_AGE_MS) {
        localStorage.removeItem(storageKey)
        return defaultValue
      }
      const { timestamp: _t, ...value } = parsed
      return value as T
    } catch {
      return defaultValue
    }
  })

  const set = useCallback(
    (value: T) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ ...value, timestamp: Date.now() }))
      } catch {}
      setState(value)
    },
    [storageKey]
  )

  return [state, set]
}
