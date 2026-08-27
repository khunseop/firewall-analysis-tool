import { Unlink } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import type { QuickAnalysisModule } from './types'

export const unreferencedObjectsModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'unreferenced_objects',
  label: '미참조 오브젝트 분석',
  icon: Unlink,
  description: '어떤 정책에도 사용되지 않는 네트워크/서비스 객체를 탐지합니다.',
  buildParams: () => ({}),
  columns: (): ColDef[] => [
    { field: 'object_name', headerName: '객체명', filter: 'agTextColumnFilter', pinned: 'left', width: 200 },
    {
      field: 'object_type', headerName: '객체 유형', filter: 'agTextColumnFilter', width: 150,
      valueFormatter: (p) => {
        const map: Record<string, string> = { network_object: '네트워크 객체', network_group: '네트워크 그룹', service: '서비스 객체', service_group: '서비스 그룹' }
        return map[p.value as string] ?? p.value
      },
    },
  ],
  summary: (r) => {
    const net = r.filter((x) => ['network_object', 'network_group'].includes(String(x['object_type'] ?? ''))).length
    const svc = r.filter((x) => ['service', 'service_group'].includes(String(x['object_type'] ?? ''))).length
    return `미참조 객체 ${r.length}건 (네트워크 ${net}건, 서비스 ${svc}건)`
  },
}
