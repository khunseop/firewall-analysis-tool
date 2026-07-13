import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Play, Download, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { runProjectTask, uploadExternalFile, downloadTaskFile, type ProjectFileState } from '@/api/deletionWorkflow'
import { triggerDownload, getOutputFiles, getExternalFile, formatElapsed, type TaskMeta } from './taskMeta'
import { ExternalFileUpload } from './ExternalFileUpload'

export function TaskCard({
  task, projectId, files, phase, autoRunCurrentTaskId,
  timing, onRefresh, onOutputReplaced, onWillRerun, onOutputSaved,
}: {
  task: TaskMeta; projectId: number; files: ProjectFileState[]
  phase: 1 | 2 | 3; autoRunCurrentTaskId: number | null
  timing?: { startedAt: number; completedAt?: number }
  onRefresh: () => void; onOutputReplaced: (taskId: number) => void
  onWillRerun?: (taskId: number) => Promise<void>
  onOutputSaved?: (result: { task_id: number; outputs: { slot: string; filename: string }[] }) => void
}) {
  const [running, setRunning] = useState(false)
  const [replacingSlot, setReplacingSlot] = useState<string | null>(null)
  const replaceRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [manualStartedAt, setManualStartedAt] = useState<number | null>(null)
  const [manualCompletedMs, setManualCompletedMs] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  const outputs = getOutputFiles(files, task.id)
  const done = outputs.length > 0
  const isAutoRunning = autoRunCurrentTaskId === task.id
  // 완료된 태스크는 auto-run이 가리켜도 스피너 대신 체크마크 표시
  const isBlinking = !done && (isAutoRunning || running)

  // effectiveStartedAt: auto-run은 timing prop, 수동 실행은 로컬 state
  const effectiveStartedAt = isAutoRunning ? (timing?.startedAt ?? null) : manualStartedAt

  // 실행 중 경과 시간 타이머
  useEffect(() => {
    if (!isBlinking || effectiveStartedAt === null) return
    setElapsedMs(Date.now() - effectiveStartedAt)
    const timer = setInterval(() => setElapsedMs(Date.now() - effectiveStartedAt), 100)
    return () => clearInterval(timer)
  }, [isBlinking, effectiveStartedAt])

  // 완료 시간 (ms): auto-run은 timing prop, 수동은 로컬 state
  const displayCompletedMs = done
    ? (timing?.completedAt != null
        ? timing.completedAt - timing.startedAt
        : manualCompletedMs)
    : null

  const handleRun = async () => {
    const isRerun = done
    const startMs = Date.now()
    setManualStartedAt(startMs)
    setManualCompletedMs(null)
    setElapsedMs(0)
    setRunning(true)
    try {
      // 재실행 시 이후 태스크 즉시 초기화 (실행 전 UI 즉각 반영)
      if (isRerun && onWillRerun) {
        await onWillRerun(task.id)
      }
      const res = await runProjectTask(projectId, task.id)
      setManualCompletedMs(Date.now() - startMs)
      toast.success(`${task.name} 완료 (출력 ${res.outputs.length}개)`)
      // refetch를 기다리지 않고 즉시 캐시에 반영 — 진행률 바가 바로 갱신되도록
      onOutputSaved?.(res)
      if (isRerun) {
        // 재실행 완료: 이후 태스크 자동실행 시작
        onOutputReplaced(task.id)
      } else {
        onRefresh()
      }
    } catch (e: unknown) {
      toast.error((e as Error).message)
      setManualStartedAt(null)
      setManualCompletedMs(null)
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

  const handleReplaceOutput = async (slot: string, file: File) => {
    setReplacingSlot(slot)
    try {
      await uploadExternalFile(projectId, task.id, slot, file)
      toast.success(`출력 파일 교체 완료 — 이후 태스크 결과를 재실행해야 합니다.`)
      onOutputReplaced(task.id)
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setReplacingSlot(null)
    }
  }

  const stepLabel = `P${phase}-${task.step}`

  return (
    <div className={`rounded-xl border p-4 space-y-3 transition-all ${
      isBlinking ? 'border-ds-tertiary/50 bg-ds-tertiary/4 shadow-sm' :
      done ? 'border-emerald-200 bg-emerald-50/30' : 'border-ds-outline-variant/30 bg-white'
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isBlinking
              ? <Loader2 className="w-4 h-4 text-ds-tertiary animate-spin shrink-0" />
              : done
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
            {/* 소요 시간 표시 */}
            {isBlinking && effectiveStartedAt !== null && (
              <span className="text-[10px] text-ds-tertiary/80 font-mono shrink-0">
                {formatElapsed(elapsedMs)}
              </span>
            )}
            {!isBlinking && displayCompletedMs != null && (
              <span className="text-[10px] text-emerald-600/70 font-mono shrink-0">
                완료 · {formatElapsed(displayCompletedMs)}
              </span>
            )}
          </div>
          <p className="text-xs text-ds-on-surface-variant mt-0.5 ml-6">{task.description}</p>
          {/* Task 7 GSAMS 안내 */}
          {task.id === 7 && !getExternalFile(files, 7, 'external_1') && (
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1 ml-6">
              Phase 1 완료 후 외부에서 GSAMS Excel을 수령하여 업로드하면 자동실행이 계속됩니다.
            </p>
          )}
        </div>
        <button
          onClick={handleRun}
          disabled={running || isAutoRunning}
          className="flex items-center gap-1 ml-3 px-3 py-1 text-xs rounded-lg bg-ds-tertiary/10 text-ds-tertiary hover:bg-ds-tertiary/20 disabled:opacity-50 shrink-0"
        >
          {running || isAutoRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {running || isAutoRunning ? '실행 중...' : done ? '재실행' : '실행'}
        </button>
      </div>

      {task.externalInputs && task.externalInputs.length > 0 && (
        <div className="ml-6 space-y-1.5">
          {task.externalInputs.map((inp) => (
            <div key={inp.slot}>
              <ExternalFileUpload
                projectId={projectId} taskId={task.id}
                slot={inp.slot} label={inp.label} required={inp.required}
                existingFile={getExternalFile(files, task.id, inp.slot)}
                onUploaded={onRefresh}
              />
              {!inp.required && inp.slot === 'external_1' && !getExternalFile(files, task.id, inp.slot) && task.id === 12 && (
                <p className="text-[11px] text-ds-on-surface-variant/70 mt-1 ml-1">
                  ℹ️ 파일 없으면 Task 1 출력(히트카운트 병합)을 자동 사용합니다. 별도 사용이력 파일이 있으면 업로드하세요.
                </p>
              )}
              {!inp.required && inp.slot === 'external_1' && !getExternalFile(files, task.id, inp.slot) && task.id === 5 && (
                <p className="text-[11px] text-ds-on-surface-variant/70 mt-1 ml-1">
                  ℹ️ 파일 없으면 이 단계를 건너뛰고 정책 파싱 결과를 그대로 다음 단계에서 사용합니다.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 실행 중 progress bar */}
      {isBlinking && (
        <div className="ml-6 h-0.5 rounded-full bg-ds-tertiary/15 overflow-hidden">
          <div
            className="h-full w-1/3 rounded-full bg-ds-tertiary/60"
            style={{ animation: 'task-progress-slide 1.4s ease-in-out infinite' }}
          />
        </div>
      )}

      {outputs.length > 0 && (
        <div className="ml-6 flex flex-wrap gap-2">
          {outputs.map((f) => (
            <div key={f.slot} className="flex items-center gap-1">
              <button
                onClick={() => handleDownload(f.slot, f.filename)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
              >
                <Download className="w-3 h-3" /> {f.filename}
              </button>
              {/* 출력 파일 교체 버튼 */}
              <button
                onClick={() => replaceRefs.current[f.slot]?.click()}
                disabled={replacingSlot === f.slot}
                title="수정된 파일로 교체"
                className="p-1 rounded border border-ds-outline-variant/30 hover:bg-black/5 disabled:opacity-50 text-ds-on-surface-variant hover:text-ds-on-surface"
              >
                {replacingSlot === f.slot
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <RefreshCw className="w-3 h-3" />
                }
              </button>
              <input
                ref={(el) => { replaceRefs.current[f.slot] = el }}
                type="file"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleReplaceOutput(f.slot, e.target.files[0])}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 컴포넌트: Task 0 섹션 ────────────────────────────────────────────────────
