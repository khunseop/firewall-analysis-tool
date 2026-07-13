import type { ProjectFileState } from '@/api/deletionWorkflow'

export interface TaskMeta {
  step: number
  id: number
  name: string
  description: string
  externalInputs?: { slot: string; label: string; required: boolean }[]
  autoFromDb?: boolean
}

export const PHASE1_TASKS: TaskMeta[] = [
  { step: 1, id: 2,  name: '신청정보 파싱',       description: 'DB 추출 파일에서 신청정보 파싱' },
  { step: 2, id: 3,  name: '중복정책 분석',       description: 'FAT DB 중복분석 결과를 Excel로 자동 생성', autoFromDb: true },
  { step: 3, id: 4,  name: '중복결과 파싱',       description: '중복분석 결과 파일에서 신청정보 파싱' },
  { step: 4, id: 5,  name: 'MIS ID 매핑',        description: '정책 파일 + MIS CSV → MIS ID 추가 (선택)',
    externalInputs: [{ slot: 'external_1', label: 'MIS CSV 파일 (선택)', required: false }] },
  { step: 5, id: 6,  name: '신청번호 추출',       description: '고유 신청 ID 추출' },
]

export const PHASE2_TASKS: TaskMeta[] = [
  { step: 1, id: 7,  name: '신청정보 가공 (GSAMS)',   description: 'GSAMS 신청정보 취합',
    externalInputs: [{ slot: 'external_1', label: 'GSAMS Excel 파일', required: true }] },
  { step: 2, id: 8,  name: '신청정보 매핑',           description: '정책 파일 + GSAMS → 신청정보 매핑' },
  { step: 3, id: 9,  name: '자동연장 날짜 업데이트',  description: '자동연장 정책 탐지 및 날짜 업데이트' },
  { step: 4, id: 10, name: '예외처리 (벤더별)',       description: '정책 예외 분류 — 벤더에 따라 PaloAlto(10) 또는 SECUI(11) 자동 선택' },
  { step: 5, id: 12, name: '사용이력 반영',           description: '예외처리 결과 + 히트카운트 → 사용이력 반영',
    externalInputs: [{ slot: 'external_1', label: '사용이력 파일 (선택)', required: false }] },
  { step: 6, id: 13, name: '하단 최신정책 검증',     description: '동일 신청번호 내 최신 날짜 정책 위치 검증 및 분류' },
  { step: 7, id: 14, name: '중복정책 분류',           description: '중복결과(파싱) + 예외처리 결과 → 공지/삭제 분류' },
  { step: 8, id: 15, name: '중복 만료셋 예외처리',   description: '전체 만료 / 차단 영향 중복 세트 예외 분류' },
  { step: 9, id: 16, name: '중복정책 상태 업데이트', description: '예외처리 결과 + 분류결과 → 중복여부 반영' },
  { step: 10, id: 17, name: '중복 예외 반영',        description: 'Settings의 중복정책 예외 목록 → 정책 파일 반영' },
  { step: 11, id: 18, name: '통보대상 분류',          description: '정책 Excel → 통보대상 컬럼 추가(최종본)' },
]

export const PHASE3_TASKS: TaskMeta[] = [
  { step: 1, id: 19, name: '자동연장예외파일 생성', description: '장기미사용/중복삭제/중복공지 결과 + GSAMS Conv → 자동연장예외 신청번호 추출' },
]

// Phase 1 + Phase 2 + Phase 3 실행 순서 (Task 0, 1은 별도)
export const EXECUTION_ORDER = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19]
export const ALL_TASK_META = [...PHASE1_TASKS, ...PHASE2_TASKS, ...PHASE3_TASKS]

// ── 유틸 ─────────────────────────────────────────────────────────────────────

export { saveBlob as triggerDownload } from '@/api/client'

export function getOutputFiles(files: ProjectFileState[], taskId: number) {
  return files.filter((f) => f.task_id === taskId && f.slot.startsWith('output_'))
}

export function hasOutput(files: ProjectFileState[], taskId: number) {
  return files.some((f) => f.task_id === taskId && f.slot.startsWith('output_'))
}

export function getExternalFile(files: ProjectFileState[], taskId: number, slot: string) {
  return files.find((f) => f.task_id === taskId && f.slot === slot)
}

export function getDownstreamTaskIds(fromTaskId: number): number[] {
  const idx = EXECUTION_ORDER.indexOf(fromTaskId)
  if (idx === -1) return []
  return EXECUTION_ORDER.slice(idx + 1)
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}분 ${Math.floor((ms % 60000) / 1000)}s`
}

// ── 컴포넌트: 외부 파일 업로드 ───────────────────────────────────────────────
