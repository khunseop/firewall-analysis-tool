import type { NewPolicyRow } from '@/api/policyBuilder'
import { newPolicyRowDefaults } from '@/api/policyBuilder'

/**
 * 엑셀에서 복사한 탭(또는 콤마) 구분 텍스트를 신규 정책 목록으로 변환합니다.
 *
 * 규칙(사내 SecToolkit 프로젝트의 CLI 생성기 문서에서 이식):
 * - 첫 줄은 헤더로 간주하고, 헤더 이름으로 컬럼을 매핑한다 (순서 무관).
 * - rule_name(정책명)이 빈 행은 "바로 위 정책의 연속"으로 간주해 다중값 필드만 콤마로 이어붙인다.
 * - 알 수 없는 헤더는 무시하고 unknownColumns로 보고한다.
 */

const MULTI_VALUE_FIELDS: (keyof NewPolicyRow)[] = [
  'from_zone', 'source', 'source_user', 'to_zone', 'destination', 'service', 'application',
]

const HEADER_TO_FIELD: Record<string, keyof NewPolicyRow> = {
  'rule_name': 'rule_name', '정책명': 'rule_name', '규칙명': 'rule_name',
  'rule_action': 'rule_action', 'action': 'rule_action', '액션': 'rule_action',
  'disabled': 'disabled', '비활성화': 'disabled',
  'from': 'from_zone', 'from_zone': 'from_zone', '출발지존': 'from_zone',
  'source': 'source', '출발지': 'source',
  'source_user': 'source_user', 'source-user': 'source_user', '사용자': 'source_user',
  'to': 'to_zone', 'to_zone': 'to_zone', '목적지존': 'to_zone',
  'destination': 'destination', '목적지': 'destination',
  'service': 'service', '서비스': 'service',
  'application': 'application', '애플리케이션': 'application',
  'description': 'description', '설명': 'description',
  'log_end': 'log_end', 'log-end': 'log_end',
  'log_setting': 'log_setting', 'log-setting': 'log_setting',
}

function splitCells(line: string): string[] {
  const cells = line.includes('\t') ? line.split('\t') : line.split(',')
  return cells.map((c) => c.trim())
}

export interface ParsePastedPoliciesResult {
  rows: NewPolicyRow[]
  unknownColumns: string[]
}

export function parsePastedPolicies(text: string): ParsePastedPoliciesResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { rows: [], unknownColumns: [] }

  const headerCells = splitCells(lines[0])
  const unknownColumns: string[] = []
  const fieldByCol: (keyof NewPolicyRow | null)[] = headerCells.map((h) => {
    const field = HEADER_TO_FIELD[h.toLowerCase()] ?? HEADER_TO_FIELD[h]
    if (!field) unknownColumns.push(h)
    return field ?? null
  })

  const rows: NewPolicyRow[] = []
  let current: NewPolicyRow | null = null

  for (const line of lines.slice(1)) {
    const cells = splitCells(line)
    const rowDict: Partial<Record<keyof NewPolicyRow, string>> = {}
    fieldByCol.forEach((field, idx) => {
      if (field) rowDict[field] = (cells[idx] ?? '').trim()
    })

    const ruleName = (rowDict.rule_name ?? '').trim()

    if (!ruleName && current) {
      const currentRec = current as unknown as Record<string, string>
      for (const field of MULTI_VALUE_FIELDS) {
        const value = (rowDict[field] ?? '').trim()
        if (!value) continue
        currentRec[field] = currentRec[field] ? `${currentRec[field]},${value}` : value
      }
      continue
    }

    if (!ruleName) continue // 완전히 빈 행 (첫 정책 전에 등장한 경우 포함)

    current = { ...newPolicyRowDefaults(rows.length), ...rowDict, rule_name: ruleName } as NewPolicyRow
    if (rowDict.disabled !== undefined) {
      current.disabled = ['true', 'yes', 'y', '1'].includes(rowDict.disabled.toLowerCase())
    }
    if (!current.rule_action) current.rule_action = 'allow'
    rows.push(current)
  }

  rows.forEach((row, idx) => { row.row_index = idx })

  return { rows, unknownColumns: [...new Set(unknownColumns)] }
}
