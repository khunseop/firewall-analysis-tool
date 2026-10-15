/**
 * Policy Diff 결과에서 "검토자가 먼저 봐야 할" 위험 변경을 가려내는 순수 함수.
 * 백엔드 diff 결과(field_changes / before / after 스냅샷)만으로 판정하므로 서버 변경이 필요 없다.
 */
import { diffMultiValueField } from '@/lib/policyDiff'

export interface RiskInput {
  action: 'created' | 'updated' | 'deleted'
  field_changes: { field: string; before: string | null; after: string | null }[]
  after: Record<string, unknown> | null
}

const ALLOW_VALUES = new Set(['allow', 'permit', 'accept'])
const TRUE_VALUES = new Set(['true', 'y', 'yes', '1', 'enable', 'enabled'])
const ADDRESS_FIELDS: { key: string; label: string }[] = [
  { key: 'source', label: '출발지' },
  { key: 'destination', label: '목적지' },
  { key: 'service', label: '서비스' },
]

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()
const hasAny = (v: unknown) => String(v ?? '').split(',').some((t) => t.trim().toLowerCase() === 'any')

/** 위험 사유 목록 — 비어 있으면 위험 변경이 아니다. */
export function assessDiffRisk(entry: RiskInput): string[] {
  const reasons: string[] = []

  if (entry.action === 'created' && entry.after) {
    if (ALLOW_VALUES.has(norm(entry.after.action))) {
      const anyFields = ADDRESS_FIELDS.filter((f) => hasAny(entry.after![f.key])).map((f) => f.label)
      if (anyFields.length > 0) reasons.push(`신규 허용 정책의 ${anyFields.join('·')}가 any`)
    }
    return reasons
  }

  if (entry.action !== 'updated') return reasons

  for (const fc of entry.field_changes) {
    if (fc.field === 'action' && ALLOW_VALUES.has(norm(fc.after)) && !ALLOW_VALUES.has(norm(fc.before))) {
      reasons.push(`액션이 ${fc.before || '없음'} → ${fc.after}로 변경`)
    }
    if (fc.field === 'enable' && TRUE_VALUES.has(norm(fc.after)) && !TRUE_VALUES.has(norm(fc.before))) {
      reasons.push('비활성 → 활성')
    }
    const addr = ADDRESS_FIELDS.find((f) => f.key === fc.field)
    if (addr && diffMultiValueField(fc.before ?? '', fc.after ?? '').added.some((t) => t.toLowerCase() === 'any')) {
      reasons.push(`${addr.label}에 any 추가`)
    }
  }
  return reasons
}

/** 룰 순서(seq)가 스냅샷상 바뀐 경우 "N번 → M번"을 돌려준다. diff 대상 필드가 아니라 스냅샷에 값이 있을 때만 판단한다. */
export function seqMove(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const b = Number(before?.seq)
  const a = Number(after?.seq)
  if (!Number.isFinite(b) || !Number.isFinite(a) || before?.seq == null || after?.seq == null || b === a) return null
  return { from: b, to: a }
}
