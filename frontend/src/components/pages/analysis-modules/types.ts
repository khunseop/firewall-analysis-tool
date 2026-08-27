import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ColDef, RowStyle, RowClassParams } from '@ag-grid-community/core'
import type { StartAnalysisParams } from '@/api/analysis'

/** "새 분석 실행" 다이얼로그의 파라미터 폼이 공유하는 상태 컨텍스트. */
export interface QuickModuleParamsContext {
  deviceId: number | null
  values: Record<string, unknown>
  setValue: (key: string, value: unknown) => void
}

/** 장비+파라미터 선택 → 실행 → 그리드 결과 하나를 보는 단발성 분석 모듈. */
export interface QuickAnalysisModule {
  kind: 'quick'
  type: string
  label: string
  icon: LucideIcon
  description: string
  /** 기본 파라미터(장비 선택) 외 이 모듈만의 추가 입력 UI. 없으면 생략. */
  renderParams?: (ctx: QuickModuleParamsContext) => ReactNode
  /** ctx.values로부터 실제 API 호출 파라미터를 구성. */
  buildParams: (ctx: QuickModuleParamsContext) => StartAnalysisParams
  /** 실행 전 검증. 에러 메시지 문자열을 반환하면 실행이 막히고 토스트로 표시된다. */
  validate?: (ctx: QuickModuleParamsContext) => string | null
  columns: (
    onRuleNameClick: (ruleName: string) => void,
    onPreviewClick: (row: Record<string, unknown>) => void,
  ) => ColDef[]
  summary: (results: Record<string, unknown>[]) => string
  rowStyle?: (p: RowClassParams<Record<string, unknown>>) => RowStyle | undefined
  downloadScript?: (
    results: Record<string, unknown>[],
    device: { name: string; vendor: string },
  ) => { filename: string; content: string } | null
}

/** 프로젝트 생성 → 여러 단계 순차 실행(위저드) → 완료의 프로젝트형 분석 모듈. */
export interface ProjectAnalysisModule {
  kind: 'project'
  type: string  // module_type 값 (analysis_projects.module_type과 일치)
  label: string
  icon: LucideIcon
  description: string
}

export type AnalysisModule = QuickAnalysisModule | ProjectAnalysisModule
