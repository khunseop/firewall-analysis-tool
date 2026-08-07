import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
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

  const mutation = useMutation({
    mutationFn: async () => {
      const timestamp = Date.now()
      for (const policyId of policyIds) {
        if (policyId < 0) {
          // 신규 생성행(음수 id) — 아직 실제 정책이 아니므로 move가 아니라 create 변경사항의 배치 위치를 갱신한다.
          const change = pendingChanges.find((c) => c.change_type === 'create' && -c.id === policyId)
          if (change) {
            await updatePendingChange(deviceId, change.id, {
              position: moveTarget.position, reference_policy_id: moveTarget.reference_policy_id,
            })
          }
          continue
        }
        await addPendingChange(deviceId, {
          change_type: 'move', target_policy_id: policyId, client_key: `move-${policyId}-${timestamp}`,
          payload: { position: moveTarget.position, reference_policy_id: moveTarget.reference_policy_id },
        })
      }
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

        <MoveTargetPicker deviceId={deviceId} value={moveTarget} onChange={setMoveTarget} />

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
