import { Plus, X } from 'lucide-react'
import type { FilterExprNode, FilterLeafNode } from '@/api/firewall'

// ─── 필드 정의 ────────────────────────────────────────────────────────────────

type FieldType = 'text' | 'date' | 'select'
type OperatorKey = 'contains' | 'equals' | 'not_equals' | 'not_contains' | 'gte' | 'lte'

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
  { key: 'rule_name',     label: '정책명',          type: 'text',   operators: ['contains', 'not_contains', 'equals', 'not_equals'], placeholder: 'web-policy' },
  { key: 'vsys',          label: '가상시스템',       type: 'text',   operators: ['contains', 'equals'], placeholder: 'vsys1' },
  { key: 'src_ip',        label: '출발지 IP',        type: 'text',   operators: ['equals', 'not_equals', 'contains', 'not_contains'], placeholder: '10.0.0.0/8' },
  { key: 'dst_ip',        label: '목적지 IP',        type: 'text',   operators: ['equals', 'not_equals', 'contains', 'not_contains'], placeholder: '0.0.0.0/0' },
  { key: 'src_name',      label: '출발지 객체명',    type: 'text',   operators: ['contains', 'not_contains', 'equals', 'not_equals'], placeholder: 'host-10.0.0.1' },
  { key: 'dst_name',      label: '목적지 객체명',    type: 'text',   operators: ['contains', 'not_contains', 'equals', 'not_equals'], placeholder: 'server-group' },
  { key: 'service',       label: '서비스/포트',      type: 'text',   operators: ['equals', 'not_equals'], placeholder: 'tcp/443 또는 http' },
  { key: 'service_name',  label: '서비스 객체명',    type: 'text',   operators: ['contains', 'not_contains', 'equals', 'not_equals'], placeholder: 'svc-https' },
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

