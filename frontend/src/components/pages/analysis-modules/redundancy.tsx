import { Copy } from 'lucide-react'
import type { ColDef, RowClassParams } from '@ag-grid-community/core'
import { formatNumber } from '@/lib/utils'
import { makePolicyCols } from './policyColumns'
import type { QuickAnalysisModule } from './types'

export const redundancyModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'redundancy',
  label: '중복 정책 분석',
  icon: Copy,
  description: '동일하거나 포함 관계에 있는 정책을 탐지합니다. 상위/하위 정책 쌍으로 결과를 보여줍니다.',
  buildParams: () => ({}),
  columns: (onRuleNameClick): ColDef[] => [
    { field: 'set_number', headerName: '중복번호', filter: 'agNumberColumnFilter', pinned: 'left', width: 100, valueFormatter: (p) => formatNumber(p.value) },
    {
      field: 'type', headerName: '구분', filter: 'agTextColumnFilter', pinned: 'left', width: 100,
      valueFormatter: (p) => p.value === 'UPPER' ? '상위 정책' : p.value === 'LOWER' ? '하위 정책' : p.value ?? '',
      cellStyle: (p) => {
        if (p.value === 'UPPER') return { color: '#005bc4', fontWeight: '500' }
        if (p.value === 'LOWER') return { color: '#b26b00', fontWeight: '500' }
        return null
      },
    },
    ...makePolicyCols(onRuleNameClick),
  ],
  summary: (r) => {
    const sets = new Set(r.map((x) => x['set_number']))
    const upper = r.filter((x) => x['type'] === 'UPPER').length
    const lower = r.filter((x) => x['type'] === 'LOWER').length
    return `${sets.size}개 중복 세트 발견 (상위 ${upper}건 / 하위 ${lower}건)`
  },
  rowStyle: (p: RowClassParams<Record<string, unknown>>) => {
    if (!p.data) return undefined
    if (p.data.type === 'UPPER') return { backgroundColor: '#e8f4fd' }
    if (p.data.type === 'LOWER') return { backgroundColor: '#fff8e1' }
    return undefined
  },
}
