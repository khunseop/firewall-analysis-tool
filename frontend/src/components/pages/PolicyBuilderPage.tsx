import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { DeviceSelectorSingle } from '@/components/shared/DeviceSelector'
import { NewPolicyPasteInput } from '@/components/pages/policy-builder/NewPolicyPasteInput'
import { ObjectGapPanel } from '@/components/pages/policy-builder/ObjectGapPanel'
import { MoveTargetPicker } from '@/components/pages/policy-builder/MoveTargetPicker'
import { PlanResultPanel } from '@/components/pages/policy-builder/PlanResultPanel'
import { planBulkPolicy, type NewObjectSpec, type NewPolicyRow, type MoveTarget, type BulkPolicyPlanResponse } from '@/api/policyBuilder'

export function PolicyBuilderPage() {
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [rows, setRows] = useState<NewPolicyRow[]>([])
  const [newObjects, setNewObjects] = useState<NewObjectSpec[]>([])
  const [moveTarget, setMoveTarget] = useState<MoveTarget>({ position: 'bottom', reference_policy_id: null })
  const [plan, setPlan] = useState<BulkPolicyPlanResponse | null>(null)

  const mutation = useMutation({
    mutationFn: () => planBulkPolicy(deviceId!, { new_policies: rows, new_objects: newObjects, move_target: moveTarget }),
    onSuccess: (data) => setPlan(data),
    onError: (err: Error) => toast.error(err.message),
  })

  const canSubmit = !!deviceId && rows.length > 0 && (moveTarget.position === 'top' || moveTarget.position === 'bottom' || !!moveTarget.reference_policy_id)

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-headline font-bold text-ds-on-surface">정책 생성 + 위치 이동 CLI 생성기</h1>
        <p className="text-[13px] text-ds-on-surface-variant mt-1">
          생성할 정책을 붙여넣고 목표 위치를 지정하면, 부족한 오브젝트/정책 생성 명령어와 이동 명령어를 만들고
          삽입 시 충돌 여부와 최종 배치를 미리 보여줍니다. 생성된 명령어는 장비에 직접 반영되지 않으며,
          검토 후 사용자가 직접 실행해야 합니다.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[13px] font-semibold text-ds-on-surface-variant">대상 장비</span>
        <DeviceSelectorSingle value={deviceId} onChange={(id) => { setDeviceId(id); setPlan(null) }} />
      </div>

      <NewPolicyPasteInput rows={rows} onChange={(r) => { setRows(r); setPlan(null) }} />

      <ObjectGapPanel deviceId={deviceId} rows={rows} newObjects={newObjects} onChange={setNewObjects} />

      <div>
        <p className="text-[13px] font-semibold text-ds-on-surface-variant mb-2">목표 위치</p>
        <MoveTargetPicker deviceId={deviceId} value={moveTarget} onChange={setMoveTarget} />
      </div>

      <button
        type="button"
        disabled={!canSubmit || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
      >
        {mutation.isPending ? '생성 중…' : 'CLI 생성 및 검증'}
      </button>

      {plan && (
        <div className="pt-4 border-t border-ds-outline-variant/20">
          <PlanResultPanel plan={plan} />
        </div>
      )}
    </div>
  )
}
