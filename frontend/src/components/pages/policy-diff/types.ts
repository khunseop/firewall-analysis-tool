// 실제 DB sync 시점이 아니라 "지금 장비에 직접 붙어 받아온 running/candidate"를 뜻하는
// sentinel id. 백엔드 /firewall/policy-diff와 값이 일치해야 한다.
export const LIVE_RUNNING_ID = -1
export const LIVE_CANDIDATE_ID = -2

export interface SyncPoint {
  id: number
  device_id: number
  sync_at: string
  total_policies: number | null
  /** true면 sync_at/total_policies 대신 liveLabel을 표시하는 실시간(running/candidate) 항목 */
  isLive?: boolean
  liveLabel?: string
}

export interface FieldChange {
  field: string
  before: string | null
  after: string | null
}

export interface DiffEntry {
  rule_name: string
  vsys: string | null
  action: 'created' | 'updated' | 'deleted'
  field_changes: FieldChange[]
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  change_count: number
}

export interface DiffResponse {
  from_sync: { id: number; sync_at: string; total_policies: number | null }
  to_sync: { id: number; sync_at: string; total_policies: number | null }
  summary: { created: number; updated: number; deleted: number; total: number }
  changes: DiffEntry[]
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 고정폭 24시간제 — "2026-10-03 22:09:02". 목록에서 세로로 훑어도 자릿수가 맞는다. */
export function fmt(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function pointLabel(p: SyncPoint) {
  return p.isLive ? p.liveLabel! : fmt(p.sync_at)
}

export const FIELD_LABELS: Record<string, string> = {
  enable: '활성화', action: '액션', source: '출발지', destination: '목적지',
  service: '서비스', description: '설명', user: '사용자',
  application: '애플리케이션', security_profile: '보안 프로파일', category: '카테고리',
  seq: '순서', from_zone: '출발지 존', to_zone: '목적지 존', log_setting: '로그 포워딩',
  last_hit_date: '마지막 사용일', hit_count: '히트 횟수',
}

// 콤마로 여러 값을 담는 필드만 "실제 바뀐 항목"(추가/삭제) 요약을 보여준다 — enable/action/seq 같은
// 단일 값 필드는 이미 이전/이후 칸에 전체 값이 보이므로 별도 요약이 필요 없다.
export const LIST_FIELDS = new Set(['source', 'destination', 'service', 'user', 'application'])

export const SNAPSHOT_FIELDS = ['action', 'enable', 'source', 'destination', 'service', 'description', 'user', 'application', 'security_profile']
