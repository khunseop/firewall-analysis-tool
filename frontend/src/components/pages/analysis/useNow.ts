import { useEffect, useState } from 'react'

/** active가 true인 동안만 1초마다 갱신되는 현재 시각 — 진행 중 경과 시간 표시용. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}
