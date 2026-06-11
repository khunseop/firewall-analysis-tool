import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
// workflow_wizard.py PHASE1_STEPS / PHASE2_STEPS 실행 순서 기준
// step: 사용자에게 보이는 순번 (1부터 시작)
// id:   fpat 내부 task ID (파일 체이닝에 사용)

interface TaskMeta {
  step: number   // 표시용 순번
  id: number     // fpat task ID
  name: string
  description: string
  externalInputs?: { slot: string; label: string; required: boolean }[]
  autoFromDb?: boolean
}

// Phase 1 실행 순서: 2 → 3 → 4 → 5 → 6
const PHASE1_TASKS: TaskMeta[] = [
  { step: 1, id: 2,  name: '신청정보 파싱',       description: 'DB 추출 파일에서 신청정보 파싱' },
  { step: 2, id: 3,  name: '중복정책 분석',       description: 'FAT DB 중복분석 결과를 Excel로 자동 생성', autoFromDb: true },
  { step: 3, id: 4,  name: '중복결과 파싱',       description: '중복분석 결과 파일에서 신청정보 파싱' },
  { step: 4, id: 5,  name: 'MIS ID 매핑',        description: '정책 파일 + MIS CSV → MIS ID 추가',
    externalInputs: [{ slot: 'external_1', label: 'MIS CSV 파일', required: true }] },
  { step: 5, id: 6,  name: '신청번호 추출',       description: '고유 신청 ID 추출' },
]

// Phase 2 실행 순서: 7 → 8 → 9 → 10/11 → 12 → 13 → 14 → 15 → 16 → 17 → 18
const PHASE2_TASKS: TaskMeta[] = [
  { step: 1, id: 7,  name: '신청정보 가공 (GSAMS)',   description: 'GSAMS 신청정보 취합',
    externalInputs: [{ slot: 'external_1', label: 'GSAMS Excel 파일', required: true }] },
  { step: 2, id: 8,  name: '신청정보 매핑',           description: '정책 파일 + GSAMS → 신청정보 매핑' },
  { step: 3, id: 9,  name: '자동연장 날짜 업데이트',  description: '자동연장 정책 탐지 및 날짜 업데이트' },
  { step: 4, id: 10, name: '예외처리 (벤더별)',       description: '정책 예외 분류 — 벤더에 따라 PaloAlto(10) 또는 SECUI(11) 자동 선택' },
  { step: 5, id: 12, name: '사용이력 반영',           description: '예외처리 결과 + 히트카운트 → 사용이력 반영' },
  { step: 6, id: 13, name: '하단 최신정책 검증',     description: '동일 신청번호 내 최신 날짜 정책 위치 검증 및 분류' },
  { step: 7, id: 14, name: '중복정책 분류',           description: '중복결과(파싱) + 예외처리 결과 → 공지/삭제 분류' },
  { step: 8, id: 15, name: '중복 만료셋 예외처리',   description: '전체 만료 / 차단 영향 중복 세트 예외 분류' },
  { step: 9, id: 16, name: '중복정책 상태 업데이트', description: '예외처리 결과 + 분류결과 → 중복여부 반영' },
  { step: 10, id: 17, name: '중복 예외 반영',        description: 'YAML 예외 목록 → 정책 파일 반영',
    externalInputs: [{ slot: 'external_1', label: '중복예외 YAML 파일 (선택)', required: false }] },
  { step: 11, id: 18, name: '통보대상 분류',          description: '정책 Excel → 유형별 공지파일 생성' },
]

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function getOutputFiles(files: ProjectFileState[], taskId: number) {
  return files.filter((f) => f.task_id === taskId && f.slot.startsWith('output_'))
}

function hasOutput(files: ProjectFileState[], taskId: number) {
  return files.some((f) => f.task_id === taskId && f.slot.startsWith('output_'))
}

function getExternalFile(files: ProjectFileState[], taskId: number, slot: string) {
  return files.find((f) => f.task_id === taskId && f.slot === slot)
}

// ── 컴포넌트: 외부 파일 업로드 ───────────────────────────────────────────────

