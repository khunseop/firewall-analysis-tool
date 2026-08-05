import { PolicyGridPicker } from '@/components/shared/PolicyGridPicker'
import type { MoveTarget } from '@/api/policyBuilder'

const POSITION_OPTIONS: { value: MoveTarget['position']; label: string }[] = [
  { value: 'top', label: '맨 위' },
  { value: 'bottom', label: '맨 아래' },
  { value: 'before', label: '기준 정책 위(before)' },
  { value: 'after', label: '기준 정책 아래(after)' },
]

export function MoveTargetPicker({ deviceId, value, onChange }: {
  deviceId: number | null
  value: MoveTarget
  onChange: (value: MoveTarget) => void
}) {
  const needsReference = value.position === 'before' || value.position === 'after'

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        {POSITION_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-center gap-1.5 text-[13px] cursor-pointer">
            <input
              type="radio"
              name="move-position"
              checked={value.position === opt.value}
              onChange={() => onChange({ ...value, position: opt.value })}
            />
            {opt.label}
          </label>
        ))}
      </div>
      {needsReference && (
        <div className="space-y-1">
          <p className="text-[11px] text-ds-on-surface-variant">
            before = 기준 정책 바로 위로 · after = 기준 정책 바로 아래로
          </p>
          <PolicyGridPicker
            deviceId={deviceId}
            mode="single"
            value={value.reference_policy_id}
            onChange={(id) => onChange({ ...value, reference_policy_id: id })}
            placeholder="기준 정책 선택…"
          />
        </div>
      )}
    </div>
  )
}
