import { Expand } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { formatNumber } from '@/lib/utils'
import { makePolicyCols } from './policyColumns'
import { PolicyMultiSelect } from './PolicyMultiSelect'
import type { QuickAnalysisModule, QuickModuleParamsContext } from './types'

export const overPermissiveModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'over_permissive',
  label: '과허용 정책 분석',
  icon: Expand,
  description: '출발지·목적지·서비스 범위가 과도하게 넓게 설정된 정책을 탐지합니다.',
  renderParams: (ctx: QuickModuleParamsContext) => (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">분석 대상 정책 (미선택 시 전체)</label>
      <PolicyMultiSelect
        deviceId={ctx.deviceId}
        value={(ctx.values.targetPolicyIds as number[] | undefined) ?? []}
        onChange={(ids) => ctx.setValue('targetPolicyIds', ids)}
        placeholder="전체 정책 분석"
      />
    </div>
  ),
  buildParams: (ctx) => {
    const targetPolicyIds = (ctx.values.targetPolicyIds as number[] | undefined) ?? []
    return { targetPolicyIds: targetPolicyIds.length > 0 ? targetPolicyIds : undefined }
  },
  columns: (onRuleNameClick): ColDef[] => [
    { field: 'source_range_size', headerName: '출발지 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
    { field: 'destination_range_size', headerName: '목적지 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
    { field: 'service_range_size', headerName: '서비스 범위', filter: 'agNumberColumnFilter', width: 130, valueFormatter: (p) => formatNumber(p.value) },
    ...makePolicyCols(onRuleNameClick),
  ],
  summary: (r) => `과허용 정책 ${r.length}건`,
}
