export const ACTION_BADGE: Record<string, string> = {
  allow:  'bg-green-100 text-green-700',
  deny:   'bg-red-100 text-red-700',
  drop:   'bg-red-100 text-red-700',
  reject: 'bg-orange-100 text-orange-700',
}

export type PendingStatus = 'new' | 'modified' | 'deleted' | 'moved'

/** 편집모드 행 상태 — 색(행 틴트)에만 의존하지 않도록 라벨 배지와 패널 범례에서 같이 쓴다. */
export const PENDING_STATUS_META: Record<PendingStatus, { label: string; badge: string; dot: string; tint: string }> = {
  new:      { label: '신규', badge: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500', tint: 'rgba(16,185,129,0.10)' },
  modified: { label: '수정', badge: 'bg-amber-100 text-amber-900',     dot: 'bg-amber-500', tint: 'rgba(245,158,11,0.10)' },
  deleted:  { label: '삭제', badge: 'bg-red-100 text-red-800',         dot: 'bg-red-500', tint: 'rgba(239,68,68,0.10)' },
  moved:    { label: '이동', badge: 'bg-blue-100 text-blue-800',       dot: 'bg-blue-500', tint: 'rgba(59,130,246,0.10)' },
}

/**
 * 콤마 구분 문자열을 파싱합니다. LDAP DN처럼 값 내부에 콤마가 있는 경우
 * list_to_string이 생성한 quoted CSV 형식("v1,v2","v3,v4")을 올바르게 처리합니다.
 */
export function parseCSVTokens(value: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of value) {
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      const trimmed = current.trim()
      if (trimmed) tokens.push(trimmed)
      current = ''
    } else {
      current += ch
    }
  }
  const trimmed = current.trim()
  if (trimmed) tokens.push(trimmed)
  return tokens
}

/** parseCSVTokens로 파싱한 뒤, 콤마를 포함한 토큰을 따옴표로 재감싸 list_to_string 형식으로 복원합니다. */
export function formatCSVField(value: string | null | undefined): string {
  if (!value) return ''
  const tokens = parseCSVTokens(value)
  return tokens.map(t => t.includes(',') ? `"${t}"` : t).join(',')
}
