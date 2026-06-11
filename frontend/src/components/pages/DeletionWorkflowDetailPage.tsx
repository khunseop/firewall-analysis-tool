import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, Database, Play, Download, Upload, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import {
  getProject,
  runProjectExtract,
  runProjectTask,
  uploadExternalFile,
  downloadTaskFile,
  type DeletionWorkflowProjectDetail,
  type ProjectFileState,
} from '@/api/deletionWorkflow'

// ── 태스크 메타 ──────────────────────────────────────────────────────────────

interface TaskMeta {
  id: number
  name: string
  description: string
  phase: 1 | 2 | 'hitcount'
  externalInputs?: { slot: string; label: string; required: boolean }[]
  autoFromDb?: boolean   // FAT DB에서 자동 생성
}

// 위저드(workflow_wizard.py) 순서 기준
const PHASE1_TASKS: TaskMeta[] = [
  { id: 1,  name: '신청정보파싱',        description: '정책 파일에서 신청정보 파싱', phase: 1 },
  { id: 17, name: '중복정책분석',        description: 'FAT DB 중복분석 결과 자동 사용', phase: 1, autoFromDb: true },
  { id: 19, name: '중복결과 신청정보파싱', description: '중복분석 결과 파일에서 신청정보 파싱', phase: 1 },
  {
    id: 3, name: 'MIS ID 매핑', description: '정책 Excel + MIS CSV → MIS ID 추가', phase: 1,
    externalInputs: [{ slot: 'external_1', label: 'MIS CSV 파일', required: true }],
  },
  { id: 2,  name: '신청번호추출',        description: '고유 신청 ID 추출', phase: 1 },
]

const PHASE2_TASKS: TaskMeta[] = [
  {
    id: 4, name: '신청정보취합 (GSAMS)', description: 'GSAMS 신청정보 취합', phase: 2,
    externalInputs: [{ slot: 'external_1', label: 'GSAMS Excel 파일', required: true }],
  },
  { id: 5,  name: '신청정보매핑',        description: '정책 Excel + GSAMS → 신청정보 매핑', phase: 2 },
  { id: 15, name: '자동연장 날짜 업데이트', description: '자동연장 정책 탐지 및 날짜 업데이트', phase: 2 },
  { id: 6,  name: '예외처리',            description: '정책 예외 분류 (벤더 자동 선택)', phase: 2 },
  { id: 13, name: '사용이력 반영',       description: '예외처리 결과 + 히트카운트 → 사용이력 반영', phase: 2 },
  { id: 8,  name: '하단 최신정책 검증',  description: '동일 신청번호 내 최신 날짜 정책 검증 및 분류', phase: 2 },
  { id: 9,  name: '중복정책 분류',       description: '중복결과(파싱) + 예외처리 → 공지/삭제 분류', phase: 2 },
  { id: 11, name: '중복 만료셋 예외처리', description: '전체 만료 / 차단 영향 중복 세트 예외 분류', phase: 2 },
  { id: 10, name: '중복정책 상태 업데이트', description: '예외처리 + 분류결과 → 중복여부 반영', phase: 2 },
  {
    id: 18, name: '중복 예외 반영',      description: 'YAML 예외 목록 → 정책 파일 반영', phase: 2,
    externalInputs: [{ slot: 'external_1', label: '중복예외 YAML 파일 (선택)', required: false }],
  },
  { id: 14, name: '미사용 상태 업데이트', description: '미사용여부 최종 업데이트', phase: 2 },
  { id: 16, name: '통보대상 분류',       description: '정책 Excel → 유형별 공지파일 생성', phase: 2 },
]

