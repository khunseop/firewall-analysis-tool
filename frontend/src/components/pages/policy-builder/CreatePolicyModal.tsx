import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { NewPolicyPasteInput } from '@/components/pages/policy-builder/NewPolicyPasteInput'
import { ObjectGapPanel } from '@/components/pages/policy-builder/ObjectGapPanel'
import { MoveTargetPicker } from '@/components/pages/policy-builder/MoveTargetPicker'
import { addPendingChange, type NewObjectSpec, type NewPolicyRow, type MoveTarget } from '@/api/policyBuilder'

export function CreatePolicyModal({ deviceId, onClose, onCreated }: {
  deviceId: number
  onClose: () => void
  onCreated: () => void
}) {
  const [rows, setRows] = useState<NewPolicyRow[]>([])
  const [newObjects, setNewObjects] = useState<NewObjectSpec[]>([])
  const [moveTarget, setMoveTarget] = useState<MoveTarget>({ position: 'bottom', reference_policy_id: null })

  const mutation = useMutation({
    mutationFn: async () => {
      const timestamp = Date.now()
      for (const obj of newObjects) {
        await addPendingChange(deviceId, {
          change_type: 'new_object', client_key: `obj-${obj.object_kind}-${obj.name}-${timestamp}`,
          payload: obj as unknown as Record<string, unknown>,
        })
      }
      for (const row of rows) {
        await addPendingChange(deviceId, {
          change_type: 'create', client_key: `draft-${row.row_index}-${timestamp}`,
          payload: { ...row, position: moveTarget.position, reference_policy_id: moveTarget.reference_policy_id } as unknown as Record<string, unknown>,
        })
      }
    },
    onSuccess: () => {
      toast.success(`정책 ${rows.length}건이 대기중 변경사항으로 추가되었습니다.`)
      onCreated()
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const canSubmit = rows.length > 0 && (moveTarget.position === 'top' || moveTarget.position === 'bottom' || !!moveTarget.reference_policy_id)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl bg-ds-surface-container-lowest max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">새 정책 붙여넣기</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <NewPolicyPasteInput rows={rows} onChange={setRows} />
          <ObjectGapPanel deviceId={deviceId} rows={rows} newObjects={newObjects} onChange={setNewObjects} />
          <div>
            <p className="text-[13px] font-semibold text-ds-on-surface-variant mb-2">목표 위치</p>
            <MoveTargetPicker deviceId={deviceId} value={moveTarget} onChange={setMoveTarget} />
          </div>
        </div>

        <DialogFooter>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
          <button
            type="button"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
          >
            {mutation.isPending ? '추가 중…' : `대기중 변경사항으로 추가 (${rows.length}건)`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
