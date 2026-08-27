import { ArrowLeftRight } from 'lucide-react'
import type { ColDef, RowClassParams } from '@ag-grid-community/core'
import { Checkbox } from '@/components/ui/checkbox'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PolicyGridPicker } from '@/components/shared/PolicyGridPicker'
import { makePolicyCols } from './policyColumns'
import type { QuickAnalysisModule, QuickModuleParamsContext } from './types'

const MOVE_FEASIBILITY_LABELS: Record<string, { label: string; style: { color: string; fontWeight: string } }> = {
  full:    { label: '가능',    style: { color: '#1f7a4d', fontWeight: '600' } },
  partial: { label: '부분 가능', style: { color: '#b26b00', fontWeight: '600' } },
  blocked: { label: '불가',    style: { color: '#9f403d', fontWeight: '600' } },
}

export const impactModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'impact',
  label: '정책 이동 영향 분석',
  icon: ArrowLeftRight,
  description: '정책을 다른 순번으로 이동했을 때 차단·섀도우 영향을 사전 분석합니다.',
  renderParams: (ctx: QuickModuleParamsContext) => {
    const targetPolicyIds = (ctx.values.targetPolicyIds as number[] | undefined) ?? []
    const referencePolicyId = (ctx.values.referencePolicyId as number | null | undefined) ?? null
    const moveToEnd = Boolean(ctx.values.moveToEnd)
    const moveDirection = (ctx.values.moveDirection as string | undefined) ?? 'below'
    return (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">이동할 정책 *</label>
          <PolicyGridPicker
            mode="multi" deviceId={ctx.deviceId} value={targetPolicyIds}
            onChange={(ids) => ctx.setValue('targetPolicyIds', ids)}
            placeholder="이동할 정책을 선택하세요…"
          />
        </div>
        <div className="space-y-3 max-w-md">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">기준 정책 *</label>
            <PolicyGridPicker
              mode="single" deviceId={moveToEnd ? null : ctx.deviceId} value={referencePolicyId}
              onChange={(id) => ctx.setValue('referencePolicyId', id)}
              placeholder="기준 정책을 선택하세요…"
            />
            <label className="flex items-center gap-2 text-[12px] text-ds-on-surface-variant cursor-pointer pt-0.5">
              <Checkbox checked={moveToEnd} onCheckedChange={(v) => ctx.setValue('moveToEnd', !!v)} />
              맨 아래로 이동
            </label>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">이동 방향</label>
            <ShadSelect value={moveDirection} onValueChange={(v) => ctx.setValue('moveDirection', v)} disabled={moveToEnd}>
              <SelectTrigger className="bg-ds-surface-container-low border-ds-outline-variant/30 text-sm">
                <SelectValue placeholder="이동 방향 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="above">기준 정책 위로</SelectItem>
                <SelectItem value="below">기준 정책 아래로</SelectItem>
              </SelectContent>
            </ShadSelect>
          </div>
        </div>
      </div>
    )
  },
  validate: (ctx) => {
    const targetPolicyIds = (ctx.values.targetPolicyIds as number[] | undefined) ?? []
    const referencePolicyId = ctx.values.referencePolicyId as number | null | undefined
    const moveToEnd = Boolean(ctx.values.moveToEnd)
    if (targetPolicyIds.length === 0) return '이동할 정책을 선택하세요.'
    if (!moveToEnd && !referencePolicyId) return '기준 정책을 선택하거나 "맨 아래로 이동"을 선택하세요.'
    return null
  },
  buildParams: (ctx) => {
    const targetPolicyIds = (ctx.values.targetPolicyIds as number[] | undefined) ?? []
    const referencePolicyId = ctx.values.referencePolicyId as number | null | undefined
    const moveToEnd = Boolean(ctx.values.moveToEnd)
    const moveDirection = (ctx.values.moveDirection as string | undefined) ?? 'below'
    return {
      targetPolicyIds,
      referencePolicyId: !moveToEnd && referencePolicyId ? referencePolicyId : undefined,
      moveDirection,
    }
  },
  columns: (onRuleNameClick, onPreviewClick): ColDef[] => [
    {
      field: 'impact_type', headerName: '영향 유형', filter: 'agTextColumnFilter', pinned: 'left', width: 150,
      cellStyle: (p) => {
        const v = String(p.value ?? '')
        if (v.includes('최대 안전')) return { color: '#1f7a4d', fontWeight: '600' }
        if (v.includes('차단')) return { color: '#9f403d', fontWeight: '500' }
        if (v.includes('Shadow')) return { color: '#b26b00', fontWeight: '500' }
        return null
      },
    },
    {
      field: 'move_feasibility', headerName: '이동 가능 여부', filter: 'agTextColumnFilter', pinned: 'left', width: 120,
      valueFormatter: (p) => MOVE_FEASIBILITY_LABELS[p.value as string]?.label ?? '',
      cellStyle: (p) => MOVE_FEASIBILITY_LABELS[p.value as string]?.style ?? null,
    },
    {
      headerName: '순서 미리보기', width: 110, pinned: 'left',
      cellRenderer: (p: { data?: Record<string, unknown> }) => {
        if (p.data?.impact_type !== '최대 안전 이동 위치') return null
        return (
          <button className="text-ds-primary underline-offset-2 hover:underline text-[12px]" onClick={() => onPreviewClick(p.data!)}>
            순서 보기
          </button>
        )
      },
    },
    { field: 'reason', headerName: '사유 / 이동 요약', filter: 'agTextColumnFilter', width: 420, wrapText: true, autoHeight: true, cellStyle: { lineHeight: '1.5', paddingTop: '6px', paddingBottom: '6px', whiteSpace: 'normal' } },
    ...makePolicyCols(onRuleNameClick),
  ],
  summary: (r) => {
    const summaryRows = r.filter((x) => x['impact_type'] === '최대 안전 이동 위치')
    const full = summaryRows.filter((x) => x['move_feasibility'] === 'full').length
    const partial = summaryRows.filter((x) => x['move_feasibility'] === 'partial').length
    const blocked = summaryRows.filter((x) => x['move_feasibility'] === 'blocked').length
    return `이동 대상 ${summaryRows.length}건 (완전 가능 ${full} / 부분 가능 ${partial} / 불가 ${blocked})`
  },
  rowStyle: (p: RowClassParams<Record<string, unknown>>) => {
    if (!p.data) return undefined
    if (String(p.data.impact_type ?? '').includes('최대 안전')) return { backgroundColor: '#eaf6ee' }
    return undefined
  },
  downloadScript: (results, device) => {
    if (device.vendor !== 'paloalto') return null
    const rows = results.filter((r) => r['impact_type'] === '최대 안전 이동 위치')
    const groupedByVsys = new Map<string, Record<string, unknown>[]>()
    for (const row of rows) {
      const vsys = String((row['policy'] as Record<string, unknown> | undefined)?.['vsys'] ?? '')
      const list = groupedByVsys.get(vsys) ?? []
      list.push(row)
      groupedByVsys.set(vsys, list)
    }
    const lines: string[] = [
      `# ${device.name} 정책이동 실행 계획 (자동 생성 — 참고용)`,
      '# 분석 시점 스냅샷 기준입니다. 실제 룰베이스와 다를 수 있으니 반드시 검토 후 사용하세요.',
      '# commit은 주석 처리되어 있습니다 — 변경 확인 후 직접 주석을 해제해 실행하세요.',
      '',
      'configure',
    ]
    for (const [vsys, vsysRows] of groupedByVsys) {
      if (vsys) lines.push('', `edit vsys "${vsys}"`)
      for (const row of vsysRows) {
        const ruleName = String((row['policy'] as Record<string, unknown> | undefined)?.['rule_name'] ?? '')
        const feasibility = row['move_feasibility']
        if (feasibility === 'blocked') {
          lines.push(`# '${ruleName}' 이동 불가: ${String(row['reason'] ?? '')}`)
          continue
        }
        if (feasibility === 'full') {
          const referenceName = row['reference_policy_name'] as string | null
          if (!referenceName) {
            lines.push(`move rulebase security rules "${ruleName}" bottom`)
          } else {
            const position = row['requested_move_direction'] === 'above' ? 'before' : 'after'
            lines.push(`move rulebase security rules "${ruleName}" ${position} "${referenceName}"`)
          }
        } else if (feasibility === 'partial') {
          const anchorName = row['blocking_conflict_policy_name'] as string | null
          const position = row['move_direction'] === '아래로' ? 'before' : 'after'
          lines.push(`# 요청한 위치까지는 이동 불가 — 아래는 최대로 안전하게 이동 가능한 위치입니다.`)
          lines.push(`move rulebase security rules "${ruleName}" ${position} "${anchorName}"`)
        }
      }
      if (vsys) lines.push('exit')
    }
    lines.push('', '# commit', 'exit')
    return { filename: `이동계획_${device.name}.txt`, content: lines.join('\n') }
  },
}