const HITCOUNT_TASK: TaskMeta = {
  id: 12, name: '히트카운트 병합', description: 'HA Secondary 히트카운트 병합 (선택)', phase: 'hitcount',
  externalInputs: [{ slot: 'external_1', label: 'HA Secondary 히트카운트 Excel (선택)', required: false }],
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function getTaskFiles(files: ProjectFileState[], taskId: number) {
  return files.filter((f) => f.task_id === taskId)
}

function hasOutput(files: ProjectFileState[], taskId: number) {
  return files.some((f) => f.task_id === taskId && f.slot.startsWith('output_'))
}

function getExternalFile(files: ProjectFileState[], taskId: number, slot: string) {
  return files.find((f) => f.task_id === taskId && f.slot === slot)
}

// ── 컴포넌트: 파일 업로드 드롭존 ────────────────────────────────────────────

function ExternalFileUpload({
  projectId, taskId, slot, label, required, existingFile, onUploaded,
}: {
  projectId: number
  taskId: number
  slot: string
  label: string
  required: boolean
  existingFile?: ProjectFileState
  onUploaded: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFile = async (file: File) => {
    setUploading(true)
    try {
      await uploadExternalFile(projectId, taskId, slot, file)
      toast.success(`${label} 업로드 완료`)
      onUploaded()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-ds-on-surface-variant">
        {required ? '📎' : '📋'} {label}:
      </span>
      {existingFile ? (
        <span className="text-emerald-600 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" />
          {existingFile.filename}
        </span>
      ) : (
        <span className="text-ds-on-surface-variant/60">{required ? '(필수)' : '(선택)'}</span>
      )}
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1 px-2 py-0.5 rounded border border-ds-outline-variant/50 hover:bg-black/5 disabled:opacity-50"
      >
        {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
        {existingFile ? '교체' : '업로드'}
      </button>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  )
}

// ── 컴포넌트: 태스크 카드 ─────────────────────────────────────────────────────

function TaskCard({
  task,
  projectId,
  files,
  onRefresh,
}: {
  task: TaskMeta
  projectId: number
  files: ProjectFileState[]
  onRefresh: () => void
}) {
  const [running, setRunning] = useState(false)
  const outputs = getTaskFiles(files, task.id).filter((f) => f.slot.startsWith('output_'))
  const done = outputs.length > 0

  const handleRun = async () => {
    setRunning(true)
    try {
      const res = await runProjectTask(projectId, task.id)
      toast.success(`Task ${task.id} 완료 (출력 ${res.outputs.length}개)`)
      onRefresh()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const handleDownload = async (slot: string, filename: string) => {
    try {
      const { blob } = await downloadTaskFile(projectId, task.id, slot)
      triggerDownload(blob, filename)
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${done ? 'border-emerald-200 bg-emerald-50/30' : 'border-ds-outline-variant/30 bg-white'}`}>
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            {done
              ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              : <div className="w-4 h-4 rounded-full border-2 border-ds-outline-variant/50 shrink-0" />
            }
            <span className="text-sm font-medium text-ds-on-surface">
              Task {task.id}: {task.name}
            </span>
            {task.autoFromDb && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-600 font-medium">
                FAT DB 자동
              </span>
            )}
          </div>
          <p className="text-xs text-ds-on-surface-variant mt-0.5 ml-6">{task.description}</p>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="flex items-center gap-1 px-3 py-1 text-xs rounded-lg bg-ds-tertiary/10 text-ds-tertiary hover:bg-ds-tertiary/20 disabled:opacity-50 shrink-0"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {running ? '실행 중...' : '실행'}
        </button>
      </div>

      {/* 외부 파일 입력 */}
      {task.externalInputs && task.externalInputs.length > 0 && (
        <div className="ml-6 space-y-1.5">
          {task.externalInputs.map((inp) => (
            <ExternalFileUpload
              key={inp.slot}
              projectId={projectId}
              taskId={task.id}
              slot={inp.slot}
              label={inp.label}
              required={inp.required}
              existingFile={getExternalFile(files, task.id, inp.slot)}
              onUploaded={onRefresh}
            />
          ))}
        </div>
      )}

      {/* 출력 파일 다운로드 */}
      {outputs.length > 0 && (
        <div className="ml-6 flex flex-wrap gap-2">
          {outputs.map((f) => (
            <button
              key={f.slot}
              onClick={() => handleDownload(f.slot, f.filename)}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
            >
              <Download className="w-3 h-3" />
              {f.filename}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function DeletionWorkflowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const projectId = Number(id)

  const { data: project, isLoading, error } = useQuery<DeletionWorkflowProjectDetail>({
    queryKey: ['deletion-workflow-project', projectId],
    queryFn: () => getProject(projectId),
    staleTime: 5_000,
  })

  const [extracting, setExtracting] = useState(false)

  const handleExtract = async () => {
    setExtracting(true)
    try {
      const res = await runProjectExtract(projectId)
      toast.success(`추출 완료: ${res.filename}`)
      qc.invalidateQueries({ queryKey: ['deletion-workflow-project', projectId] })
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setExtracting(false)
    }
  }

  const refresh = () => qc.invalidateQueries({ queryKey: ['deletion-workflow-project', projectId] })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-ds-on-surface-variant">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        로딩 중...
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-sm text-ds-error">
        <AlertCircle className="w-4 h-4" />
        프로젝트를 불러올 수 없습니다.
      </div>
    )
  }

  const files = project.files ?? []
  const hasTask0 = hasOutput(files, 0)

  const phase1Tasks = PHASE1_TASKS
  const phase2Tasks = PHASE2_TASKS

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-ds-outline-variant/30 shrink-0">
        <button
          onClick={() => navigate('/deletion-workflow')}
          className="flex items-center gap-1 text-sm text-ds-on-surface-variant hover:text-ds-on-surface"
        >
          <ArrowLeft className="w-4 h-4" />
          목록으로
        </button>
        <div className="w-px h-4 bg-ds-outline-variant/30" />
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-ds-on-surface truncate">
            {project.device_name} / {project.name}
          </h1>
          <p className="text-xs text-ds-on-surface-variant mt-0.5">
            {project.device_ip} · {project.device_vendor} ·
            생성 {new Date(project.created_at).toLocaleDateString('ko-KR')}
          </p>
        </div>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-auto px-6 py-5 space-y-6">

        {/* Task 0: 데이터 추출 */}
        <div className="rounded-xl border border-ds-outline-variant/30 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                {hasTask0
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : <Database className="w-4 h-4 text-ds-on-surface-variant" />
                }
                <span className="text-sm font-medium text-ds-on-surface">
                  Task 0: DB 데이터 추출
                </span>
              </div>
              <p className="text-xs text-ds-on-surface-variant mt-0.5 ml-6">
                FAT DB에서 동기화된 정책·객체 데이터를 추출하여 프로젝트에 저장합니다.
              </p>
              {hasTask0 && (
                <p className="text-xs text-emerald-600 mt-1 ml-6">
                  ✓ {files.find((f) => f.task_id === 0 && f.slot === 'output_0')?.filename}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {hasTask0 && (
                <button
                  onClick={async () => {
                    try {
                      const { blob, filename } = await downloadTaskFile(projectId, 0, 'output_0')
                      triggerDownload(blob, filename)
                    } catch (e: unknown) {
                      toast.error((e as Error).message)
                    }
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-ds-outline-variant/50 hover:bg-black/5"
                >
                  <Download className="w-3 h-3" />
                  다운로드
                </button>
              )}
              <button
                onClick={handleExtract}
                disabled={extracting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90 disabled:opacity-50"
              >
                {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                {extracting ? '추출 중...' : hasTask0 ? '재추출' : '추출 실행'}
              </button>
            </div>
          </div>
        </div>

        {/* Phase 1 */}
        <section>
          <h2 className="text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wider mb-3">
            Phase 1 — 신청정보 처리
          </h2>
          <div className="space-y-3">
            {phase1Tasks.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                projectId={projectId}
                files={files}
                onRefresh={refresh}
              />
            ))}
          </div>
        </section>

        {/* GSAMS Checkpoint 배너 */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <span className="font-medium">GSAMS Checkpoint</span>
          <span className="ml-2 text-amber-700">
            — Phase 1 완료 후 신청번호 파일을 타부서에 전달하고, GSAMS Excel 파일을 수령하세요 (Task 4 업로드 필요).
          </span>
        </div>

        {/* 히트카운트 (선택) */}
        <section>
          <h2 className="text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wider mb-3">
            히트카운트 병합 (선택)
          </h2>
          <TaskCard
            task={HITCOUNT_TASK}
            projectId={projectId}
            files={files}
            onRefresh={refresh}
          />
        </section>

        {/* Phase 2 */}
        <section>
          <h2 className="text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wider mb-3">
            Phase 2 — 정책 분류·공지
          </h2>
          <div className="space-y-3">
            {phase2Tasks.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                projectId={projectId}
                files={files}
                onRefresh={refresh}
              />
            ))}
          </div>
        </section>

      </div>
    </div>
  )
}
