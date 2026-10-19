import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { NewPolicyPasteInput } from '@/components/pages/policy-builder/NewPolicyPasteInput'
import { ObjectGapPanel } from '@/components/pages/policy-builder/ObjectGapPanel'
import { MoveTargetPicker } from '@/components/pages/policy-builder/MoveTargetPicker'
import { addPendingChange, type MoveTarget, type NewObjectSpec, type NewPolicyRow } from '@/api/policyBuilder'

export function CreatePolicyModal({ deviceId, onClose, onCreated }: {
  deviceId: number
  onClose: () => void
  onCreated: () => void
}) {
  const [rows, setRows] = useState<NewPolicyRow[]>([])
  const [newObjects, setNewObjects] = useState<NewObjectSpec[]>([])
  const [target, setTarget] = useState<MoveTarget>({ position: 'bottom', reference_policy_id: null })

  const mutation = useMutation({
    mutationFn: async () => {
      const timestamp = Date.now()
      await Promise.all(newObjects.map((obj) => addPendingChange(deviceId, {
        change_type: 'new_object', client_key: `obj-${obj.object_kind}-${obj.name}-${timestamp}`,
        payload: obj as unknown as Record<string, unknown>,
      })))
      // 붙여넣은 순서가 DB id 순서가 되도록 한 건씩 차례로 저장한다(병렬 저장은 도착 순서대로 id가 매겨져 순서가 뒤섞인다).
      for (const row of rows) {
        await addPendingChange(deviceId, {
          change_type: 'create', client_key: `draft-${row.row_index}-${timestamp}`,
          payload: { ...row, position: target.position, reference_policy_id: target.reference_policy_id } as unknown as Record<string, unknown>,
        })
      }
    },
    onSuccess: () => {
      toast.success(`정책 ${rows.length}건을 변경 계획에 추가했습니다. 오른쪽 패널에서 순서를 확인하세요.`)
      onCreated()
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const needsReference = target.position === 'before' || target.position === 'after'
  const canSubmit = rows.length > 0 && (!needsReference || target.reference_policy_id != null)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* 입력 | 결과를 좌우로 나눠 결과가 늘어나도 입력창이 밀려나지 않게 하고,
          배치 위치는 푸터 바로 위에 고정해 "어디에 넣을지"를 같은 화면에서 정한다. */}
      <DialogContent className="max-w-6xl w-[92vw] h-[88vh] bg-ds-surface-container-lowest flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-headline text-ds-on-surface">새 정책 붙여넣기</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
          <NewPolicyPasteInput rows={rows} onChange={setRows}>
            <ObjectGapPanel deviceId={deviceId} rows={rows} newObjects={newObjects} onChange={setNewObjects} />
          </NewPolicyPasteInput>
        </div>

        <fieldset className="shrink-0 border-t border-ds-outline-variant/15 pt-3 space-y-2">
          <legend className="sr-only">배치 위치</legend>
          <p className="text-13 font-semibold text-ds-on-surface">배치 위치 <span className="font-normal text-ds-on-surface-variant">· 파싱된 정책을 한꺼번에 이 위치에 넣습니다 (나중에 그리드에서 행을 선택해 "이동"으로 바꿀 수 있습니다)</span></p>
          <MoveTargetPicker deviceId={deviceId} value={target} onChange={setTarget} />
        </fieldset>

        <DialogFooter className="shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
          <Button
            type="button"
            variant="gradient"
            size="auto"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-5 py-2 text-sm font-bold rounded-md"
          >
            {mutation.isPending ? '추가 중…' : `변경 계획에 추가 (${rows.length}건)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
