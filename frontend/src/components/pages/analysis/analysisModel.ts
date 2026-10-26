import { getQuickModule } from '../analysis-modules'
import type { AnalysisTask, AnalysisTaskListItem } from '@/api/analysis'

/** 목록·상세·진행 줄이 같은 상태 표현을 쓰도록 한 곳에 둔다. 상태는 색만이 아니라 라벨 텍스트와 함께 보인다. */
export type StatusGroup = 'running' | 'success' | 'failure' | 'draft'

export interface StatusMeta { label: string; group: StatusGroup; dot: string; text: string }

export const TASK_STATUS: Record<string, StatusMeta> = {
  pending:     { label: '대기',   group: 'running', dot: 'bg-ds-outline',                 text: 'text-ds-on-surface-variant' },
  in_progress: { label: '진행 중', group: 'running', dot: 'bg-ds-tertiary animate-pulse', text: 'text-ds-tertiary' },
  success:     { label: '완료',   group: 'success', dot: 'bg-emerald-500',                text: 'text-emerald-800' },
  failure:     { label: '실패',   group: 'failure', dot: 'bg-ds-error',                   text: 'text-ds-error' },
}

export const PROJECT_STATUS: Record<string, StatusMeta> = {
  draft:     { label: '초안',   group: 'draft',   dot: 'bg-ds-outline',                 text: 'text-ds-on-surface-variant' },
  running:   { label: '진행 중', group: 'running', dot: 'bg-ds-tertiary animate-pulse', text: 'text-ds-tertiary' },
  completed: { label: '완료',   group: 'success', dot: 'bg-emerald-500',                text: 'text-emerald-800' },
}

export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  running: '진행 중', success: '완료', failure: '실패', draft: '초안',
}

/** 정상(탐지 0건)이 "문제 없음"을 뜻하는 분석 유형. 영향도·미사용 NG 정책 리포트는 0건이어도 "정상"이라 부르지 않는다. */
const FINDING_TYPES = new Set(['redundancy', 'unused', 'unreferenced_objects', 'risky_ports', 'over_permissive'])

const RESULT_NOUN: Record<string, string> = {
  redundancy: '중복 세트', unused: '미사용 정책', unreferenced_objects: '미참조 객체',
  risky_ports: '위험 포트 정책', over_permissive: '과허용 정책', impact: '이동 대상', unused_ng_policy: '정책',
}

type TaskLike = Pick<AnalysisTask, 'task_type' | 'task_status' | 'result_count' | 'error_message'>

export type ResultKind = 'running' | 'failure' | 'zero' | 'count' | 'unknown'

/** 이력의 "결과" 칸 — 조회 실패·작업 실패·정상 0건을 서로 다른 문구로 구분한다. */
export function describeTaskResult(t: TaskLike): { kind: ResultKind; text: string } {
  if (t.task_status === 'pending' || t.task_status === 'in_progress') return { kind: 'running', text: '진행 중' }
  if (t.task_status === 'failure') return { kind: 'failure', text: t.error_message ? `실패: ${t.error_message}` : '실패' }
  const noun = RESULT_NOUN[t.task_type] ?? '결과'
  if (t.result_count == null) return { kind: 'unknown', text: '건수 기록 없음' }
  if (t.result_count === 0) {
    return FINDING_TYPES.has(t.task_type)
      ? { kind: 'zero', text: `정상 완료 · ${noun} 0건` }
      : { kind: 'zero', text: `완료 · ${noun} 0건` }
  }
  // 일부만 수집된 채 성공 처리된 경우(error_message에 경고 기록) 건수 뒤에 함께 표시
  const warn = t.error_message ? ` · ⚠ ${t.error_message}` : ''
  return { kind: 'count', text: `${noun} ${t.result_count.toLocaleString()}건${warn}` }
}

/** 이력의 "기준" 칸 — 저장된 실행 파라미터를 모듈이 정의한 방식으로 요약한다. */
export function describeTaskParams(t: Pick<AnalysisTask, 'task_type' | 'params'>): string {
  const mod = getQuickModule(t.task_type)
  if (!mod?.describeParams) return '기준 없음'
  if (t.params == null) return '기록 없음'
  return mod.describeParams(t.params) ?? '기준 없음'
}

export function formatDuration(startedAt: string | null, completedAt: string | null, now = Date.now()): string | null {
  if (!startedAt) return null
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : now
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  const sec = Math.max(0, Math.round((end - start) / 1000))
  if (sec < 1) return '1초 미만'
  if (sec < 60) return `${sec}초`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}분 ${sec % 60}초`
  return `${Math.floor(min / 60)}시간 ${min % 60}분`
}

export const isActiveTask = (t: Pick<AnalysisTaskListItem, 'task_status'>) =>
  t.task_status === 'pending' || t.task_status === 'in_progress'

export function statusMetaOf(status: string, kind: 'quick' | 'project'): StatusMeta {
  const meta = (kind === 'quick' ? TASK_STATUS : PROJECT_STATUS)[status]
  return meta ?? { label: status, group: 'draft', dot: 'bg-ds-outline', text: 'text-ds-on-surface-variant' }
}