function getFieldDef(key: string): FieldDef {
  return QB_FIELDS.find(f => f.key === key) ?? QB_FIELDS[0]
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

export function conditionsToFilterTree(conditions: Condition[]): FilterTree {
  if (conditions.length === 0) return []
  return [{
    id: crypto.randomUUID(),
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
        if (isExact) (isNot ? (payload.src_ips_exact_exclude as string[]) : (payload.src_ips_exact as string[])).push(v)
        else         (isNot ? (payload.src_ips_exclude as string[])        : (payload.src_ips as string[])).push(v)
        break
      case 'dst_ip':
        if (isExact) (isNot ? (payload.dst_ips_exact_exclude as string[]) : (payload.dst_ips_exact as string[])).push(v)
        else         (isNot ? (payload.dst_ips_exclude as string[])        : (payload.dst_ips as string[])).push(v)
        break
      case 'src_name':
        if (isNot) (payload.src_names_exclude as string[]).push(v)
        else (payload.src_names as string[]).push(v)
        break
      case 'dst_name':
        if (isNot) (payload.dst_names_exclude as string[]).push(v)
        else (payload.dst_names as string[]).push(v)
        break
      case 'service':
        if (isNot) (payload.services_exclude as string[]).push(v)
        else (payload.services as string[]).push(v)
        break
      case 'service_name':
        if (isNot) (payload.service_names_exclude as string[]).push(v)
        else (payload.service_names as string[]).push(v)
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

// ─── 조인 토글 버튼 ───────────────────────────────────────────────────────────

function JoinToggle({ value, onToggle }: { value: 'AND' | 'OR'; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${
        value === 'OR'
          ? 'bg-ds-tertiary/10 text-ds-tertiary border-ds-tertiary/30 hover:bg-ds-tertiary/20'
          : 'bg-ds-surface-container text-ds-on-surface-variant border-ds-outline-variant/20 hover:border-ds-tertiary/30 hover:text-ds-tertiary'
      }`}
    >
      {value}
    </button>
  )
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

interface QueryBuilderProps {
  tree: FilterTree
  onTreeChange: (tree: FilterTree) => void
}

export function QueryBuilder({ tree, onTreeChange }: QueryBuilderProps) {
  const addCondition = (groupIdx: number) => {
    const def = QB_FIELDS[0]
    onTreeChange(tree.map((g, i) => i !== groupIdx ? g : {
      ...g,
      conditions: [...g.conditions, { field: def.key, operator: def.operators[0], value: '', joinOperator: 'AND' }],
    }))
  }

  const removeCondition = (groupIdx: number, condIdx: number) => {
    const group = tree[groupIdx]
    const newConds = group.conditions.filter((_, i) => i !== condIdx)
    if (newConds.length === 0) {
      onTreeChange(tree.filter((_, i) => i !== groupIdx))
      return
    }
    onTreeChange(tree.map((g, i) => i !== groupIdx ? g : { ...g, conditions: newConds }))
  }

  const updateCondition = (groupIdx: number, condIdx: number, patch: Partial<ConditionWithJoin>) => {
    onTreeChange(tree.map((g, i) => i !== groupIdx ? g : {
      ...g,
      conditions: g.conditions.map((c, j) => {
        if (j !== condIdx) return c
        const next = { ...c, ...patch }
        if (patch.field && patch.field !== c.field) {
          const def = getFieldDef(patch.field)
          next.operator = def.operators[0]
          next.value = def.type === 'select' ? def.options![0].value : ''
        }
        return next
      }),
    }))
  }

  const toggleCondJoin = (groupIdx: number, condIdx: number) => {
    const cond = tree[groupIdx].conditions[condIdx]
    updateCondition(groupIdx, condIdx, { joinOperator: cond.joinOperator === 'AND' ? 'OR' : 'AND' })
  }

  const toggleGroupJoin = (groupIdx: number) => {
    onTreeChange(tree.map((g, i) => i !== groupIdx ? g : { ...g, joinOperator: g.joinOperator === 'AND' ? 'OR' : 'AND' }))
  }

  const addGroup = () => {
    const def = QB_FIELDS[0]
    onTreeChange([...tree, {
      id: crypto.randomUUID(),
      joinOperator: 'AND',
      conditions: [{ field: def.key, operator: def.operators[0], value: '', joinOperator: 'AND' }],
    }])
  }

  const removeGroup = (groupIdx: number) => {
    onTreeChange(tree.filter((_, i) => i !== groupIdx))
  }

  const multiGroup = tree.length > 1

  return (
    <div className="space-y-1">
      {tree.map((group, groupIdx) => {
        const multiCond = group.conditions.length > 1
        return (
          <div key={group.id}>
            {/* 그룹 간 연결자 (첫 그룹 제외) */}
            {groupIdx > 0 && (
              <div className="flex items-center gap-2 my-1 pl-2">
                <div className="w-3 h-px bg-ds-outline-variant/30" />
                <JoinToggle value={tree[groupIdx - 1].joinOperator} onToggle={() => toggleGroupJoin(groupIdx - 1)} />
                <div className="flex-1 h-px bg-ds-outline-variant/30" />
              </div>
            )}

            {/* 그룹 컨테이너 */}
            <div className={`space-y-1.5 ${multiGroup ? 'pl-3 border-l-2 border-ds-tertiary/20' : ''}`}>
              {group.conditions.map((cond, condIdx) => {
                const def = getFieldDef(cond.field)
                return (
                  <div key={condIdx}>
                    {/* 조건 행 */}
                    <div className="flex items-center gap-2">
                      <select
                        value={cond.field}
                        onChange={e => updateCondition(groupIdx, condIdx, { field: e.target.value })}
                        className="shrink-0 bg-white border border-ds-outline-variant/25 rounded text-xs px-2 py-1.5 focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary"
                      >
                        {QB_FIELDS.map(f => (
                          <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                      </select>

                      <select
                        value={cond.operator}
                        onChange={e => updateCondition(groupIdx, condIdx, { operator: e.target.value as OperatorKey })}
                        className="shrink-0 w-24 bg-white border border-ds-outline-variant/25 rounded text-xs px-2 py-1.5 focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary"
                      >
                        {def.operators.map(op => (
                          <option key={op} value={op}>{OP_LABELS[op]}</option>
                        ))}
                      </select>

                      <div className="flex-1">
                        {def.type === 'select' ? (
                          <select
                            value={cond.value}
                            onChange={e => updateCondition(groupIdx, condIdx, { value: e.target.value })}
                            className="w-full bg-white border border-ds-outline-variant/25 rounded text-xs px-2 py-1.5 focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary"
                          >
                            {def.options!.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={def.type === 'date' ? 'date' : 'text'}
                            value={cond.value}
                            onChange={e => updateCondition(groupIdx, condIdx, { value: e.target.value })}
                            placeholder={def.placeholder ?? '값 입력'}
                            className="w-full bg-white border border-ds-outline-variant/25 rounded text-xs px-2 py-1.5 font-mono focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary"
                          />
                        )}
                      </div>

                      <button
                        onClick={() => removeCondition(groupIdx, condIdx)}
                        className="shrink-0 p-1.5 rounded hover:bg-ds-error/10 text-ds-on-surface-variant hover:text-ds-error transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* 조건 간 연결자 (마지막 조건 제외) */}
                    {multiCond && condIdx < group.conditions.length - 1 && (
                      <div className="flex items-center gap-2 my-0.5 ml-1">
                        <JoinToggle value={cond.joinOperator} onToggle={() => toggleCondJoin(groupIdx, condIdx)} />
                      </div>
                    )}
                  </div>
                )
              })}

              {/* 그룹 하단: 조건 추가 + 그룹 삭제 */}
              <div className="flex items-center gap-3 mt-0.5">
                <button
                  onClick={() => addCondition(groupIdx)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-ds-tertiary hover:text-ds-tertiary/80 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  조건 추가
                </button>
                {multiGroup && (
                  <button
                    onClick={() => removeGroup(groupIdx)}
                    className="flex items-center gap-1 text-[11px] text-ds-on-surface-variant hover:text-ds-error transition-colors"
                  >
                    <X className="w-3 h-3" />
                    그룹 삭제
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {/* 전체 하단: 그룹 추가 */}
      <div className="flex items-center gap-4 pt-1">
        {tree.length === 0 && (
          <button
            onClick={addGroup}
            className="flex items-center gap-1.5 text-xs font-semibold text-ds-tertiary hover:text-ds-tertiary/80 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            조건 추가
          </button>
        )}
        <button
          onClick={addGroup}
          className="flex items-center gap-1.5 text-xs font-semibold text-ds-on-surface-variant hover:text-ds-tertiary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          그룹 추가
        </button>
      </div>
    </div>
  )
}
