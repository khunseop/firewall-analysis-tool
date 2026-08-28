import { FileSearch2 } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import type { QuickAnalysisModule, QuickModuleParamsContext } from './types'

// 컬럼 그룹별 강조색 — 그리드와 Excel 내보내기(cellStyle.color가 그대로 폰트색으로 반영됨) 공통 적용
const FLAG_COLOR = { color: '#005bc4', fontWeight: '600' }          // AD/NG 정책 여부
const START_ELAPSED_COLOR = { color: '#b26b00', fontWeight: '500' } // 시작일/경과일
const USAGE_COLOR = { color: '#1f7a4d', fontWeight: '500' }         // 사용이력

const todayIso = () => new Date().toISOString().slice(0, 10)

export const unusedNgPolicyModule: QuickAnalysisModule = {
  kind: 'quick',
  type: 'unused_ng_policy',
  label: '미사용 NG 정책',
  icon: FileSearch2,
  description: '전체 정책에 신청정보·사용이력(라이브 수집)·AD/NG 정책 여부·경과일을 부가한 검토용 리포트를 생성합니다.',
  renderParams: (ctx: QuickModuleParamsContext) => (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">기준일 (경과일 계산 기준)</label>
      <input
        type="date"
        value={String(ctx.values.referenceDate ?? todayIso())}
        onChange={(e) => ctx.setValue('referenceDate', e.target.value)}
        className="w-40 h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary"
      />
    </div>
  ),
  buildParams: (ctx) => ({ referenceDate: String(ctx.values.referenceDate ?? todayIso()) }),
  columns: (onRuleNameClick): ColDef[] => [
    { field: 'Vsys', headerName: 'VSYS', filter: 'agTextColumnFilter', width: 90 },
    { field: 'Seq', headerName: '순번', filter: 'agNumberColumnFilter', width: 70 },
    {
      field: 'Rule Name', headerName: '정책명', filter: 'agTextColumnFilter', pinned: 'left', width: 180,
      cellRenderer: (p: { value: string }) => {
        if (!p.value) return null
        return (
          <button className="text-ds-primary underline-offset-2 hover:underline text-left w-full truncate" onClick={() => onRuleNameClick(p.value)}>
            {p.value}
          </button>
        )
      },
    },
    { field: 'Enable', headerName: '활성', width: 70 },
    { field: 'Action', headerName: '액션', filter: 'agTextColumnFilter', width: 90 },
    { field: 'AD 정책 여부', headerName: 'AD 정책 여부', filter: 'agTextColumnFilter', width: 120, cellStyle: FLAG_COLOR },
    { field: 'NG 정책 여부', headerName: 'NG 정책 여부', filter: 'agTextColumnFilter', width: 120, cellStyle: FLAG_COLOR },
    { field: 'Source', headerName: '출발지', filter: 'agTextColumnFilter', width: 200 },
    { field: 'User', headerName: '사용자', filter: 'agTextColumnFilter', width: 110 },
    { field: 'Destination', headerName: '목적지', filter: 'agTextColumnFilter', width: 200 },
    { field: 'Service', headerName: '서비스', filter: 'agTextColumnFilter', width: 160 },
    { field: 'Application', headerName: '애플리케이션', filter: 'agTextColumnFilter', width: 130 },
    { field: 'Security Profile', headerName: '보안 프로파일', filter: 'agTextColumnFilter', width: 130 },
    { field: 'Category', headerName: '카테고리', filter: 'agTextColumnFilter', width: 110 },
    { field: 'Description', headerName: '설명', filter: 'agTextColumnFilter', width: 200 },
    { field: 'Request Type', headerName: '신청 유형', filter: 'agTextColumnFilter', width: 110 },
    { field: 'Request ID', headerName: '신청 번호', filter: 'agTextColumnFilter', width: 130 },
    { field: 'Ruleset ID', headerName: 'Ruleset ID', filter: 'agTextColumnFilter', width: 110 },
    { field: 'MIS ID', headerName: 'MIS ID', filter: 'agTextColumnFilter', width: 110 },
    { field: 'Request User', headerName: '신청자', filter: 'agTextColumnFilter', width: 110 },
    { field: 'Start Date', headerName: 'Start Date', filter: 'agTextColumnFilter', width: 110 },
    { field: 'End Date', headerName: 'End Date', filter: 'agTextColumnFilter', width: 110 },
    { field: '시작일', headerName: '시작일', filter: 'agTextColumnFilter', width: 110, cellStyle: START_ELAPSED_COLOR },
    { field: '경과일', headerName: '경과일', filter: 'agNumberColumnFilter', width: 100, cellStyle: START_ELAPSED_COLOR },
    { field: 'Hit Count', headerName: 'Hit Count', filter: 'agTextColumnFilter', width: 110, cellStyle: USAGE_COLOR },
    { field: 'First Hit Date', headerName: 'First Hit Date', filter: 'agTextColumnFilter', width: 130, cellStyle: USAGE_COLOR },
    { field: 'Last Hit Date', headerName: 'Last Hit Date', filter: 'agTextColumnFilter', width: 130, cellStyle: USAGE_COLOR },
    { field: 'Unused Days', headerName: 'Unused Days', filter: 'agTextColumnFilter', width: 110, cellStyle: USAGE_COLOR },
  ],
  summary: (r) => {
    const total = r.length
    const ad = r.filter((x) => x['AD 정책 여부'] === 'Y').length
    const ng = r.filter((x) => x['NG 정책 여부'] === 'Y').length
    const other = r.filter((x) => x['AD 정책 여부'] === 'N' && x['NG 정책 여부'] === 'N').length
    return `전체 ${total}건 · AD 정책 ${ad}건 · NG 정책 ${ng}건 · 그 외 ${other}건`
  },
}
