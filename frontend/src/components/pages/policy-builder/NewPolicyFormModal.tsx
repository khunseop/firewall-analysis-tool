import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ObjectGapPanel } from '@/components/pages/policy-builder/ObjectGapPanel'
import { addPendingChange, newPolicyRowDefaults, type NewObjectSpec, type NewPolicyRow } from '@/api/policyBuilder'

const FIELD_LABELS: { key: keyof NewPolicyRow; label: string; placeholder: string }[] = [
  { key: 'from_zone', label: 'from (출발지 존)', placeholder: 'any' },
  { key: 'source', label: 'source (출발지)', placeholder: '10.0.0.0/24, any' },
  { key: 'source_user', label: 'source-user', placeholder: 'any' },
  { key: 'to_zone', label: 'to (목적지 존)', placeholder: 'any' },
  { key: 'destination', label: 'destination (목적지)', placeholder: 'any' },
  { key: 'service', label: 'service', placeholder: 'tcp-443, any' },
  { key: 'application', label: 'application', placeholder: 'any' },
  { key: 'log_setting', label: 'log-setting', placeholder: '(비워두면 미지정)' },
]

export function NewPolicyFormModal({ deviceId, onClose, onCreated }: {
  deviceId: number
  onClose: () => void
  onCreated: () => void
}) {
  const uid = useId()
  const [row, setRow] = useState<NewPolicyRow>(() => newPolicyRowDefaults(0))
  const [newObjects, setNewObjects] = useState<NewObjectSpec[]>([])

  const update = (patch: Partial<NewPolicyRow>) => setRow((prev) => ({ ...prev, ...patch }))

  const mutation = useMutation({
    mutationFn: async () => {
      const timestamp = Date.now()
      await Promise.all(newObjects.map((obj) => addPendingChange(deviceId, {
        change_type: 'new_object', client_key: `obj-${obj.object_kind}-${obj.name}-${timestamp}`,
        payload: obj as unknown as Record<string, unknown>,
      })))
      await addPendingChange(deviceId, {
        change_type: 'create', client_key: `draft-form-${timestamp}`,
        payload: { ...row, position: 'bottom', reference_policy_id: null } as unknown as Record<string, unknown>,
      })
    },
    onSuccess: () => {
      toast.success('정책 1건을 변경 계획에 추가했습니다. 위치는 그리드에서 선택 후 "이동"으로 지정하세요.')
      onCreated()
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const canSubmit = row.rule_name.trim() !== ''

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl bg-ds-surface-container-lowest max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">새 정책 추가</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor={`${uid}-rule_name`} className="text-11 font-semibold text-ds-on-surface-variant">정책명 *</label>
              <Input id={`${uid}-rule_name`} aria-required="true" value={row.rule_name} onChange={(e) => update({ rule_name: e.target.value })} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${uid}-rule_action`} className="text-11 font-semibold text-ds-on-surface-variant">액션</label>
              <Select value={row.rule_action} onValueChange={(v) => update({ rule_action: v })}>
                <SelectTrigger id={`${uid}-rule_action`} className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">allow</SelectItem>
                  <SelectItem value="deny">deny</SelectItem>
                  <SelectItem value="drop">drop</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {FIELD_LABELS.map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1">
                <label htmlFor={`${uid}-${key}`} className="text-11 font-semibold text-ds-on-surface-variant">{label}</label>
                <Input
                  id={`${uid}-${key}`}
                  value={row[key] as string}
                  onChange={(e) => update({ [key]: e.target.value })}
                  placeholder={placeholder}
                  className="h-8 text-xs font-mono"
                />
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <label htmlFor={`${uid}-description`} className="text-11 font-semibold text-ds-on-surface-variant">설명</label>
            <Input id={`${uid}-description`} value={row.description} onChange={(e) => update({ description: e.target.value })} className="h-8 text-xs" />
          </div>

          <ObjectGapPanel deviceId={deviceId} rows={canSubmit ? [row] : []} newObjects={newObjects} onChange={setNewObjects} />
        </div>

        <DialogFooter>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
          <Button
            type="button"
            variant="gradient"
            size="auto"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-5 py-2 text-sm font-bold rounded-md"
          >
            {mutation.isPending ? '추가 중…' : '변경 계획에 추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
