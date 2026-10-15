import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Play, FolderPlus, Search, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { ActionMenu } from '@/components/shared/ActionMenu'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { deleteAnalysisTask, type AnalysisTaskListItem } from '@/api/analysis'
import { deleteAnalysisProject, type AnalysisProject } from '@/api/analysisProjects'
import { queryKeys } from '@/api/queryKeys'
import { formatDate } from '@/lib/utils'
import { QUICK_MODULES, PROJECT_MODULES, getQuickModule } from './analysis-modules'
import { AnalysisHistoryTable } from './analysis/AnalysisHistoryTable'
import { RunningTasksStrip } from './analysis/RunningTasksStrip'
import { LatestRunMatrix } from './analysis/LatestRunMatrix'
import { StartAnalysisDialog, type StartAnalysisInitial } from './analysis/StartAnalysisDialog'
import { CreateProjectDialog } from './analysis/CreateProjectDialog'
import { describeTaskResult, STATUS_GROUP_LABEL, type StatusGroup } from './analysis/analysisModel'
import { HISTORY_FETCH_SIZE, useAnalysisHistory, useRecentTasks, type HistoryRow } from './analysis/useAnalysisHistory'

const PAGE_SIZE = 20

/** 다른 화면(장비 메뉴, 분석 상세의 "다시 실행")이 이 페이지로 이동하며 실행 다이얼로그를 미리 채워 열 때 쓰는 state. */
interface LocationState { openCreateWithDeviceId?: number; rerun?: StartAnalysisInitial }

/** 삭제 확인 문구에 넣을 "무엇이 사라지는지" — 유형·장비·실행 시각·결과 건수. */
function describeTaskForConfirm(t: AnalysisTaskListItem, typeLabel: string): string {
  const result = describeTaskResult(t)
  return `${typeLabel} · ${t.device_name} · ${formatDate(t.created_at)} 실행 (${result.kind === 'failure' ? '실패한 실행' : result.text})`
}

