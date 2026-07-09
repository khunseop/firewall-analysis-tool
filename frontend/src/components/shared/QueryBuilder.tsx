import { Plus, X } from 'lucide-react'
import {
  QB_FIELDS, OP_LABELS, OP_DESCRIPTIONS, generateId, getFieldDef, findInvalidIpTokens,
  type FilterTree, type ConditionWithJoin, type OperatorKey,
} from './queryBuilderModel'

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

  const addExactWithinCondition = (groupIdx: number, condIdx: number) => {
    onTreeChange(tree.map((g, i) => {
      if (i !== groupIdx) return g
      const cond = g.conditions[condIdx]
      const withinCond: ConditionWithJoin = { field: cond.field, operator: 'only_within', value: cond.value, joinOperator: cond.joinOperator }
      const conditions = [...g.conditions]
      conditions[condIdx] = { ...cond, joinOperator: 'AND' }
      conditions.splice(condIdx + 1, 0, withinCond)
      return { ...g, conditions }
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
      id: generateId(),
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
                const isIpField = cond.field === 'src_ip' || cond.field === 'dst_ip'
                const invalidTokens = isIpField ? findInvalidIpTokens(cond.value) : []
                const showExactHint = isIpField && cond.operator === 'equals' && cond.value.trim() !== ''
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
                        title={OP_DESCRIPTIONS[cond.operator]}
                        className="shrink-0 w-24 bg-white border border-ds-outline-variant/25 rounded text-xs px-2 py-1.5 focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary"
                      >
                        {def.operators.map(op => (
                          <option key={op} value={op} title={OP_DESCRIPTIONS[op]}>{OP_LABELS[op]}</option>
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
                            className={`w-full bg-white border rounded text-xs px-2 py-1.5 font-mono focus:outline-none focus:ring-1 ${
                              invalidTokens.length > 0
                                ? 'border-ds-error focus:border-ds-error focus:ring-ds-error'
                                : 'border-ds-outline-variant/25 focus:border-ds-tertiary focus:ring-ds-tertiary'
                            }`}
                          />
                        )}
                        {invalidTokens.length > 0 && (
                          <div className="text-[10px] text-ds-error mt-0.5">
                            IP/CIDR 형식이 올바르지 않습니다: {invalidTokens.join(', ')}
                          </div>
                        )}
                        {invalidTokens.length === 0 && showExactHint && (
                          <div className="text-[10px] text-ds-on-surface-variant mt-0.5">
                            다른 대역이 섞여 있어도 매칭됩니다.{' '}
                            <button
                              onClick={() => addExactWithinCondition(groupIdx, condIdx)}
                              className="text-ds-tertiary hover:underline font-semibold"
                            >
                              정확히 이 대역만 보기
                            </button>
                          </div>
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
