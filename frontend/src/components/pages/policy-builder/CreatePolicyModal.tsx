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
      {/* 붙여넣기 결과 표 + 오브젝트 갭 패널까지 한 화면에서 다뤄야 해서 내용이 금방 넘친다.
          높이를 뷰포트 기준으로 고정하고 헤더/푸터는 그대로 둔 채 중간 영역만 스크롤되게 해서
          (1) 매번 스크롤해서 액션 버튼을 찾을 필요가 없고 (2) 파싱 결과가 늘어나도 다이얼로그
          박스 자체의 높이가 바뀌지 않아 화면이 갑자기 확대되는 문제도 함께 없앤다. */}
      <DialogContent className="max-w-6xl w-[92vw] h-[88vh] bg-ds-surface-container-lowest flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-headline text-ds-on-surface">새 정책 붙여넣기</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          <NewPolicyPasteInput rows={rows} onChange={setRows} />
          <ObjectGapPanel deviceId={deviceId} rows={rows} newObjects={newObjects} onChange={setNewObjects} />
          <p className="text-[12px] text-ds-on-surface-variant">
            생성된 정책은 일단 최하단에 추가됩니다. 배치 위치는 추가 후 그리드에서 행을 선택해 "선택 이동"으로 지정하세요.
          </p>
        </div>

        <DialogFooter className="shrink-0">
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
