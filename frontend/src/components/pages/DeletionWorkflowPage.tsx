import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Upload, Download, Play, CheckCircle2, XCircle, Loader2,
  AlertTriangle, ChevronRight, FileText, X, ArrowRight, Database
} from 'lucide-react'
import {
  fetchDeletionTasks, executeDeletionTask, extractDeviceData, exportRedundancyData,
  type DeletionTaskMeta
} from '@/api/deletionWorkflow'
import { listDevices, type Device } from '@/api/devices'
import { cn } from '@/lib/utils'

// ──────────────────────────────────────────────────────────────────
// 타입
// ──────────────────────────────────────────────────────────────────
type TaskStatus = 'idle' | 'running' | 'done' | 'error'

interface TaskState {
  status: TaskStatus
  files: (File | null)[]
  resultBlob?: Blob
  resultName?: string
  error?: string
}

type Phase = 1 | 2

// Phase 1 태스크: 1, 2, 3
// Phase 2 태스크: 4~14
const PHASE1_TASK_IDS = [1, 2, 3]
const PHASE2_TASK_IDS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

// Task 6/7은 vendor 선택 필요
const VENDOR_TASK_IDS = [6, 7]
const TASK_DEFAULT_VENDOR: Record<number, string> = { 6: 'paloalto', 7: 'secui' }

// ──────────────────────────────────────────────────────────────────
// 데이터 추출 패널 (Task 0 AutoCollector 대체)
// ──────────────────────────────────────────────────────────────────
interface ExtractionPanelProps {
  devices: Device[]
  onExtracted: (blob: Blob, name: string) => void
}

