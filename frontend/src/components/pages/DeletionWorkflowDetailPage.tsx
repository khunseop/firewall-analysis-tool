import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, AlertCircle, Loader2, Zap, RotateCcw, Square, CalendarDays, Pencil, X, Check, PackageCheck, RefreshCcw } from 'lucide-react'
import { getProject, runProjectExtract, runProjectTask, resetAllProjectFiles, clearProjectOutputs, updateProject, completeProject, type DeletionWorkflowProjectDetail, type ProjectFileState } from '@/api/deletionWorkflow'
import { getDevice, syncAll, getSyncStatus } from '@/api/devices'
import { startAnalysis, getAnalysisStatus } from '@/api/analysis'
import { queryKeys } from '@/api/queryKeys'
import { PHASE1_TASKS, PHASE2_TASKS, EXECUTION_ORDER, ALL_TASK_META, triggerDownload, hasOutput, getExternalFile, getDownstreamTaskIds } from './deletion-workflow/taskMeta'
import { TaskCard } from './deletion-workflow/TaskCard'
import { Task0Section } from './deletion-workflow/Task0Section'

export default function DeletionWorkflowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const projectId = Number(id)

  // 자동실행 상태
  const autoRunRef = useRef(false)
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoRunCurrentTaskId, setAutoRunCurrentTaskId] = useState<number | null>(null)
  const [autoRunBlockedAt, setAutoRunBlockedAt] = useState<number | null>(null)

  // 태스크별 타이밍 (자동실행 기준; 수동 실행은 TaskCard 내부 로컬 state)
  const [taskTimings, setTaskTimings] = useState<
    Record<number, { startedAt: number; completedAt?: number }>
  >({})

  // 초기화 확인 모달
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)

  // 완료 처리
  const [completing, setCompleting] = useState(false)

  // 동기화 확인 모달
  const [syncConfirm, setSyncConfirm] = useState<{
    lastSyncDate: string | null
    refDate: string
    onSyncAndProceed: () => Promise<void>
    onSkip: () => Promise<void>
  } | null>(null)
  const [syncing, setSyncing] = useState(false)

  // 기준일 인라인 편집
  const [editingRefDate, setEditingRefDate] = useState(false)
  const [refDateInput, setRefDateInput] = useState('')

  const { data: project, isLoading, error } = useQuery<DeletionWorkflowProjectDetail>({
    queryKey: queryKeys.deletionWorkflowProject(projectId),
    queryFn: () => getProject(projectId),
    staleTime: 5_000,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.deletionWorkflowProject(projectId) })

  const refDateMutation = useMutation({
    mutationFn: (date: string | null) => updateProject(projectId, { reference_date: date }),
    onSuccess: (data) => {
      qc.setQueryData(
        ['deletion-workflow-project', projectId],
        (old: DeletionWorkflowProjectDetail | undefined) =>
          old ? { ...old, reference_date: data.reference_date } : old,
      )
      qc.invalidateQueries({ queryKey: queryKeys.deletionWorkflowProjects })
      toast.success(data.reference_date ? `기준일이 ${data.reference_date}로 설정되었습니다.` : '기준일이 해제되었습니다.')
      setEditingRefDate(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleRefDateSave = () => {
    refDateMutation.mutate(refDateInput || null)
  }

  const handleRefDateEdit = () => {
    setRefDateInput(project?.reference_date ?? '')
    setEditingRefDate(true)
  }

  // ── 동기화 날짜 확인 ─────────────────────────────────────────────────────
  // 기준일과 마지막 동기화 날짜가 다르면 확인 다이얼로그를 표시하고 결과(skip/sync/cancel)를 반환

  const askSyncDecision = (lastSyncDate: string | null, refDate: string, deviceId: number) =>
    new Promise<'sync' | 'skip' | 'cancel'>((resolve) => {
      setSyncConfirm({
        lastSyncDate,
        refDate,
        onSyncAndProceed: async () => {
          setSyncConfirm(null)
          setSyncing(true)
          try {
            toast.info('정책 동기화를 시작합니다...')
            await syncAll(deviceId)
            for (let i = 0; i < 120; i++) {
              await new Promise((r) => setTimeout(r, 3000))
              const status = await getSyncStatus(deviceId).catch(() => null)
              if (!status) break
              if (status.last_sync_status === 'success') {
                toast.success('동기화 완료')
                break
              }
              if (status.last_sync_status === 'failure') {
                toast.error('동기화 실패 — 그냥 진행합니다.')
                break
              }
            }
          } catch (e: unknown) {
            toast.error(`동기화 오류: ${(e as Error).message}`)
          } finally {
            setSyncing(false)
          }
          resolve('sync')
        },
        onSkip: async () => {
          setSyncConfirm(null)
          resolve('skip')
        },
      })
    })

  const checkSync = async (projectRef: DeletionWorkflowProjectDetail): Promise<boolean> => {
    let device
    try {
      device = await getDevice(projectRef.device_id)
    } catch {
      return true // 장비 조회 실패 시 그냥 진행
    }
    const lastSyncDate = device.last_sync_at ? device.last_sync_at.substring(0, 10) : null
    const refDate = projectRef.reference_date || new Date().toISOString().substring(0, 10)
    if (lastSyncDate === refDate) return true

    const decision = await askSyncDecision(lastSyncDate, refDate, projectRef.device_id)
    return decision !== 'cancel'
  }

  // ── 중복정책 분석 자동 실행 ───────────────────────────────────────────────

  const ensureRedundancyAnalysis = async (deviceId: number): Promise<boolean> => {
    try {
      const latest = await getAnalysisStatus(deviceId)
      if (latest.task_status === 'success') return true
      if (latest.task_status === 'in_progress' || latest.task_status === 'pending') {
        // 이미 진행 중 — 완료 대기
        toast.info('중복정책 분석이 진행 중입니다. 완료를 기다립니다...')
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 3000))
          const s = await getAnalysisStatus(deviceId).catch(() => null)
          if (!s) break
          if (s.task_status === 'success') return true
          if (s.task_status !== 'in_progress' && s.task_status !== 'pending') break
        }
        return false
      }
    } catch {
      // 분석 결과 없음 → 신규 실행
    }

    toast.info('중복정책 분석 결과가 없습니다. 자동으로 분석을 시작합니다...')
    try {
      await startAnalysis(deviceId, 'redundancy')
    } catch (e: unknown) {
      toast.error(`중복정책 분석 시작 실패: ${(e as Error).message}`)
      return false
    }

    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const s = await getAnalysisStatus(deviceId).catch(() => null)
      if (!s) break
      if (s.task_status === 'success') {
        toast.success('중복정책 분석 완료 — 워크플로우를 계속합니다.')
        return true
      }
      if (s.task_status !== 'in_progress' && s.task_status !== 'pending') {
        toast.error('중복정책 분석 실패')
        return false
      }
    }
    toast.error('중복정책 분석 타임아웃')
    return false
  }

  // ── 자동실행 ──────────────────────────────────────────────────────────────

  const startAutoRunFrom = async (fromTaskId?: number) => {
    autoRunRef.current = true
    setAutoRunning(true)
    setAutoRunBlockedAt(null)

    // Task 0: 처음부터 실행하는 경우에만 데이터 추출 포함
    const includeTask0 = fromTaskId === undefined
    if (includeTask0 && autoRunRef.current) {
      const cur = await getProject(projectId).catch(() => null)
      if (cur && !hasOutput(cur.files ?? [], 0)) {
        // 기준일 동기화 확인
        const canProceed = await checkSync(cur)
        if (!canProceed) {
          autoRunRef.current = false
          setAutoRunning(false)
          setAutoRunCurrentTaskId(null)
          return
        }

        setTaskTimings((prev) => ({ ...prev, 0: { startedAt: Date.now() } }))
        setAutoRunCurrentTaskId(0)
        try {
          const extractResult = await runProjectExtract(projectId)
          const completedAt = Date.now()
          setTaskTimings((prev) => ({ ...prev, 0: { ...prev[0], completedAt } }))
          // 즉시 캐시 업데이트
          qc.setQueryData(
            ['deletion-workflow-project', projectId],
            (old: DeletionWorkflowProjectDetail | undefined) => {
              if (!old) return old
              const existing = (old.files ?? []).filter(
                (f) => !(f.task_id === 0 && f.slot === 'output_0'),
              )
              return {
                ...old,
                files: [
                  ...existing,
                  { task_id: 0, slot: 'output_0', filename: extractResult.filename, created_at: new Date().toISOString() },
                ],
              }
            },
          )
        } catch (e: unknown) {
          toast.error(`데이터 추출 실패: ${(e as Error).message}`)
          autoRunRef.current = false
          setAutoRunning(false)
          setAutoRunCurrentTaskId(null)
          refresh()
          return
        }
      }
    }

    const startIdx = fromTaskId !== undefined
      ? EXECUTION_ORDER.indexOf(fromTaskId)
      : 0
    const tasksToRun = EXECUTION_ORDER.slice(Math.max(startIdx, 0))

    for (const taskId of tasksToRun) {
      if (!autoRunRef.current) break

      // 캐시 우선 조회 (setQueryData로 즉시 반영된 최신 상태 사용)
      const cachedProject = qc.getQueryData<DeletionWorkflowProjectDetail>(
        ['deletion-workflow-project', projectId],
      )
      const currentFiles = cachedProject?.files ?? []

      // 이미 완료 → 건너뜀
      if (hasOutput(currentFiles, taskId)) continue

      // 필수 외부 파일 확인 (캐시에 없으면 서버 조회)
      const taskMeta = ALL_TASK_META.find((t) => t.id === taskId)
      if (!taskMeta) continue

      let checkFiles = currentFiles
      if ((taskMeta.externalInputs ?? []).some((inp) => inp.required)) {
        const freshProject = await getProject(projectId).catch(() => null)
        checkFiles = freshProject?.files ?? currentFiles
      }
      const missingRequired = (taskMeta.externalInputs ?? [])
        .filter((inp) => inp.required && !getExternalFile(checkFiles, taskId, inp.slot))
      if (missingRequired.length > 0) {
        setAutoRunBlockedAt(taskId)
        toast.info(`${taskMeta.name}: '${missingRequired[0].label}'을 업로드하면 자동실행이 계속됩니다.`)
        break
      }

      // Task 3(중복정책 분석): FAT DB에 분석 결과가 없으면 자동 실행
      if (taskId === 3) {
        const cachedProject2 = qc.getQueryData<DeletionWorkflowProjectDetail>(
          ['deletion-workflow-project', projectId],
        )
        const deviceId = cachedProject2?.device_id
        if (deviceId) {
          setAutoRunCurrentTaskId(3) // 분석 중 스피너 표시
          const ok = await ensureRedundancyAnalysis(deviceId)
          if (!autoRunRef.current) break
          if (!ok) {
            autoRunRef.current = false
            break
          }
        }
      }

      setTaskTimings((prev) => ({ ...prev, [taskId]: { startedAt: Date.now() } }))
      setAutoRunCurrentTaskId(taskId)
      try {
        const result = await runProjectTask(projectId, taskId)
        // 완료 즉시 캐시 업데이트 (다음 태스크 판정 + 체크마크 즉각 표시)
        const completedAt = Date.now()
        setTaskTimings((prev) => ({ ...prev, [taskId]: { ...prev[taskId], completedAt } }))
        qc.setQueryData(
          ['deletion-workflow-project', projectId],
          (old: DeletionWorkflowProjectDetail | undefined) => {
            if (!old) return old
            const newFiles: ProjectFileState[] = result.outputs.map((o) => ({
              task_id: result.task_id,
              slot: o.slot,
              filename: o.filename,
              created_at: new Date().toISOString(),
            }))
            const existing = (old.files ?? []).filter(
              (f) => !(f.task_id === result.task_id && newFiles.some((nf) => nf.slot === f.slot)),
            )
            return { ...old, files: [...existing, ...newFiles] }
          },
        )
      } catch (e: unknown) {
        toast.error(`${taskMeta.name} 실패: ${(e as Error).message}`)
        autoRunRef.current = false
        break
      }
    }

    setAutoRunning(false)
    setAutoRunCurrentTaskId(null)
    autoRunRef.current = false
    refresh()
  }

  const stopAutoRun = () => {
    autoRunRef.current = false
  }

  // ── 재실행 전 이후 태스크 초기화 ────────────────────────────────────────────

  const handleWillRerun = async (taskId: number) => {
    const downstreamIds = getDownstreamTaskIds(taskId)
    if (downstreamIds.length === 0) return
    await clearProjectOutputs(projectId, downstreamIds).catch(() => null)
    // 즉시 캐시에서 이후 태스크 output 파일 제거 (UI 즉각 반영)
    qc.setQueryData(
      ['deletion-workflow-project', projectId],
      (old: DeletionWorkflowProjectDetail | undefined) => {
        if (!old) return old
        return {
          ...old,
          files: (old.files ?? []).filter(
            (f) => !(downstreamIds.includes(f.task_id) && f.slot.startsWith('output_')),
          ),
        }
      },
    )
  }

  // ── 출력파일 교체 후 이후 재실행 ────────────────────────────────────────────

  const handleOutputReplaced = async (taskId: number) => {
    const downstreamIds = getDownstreamTaskIds(taskId)
    if (downstreamIds.length > 0) {
      await clearProjectOutputs(projectId, downstreamIds).catch(() => null)
    }
    refresh()
    // 이후 자동실행 시작
    const nextIdx = EXECUTION_ORDER.indexOf(taskId) + 1
    if (nextIdx < EXECUTION_ORDER.length) {
      startAutoRunFrom(EXECUTION_ORDER[nextIdx])
    }
  }

  // ── 전체 초기화 ──────────────────────────────────────────────────────────

  const handleReset = async () => {
    setResetting(true)
    try {
      const res = await resetAllProjectFiles(projectId)
      toast.success(`초기화 완료 — ${res.deleted}개 파일 삭제`)
      refresh()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setResetting(false)
      setResetConfirm(false)
    }
  }

  // ── 완료 처리 ────────────────────────────────────────────────────────────

  const handleComplete = async () => {
    setCompleting(true)
    try {
      const { blob, filename } = await completeProject(projectId)
      triggerDownload(blob, filename)
      qc.invalidateQueries({ queryKey: queryKeys.deletionWorkflowProject(projectId) })
      qc.invalidateQueries({ queryKey: queryKeys.deletionWorkflowProjects })
      toast.success('프로젝트 완료 — 결과파일이 저장되었습니다.')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setCompleting(false)
    }
  }

  // ── 렌더링 ──────────────────────────────────────────────────────────────

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

  // 진행률 계산
  const phase1Done = PHASE1_TASKS.filter((t) => hasOutput(files, t.id)).length
  const phase2Done = PHASE2_TASKS.filter((t) => hasOutput(files, t.id)).length
  const totalDone = phase1Done + phase2Done
  const totalTasks = PHASE1_TASKS.length + PHASE2_TASKS.length
  const progressPct = Math.round((totalDone / totalTasks) * 100)

  // 자동실행 버튼 텍스트
  const autoRunBlockedMeta = autoRunBlockedAt !== null
    ? ALL_TASK_META.find((t) => t.id === autoRunBlockedAt)
    : null

  // 완료 버튼 표시 조건: task 14 또는 18에 output 파일이 존재
  const canComplete = project.status !== 'completed' &&
    (hasOutput(files, 14) || hasOutput(files, 18))

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
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-xs text-ds-on-surface-variant">
              {project.device_ip} · {project.device_vendor} · 생성 {new Date(project.created_at).toLocaleDateString('ko-KR')}
            </p>
            <span className="text-ds-on-surface-variant/30 text-xs">·</span>
            {editingRefDate ? (
              <span className="flex items-center gap-1">
                <CalendarDays className="w-3 h-3 text-amber-600 shrink-0" />
                <input
                  type="date"
                  autoFocus
                  value={refDateInput}
                  onChange={(e) => setRefDateInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRefDateSave()
                    if (e.key === 'Escape') setEditingRefDate(false)
                  }}
                  className="text-xs border border-amber-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-400 bg-amber-50"
                />
                <button
                  onClick={handleRefDateSave}
                  disabled={refDateMutation.isPending}
                  title="저장"
                  className="p-0.5 rounded hover:bg-emerald-100 text-emerald-600 disabled:opacity-50"
                >
                  {refDateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => setEditingRefDate(false)}
                  title="취소"
                  className="p-0.5 rounded hover:bg-gray-100 text-ds-on-surface-variant"
                >
                  <X className="w-3 h-3" />
                </button>
                {refDateInput && (
                  <button
                    onClick={() => { setRefDateInput(''); refDateMutation.mutate(null) }}
                    className="text-[10px] text-ds-on-surface-variant/60 hover:text-ds-error underline"
                  >
                    해제
                  </button>
                )}
              </span>
            ) : (
              <button
                onClick={handleRefDateEdit}
                className="flex items-center gap-1 text-xs group"
                title="기준일 수정"
              >
                <CalendarDays className="w-3 h-3 text-amber-600 shrink-0" />
                {project.reference_date
                  ? <span className="text-amber-700 font-medium">기준일: {project.reference_date}</span>
                  : <span className="text-ds-on-surface-variant/50">기준일: 당일</span>
                }
                <Pencil className="w-2.5 h-2.5 text-ds-on-surface-variant/40 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* 완료됨 배지 or 완료 버튼 */}
          {project.status === 'completed' ? (
            <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
              <PackageCheck className="w-3 h-3" /> 완료됨
            </span>
          ) : canComplete && (
            <button
              onClick={handleComplete}
              disabled={completing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {completing ? <Loader2 className="w-3 h-3 animate-spin" /> : <PackageCheck className="w-3 h-3" />}
              완료
            </button>
          )}
          {/* 자동실행 / 중지 */}
          {autoRunning ? (
            <button
              onClick={stopAutoRun}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
            >
              <Square className="w-3 h-3" /> 중지
            </button>
          ) : (
            <button
              onClick={() => startAutoRunFrom()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90 transition-colors"
            >
              <Zap className="w-3 h-3" /> 자동실행
            </button>
          )}
          {/* 초기화 */}
          <button
            onClick={() => setResetConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-ds-outline-variant/40 text-ds-on-surface-variant hover:bg-ds-surface-container transition-colors"
          >
            <RotateCcw className="w-3 h-3" /> 초기화
          </button>
        </div>
      </div>

      {/* 진행률 바 */}
      <div className="px-6 py-3 border-b border-ds-outline-variant/20 bg-ds-surface-container-low/30 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-ds-outline-variant/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[11px] font-medium text-ds-on-surface-variant whitespace-nowrap">
            {totalDone} / {totalTasks} 완료
          </span>
          <span className="text-[11px] text-ds-on-surface-variant/60 whitespace-nowrap">
            Phase1 {phase1Done}/{PHASE1_TASKS.length}
            {phase1Done === PHASE1_TASKS.length && <span className="text-emerald-500 ml-1">✓</span>}
            &nbsp;·&nbsp;
            Phase2 {phase2Done}/{PHASE2_TASKS.length}
            {phase2Done === PHASE2_TASKS.length && <span className="text-emerald-500 ml-1">✓</span>}
          </span>
          {autoRunning && autoRunCurrentTaskId !== null && (
            <span className="text-[11px] text-ds-tertiary flex items-center gap-1 whitespace-nowrap">
              <Loader2 className="w-3 h-3 animate-spin" />
              {ALL_TASK_META.find((t) => t.id === autoRunCurrentTaskId)?.name ?? `Task ${autoRunCurrentTaskId}`} 실행 중
            </span>
          )}
          {!autoRunning && autoRunBlockedMeta && (
            <span className="text-[11px] text-amber-700 whitespace-nowrap">
              ⏸ {autoRunBlockedMeta.name} — 파일 업로드 필요
            </span>
          )}
        </div>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-auto px-6 py-5 space-y-6">

        <Task0Section
          projectId={projectId}
          files={files}
          hasPeerIp={hasPeerIp}
          autoRunCurrentTaskId={autoRunCurrentTaskId}
          onRefresh={refresh}
          onBeforeExtract={async () => {
            const cur = await getProject(projectId).catch(() => null)
            if (!cur) return true
            return checkSync(cur)
          }}
        />

        <section>
          <h2 className="text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wider mb-3">
            Phase 1 — 신청정보 처리
          </h2>
          <div className="space-y-3">
            {PHASE1_TASKS.map((t) => (
              <TaskCard
                key={t.id} task={t} phase={1}
                projectId={projectId} files={files}
                autoRunCurrentTaskId={autoRunCurrentTaskId}
                timing={taskTimings[t.id]}
                onRefresh={refresh}
                onOutputReplaced={handleOutputReplaced}
                onWillRerun={handleWillRerun}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wider mb-3">
            Phase 2 — 정책 분류·공지
          </h2>
          <div className="space-y-3">
            {PHASE2_TASKS.map((t) => (
              <TaskCard
                key={t.id} task={t} phase={2}
                projectId={projectId} files={files}
                autoRunCurrentTaskId={autoRunCurrentTaskId}
                timing={taskTimings[t.id]}
                onRefresh={refresh}
                onOutputReplaced={handleOutputReplaced}
                onWillRerun={handleWillRerun}
              />
            ))}
          </div>
        </section>

      </div>

      {/* 동기화 확인 모달 */}
      {syncConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-96 space-y-4">
            <div className="flex items-center gap-2 text-amber-700">
              <RefreshCcw className="w-5 h-5" />
              <span className="font-semibold">동기화 확인</span>
            </div>
            <div className="text-sm text-ds-on-surface space-y-1.5">
              <p>
                기준일 <span className="font-semibold text-amber-700">{syncConfirm.refDate}</span>과 마지막 동기화 날짜가 다릅니다.
              </p>
              <p className="text-ds-on-surface-variant text-xs">
                마지막 동기화: {syncConfirm.lastSyncDate ?? '없음'}
              </p>
              <p className="mt-2">정책 동기화를 진행하시겠습니까?</p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => { setSyncConfirm(null) }}
                className="px-4 py-2 text-sm text-ds-on-surface-variant hover:text-ds-on-surface"
              >
                취소
              </button>
              <button
                onClick={syncConfirm.onSkip}
                className="px-4 py-2 text-sm rounded-lg border border-ds-outline-variant/50 hover:bg-ds-surface-container text-ds-on-surface"
              >
                그냥 진행
              </button>
              <button
                onClick={syncConfirm.onSyncAndProceed}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90 disabled:opacity-50"
              >
                {syncing && <Loader2 className="w-4 h-4 animate-spin" />}
                <RefreshCcw className="w-4 h-4" />
                동기화 후 진행
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 초기화 확인 모달 */}
      {resetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-center gap-2 text-ds-error">
              <RotateCcw className="w-5 h-5" />
              <span className="font-semibold">출력 초기화</span>
            </div>
            <p className="text-sm text-ds-on-surface">
              모든 파일을 삭제합니다.<br />
              <span className="text-ds-on-surface-variant">태스크 출력 및 외부 업로드 파일(GSAMS, MIS CSV 등) 모두 포함됩니다.</span>
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setResetConfirm(false)}
                className="px-4 py-2 text-sm text-ds-on-surface-variant hover:text-ds-on-surface"
              >
                취소
              </button>
              <button
                onClick={handleReset}
                disabled={resetting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-ds-error text-white hover:bg-ds-error/90 disabled:opacity-50"
              >
                {resetting && <Loader2 className="w-4 h-4 animate-spin" />}
                초기화
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
