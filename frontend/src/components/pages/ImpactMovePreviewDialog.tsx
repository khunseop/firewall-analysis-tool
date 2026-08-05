import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getPolicies, type Policy } from '@/api/firewall'
import { queryKeys } from '@/api/queryKeys'
import { PolicyMiniRow } from '@/components/shared/PolicyMiniRow'

const CONTEXT_RADIUS = 4

interface Simulation {
  beforeArray: Policy[]
  afterArray: Policy[]
  originalIndex: number
  afterIndex: number
  targetId: number
}

function simulateMove(activePolicies: Policy[], row: Record<string, unknown>): Simulation | null {
  const targetId = row.target_policy_id as number
  const originalIndex = activePolicies.findIndex((p) => p.id === targetId)
  if (originalIndex === -1) return null

  const feasibility = row.move_feasibility as string
  const movedPolicy = activePolicies[originalIndex]
  const withoutTarget = activePolicies.filter((p) => p.id !== targetId)

  if (feasibility === 'blocked') {
    return { beforeArray: activePolicies, afterArray: activePolicies, originalIndex, afterIndex: originalIndex, targetId }
  }

  let anchorId: number | null = null
  let position: 'before' | 'after' = 'before'
  if (feasibility === 'full') {
    anchorId = (row.reference_policy_id as number | null) ?? null
    position = row.requested_move_direction === 'above' ? 'before' : 'after'
  } else if (feasibility === 'partial') {
    anchorId = (row.blocking_conflict_policy_id as number | null) ?? null
    position = row.move_direction === '아래로' ? 'before' : 'after'
  }

  let newIndex = withoutTarget.length
  if (anchorId != null) {
    const anchorIndex = withoutTarget.findIndex((p) => p.id === anchorId)
    if (anchorIndex !== -1) newIndex = position === 'before' ? anchorIndex : anchorIndex + 1
  }

  const afterArray = [...withoutTarget.slice(0, newIndex), movedPolicy, ...withoutTarget.slice(newIndex)]
  return { beforeArray: activePolicies, afterArray, originalIndex, afterIndex: newIndex, targetId }
}

export function ImpactMovePreviewDialog({
  open, onOpenChange, deviceId, row,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deviceId: number | null
  row: Record<string, unknown> | null
}) {
  const { data: policies = [], isLoading } = useQuery({
    queryKey: queryKeys.policiesRaw(deviceId),
    queryFn: () => getPolicies(deviceId!),
    enabled: !!deviceId && open,
    staleTime: 60_000,
  })

  const activePolicies = useMemo(
    () => policies.filter((p) => p.enable).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
    [policies],
  )

  const simulation = useMemo(() => {
    if (!row || activePolicies.length === 0) return null
    return simulateMove(activePolicies, row)
  }, [row, activePolicies])

  const feasibility = row?.move_feasibility as string | undefined
  const targetPolicyName = row?.target_policy_name as string | undefined
  const newSeqLabel = row?.max_safe_seq != null ? String(row.max_safe_seq) : undefined

  const windows = useMemo(() => {
    if (!simulation) return null
    const { beforeArray, afterArray, originalIndex, afterIndex } = simulation
    const lo = Math.max(0, Math.min(originalIndex, afterIndex) - CONTEXT_RADIUS)
    const hi = Math.min(beforeArray.length - 1, Math.max(originalIndex, afterIndex) + CONTEXT_RADIUS)
    return { before: beforeArray.slice(lo, hi + 1), after: afterArray.slice(lo, hi + 1) }
  }, [simulation])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">
            '{targetPolicyName}' 이동 전/후 순서 미리보기
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-10 text-center text-[13px] text-ds-on-surface-variant">불러오는 중…</div>
        ) : feasibility === 'blocked' ? (
          <div className="py-10 text-center text-[13px] text-ds-on-surface-variant">
            이동이 불가능하여 순서가 변경되지 않습니다.
          </div>
        ) : !windows ? (
          <div className="py-10 text-center text-[13px] text-ds-on-surface-variant">
            미리보기를 계산할 수 없습니다 (정책 정보를 찾을 수 없음).
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-semibold text-ds-on-surface-variant mb-1.5 px-1">이동 전</p>
              <div className="border border-ds-outline-variant/20 rounded-lg p-1 space-y-0.5 max-h-[420px] overflow-y-auto">
                {windows.before.map((p) => (
                  <PolicyMiniRow key={p.id} ruleName={p.rule_name} action={p.action} seq={p.seq} isMoved={p.id === simulation!.targetId} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-ds-on-surface-variant mb-1.5 px-1">
                이동 후 {feasibility === 'partial' && <span className="text-amber-600">(요청 위치까지는 불가 — 최대 안전 위치 기준)</span>}
              </p>
              <div className="border border-ds-outline-variant/20 rounded-lg p-1 space-y-0.5 max-h-[420px] overflow-y-auto">
                {windows.after.map((p) => (
                  <PolicyMiniRow
                    key={p.id}
                    ruleName={p.rule_name}
                    action={p.action}
                    seq={p.seq}
                    isMoved={p.id === simulation!.targetId}
                    newSeqLabel={p.id === simulation!.targetId ? newSeqLabel : undefined}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
