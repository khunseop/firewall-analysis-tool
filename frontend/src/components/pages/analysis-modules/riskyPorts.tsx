import { ShieldAlert } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { makePolicyCols } from './policyColumns'
import { PolicyMultiSelect } from './PolicyMultiSelect'
import type { QuickAnalysisModule, QuickModuleParamsContext } from './types'

export const riskyPortsModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'risky_ports',
  label: '위험 포트 분석',
  icon: ShieldAlert,
  description: 'Well-known 위험 포트(예: Telnet, FTP)가 허용된 정책을 탐지합니다.',
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
    {
      headerName: '위험 포트', filter: 'agTextColumnFilter', width: 200,
      cellStyle: { color: '#9f403d', fontWeight: '500' },
      valueGetter: (p) => {
        const ports = p.data?.removed_risky_ports
        if (Array.isArray(ports)) return ports.map((r: Record<string, unknown>) => r.definition ?? String(r)).join(', ')
        return p.data?.risky_port_def ?? ''
      },
    },
    { headerName: '서비스', filter: 'agTextColumnFilter', width: 160, valueGetter: (p) => p.data?.policy?.service ?? '' },
    ...makePolicyCols(onRuleNameClick),
  ],
  summary: (r) => `위험 포트 허용 정책 ${r.length}건`,
}
