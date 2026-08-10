import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { MoveTargetPicker } from '@/components/pages/policy-builder/MoveTargetPicker'
import { addPendingChange, updatePendingChange, type MoveTarget, type PendingPolicyChange } from '@/api/policyBuilder'

export function MoveExistingDialog({ deviceId, policyIds, pendingChanges, onClose, onMoved }: {
  deviceId: number
  policyIds: number[]
  pendingChanges: PendingPolicyChange[]
  onClose: () => void
  onMoved: () => void
}) {
  const [moveTarget, setMoveTarget] = useState<MoveTarget>({ position: 'bottom', reference_policy_id: null })

  // 삭제 대기중인 정책을 기준 정책으로 고르면, 최종 실행 순서에 따라 무엇을 기준으로 삼았는지
  // 헷갈릴 수 있어 선택 UI에 경고를 표시한다(선택 자체는 막지 않음 — CLI 실행 순서상 move가
  // delete보다 항상 먼저 나와 실제 오류로 이어지지는 않는다).
  const deletedPolicyIds = useMemo(
    () => new Set(pendingChanges.filter((c) => c.change_type === 'delete' && c.target_policy_id != null).map((c) => c.target_policy_id!)),
    [pendingChanges]
  )
  const referenceIsPendingDelete = moveTarget.reference_policy_id != null && deletedPolicyIds.has(moveTarget.reference_policy_id)

  const mutation = useMutation({
    mutationFn: async () => {
      const timestamp = Date.now()
      await Promise.all(policyIds.map((policyId) => {
        if (policyId < 0) {
          // 신규 생성행(음수 id) — 아직 실제 정책이 아니므로 move가 아니라 create 변경사항의 배치 위치를 갱신한다.
          const change = pendingChanges.find((c) => c.change_type === 'create' && -c.id === policyId)
          if (!change) return Promise.resolve()
          return updatePendingChange(deviceId, change.id, {
            position: moveTarget.position, reference_policy_id: moveTarget.reference_policy_id,
          })
        }
        return addPendingChange(deviceId, {
          change_type: 'move', target_policy_id: policyId, client_key: `move-${policyId}-${timestamp}`,
          payload: { position: moveTarget.position, reference_policy_id: moveTarget.reference_policy_id },
        })
      }))
    },
    onSuccess: () => {
      toast.success(`정책 ${policyIds.length}건 이동이 대기중 변경사항으로 추가되었습니다.`)
      onMoved()
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const canSubmit = moveTarget.position === 'top' || moveTarget.position === 'bottom' || !!moveTarget.reference_policy_id

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">선택한 정책 {policyIds.length}건 이동</DialogTitle>
        </DialogHeader>

        <MoveTargetPicker deviceId={deviceId} value={moveTarget} onChange={setMoveTarget} deletedPolicyIds={deletedPolicyIds} />
        {referenceIsPendingDelete && (
          <p className="flex items-center gap-1.5 text-[12px] text-ds-error">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> 선택한 기준 정책은 삭제 대기중입니다. 위치 계산에는 문제없지만, 참고용으로 다른 기준을 고려해보세요.
          </p>
        )}

        <DialogFooter>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
          <button
            type="button"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
          >
            {mutation.isPending ? '추가 중…' : '이동 예약'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
