/**
 * QueryBuilder의 필드 정의·타입·요청 변환 유틸 (비컴포넌트 — react-refresh 분리)
 */
import type { FilterExprNode, FilterLeafNode } from '@/api/firewall'

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ─── 필드 정의 ────────────────────────────────────────────────────────────────

type FieldType = 'text' | 'date' | 'select'
export type OperatorKey = 'contains' | 'equals' | 'not_equals' | 'not_contains' | 'gte' | 'lte' | 'only_within'

interface FieldOption { value: string; label: string }

interface FieldDef {
  key: string
  label: string
  type: FieldType
  operators: OperatorKey[]
  options?: FieldOption[]
  placeholder?: string
}

export const QB_FIELDS: FieldDef[] = [
  { key: 'rule_name',     label: '정책명',          type: 'text',   operators: ['contains', 'not_contains', 'equals', 'not_equals'], placeholder: 'web-policy, http-rule' },
  { key: 'vsys',          label: '가상시스템',       type: 'text',   operators: ['contains', 'equals'], placeholder: 'vsys1' },
  { key: 'src_ip',        label: '출발지 IP',        type: 'text',   operators: ['equals', 'not_equals', 'contains', 'not_contains', 'only_within'], placeholder: '10.0.0.0/8, 192.168.0.0/16' },
  { key: 'dst_ip',        label: '목적지 IP',        type: 'text',   operators: ['equals', 'not_equals', 'contains', 'not_contains', 'only_within'], placeholder: '0.0.0.0/0, 10.0.0.0/8' },
  { key: 'src_name',      label: '출발지 객체명',    type: 'text',   operators: ['contains', 'not_contains', 'equals', 'not_equals'], placeholder: 'host-A, host-B' },
  { key: 'dst_name',      label: '목적지 객체명',    type: 'text',   operators: ['contains', 'not_contains', 'equals', 'not_equals'], placeholder: 'server-group, web-server' },
  { key: 'service',       label: '서비스/포트',      type: 'text',   operators: ['equals', 'not_equals'], placeholder: 'tcp/443, tcp/80' },
  { key: 'service_name',  label: '서비스 객체명',    type: 'text',   operators: ['contains', 'not_contains', 'equals', 'not_equals'], placeholder: 'svc-https, svc-http' },
  { key: 'action',        label: '액션',             type: 'text',   operators: ['equals', 'not_equals'], placeholder: 'allow' },
  { key: 'enable',        label: '활성화',           type: 'select', operators: ['equals'],
    options: [{ value: 'true', label: '활성' }, { value: 'false', label: '비활성' }] },
  { key: 'user',          label: '사용자',           type: 'text',   operators: ['contains', 'not_contains', 'equals', 'not_equals'], placeholder: '' },
  { key: 'application',   label: '애플리케이션',     type: 'text',   operators: ['contains', 'not_contains', 'equals', 'not_equals'], placeholder: '' },
  { key: 'description',   label: '설명',             type: 'text',   operators: ['contains', 'not_contains', 'equals', 'not_equals'], placeholder: '' },
  { key: 'last_hit_from', label: '마지막 매칭 시작', type: 'date',   operators: ['gte'] },
  { key: 'last_hit_to',   label: '마지막 매칭 종료', type: 'date',   operators: ['lte'] },
]

export const OP_LABELS: Record<OperatorKey, string> = {
  contains:     '포함',
  not_contains: '미포함',
  equals:       '=',
  not_equals:   '≠',
  gte:          '이후 (≥)',
  lte:          '이전 (≤)',
  only_within:  '전용 (범위 내만)',
}

// 연산자 드롭다운 title 툴팁용 설명
export const OP_DESCRIPTIONS: Partial<Record<OperatorKey, string>> = {
  equals:      '값이 정확히 일치하는 항목이 하나라도 있으면 매칭 (다른 값이 함께 섞여 있어도 매칭됨)',
  only_within: '지정한 범위 안에 있는 값만 매칭 (범위를 벗어나는 값이 하나라도 있으면 그 정책은 제외). "=" 조건과 함께 사용하면 정확히 그 대역만 사용하는 정책을 찾을 수 있습니다.',
  contains:    '값의 일부라도 포함하면 매칭',
}

// ─── IP/CIDR 값 검증 (src_ip, dst_ip 필드용) ───────────────────────────────────

