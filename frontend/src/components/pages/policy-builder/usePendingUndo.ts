import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cleanupOrphanNewObjects, removePendingChange, type PendingPolicyChange } from '@/api/policyBuilder'

/**
 * 편집모드 "실행 취소" — 대기중 변경사항은 대부분 append-only 행이라, 한 번의 편집 액션으로
 * 새로 생긴 행들을 한 묶음으로 기억해 두었다가 되돌릴 때 그 행들을 제거한다.
 * 목록이 갱신될 때마다 이전과 비교해 새로 생긴 id가 있으면 1개 액션으로 스택에 쌓는다.
 * 스택은 화면 세션 동안만 유지된다(새로고침/장비 변경 시 초기화).
 * 신규 생성행의 셀 직접 편집(PATCH)은 추적하지 않는다.
 */
export function usePendingUndo({ active, deviceId, ready, pendingChanges, runAction }: {
  active: boolean
  deviceId: number | null
  ready: boolean // 대기중 변경사항 조회가 끝나 안정된 상태
  pendingChanges: PendingPolicyChange[]
  runAction: (action: () => Promise<unknown>) => Promise<void>
}) {
  // 편집모드 on/off·장비가 바뀌면 키가 달라져 이전 스택은 자동으로 무시된다.
  const scope = `${active}:${deviceId}`
  const [history, setHistory] = useState<{ scope: string; stack: number[][] }>({ scope, stack: [] })
  const stack = useMemo(() => (history.scope === scope ? history.stack : []), [history, scope])
  const knownIds = useRef<Set<number> | null>(null)

  useEffect(() => {
    knownIds.current = null
  }, [active, deviceId])

  useEffect(() => {
    if (!active || !ready) return
    const currentIds = new Set(pendingChanges.map((c) => c.id))
    const known = knownIds.current
    knownIds.current = currentIds
    if (!known) return
    const added = [...currentIds].filter((id) => !known.has(id))
    if (added.length > 0) {
      setHistory((prev) => ({ scope, stack: [...(prev.scope === scope ? prev.stack : []), added] }))
    }
  }, [active, ready, pendingChanges, scope])

  const undoLast = useCallback(async () => {
    if (!deviceId) return
    const currentIds = new Set(pendingChanges.map((c) => c.id))
    // 이미 다른 경로(행 되돌리기 등)로 사라진 묶음은 건너뛰고, 실제로 지울 행이 있는 마지막 묶음을 되돌린다.
    let target: number[] = []
    let remaining = stack
    while (remaining.length > 0 && target.length === 0) {
      target = remaining[remaining.length - 1].filter((id) => currentIds.has(id))
      remaining = remaining.slice(0, -1)
    }
    if (target.length === 0) {
      setHistory({ scope, stack: remaining })
      return
    }
    await runAction(async () => {
      await Promise.all(target.map((id) => removePendingChange(deviceId, id)))
      const removedCreate = pendingChanges.some((c) => target.includes(c.id) && c.change_type === 'create')
      if (removedCreate) await cleanupOrphanNewObjects(deviceId, pendingChanges.filter((c) => !target.includes(c.id)))
      // 서버 작업이 성공했을 때만 스택에서 제거 — 실패하면 같은 항목을 다시 시도할 수 있다.
      setHistory({ scope, stack: remaining })
    })
  }, [deviceId, pendingChanges, stack, scope, runAction])

  const undoRef = useRef(undoLast)
  useEffect(() => { undoRef.current = undoLast }, [undoLast])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return
      const el = e.target as HTMLElement | null
      if (el && (el.closest('input, textarea, select, [contenteditable="true"]'))) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      void undoRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active])

  return { canUndo: stack.length > 0, undoLast }
}