export function AnalysisListPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirm()
  const [startOpen, setStartOpen] = useState(false)
  const [startInitial, setStartInitial] = useState<StartAnalysisInitial | null>(null)
  const [projectModuleType, setProjectModuleType] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusGroup | 'all'>('all')
  const [page, setPage] = useState(1)

  const openStart = (initial: StartAnalysisInitial | null) => { setStartInitial(initial); setStartOpen(true) }

  useEffect(() => {
    const state = location.state as LocationState | null
    if (state?.rerun) openStart(state.rerun)
    else if (state?.openCreateWithDeviceId) openStart({ deviceId: state.openCreateWithDeviceId })
    else return
    navigate(location.pathname, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(id)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [search, typeFilter, statusFilter])

  const history = useAnalysisHistory({ search, typeFilter, statusFilter })
  const recent = useRecentTasks()

  const runningRows = useMemo(() => history.rows.filter((r) => r.status.group === 'running'), [history.rows])
  // 같은 장비에 이미 분석이 돌고 있으면 새 요청이 조용히 버려지므로, 실행 다이얼로그에서 그 장비를 막는다.
  const busyDeviceIds = useMemo(
    () => new Set((recent.data?.items ?? []).filter((t) => t.task_status === 'pending' || t.task_status === 'in_progress').map((t) => t.device_id)),
    [recent.data],
  )

  const totalPages = Math.max(1, Math.ceil(history.rows.length / PAGE_SIZE))
  const pageRows = history.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const filtersActive = !!search || typeFilter !== 'all' || statusFilter !== 'all'

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: number) => deleteAnalysisTask(taskId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.analysisTasks }); toast.success('분석 이력을 삭제했습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })
  const deleteProjectMutation = useMutation({
    mutationFn: (project: AnalysisProject) => deleteAnalysisProject(project.id),
    onSuccess: (_d, project) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.analysisProjects(project.module_type) })
      queryClient.invalidateQueries({ queryKey: queryKeys.analysisProjects('all') })
      toast.success('프로젝트를 삭제했습니다.')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleDelete = async (row: HistoryRow) => {
    if (row.kind === 'quick') {
      const task = row.raw as AnalysisTaskListItem
      const ok = await confirm({
        title: '분석 이력을 삭제할까요?',
        description: `${describeTaskForConfirm(task, row.typeLabel)}. 저장된 결과도 함께 삭제되며 되돌릴 수 없습니다.`,
        variant: 'destructive', confirmLabel: '삭제',
      })
      if (ok) deleteTaskMutation.mutate(task.id)
      return
    }
    const project = row.raw as AnalysisProject
    const ok = await confirm({
      title: '프로젝트를 삭제할까요?',
      description: `"${project.name}" (${row.deviceName}) 프로젝트와 저장된 모든 단계 결과 파일이 삭제되며 되돌릴 수 없습니다.`,
      variant: 'destructive', confirmLabel: '삭제',
    })
    if (ok) deleteProjectMutation.mutate(project)
  }

  const handleRerun = (task: AnalysisTaskListItem) => {
    const mod = getQuickModule(task.task_type)
    openStart({
      type: task.task_type,
      deviceId: task.device_id,
      // 기준이 기록되지 않은 과거 실행분은 유형·장비만 채운다
      values: task.params && mod?.paramsToValues ? mod.paramsToValues(task.params) : {},
    })
  }

  const projectItems = PROJECT_MODULES.map((m) => ({
    key: m.type, label: `${m.label} 프로젝트 만들기`, icon: <FolderPlus className="w-3.5 h-3.5" />, onSelect: () => setProjectModuleType(m.type),
  }))

  // 한쪽 조회가 실패했다면 합계가 틀리므로 건수를 말하지 않는다(아래 배너가 이유를 알린다).
  const partialFailure = (history.quickEnabled && history.quick.isError) || (history.projectsEnabled && history.projects.isError)
  const description = partialFailure
    ? undefined
    : `이력 ${(history.quickTotal + (history.projects.data?.length ?? 0)).toLocaleString()}건${runningRows.length > 0 ? ` · 진행 중 ${runningRows.length}건` : ''}`

  return (
    <div className="flex flex-col gap-6">
      {ConfirmDialogElement}
      <PageHeader
        title="분석"
        description={history.isLoading ? undefined : description}
        actions={
          <>
            {projectItems.length === 1 ? (
              <Button variant="subtle" size="auto" onClick={projectItems[0].onSelect} className="gap-1.5 px-3 py-2 text-13 font-medium rounded-lg">
                <FolderPlus className="!w-3.5 !h-3.5" />{projectItems[0].label}
              </Button>
            ) : projectItems.length > 1 ? (
              <ActionMenu label="프로젝트 만들기" icon={<FolderPlus className="!w-3.5 !h-3.5" />} items={projectItems} />
            ) : null}
            <Button variant="gradient" size="auto" onClick={() => openStart(null)} className="gap-1.5 px-3.5 py-2 text-sm font-semibold rounded-lg">
              <Play className="!w-4 !h-4" />분석 실행
            </Button>
          </>
        }
      />

      <RunningTasksStrip rows={runningRows} />

      <LatestRunMatrix
        tasks={recent.data?.items ?? []}
        truncated={(recent.data?.total ?? 0) > (recent.data?.items.length ?? 0)}
        error={recent.isError && !recent.data ? (recent.error as Error).message : null}
        onRetry={() => { void recent.refetch() }}
      />

      {/* 필터 */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-3 py-2 flex-1 min-w-48 max-w-xs">
          <Search className="w-3.5 h-3.5 text-ds-on-surface-variant shrink-0" aria-hidden="true" />
          <input
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="장비명·IP 검색…" aria-label="장비명 또는 IP 검색"
            className="flex-1 text-13 bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/70"
          />
        </div>
        <ShadSelect value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger aria-label="종류 필터" className="w-48 bg-white border-ds-outline-variant/30 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 종류</SelectItem>
            {QUICK_MODULES.map((m) => <SelectItem key={m.type} value={m.type}>{m.label}</SelectItem>)}
            {PROJECT_MODULES.map((m) => <SelectItem key={m.type} value={m.type}>{m.label} (프로젝트)</SelectItem>)}
          </SelectContent>
        </ShadSelect>
        <ShadSelect value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusGroup | 'all')}>
          <SelectTrigger aria-label="상태 필터" className="w-32 bg-white border-ds-outline-variant/30 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            {(Object.keys(STATUS_GROUP_LABEL) as StatusGroup[]).map((g) => <SelectItem key={g} value={g}>{STATUS_GROUP_LABEL[g]}</SelectItem>)}
          </SelectContent>
        </ShadSelect>
      </div>

      {/* 한쪽만 실패 — 성공한 쪽 이력은 보여주되 빠진 종류를 알린다 */}
      {!history.failedAll && history.quickEnabled && history.quick.isError && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 flex items-center gap-3 text-11 text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">분석 실행 이력을 불러오지 못해 프로젝트만 표시 중입니다. ({(history.quick.error as Error).message})</span>
          <Button variant="subtle" size="auto" onClick={() => { void history.quick.refetch() }} className="px-3 py-1.5 text-xs font-semibold rounded-lg">다시 시도</Button>
        </div>
      )}
      {!history.failedAll && history.projectsEnabled && history.projects.isError && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 flex items-center gap-3 text-11 text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">프로젝트 이력을 불러오지 못해 분석 실행 이력만 표시 중입니다. ({(history.projects.error as Error).message})</span>
          <Button variant="subtle" size="auto" onClick={() => { void history.projects.refetch() }} className="px-3 py-1.5 text-xs font-semibold rounded-lg">다시 시도</Button>
        </div>
      )}
      {history.truncated && (
        <p className="text-11 text-ds-on-surface-variant">
          분석 실행 이력이 많아 최근 {HISTORY_FETCH_SIZE}건만 표시 중입니다(전체 {history.quickTotal.toLocaleString()}건). 종류나 장비로 좁혀서 보세요.
        </p>
      )}

      {/* 이력 */}
      <div className="card rounded-xl overflow-hidden">
        {history.failedAll ? (
          <div role="alert" className="m-4 rounded-xl border border-ds-error/25 bg-ds-error/5 px-4 py-3 flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-ds-error shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-13 font-semibold text-ds-error">분석 이력을 불러오지 못했습니다</p>
              <p className="text-11 text-ds-on-surface-variant mt-0.5">
                이력이 없는 것이 아니라 조회에 실패한 것입니다. {((history.quick.error ?? history.projects.error) as Error | null)?.message}
              </p>
            </div>
            <Button variant="subtle" size="auto" onClick={history.refetch} disabled={history.isFetching} className="px-3 py-1.5 text-xs font-semibold rounded-lg shrink-0">다시 시도</Button>
          </div>
        ) : history.isLoading ? (
          <div className="py-16 text-center text-13 text-ds-on-surface-variant">이력을 불러오는 중…</div>
        ) : pageRows.length === 0 ? (
          filtersActive ? (
            <EmptyState
              title="조건에 맞는 이력이 없습니다"
              description="검색어나 필터를 바꿔 보세요."
              action={<Button variant="subtle" size="auto" onClick={() => { setSearchInput(''); setTypeFilter('all'); setStatusFilter('all') }} className="px-3 py-1.5 text-xs font-semibold rounded-lg">필터 초기화</Button>}
            />
          ) : (
            <EmptyState
              title="아직 실행한 분석이 없습니다"
              description="분석을 실행하면 시점별 결과가 이력으로 남습니다."
              action={<Button variant="gradient" size="auto" onClick={() => openStart(null)} className="px-4 py-2 text-sm font-semibold rounded-lg">분석 실행</Button>}
            />
          )
        ) : (
          <AnalysisHistoryTable rows={pageRows} onRerun={handleRerun} onDelete={handleDelete} />
        )}
      </div>

      {/* 페이지네이션 */}
      {history.rows.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="이전 페이지"
            className="p-1.5 rounded-lg border border-ds-outline-variant/30 text-ds-on-surface-variant hover:bg-ds-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <span className="text-xs text-ds-on-surface-variant tabular-nums">{page} / {totalPages} 페이지 (표시 {history.rows.length.toLocaleString()}건)</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} aria-label="다음 페이지"
            className="p-1.5 rounded-lg border border-ds-outline-variant/30 text-ds-on-surface-variant hover:bg-ds-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <StartAnalysisDialog open={startOpen} onClose={() => setStartOpen(false)} initial={startInitial} busyDeviceIds={busyDeviceIds} />
      {projectModuleType && (
        <CreateProjectDialog open onClose={() => setProjectModuleType(null)} moduleType={projectModuleType} />
      )}
    </div>
  )
}