const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d|0)'
const IPV4_RE = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`)

function isValidIpv4(s: string): boolean {
  return IPV4_RE.test(s.trim())
}

function isValidIpToken(token: string): boolean {
  const t = token.trim()
  if (!t) return true
  if (t.toLowerCase() === 'any') return true
  if (t.includes('/')) {
    const [addr, prefix] = t.split('/')
    if (!isValidIpv4(addr)) return false
    const p = Number(prefix)
    return Number.isInteger(p) && p >= 0 && p <= 32
  }
  if (t.includes('-')) {
    const [a, b] = t.split('-')
    return isValidIpv4(a) && isValidIpv4(b)
  }
  return isValidIpv4(t)
}

/** 콤마 구분 IP/CIDR 값 중 형식이 잘못된 토큰만 반환 (src_ip/dst_ip 필드 검증용) */
export function findInvalidIpTokens(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean).filter(t => !isValidIpToken(t))
}

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface Condition {
  field: string
  operator: OperatorKey
  value: string
}

export interface ConditionWithJoin extends Condition {
  joinOperator: 'AND' | 'OR'
}

export interface ConditionGroup {
  id: string
  conditions: ConditionWithJoin[]
  joinOperator: 'AND' | 'OR'
}

export type FilterTree = ConditionGroup[]

export function getFieldDef(key: string): FieldDef {
  return QB_FIELDS.find(f => f.key === key) ?? QB_FIELDS[0]
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

export function conditionsToFilterTree(conditions: Condition[]): FilterTree {
  if (conditions.length === 0) return []
  return [{
    id: generateId(),
    joinOperator: 'AND',
    conditions: conditions.map(c => ({ ...c, joinOperator: 'AND' as const })),
  }]
}

function buildLeafNode(c: ConditionWithJoin): FilterLeafNode {
  return { type: 'LEAF', field: c.field, operator: c.operator, value: c.value }
}

function buildGroupExpr(group: ConditionGroup): FilterExprNode {
  const valid = group.conditions.filter(c => c.value.trim())
  if (valid.length === 0) throw new Error('empty group')
  if (valid.length === 1) return buildLeafNode(valid[0])
  // 연속되는 같은 연산자는 flat 노드로
  const ops = valid.slice(0, -1).map(c => c.joinOperator)
  const uniqueOps = new Set(ops)
  if (uniqueOps.size === 1) {
    return { type: ops[0], children: valid.map(buildLeafNode) }
  }
  // 혼재 — 좌결합 binary
  let result: FilterExprNode = buildLeafNode(valid[0])
  for (let i = 1; i < valid.length; i++) {
    result = { type: valid[i - 1].joinOperator, children: [result, buildLeafNode(valid[i])] }
  }
  return result
}

function buildExprNode(tree: FilterTree): FilterExprNode {
  const validGroups = tree.filter(g => g.conditions.some(c => c.value.trim()))
  if (validGroups.length === 0) throw new Error('empty tree')
  if (validGroups.length === 1) return buildGroupExpr(validGroups[0])
  let result: FilterExprNode = buildGroupExpr(validGroups[0])
  for (let i = 1; i < validGroups.length; i++) {
    const op = validGroups[i - 1].joinOperator
    result = { type: op, children: [result, buildGroupExpr(validGroups[i])] }
  }
  return result
}

// ─── 빌드 헬퍼 (외부 임포트용) ────────────────────────────────────────────────

export function buildRequestFromConditions(
  conditions: Condition[],
  deviceIds: number[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    device_ids: deviceIds,
    rule_name: null, rule_name_negate: false,
    vsys: null, vsys_negate: false,
    user: null, user_negate: false,
    application: null, application_negate: false,
    description: null, description_negate: false,
    action: null, action_negate: false,
    enable: null,
    last_hit_date_from: null, last_hit_date_to: null,
    src_ips: [], dst_ips: [], src_ips_exact: [], dst_ips_exact: [], services: [],
    src_names: [], dst_names: [], service_names: [],
    src_ips_exclude: [], dst_ips_exclude: [], src_ips_exact_exclude: [], dst_ips_exact_exclude: [], services_exclude: [],
    src_names_exclude: [], dst_names_exclude: [], service_names_exclude: [],
    src_ips_only_within: [], dst_ips_only_within: [],
  }

  for (const { field, operator, value } of conditions) {
    const v = value?.trim()
    if (!v) continue
    const isNot = operator === 'not_equals' || operator === 'not_contains'
    const isExact = operator === 'equals' || operator === 'not_equals'
    switch (field) {
      case 'rule_name':
        payload.rule_name = v
        payload.rule_name_negate = isNot
        break
      case 'vsys':
        payload.vsys = v
        payload.vsys_negate = isNot
        break
      case 'user':
        payload.user = v
        payload.user_negate = isNot
        break
      case 'application':
        payload.application = v
        payload.application_negate = isNot
        break
      case 'description':
        payload.description = v
        payload.description_negate = isNot
        break
      case 'action':
        payload.action = v
        payload.action_negate = isNot
        break
      case 'enable':
        payload.enable = v === 'true'
        break
      case 'src_ip':
        for (const ip of v.split(',').map(s => s.trim()).filter(Boolean)) {
          if (operator === 'only_within') (payload.src_ips_only_within as string[]).push(ip)
          else if (isExact) (isNot ? (payload.src_ips_exact_exclude as string[]) : (payload.src_ips_exact as string[])).push(ip)
          else              (isNot ? (payload.src_ips_exclude as string[])        : (payload.src_ips as string[])).push(ip)
        }
        break
      case 'dst_ip':
        for (const ip of v.split(',').map(s => s.trim()).filter(Boolean)) {
          if (operator === 'only_within') (payload.dst_ips_only_within as string[]).push(ip)
          else if (isExact) (isNot ? (payload.dst_ips_exact_exclude as string[]) : (payload.dst_ips_exact as string[])).push(ip)
          else              (isNot ? (payload.dst_ips_exclude as string[])        : (payload.dst_ips as string[])).push(ip)
        }
        break
      case 'src_name':
        for (const n of v.split(',').map(s => s.trim()).filter(Boolean)) {
          if (isNot) (payload.src_names_exclude as string[]).push(n)
          else (payload.src_names as string[]).push(n)
        }
        break
      case 'dst_name':
        for (const n of v.split(',').map(s => s.trim()).filter(Boolean)) {
          if (isNot) (payload.dst_names_exclude as string[]).push(n)
          else (payload.dst_names as string[]).push(n)
        }
        break
      case 'service':
        for (const s of v.split(',').map(s => s.trim()).filter(Boolean)) {
          if (isNot) (payload.services_exclude as string[]).push(s)
          else (payload.services as string[]).push(s)
        }
        break
      case 'service_name':
        for (const n of v.split(',').map(s => s.trim()).filter(Boolean)) {
          if (isNot) (payload.service_names_exclude as string[]).push(n)
          else (payload.service_names as string[]).push(n)
        }
        break
      case 'last_hit_from':
        payload.last_hit_date_from = v
        break
      case 'last_hit_to':
        payload.last_hit_date_to = v
        break
    }
  }

  return payload
}

export function buildRequestFromFilterTree(
  tree: FilterTree,
  deviceIds: number[],
): Record<string, unknown> {
  const allConds = tree.flatMap(g => g.conditions)

  // 단순 AND 전용이면 기존 flat payload 사용 (하위 호환)
  const isSimpleAnd =
    tree.length <= 1 &&
    allConds.every(c => c.joinOperator === 'AND')

  if (isSimpleAnd) {
    return buildRequestFromConditions(allConds, deviceIds)
  }

  const validGroups = tree.filter(g => g.conditions.some(c => c.value.trim()))
  if (validGroups.length === 0) {
    return buildRequestFromConditions([], deviceIds)
  }

  let expr: FilterExprNode
  try {
    expr = buildExprNode(validGroups)
  } catch {
    return buildRequestFromConditions([], deviceIds)
  }

  return {
    device_ids: deviceIds,
    filter_expression: expr,
    rule_name: null, rule_name_negate: false,
    vsys: null, vsys_negate: false,
    user: null, user_negate: false,
    application: null, application_negate: false,
    description: null, description_negate: false,
    action: null, action_negate: false,
    enable: null,
    last_hit_date_from: null, last_hit_date_to: null,
    src_ips: [], dst_ips: [], src_ips_exact: [], dst_ips_exact: [], services: [],
    src_names: [], dst_names: [], service_names: [],
    src_ips_exclude: [], dst_ips_exclude: [], src_ips_exact_exclude: [], dst_ips_exact_exclude: [], services_exclude: [],
    src_names_exclude: [], dst_names_exclude: [], service_names_exclude: [],
  }
}