function ExtractionPanel({ devices, onExtracted }: ExtractionPanelProps) {
  const [deviceId, setDeviceId] = useState<number | ''>('')
  const [haDeviceId, setHaDeviceId] = useState<number | ''>('')
  const [useSsh, setUseSsh] = useState(false)
  const [primaryLoading, setPrimaryLoading] = useState(false)
  const [haLoading, setHaLoading] = useState(false)
  const [redundancyLoading, setRedundancyLoading] = useState(false)

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleExtract = async (useHaPeer = false) => {
    const id = useHaPeer ? haDeviceId : deviceId
    if (!id) return
    const setLoading = useHaPeer ? setHaLoading : setPrimaryLoading
    setLoading(true)
    try {
      const { blob, filename } = await extractDeviceData(Number(id), { useHaPeer, useSsh })
      downloadBlob(blob, filename)
      if (!useHaPeer) onExtracted(blob, filename)
      toast.success(`${filename} 추출 완료`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleRedundancyExport = async () => {
    if (!deviceId) return
    setRedundancyLoading(true)
    try {
      const { blob, filename } = await exportRedundancyData(Number(deviceId))
      downloadBlob(blob, filename)
      toast.success(`${filename} 내보내기 완료`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRedundancyLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-ds-outline-variant/8 shadow-sm p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-ds-tertiary" />
        <span className="text-[13px] font-semibold text-ds-on-surface">데이터 추출 (Task 0)</span>
        <span className="text-[10px] text-ds-on-surface-variant/60 ml-1">방화벽 장비에서 직접 추출</span>
      </div>

      {/* 장비 선택 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">Primary 장비</p>
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value ? Number(e.target.value) : '')}
            className="w-full h-8 px-2 text-[12px] bg-ds-surface-container-low border border-ds-outline-variant/20 rounded-lg focus:outline-none focus:border-ds-tertiary"
          >
            <option value="">장비 선택…</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.ip_address})</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">Secondary 장비 (HA, 선택)</p>
          <select
            value={haDeviceId}
            onChange={(e) => setHaDeviceId(e.target.value ? Number(e.target.value) : '')}
            className="w-full h-8 px-2 text-[12px] bg-ds-surface-container-low border border-ds-outline-variant/20 rounded-lg focus:outline-none focus:border-ds-tertiary"
          >
            <option value="">사용 안 함</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.ip_address})</option>
            ))}
          </select>
        </div>
      </div>

      {/* SSH 옵션 */}
      <label className="flex items-center gap-2 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={useSsh}
          onChange={(e) => setUseSsh(e.target.checked)}
          className="w-3.5 h-3.5 accent-ds-tertiary"
        />
        <span className="text-[12px] text-ds-on-surface-variant">SSH 방식으로 사용이력 수집 (PaloAlto)</span>
      </label>

      {/* 액션 버튼들 */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleExtract(false)}
          disabled={!deviceId || primaryLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold btn-primary-gradient text-white rounded-lg shadow-sm disabled:opacity-40 hover:opacity-90 transition-all"
        >
          {primaryLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          Primary 추출
        </button>
        <button
          onClick={() => handleExtract(true)}
          disabled={!haDeviceId || haLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-tertiary bg-ds-tertiary/8 border border-ds-tertiary/20 rounded-lg disabled:opacity-40 hover:bg-ds-tertiary/12 transition-colors"
        >
          {haLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          Secondary 사용이력
        </button>
        <button
          onClick={handleRedundancyExport}
          disabled={!deviceId || redundancyLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container border border-ds-outline-variant/20 rounded-lg disabled:opacity-40 hover:bg-ds-surface-container-high transition-colors"
        >
          {redundancyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          중복분석 내보내기
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Phase 스테퍼
// ──────────────────────────────────────────────────────────────────
function PhaseStepper({ phase }: { phase: Phase | 'checkpoint' }) {
  const steps = [
    { key: 1, label: 'Phase 1', sub: '데이터 수집·파싱' },
    { key: 'checkpoint', label: 'Checkpoint', sub: 'GSAMS 수령 대기' },
    { key: 2, label: 'Phase 2', sub: '신청정보 매핑·분류' },
  ] as const

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        const isActive = step.key === phase
        const isDone =
          (step.key === 1 && (phase === 'checkpoint' || phase === 2)) ||
          (step.key === 'checkpoint' && phase === 2)

        return (
          <div key={step.key} className="flex items-center">
            <div className={cn(
              'flex flex-col items-center px-5 py-2.5 rounded-lg transition-colors',
              isActive && 'bg-ds-tertiary/8',
            )}>
              <div className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold mb-1',
                isDone ? 'bg-emerald-500 text-white' :
                isActive ? 'bg-ds-tertiary text-white' :
                'bg-ds-surface-container text-ds-on-surface-variant'
              )}>
                {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={cn(
                'text-[12px] font-semibold',
                isActive ? 'text-ds-tertiary' : isDone ? 'text-emerald-600' : 'text-ds-on-surface-variant'
              )}>{step.label}</span>
              <span className="text-[10px] text-ds-on-surface-variant/60 mt-0.5">{step.sub}</span>
            </div>
            {i < steps.length - 1 && (
              <ChevronRight className="w-4 h-4 text-ds-outline-variant/60 mx-1 shrink-0" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// 파일 드롭존
// ──────────────────────────────────────────────────────────────────
interface FileDropzoneProps {
  label?: string
  file: File | null
  onFile: (f: File) => void
  onClear: () => void
  accept?: string
}

function FileDropzone({ label, file, onFile, onClear, accept = '.xlsx,.xls,.csv' }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }

  return (
    <div className="flex-1 min-w-0">
      {label && <p className="text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 mb-1.5">{label}</p>}
      {file ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-ds-tertiary/5 border border-ds-tertiary/20 rounded-lg">
          <FileText className="w-3.5 h-3.5 text-ds-tertiary shrink-0" />
          <span className="text-[12px] text-ds-on-surface truncate flex-1">{file.name}</span>
          <button
            onClick={onClear}
            className="p-0.5 rounded hover:bg-ds-surface-container-high text-ds-on-surface-variant hover:text-ds-error transition-colors shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-3 py-2.5 border border-dashed rounded-lg text-[12px] transition-colors',
            dragging
              ? 'border-ds-tertiary bg-ds-tertiary/5 text-ds-tertiary'
              : 'border-ds-outline-variant/30 text-ds-on-surface-variant hover:border-ds-tertiary/40 hover:text-ds-tertiary hover:bg-ds-tertiary/3'
          )}
        >
          <Upload className="w-3.5 h-3.5 shrink-0" />
          파일 선택 또는 드롭
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// 태스크 카드
// ──────────────────────────────────────────────────────────────────
interface TaskCardProps {
  meta: DeletionTaskMeta
  state: TaskState
  prevResult?: { blob: Blob; name: string } | null
  onFilesChange: (files: (File | null)[]) => void
  onRun: (vendor?: string) => void
  onDownload: () => void
}

function TaskCard({ meta, state, prevResult, onFilesChange, onRun, onDownload }: TaskCardProps) {
  const [vendor, setVendor] = useState(TASK_DEFAULT_VENDOR[meta.id] ?? 'paloalto')
  const needsVendor = VENDOR_TASK_IDS.includes(meta.id)

  const setFile = (idx: number, f: File | null) => {
    const next = [...state.files]
    next[idx] = f
    onFilesChange(next)
  }

  const canRun = state.files.slice(0, meta.input_count).every(Boolean) && state.status !== 'running'

  const handleUsePrev = () => {
    if (!prevResult) return
    const file = new File([prevResult.blob], prevResult.name, { type: prevResult.blob.type })
    const next = [...state.files]
    next[0] = file
    onFilesChange(next)
  }

  return (
    <div className={cn(
      'bg-white rounded-xl border shadow-sm transition-all',
      state.status === 'done' ? 'border-emerald-200' :
      state.status === 'error' ? 'border-ds-error/20' :
      state.status === 'running' ? 'border-ds-tertiary/30' :
      'border-ds-outline-variant/8'
    )}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-ds-outline-variant/8">
        <div className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
          state.status === 'done' ? 'bg-emerald-100 text-emerald-700' :
          state.status === 'error' ? 'bg-red-50 text-ds-error' :
          state.status === 'running' ? 'bg-ds-tertiary/10 text-ds-tertiary' :
          'bg-ds-surface-container text-ds-on-surface-variant'
        )}>
          {state.status === 'done' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
           state.status === 'error' ? <XCircle className="w-3.5 h-3.5" /> :
           state.status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
           meta.id}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-semibold text-ds-on-surface">{meta.name}</span>
          <span className="text-[11px] text-ds-on-surface-variant/60 ml-2">{meta.description}</span>
        </div>
        {meta.input_count > 1 && (
          <span className="text-[10px] font-bold text-ds-on-surface-variant/40 uppercase tracking-wide">파일 {meta.input_count}개</span>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* File inputs */}
        <div className={cn('flex gap-2', meta.input_count > 1 ? 'flex-col sm:flex-row' : 'flex-row')}>
          {Array.from({ length: meta.input_count }).map((_, idx) => (
            <FileDropzone
              key={idx}
              label={meta.input_count > 1 ? (idx === 0 ? '첫 번째 파일' : '두 번째 파일') : undefined}
              file={state.files[idx] ?? null}
              onFile={(f) => setFile(idx, f)}
              onClear={() => setFile(idx, null)}
            />
          ))}
        </div>

        {/* Use previous result shortcut */}
        {prevResult && !state.files[0] && (
          <button
            onClick={handleUsePrev}
            className="flex items-center gap-1.5 text-[11px] text-ds-tertiary hover:text-ds-tertiary/80 transition-colors"
          >
            <ArrowRight className="w-3 h-3" />
            이전 태스크 결과 사용 ({prevResult.name})
          </button>
        )}

        {/* Vendor selector */}
        {needsVendor && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">벤더</span>
            <select
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="h-7 px-2 text-[12px] bg-ds-surface-container-low border border-ds-outline-variant/20 rounded-lg focus:outline-none focus:border-ds-tertiary"
            >
              <option value="paloalto">PaloAlto</option>
              <option value="secui">SECUI</option>
            </select>
          </div>
        )}

        {/* Error message */}
        {state.status === 'error' && state.error && (
          <p className="text-[11px] text-ds-error bg-red-50 px-3 py-2 rounded-lg border border-ds-error/15">
            {state.error}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onRun(needsVendor ? vendor : undefined)}
            disabled={!canRun}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold btn-primary-gradient text-white rounded-lg shadow-sm disabled:opacity-40 hover:opacity-90 transition-all"
          >
            {state.status === 'running' ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> 실행 중…</>
            ) : (
              <><Play className="w-3 h-3" /> 실행</>
            )}
          </button>
          {state.status === 'done' && (
            <button
              onClick={onDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-tertiary bg-ds-tertiary/8 border border-ds-tertiary/20 rounded-lg hover:bg-ds-tertiary/12 transition-colors"
            >
              <Download className="w-3 h-3" />
              {state.resultName ?? '결과 다운로드'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// GSAMS 체크포인트 배너
// ──────────────────────────────────────────────────────────────────
function GsamsCheckpoint({ onProceed }: { onProceed: () => void }) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-[13px] font-semibold text-amber-800">Checkpoint — GSAMS 신청정보 수령 대기</p>
          <p className="text-[11px] text-amber-700/80 mt-1 leading-relaxed">
            Phase 1이 완료되었습니다. 생성된 신청번호 파일을 타부서에 전달하고,<br />
            GSAMS 신청정보 파일을 수령한 후 Phase 2를 시작하세요.
          </p>
        </div>
      </div>
      <button
        onClick={onProceed}
        className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors shrink-0 whitespace-nowrap"
      >
        Phase 2 시작
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// 섹션 헤더
// ──────────────────────────────────────────────────────────────────
function SectionHeader({ phase, done }: { phase: 1 | 2; done: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn(
        'px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide',
        done ? 'bg-emerald-100 text-emerald-700' : 'bg-ds-tertiary/10 text-ds-tertiary'
      )}>
        Phase {phase}
      </div>
      <p className="text-[12px] text-ds-on-surface-variant">
        {phase === 1
          ? '데이터 수집, 파싱, 신청번호 추출'
          : '신청정보 매핑, 예외처리, 중복/미사용 분류'}
      </p>
      {done && <span className="text-[11px] font-semibold text-emerald-600">완료</span>}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// 메인 페이지
// ──────────────────────────────────────────────────────────────────
export function DeletionWorkflowPage() {
  const [phase, setPhase] = useState<Phase | 'checkpoint'>(1)
  const [taskStates, setTaskStates] = useState<Record<number, TaskState>>({})

  const { data, isLoading, error } = useQuery({
    queryKey: ['deletion-workflow-tasks'],
    queryFn: fetchDeletionTasks,
    staleTime: Infinity,
  })

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: listDevices,
  })

  const getState = (taskId: number): TaskState =>
    taskStates[taskId] ?? { status: 'idle', files: [] }

  const setTaskState = (taskId: number, patch: Partial<TaskState>) =>
    setTaskStates((prev) => ({
      ...prev,
      [taskId]: { ...getState(taskId), ...patch },
    }))

  const handleRun = async (taskId: number, vendor?: string) => {
    const state = getState(taskId)
    const meta = data?.tasks.find((t) => t.id === taskId)
    if (!meta) return

    const files = state.files.slice(0, meta.input_count).filter(Boolean) as File[]
    setTaskState(taskId, { status: 'running', error: undefined })

    try {
      const { blob, filename } = await executeDeletionTask(taskId, files, vendor)
      setTaskState(taskId, { status: 'done', resultBlob: blob, resultName: filename })
      toast.success(`Task ${taskId} (${meta.name}) 완료`)

      // Phase 1의 마지막 태스크(3) 완료 시 체크포인트로 이동
      if (PHASE1_TASK_IDS.includes(taskId) && phase === 1) {
        const phase1States = { ...taskStates, [taskId]: { ...getState(taskId), status: 'done' as TaskStatus } }
        const allPhase1Done = PHASE1_TASK_IDS.every((id) =>
          id === taskId ? true : (phase1States[id]?.status === 'done')
        )
        if (allPhase1Done) setPhase('checkpoint')
      }
    } catch (e: unknown) {
      const msg = (e as Error).message
      setTaskState(taskId, { status: 'error', error: msg })
      toast.error(msg)
    }
  }

  const handleDownload = (taskId: number) => {
    const state = getState(taskId)
    if (!state.resultBlob || !state.resultName) return
    const url = URL.createObjectURL(state.resultBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = state.resultName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const getPrevResult = (taskId: number) => {
    const ids = [...PHASE1_TASK_IDS, ...PHASE2_TASK_IDS]
    const idx = ids.indexOf(taskId)
    if (idx <= 0) return null
    const prevId = ids[idx - 1]
    const prev = taskStates[prevId]
    if (prev?.status === 'done' && prev.resultBlob && prev.resultName) {
      return { blob: prev.resultBlob, name: prev.resultName }
    }
    return null
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-ds-tertiary animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface font-headline">정책 삭제 워크플로우</h1>
        <div className="flex items-center gap-3 bg-red-50 border border-ds-error/15 rounded-xl px-5 py-4">
          <AlertTriangle className="w-4 h-4 text-ds-error shrink-0" />
          <p className="text-[13px] text-ds-error">{(error as Error).message}</p>
        </div>
      </div>
    )
  }

  const tasks = data?.tasks ?? []
  const phase1Tasks = tasks.filter((t) => PHASE1_TASK_IDS.includes(t.id))
  const phase2Tasks = tasks.filter((t) => PHASE2_TASK_IDS.includes(t.id))
  const phase1AllDone = PHASE1_TASK_IDS.every((id) => taskStates[id]?.status === 'done')

  const handleExtracted = (blob: Blob, name: string) => {
    // 추출된 Primary 파일을 Task 1의 첫 번째 입력으로 자동 설정
    const file = new File([blob], name, { type: blob.type })
    setTaskState(1, { files: [file] })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface font-headline">정책 삭제 워크플로우</h1>
        {data?.fpat_yaml && !data.fpat_yaml.includes('없음') && (
          <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">
            fpat.yaml 로드됨
          </span>
        )}
      </div>

      {/* 데이터 추출 */}
      <ExtractionPanel devices={devices} onExtracted={handleExtracted} />

      {/* Phase 스테퍼 */}
      <div className="bg-white rounded-xl border border-ds-outline-variant/8 shadow-sm px-4 py-3">
        <PhaseStepper phase={phase} />
      </div>

      {/* Phase 1 섹션 */}
      <div className="flex flex-col gap-3">
        <SectionHeader phase={1} done={phase1AllDone} />
        {phase1Tasks.map((meta) => (
          <TaskCard
            key={meta.id}
            meta={meta}
            state={getState(meta.id)}
            prevResult={getPrevResult(meta.id)}
            onFilesChange={(files) => setTaskState(meta.id, { files })}
            onRun={(vendor) => handleRun(meta.id, vendor)}
            onDownload={() => handleDownload(meta.id)}
          />
        ))}
      </div>

      {/* GSAMS 체크포인트 */}
      {phase === 'checkpoint' && (
        <GsamsCheckpoint onProceed={() => setPhase(2)} />
      )}

      {/* Phase 2 섹션 */}
      {phase === 2 && (
        <div className="flex flex-col gap-3">
          <SectionHeader phase={2} done={false} />
          {phase2Tasks.map((meta) => (
            <TaskCard
              key={meta.id}
              meta={meta}
              state={getState(meta.id)}
              prevResult={getPrevResult(meta.id)}
              onFilesChange={(files) => setTaskState(meta.id, { files })}
              onRun={(vendor) => handleRun(meta.id, vendor)}
              onDownload={() => handleDownload(meta.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
