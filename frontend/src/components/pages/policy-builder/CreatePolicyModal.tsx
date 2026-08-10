import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { NewPolicyPasteInput } from '@/components/pages/policy-builder/NewPolicyPasteInput'
import { ObjectGapPanel } from '@/components/pages/policy-builder/ObjectGapPanel'
import { addPendingChange, type NewObjectSpec, type NewPolicyRow } from '@/api/policyBuilder'

export function CreatePolicyModal({ deviceId, onClose, onCreated }: {
  deviceId: number
  onClose: () => void
  onCreated: () => void
}) {
  const [rows, setRows] = useState<NewPolicyRow[]>([])
  const [newObjects, setNewObjects] = useState<NewObjectSpec[]>([])

  const mutation = useMutation({
    mutationFn: async () => {
      const timestamp = Date.now()
      await Promise.all(newObjects.map((obj) => addPendingChange(deviceId, {
        change_type: 'new_object', client_key: `obj-${obj.object_kind}-${obj.name}-${timestamp}`,
        payload: obj as unknown as Record<string, unknown>,
      })))
      await Promise.all(rows.map((row) => addPendingChange(deviceId, {
        change_type: 'create', client_key: `draft-${row.row_index}-${timestamp}`,
        payload: { ...row, position: 'bottom', reference_policy_id: null } as unknown as Record<string, unknown>,
      })))
    },
    onSuccess: () => {
      toast.success(`정책 ${rows.length}건이 대기중 변경사항으로 추가되었습니다. 그리드에서 선택 후 "선택 이동"으로 위치를 지정하세요.`)
      onCreated()
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const canSubmit = rows.length > 0

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* 파싱 결과 표가 나타나면서 다이얼로그 높이가 급격히 커지는데, 기본 Dialog는 화면 중앙에
          transform(top-50%/translate-y--50%)으로 위치를 잡기 때문에 높이가 바뀔 때마다 그 오프셋이
          재계산되어 상자가 중심에서 사방으로 갑자기 확대되는 것처럼 보인다(파싱 시 "화면이 깨지는" 버그의 원인).
          화면 위쪽에 고정해 높이가 바뀌어도 아래로만 자라도록 한다. */}
      <DialogContent className="max-w-5xl bg-ds-surface-container-lowest max-h-[85vh] overflow-y-auto top-8 translate-y-0">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">새 정책 붙여넣기</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <NewPolicyPasteInput rows={rows} onChange={setRows} />
          <ObjectGapPanel deviceId={deviceId} rows={rows} newObjects={newObjects} onChange={setNewObjects} />
          <p className="text-[12px] text-ds-on-surface-variant">
            생성된 정책은 일단 최하단에 추가됩니다. 배치 위치는 추가 후 그리드에서 행을 선택해 "선택 이동"으로 지정하세요.
          </p>
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
