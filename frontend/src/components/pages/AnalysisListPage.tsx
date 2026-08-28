import { useEffect, useState, type MouseEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Search, Check, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DeviceSelectorSingle } from '@/components/shared/DeviceSelector'
import { startAnalysis, listAnalysisTasks, deleteAnalysisTask, type AnalysisTaskListItem } from '@/api/analysis'
import { formatDate } from '@/lib/utils'
import { queryKeys } from '@/api/queryKeys'
import { EmptyState } from '@/components/shared/EmptyState'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QUICK_MODULES, PROJECT_MODULES } from './analysis-modules'
import { listAnalysisProjects, createAnalysisProject, deleteAnalysisProject, type AnalysisProject } from '@/api/analysisProjects'

/** 새 분석 다이얼로그에서 선택 가능한 모든 모듈 (quick 실행 + 프로젝트 생성). */
const SELECTABLE_MODULES = [...QUICK_MODULES, ...PROJECT_MODULES]

const ANALYSIS_TYPE_LABELS: Record<string, string> = Object.fromEntries(QUICK_MODULES.map((m) => [m.type, m.label]))

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  pending:     { label: '대기중', cls: 'bg-gray-100 text-gray-600' },
  in_progress: { label: '분석중', cls: 'bg-blue-50 text-blue-600' },
  success:     { label: '완료',   cls: 'bg-emerald-50 text-emerald-600' },
  failure:     { label: '실패',   cls: 'bg-red-50 text-red-600' },
}

/** 이력 목록의 "전체" 필터에서 quick 실행과 프로젝트를 함께 보여주기 위한 정규화된 행. */
interface UnifiedHistoryRow {
  id: string
  kind: 'quick' | 'project'
  label: string
  deviceName: string
  deviceIp: string
  statusLabel: string
  statusCls: string
  timestamp: string
  href: string
  raw: AnalysisTaskListItem | AnalysisProject
}

const PROJECT_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  draft:     { label: '초안',   cls: 'bg-gray-100 text-gray-600' },
  running:   { label: '진행중', cls: 'bg-blue-50 text-blue-600' },
  completed: { label: '완료',   cls: 'bg-emerald-50 text-emerald-600' },
}

function toUnifiedRow(item: AnalysisTaskListItem | AnalysisProject, kind: 'quick' | 'project'): UnifiedHistoryRow {
  if (kind === 'quick') {
    const t = item as AnalysisTaskListItem
    const cfg = STATUS_CONFIG[t.task_status] ?? { label: t.task_status, cls: 'bg-gray-100 text-gray-500' }
    return {
      id: `quick-${t.id}`, kind, label: ANALYSIS_TYPE_LABELS[t.task_type] ?? t.task_type,
      deviceName: t.device_name, deviceIp: t.device_ip,
      statusLabel: cfg.label, statusCls: cfg.cls,
      timestamp: t.created_at, href: `/analysis/${t.id}`, raw: t,
    }
  }
  const p = item as AnalysisProject
  const cfg = PROJECT_STATUS_CONFIG[p.status] ?? { label: p.status, cls: 'bg-gray-100 text-gray-500' }
  const module = PROJECT_MODULES.find((m) => m.type === p.module_type)
  return {
    // "생성일" 컬럼/정렬과 일치시키기 위해 updated_at이 아닌 created_at을 쓴다.
    // updated_at을 쓰면 파이프라인 단계를 실행할 때마다 값이 바뀌어 "전체" 병합 뷰의
    // 정렬 순서와 화면상 순번(#)이 계속 흔들리는 문제가 있었다.
    id: `project-${p.id}`, kind, label: module?.label ?? p.module_type,
    deviceName: p.device_name, deviceIp: p.device_ip,
    statusLabel: cfg.label, statusCls: cfg.cls,
    timestamp: p.created_at, href: `/analysis/projects/${p.module_type}/${p.id}`, raw: p,
  }
}

