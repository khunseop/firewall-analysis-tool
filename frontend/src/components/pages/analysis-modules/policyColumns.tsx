import React from 'react'
import type { ColDef } from '@ag-grid-community/core'

// 모든 분석 엔진이 정책 데이터를 "policy" 키 아래에 감싸서 반환하므로,
// 중첩된 policy 서브객체에서 필드를 읽는 공용 valueGetter.
export const pv = (key: string) => (p: { data?: Record<string, unknown> }) =>
  (p.data?.policy as Record<string, unknown> | undefined)?.[key] ?? p.data?.[key]

export function makePolicyCols(onRuleNameClick?: (name: string) => void): ColDef[] {
  return [
    { headerName: '순번',        filter: 'agNumberColumnFilter', width: 70,  valueGetter: pv('seq') },
    {
      headerName: '정책명', filter: 'agTextColumnFilter', width: 160, valueGetter: pv('rule_name'),
      ...(onRuleNameClick && {
        cellRenderer: (p: { value: string }) => {
          if (!p.value) return null
          return (
            <button className="text-ds-primary underline-offset-2 hover:underline text-left w-full truncate" onClick={() => onRuleNameClick(p.value)}>
              {p.value}
            </button>
          )
        },
      }),
    },
    { headerName: '액션',        filter: 'agTextColumnFilter',   width: 80,  valueGetter: pv('action') },
    { headerName: '활성',        width: 70,  valueGetter: pv('enable'), valueFormatter: (p) => (p.value ? '활성' : '비활성') },
    { headerName: '출발지',      filter: 'agTextColumnFilter',   width: 200, valueGetter: pv('source') },
    { headerName: '목적지',      filter: 'agTextColumnFilter',   width: 200, valueGetter: pv('destination') },
    { headerName: '서비스',      filter: 'agTextColumnFilter',   width: 160, valueGetter: pv('service') },
    { headerName: '사용자',      filter: 'agTextColumnFilter',   width: 100, valueGetter: pv('user') },
    { headerName: '보안 프로파일', filter: 'agTextColumnFilter', width: 130, valueGetter: pv('security_profile') },
    { headerName: '카테고리',    filter: 'agTextColumnFilter',   width: 100, valueGetter: pv('category') },
    { headerName: '설명',        filter: 'agTextColumnFilter',   width: 150, valueGetter: pv('description') },
    { headerName: '마지막 사용일', filter: 'agTextColumnFilter', width: 130, valueGetter: pv('last_hit_date') },
    { headerName: 'VSYS',        filter: 'agTextColumnFilter',   width: 80,  valueGetter: pv('vsys') },
  ]
}