function ExternalFileUpload({
  projectId, taskId, slot, label, required, existingFile, onUploaded,
}: {
  projectId: number; taskId: number; slot: string; label: string
  required: boolean; existingFile?: ProjectFileState; onUploaded: () => void
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
      <span className="text-ds-on-surface-variant">{required ? '📎' : '📋'} {label}:</span>
      {existingFile ? (
        <span className="text-emerald-600 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> {existingFile.filename}
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
      <input ref={fileRef} type="file" className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
    </div>
  )
}

// ── 컴포넌트: 태스크 카드 ────────────────────────────────────────────────────

function TaskCard({
  task, projectId, files, phase, onRefresh,
}: {
  task: TaskMeta; projectId: number; files: ProjectFileState[]
  phase: 1 | 2; onRefresh: () => void
}) {
  const [running, setRunning] = useState(false)
  const outputs = getOutputFiles(files, task.id)
  const done = outputs.length > 0

  const handleRun = async () => {
    setRunning(true)
    try {
      const res = await runProjectTask(projectId, task.id)
      toast.success(`${task.name} 완료 (출력 ${res.outputs.length}개)`)
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

  const stepLabel = `P${phase}-${task.step}`

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${done ? 'border-emerald-200 bg-emerald-50/30' : 'border-ds-outline-variant/30 bg-white'}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {done
              ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              : <div className="w-4 h-4 rounded-full border-2 border-ds-outline-variant/40 shrink-0" />
            }
            <span className="text-sm font-medium text-ds-on-surface">{task.name}</span>
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-ds-surface-container text-ds-on-surface-variant font-mono shrink-0">
              {stepLabel}
            </span>
            {task.autoFromDb && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-600 font-medium shrink-0">
                FAT DB 자동
              </span>
            )}
          </div>
          <p className="text-xs text-ds-on-surface-variant mt-0.5 ml-6">{task.description}</p>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="flex items-center gap-1 ml-3 px-3 py-1 text-xs rounded-lg bg-ds-tertiary/10 text-ds-tertiary hover:bg-ds-tertiary/20 disabled:opacity-50 shrink-0"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {running ? '실행 중...' : done ? '재실행' : '실행'}
        </button>
      </div>

      {task.externalInputs && task.externalInputs.length > 0 && (
        <div className="ml-6 space-y-1.5">
          {task.externalInputs.map((inp) => (
            <ExternalFileUpload
              key={inp.slot}
              projectId={projectId} taskId={task.id}
              slot={inp.slot} label={inp.label} required={inp.required}
              existingFile={getExternalFile(files, task.id, inp.slot)}
              onUploaded={onRefresh}
            />
          ))}
        </div>
      )}

      {outputs.length > 0 && (
        <div className="ml-6 flex flex-wrap gap-2">
          {outputs.map((f) => (
            <button
              key={f.slot}
              onClick={() => handleDownload(f.slot, f.filename)}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
            >
              <Download className="w-3 h-3" /> {f.filename}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 컴포넌트: Task 0 섹션 (데이터 추출 + HA 히트카운트) ─────────────────────

function Task0Section({
  projectId, files, hasPeerIp, onRefresh,
}: {
  projectId: number; files: ProjectFileState[]
  hasPeerIp: boolean; onRefresh: () => void
}) {
  const [extracting, setExtracting] = useState(false)
  const [merging, setMerging] = useState(false)
  const task0done = hasOutput(files, 0)
  const task1done = hasOutput(files, 1)
  const task0file = files.find((f) => f.task_id === 0 && f.slot === 'output_0')
  const task1file = files.find((f) => f.task_id === 1 && f.slot === 'output_0')
  const haSecFile = getExternalFile(files, 1, 'external_1')
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleExtract = async () => {
    setExtracting(true)
    try {
      const res = await runProjectExtract(projectId)
      toast.success(`추출 완료: ${res.filename}`)
      onRefresh()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setExtracting(false)
    }
  }

  const handleMerge = async () => {
    setMerging(true)
    try {
      const res = await runProjectTask(projectId, 1)
      toast.success(`히트카운트 병합 완료 (출력 ${res.outputs.length}개)`)
      onRefresh()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setMerging(false)
    }
  }

  const handleHaFile = async (file: File) => {
    setUploading(true)
    try {
      await uploadExternalFile(projectId, 1, 'external_1', file)
      toast.success('HA Secondary 파일 업로드 완료')
      onRefresh()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-xl border border-ds-outline-variant/30 bg-white p-5 space-y-4">
      {/* Task 0: DB 추출 */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            {task0done
              ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              : <Database className="w-4 h-4 text-ds-on-surface-variant" />
            }
            <span className="text-sm font-medium text-ds-on-surface">
              데이터 추출 및 사용이력 병합
            </span>
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-ds-surface-container text-ds-on-surface-variant font-mono">
              P0
            </span>
          </div>
          <p className="text-xs text-ds-on-surface-variant mt-0.5 ml-6">
            FAT DB에서 정책·객체 데이터와 사용이력(last_hit_date)을 추출합니다.
          </p>
          {task0done && (
            <p className="text-xs text-emerald-600 mt-1 ml-6">✓ {task0file?.filename}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {task0done && (
            <button
              onClick={async () => {
                try {
                  const { blob, filename } = await downloadTaskFile(projectId, 0, 'output_0')
                  triggerDownload(blob, filename)
                } catch (e: unknown) { toast.error((e as Error).message) }
              }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-ds-outline-variant/50 hover:bg-black/5"
            >
              <Download className="w-3 h-3" /> 다운로드
            </button>
          )}
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90 disabled:opacity-50"
          >
            {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            {extracting ? '추출 중...' : task0done ? '재추출' : '추출 실행'}
          </button>
        </div>
      </div>

      {/* Task 12: HA Secondary 히트카운트 (HA 장비인 경우) */}
      {hasPeerIp && (
        <div className="ml-6 pt-3 border-t border-ds-outline-variant/20 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                {task1done
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  : <div className="w-3.5 h-3.5 rounded-full border-2 border-ds-outline-variant/40" />
                }
                <span className="text-xs font-medium text-ds-on-surface">
                  HA Secondary 히트카운트 병합
                </span>
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-ds-surface-container text-ds-on-surface-variant font-mono">
                  선택
                </span>
              </div>
              <p className="text-[11px] text-ds-on-surface-variant mt-0.5 ml-5">
                HA Secondary 장비의 히트카운트를 병합합니다.
              </p>
              {task1done && (
                <p className="text-[11px] text-emerald-600 mt-0.5 ml-5">✓ {task1file?.filename}</p>
              )}
            </div>
            <button
              onClick={handleMerge}
              disabled={merging || !haSecFile}
              title={!haSecFile ? 'HA Secondary 파일을 먼저 업로드하세요' : ''}
              className="flex items-center gap-1 ml-3 px-2.5 py-1 text-xs rounded-lg bg-ds-tertiary/10 text-ds-tertiary hover:bg-ds-tertiary/20 disabled:opacity-40 shrink-0"
            >
              {merging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {merging ? '병합 중...' : '병합'}
            </button>
          </div>
          <div className="ml-5 flex items-center gap-2 text-xs">
            <span className="text-ds-on-surface-variant">📋 HA Secondary 히트카운트 Excel:</span>
            {haSecFile ? (
              <span className="text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> {haSecFile.filename}
              </span>
            ) : (
              <span className="text-ds-on-surface-variant/60">(선택)</span>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-ds-outline-variant/50 hover:bg-black/5 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {haSecFile ? '교체' : '업로드'}
            </button>
            <input ref={fileRef} type="file" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleHaFile(e.target.files[0])} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────────

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

  const refresh = () => qc.invalidateQueries({ queryKey: ['deletion-workflow-project', projectId] })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-ds-on-surface-variant">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 로딩 중...
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-sm text-ds-error">
        <AlertCircle className="w-4 h-4" /> 프로젝트를 불러올 수 없습니다.
      </div>
    )
  }

  const files = project.files ?? []
  const hasPeerIp = Boolean(project.device_vendor)

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-ds-outline-variant/30 shrink-0">
        <button
          onClick={() => navigate('/deletion-workflow')}
          className="flex items-center gap-1 text-sm text-ds-on-surface-variant hover:text-ds-on-surface"
        >
          <ArrowLeft className="w-4 h-4" /> 목록으로
        </button>
        <div className="w-px h-4 bg-ds-outline-variant/30" />
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-ds-on-surface truncate">
            {project.device_name} / {project.name}
          </h1>
          <p className="text-xs text-ds-on-surface-variant mt-0.5">
            {project.device_ip} · {project.device_vendor} · 생성 {new Date(project.created_at).toLocaleDateString('ko-KR')}
          </p>
        </div>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-auto px-6 py-5 space-y-6">

        {/* P0: 데이터 추출 + HA 히트카운트 */}
        <Task0Section
          projectId={projectId}
          files={files}
          hasPeerIp={hasPeerIp}
          onRefresh={refresh}
        />

        {/* Phase 1 */}
        <section>
          <h2 className="text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wider mb-3">
            Phase 1 — 신청정보 처리
          </h2>
          <div className="space-y-3">
            {PHASE1_TASKS.map((t) => (
              <TaskCard key={t.id} task={t} phase={1} projectId={projectId} files={files} onRefresh={refresh} />
            ))}
          </div>
        </section>

        {/* GSAMS Checkpoint */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Checkpoint — GSAMS 신청정보 수령 대기</span>
          <p className="text-xs mt-1 text-amber-700">
            Phase 1 완료 후 신청번호 파일(P1-5 출력)을 타부서에 전달하고, GSAMS Excel 파일을 수령한 후 Phase 2를 진행하세요.
          </p>
        </div>

        {/* Phase 2 */}
        <section>
          <h2 className="text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wider mb-3">
            Phase 2 — 정책 분류·공지
          </h2>
          <div className="space-y-3">
            {PHASE2_TASKS.map((t) => (
              <TaskCard key={t.id} task={t} phase={2} projectId={projectId} files={files} onRefresh={refresh} />
            ))}
          </div>
        </section>

      </div>
    </div>
  )
}