function CreateAnalysisDialog({ open, onClose, initialDeviceId }: { open: boolean; onClose: () => void; initialDeviceId?: number | null }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [analysisType, setAnalysisType] = useState(QUICK_MODULES[0].type)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [projectName, setProjectName] = useState('')
  const [projectMemo, setProjectMemo] = useState('')
  const [projectReferenceDate, setProjectReferenceDate] = useState('')
  const setValue = (key: string, value: unknown) => setValues((prev) => ({ ...prev, [key]: value }))

  const resetProjectForm = () => { setProjectName(''); setProjectMemo(''); setProjectReferenceDate('') }

  // 다이얼로그가 열릴 때 입력값 초기화 (렌더 중 상태 조정 패턴 — effect 내 동기 setState 회피)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setDeviceId(initialDeviceId ?? null)
      setAnalysisType(QUICK_MODULES[0].type)
      setValues({})
      resetProjectForm()
    }
  }

  const selectedModule = SELECTABLE_MODULES.find((m) => m.type === analysisType)
  const isProject = selectedModule?.kind === 'project'

  const startMutation = useMutation({
    mutationFn: () => {
      if (!deviceId) throw new Error('장비를 선택하세요.')
      const module = QUICK_MODULES.find((m) => m.type === analysisType)
      if (!module) throw new Error(`알 수 없는 분석 유형: ${analysisType}`)
      const ctx = { deviceId, values, setValue }
      const validationError = module.validate?.(ctx)
      if (validationError) throw new Error(validationError)
      return startAnalysis(deviceId, analysisType, module.buildParams(ctx))
    },
    onSuccess: () => {
      toast.success('분석이 시작되었습니다. 목록에서 진행 상황을 확인하세요.')
      queryClient.invalidateQueries({ queryKey: queryKeys.analysisTasks })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createProjectMutation = useMutation({
    mutationFn: () => {
      if (!deviceId) throw new Error('장비를 선택하세요.')
      if (!projectName.trim()) throw new Error('프로젝트명을 입력하세요.')
      return createAnalysisProject(
        analysisType, deviceId, projectName.trim(),
        projectMemo.trim() || undefined, projectReferenceDate || undefined,
      )
    },
    onSuccess: (project: AnalysisProject) => {
      toast.success('프로젝트가 생성되었습니다.')
      queryClient.invalidateQueries({ queryKey: queryKeys.analysisProjects(project.module_type) })
      queryClient.invalidateQueries({ queryKey: queryKeys.analysisProjects('all') })
      onClose()
      navigate(`/analysis/projects/${project.module_type}/${project.id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const isPending = isProject ? createProjectMutation.isPending : startMutation.isPending

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl bg-ds-surface-container-lowest max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">{isProject ? '새 프로젝트 만들기' : '새 분석 실행'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">장비 *</label>
            <DeviceSelectorSingle value={deviceId} onChange={setDeviceId} />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">분석 유형</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {SELECTABLE_MODULES.map((m) => {
                const Icon = m.icon
                const selected = analysisType === m.type
                return (
                  <button
                    key={m.type}
                    type="button"
                    onClick={() => { setAnalysisType(m.type); setValues({}); resetProjectForm() }}
                    className={`relative text-left p-3.5 rounded-xl border transition-all ${
                      selected
                        ? 'border-ds-primary bg-ds-primary/5 shadow-sm'
                        : 'border-ds-outline-variant/30 hover:border-ds-primary/40 hover:bg-ds-surface-container-low'
                    }`}
                  >
                    {selected && (
                      <span className="absolute top-2.5 right-2.5 w-4 h-4 rounded-full bg-ds-primary flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                    <Icon className={`w-4 h-4 mb-2 ${selected ? 'text-ds-primary' : 'text-ds-on-surface-variant'}`} />
                    <p className={`text-[13px] font-semibold leading-tight mb-1 ${selected ? 'text-ds-primary' : 'text-ds-on-surface'}`}>{m.label}</p>
                    <p className="text-[11px] text-ds-on-surface-variant/70 leading-snug">{m.description}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {isProject ? (
            <div className="space-y-4">
              <div>
                <Label>프로젝트명</Label>
                <Input className="mt-1" placeholder="예: 2026-06 정책 삭제" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              </div>
              <div>
                <Label>메모 (선택)</Label>
                <Input className="mt-1" placeholder="작업 메모..." value={projectMemo} onChange={(e) => setProjectMemo(e.target.value)} />
              </div>
              <div>
                <Label>
                  기준일 (선택)
                  <span className="ml-1.5 text-xs font-normal text-ds-on-surface-variant">— 만료·미사용 판단 기준일. 미설정 시 작업 당일 기준</span>
                </Label>
                <Input type="date" className="mt-1" value={projectReferenceDate} onChange={(e) => setProjectReferenceDate(e.target.value)} />
              </div>
            </div>
          ) : (
            selectedModule?.kind === 'quick' && selectedModule.renderParams?.({ deviceId, values, setValue })
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-ds-outline-variant/10">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
          <button
            type="button"
            onClick={() => (isProject ? createProjectMutation.mutate() : startMutation.mutate())}
            disabled={isPending}
            className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
          >
            {isProject
              ? (isPending ? '생성 중…' : '생성')
              : (isPending ? '실행 중…' : '실행')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const PAGE_SIZE = 20
/** "전체"/프로젝트형 뷰에서 quick 실행을 프로젝트와 합치기 위해 한 번에 가져오는 건수. */
const MERGE_FETCH_SIZE = 200

export function AnalysisListPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)
  const [prefillDeviceId, setPrefillDeviceId] = useState<number | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const deviceId = (location.state as { openCreateWithDeviceId?: number } | null)?.openCreateWithDeviceId
    if (deviceId) {
      setPrefillDeviceId(deviceId)
      setCreateOpen(true)
      navigate(location.pathname, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(id)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [search, typeFilter, statusFilter])

  const isProjectFilter = PROJECT_MODULES.some((m) => m.type === typeFilter)

  // "전체"/프로젝트형 뷰는 서버 페이지네이션 대신 큰 배치를 한 번에 받아 클라이언트에서 병합·페이지네이션한다.
  const isMergedView = typeFilter === 'all' || isProjectFilter

  const quickQuery = useQuery({
    queryKey: queryKeys.analysisTasksList(search, isProjectFilter ? 'all' : typeFilter, statusFilter, isMergedView ? 1 : page),
    queryFn: () => listAnalysisTasks({
      search: search || undefined,
      analysisType: isMergedView ? undefined : typeFilter,
      status: statusFilter === 'all' ? undefined : statusFilter,
      page: isMergedView ? 1 : page,
      pageSize: isMergedView ? MERGE_FETCH_SIZE : PAGE_SIZE,
    }),
    enabled: !isProjectFilter,
    staleTime: 5_000,
  })

  const projectQuery = useQuery({
    queryKey: queryKeys.analysisProjects(isProjectFilter ? typeFilter : 'all'),
    queryFn: async () => {
      if (isProjectFilter) return listAnalysisProjects(typeFilter)
      const all = await Promise.all(PROJECT_MODULES.map((m) => listAnalysisProjects(m.type)))
      return all.flat()
    },
    // 상태 필터는 quick 태스크 상태 어휘(pending/in_progress/…)라서 프로젝트 상태와 대응되지 않는다.
    // 상태 필터가 걸린 경우 프로젝트 행은 아예 제외한다(조회도 하지 않음).
    enabled: isMergedView && statusFilter === 'all',
    staleTime: 5_000,
  })

  const isLoading = quickQuery.isLoading || projectQuery.isLoading

  // "전체": quick(최대 MERGE_FETCH_SIZE건) + 모든 프로젝트를 합쳐 날짜순 정렬 후 클라이언트에서 페이지네이션.
  // 특정 프로젝트형 유형: 프로젝트 목록 전체를 클라이언트에서 페이지네이션.
  // 특정 quick 유형: 기존과 동일하게 백엔드 페이지네이션 그대로 사용(추가 슬라이스 없음).
  const allRows: UnifiedHistoryRow[] = (() => {
    if (isProjectFilter) {
      return (projectQuery.data ?? [])
        .map((p) => toUnifiedRow(p, 'project'))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    }
    if (typeFilter !== 'all') {
      return (quickQuery.data?.items ?? []).map((t) => toUnifiedRow(t, 'quick'))
    }
    const quickRows = (quickQuery.data?.items ?? []).map((t) => toUnifiedRow(t, 'quick'))
    const projectRows = (projectQuery.data ?? []).map((p) => toUnifiedRow(p, 'project'))
    return [...quickRows, ...projectRows].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
  })()

  const total = isMergedView ? allRows.length : (quickQuery.data?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rows = isMergedView ? allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : allRows

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: number) => deleteAnalysisTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.analysisTasks })
      toast.success('분석 작업이 삭제되었습니다.')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteProjectMutation = useMutation({
    mutationFn: (project: AnalysisProject) => deleteAnalysisProject(project.id),
    onSuccess: (_data, project) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.analysisProjects(project.module_type) })
      queryClient.invalidateQueries({ queryKey: queryKeys.analysisProjects('all') })
      toast.success('프로젝트가 삭제되었습니다.')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleDelete = async (e: MouseEvent, row: UnifiedHistoryRow) => {
    e.stopPropagation()
    if (row.kind === 'quick') {
      const task = row.raw as AnalysisTaskListItem
      const ok = await confirm({
        title: '분석 결과 삭제',
        description: `[${ANALYSIS_TYPE_LABELS[task.task_type] ?? task.task_type}] ${task.device_name} 분석 결과를 삭제하시겠습니까?`,
        variant: 'destructive',
        confirmLabel: '삭제',
      })
      if (ok) deleteTaskMutation.mutate(task.id)
      return
    }
    const project = row.raw as AnalysisProject
    const ok = await confirm({
      title: '프로젝트 삭제',
      description: `"${project.name}" 프로젝트와 모든 저장 파일이 삭제됩니다.`,
      variant: 'destructive',
      confirmLabel: '삭제',
    })
    if (ok) deleteProjectMutation.mutate(project)
  }

  return (
    <div className="flex flex-col gap-6">
      {ConfirmDialogElement}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">정책 분석</h1>
          <p className="text-[12px] text-ds-on-surface-variant mt-0.5">장비별 정책 분석 작업을 실행하고 이력을 관리합니다.</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold btn-primary-gradient text-ds-on-tertiary rounded-lg shadow-sm hover:opacity-90 transition-all"
        >
          <Plus className="w-4 h-4" />
          새 분석 실행
        </button>
      </div>

      {/* 필터 바 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-3 py-2 flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-ds-on-surface-variant shrink-0" />
          <input
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="장비명 검색…"
            className="flex-1 text-[13px] bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/50"
          />
        </div>
        <ShadSelect value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44 bg-white border-ds-outline-variant/30 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 유형</SelectItem>
            {QUICK_MODULES.map((m) => <SelectItem key={m.type} value={m.type}>{m.label}</SelectItem>)}
            {PROJECT_MODULES.map((m) => <SelectItem key={m.type} value={m.type}>{m.label}</SelectItem>)}
          </SelectContent>
        </ShadSelect>
        <ShadSelect value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 bg-white border-ds-outline-variant/30 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            <SelectItem value="pending">대기중</SelectItem>
            <SelectItem value="in_progress">분석중</SelectItem>
            <SelectItem value="success">완료</SelectItem>
            <SelectItem value="failure">실패</SelectItem>
          </SelectContent>
        </ShadSelect>
      </div>

      {/* 목록 */}
      <div className="card rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-[13px] text-ds-on-surface-variant">로딩 중…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="실행된 분석이 없습니다." />
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-ds-outline-variant/20">
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs w-16">#</th>
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs">장비</th>
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs">분석유형</th>
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs w-24">상태</th>
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs w-40">생성일</th>
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs w-40">완료일</th>
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs w-12"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={row.id}
                  onClick={() => navigate(row.href)}
                  className="border-b border-ds-outline-variant/10 hover:bg-black/[0.02] cursor-pointer"
                >
                  {/* row.raw.id는 분석 실행(analysistasks)과 프로젝트(analysis_projects)가
                      서로 다른 ID 시퀀스라 "전체" 병합 뷰에서 섞으면 숫자가 뒤섞여 보인다.
                      화면상 순번(페이지 오프셋 포함)을 대신 표시해 항상 정렬된 것처럼 보이게 한다. */}
                  <td className="py-2.5 px-4 text-ds-on-surface-variant text-xs">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-ds-on-surface text-[13px]">{row.deviceName}</div>
                    <div className="text-[11px] text-ds-on-surface-variant">{row.deviceIp}</div>
                  </td>
                  <td className="py-2.5 px-4 text-[13px] text-ds-on-surface">{row.label}</td>
                  <td className="py-2.5 px-4"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.statusCls}`}>{row.statusLabel}</span></td>
                  <td className="py-2.5 px-4 text-ds-on-surface-variant text-xs">{formatDate(row.timestamp)}</td>
                  <td className="py-2.5 px-4 text-ds-on-surface-variant text-xs">
                    {row.kind === 'quick' && (row.raw as AnalysisTaskListItem).completed_at ? formatDate((row.raw as AnalysisTaskListItem).completed_at!) : '-'}
                  </td>
                  <td className="py-2.5 px-4">
                    <button
                      onClick={(e) => handleDelete(e, row)}
                      disabled={row.kind === 'quick' && (row.raw as AnalysisTaskListItem).task_status === 'in_progress'}
                      className="p-1 rounded text-ds-on-surface-variant/60 hover:text-ds-error hover:bg-ds-error/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 페이지네이션 */}
      {total > 0 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-1.5 rounded-lg border border-ds-outline-variant/30 text-ds-on-surface-variant hover:bg-ds-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[12px] text-ds-on-surface-variant tabular-nums">{page} / {totalPages} 페이지 (총 {total.toLocaleString()}건)</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="p-1.5 rounded-lg border border-ds-outline-variant/30 text-ds-on-surface-variant hover:bg-ds-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      <CreateAnalysisDialog open={createOpen} onClose={() => setCreateOpen(false)} initialDeviceId={prefillDeviceId} />
    </div>
  )
}
