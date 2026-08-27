import { Clock } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { makePolicyCols } from './policyColumns'
import type { QuickAnalysisModule, QuickModuleParamsContext } from './types'

export const unusedModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'unused',
  label: '미사용 정책 분석',
  icon: Clock,
  description: '설정 기간 동안 트래픽이 발생하지 않은 정책을 탐지합니다.',
  renderParams: (ctx: QuickModuleParamsContext) => (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">미사용 기준 (일)</label>
      <input
        type="number" min="1"
        value={String(ctx.values.days ?? '90')}
        onChange={(e) => ctx.setValue('days', e.target.value)}
        className="w-32 h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary"
      />
    </div>
  ),
  buildParams: (ctx) => ({ days: Number(ctx.values.days ?? '90') }),
  columns: (onRuleNameClick): ColDef[] => [
    { field: 'reason', headerName: '미사용 사유', filter: 'agTextColumnFilter', pinned: 'left', width: 150 },
    { field: 'days_unused', headerName: '미사용 일수', filter: 'agNumberColumnFilter', width: 120, valueFormatter: (p) => p.value ? `${p.value}일` : '-' },
    ...makePolicyCols(onRuleNameClick),
  ],
  summary: (r) => `미사용 정책 ${r.length}건`,
}
