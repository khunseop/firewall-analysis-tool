import { useCallback, useRef, useState } from 'react'

/**
 * 파일 내보내기처럼 오래 걸리는 비동기 작업의 진행 상태를 관리한다.
 * 진행 중에는 `busy`가 true이고, 같은 작업을 다시 호출해도 무시해 중복 다운로드를 막는다.
 */
export function useExportAction() {
  const [busy, setBusy] = useState(false)
  const runningRef = useRef(false)

  const run = useCallback(async (task: () => Promise<void>) => {
    if (runningRef.current) return
    runningRef.current = true
    setBusy(true)
    try {
      await task()
    } finally {
      runningRef.current = false
      setBusy(false)
    }
  }, [])

  return { busy, run }
}
