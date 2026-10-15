import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAnalysisTasks, type AnalysisTaskListItem } from '@/api/analysis'
import { listAnalysisProjects, type AnalysisProject } from '@/api/analysisProjects'
import { queryKeys } from '@/api/queryKeys'
import { QUICK_MODULES, PROJECT_MODULES } from '../analysis-modules'
import { isActiveTask, statusMetaOf, type StatusGroup, type StatusMeta } from './analysisModel'

/** 이력 표가 한 번에 가져오는 분석 실행 건수 상한. 넘으면 표 위에 안내한다(조용히 자르지 않는다). */
export const HISTORY_FETCH_SIZE = 200
const POLL_MS = 3000

export interface HistoryRow {
  id: string
  kind: 'quick' | 'project'
  typeKey: string
  typeLabel: string
  title: string | null
  deviceId: number
  deviceName: string
  deviceIp: string
  status: StatusMeta
  timestamp: string
  href: string
  raw: AnalysisTaskListItem | AnalysisProject
}

function toRow(item: AnalysisTaskListItem | AnalysisProject, kind: 'quick' | 'project'): HistoryRow {
  if (kind === 'quick') {
    const t = item as AnalysisTaskListItem
    const mod = QUICK_MODULES.find((m) => m.type === t.task_type)
    return {
      id: `quick-${t.id}`, kind, typeKey: t.task_type, typeLabel: mod?.label ?? t.task_type, title: null,
      deviceId: t.device_id, deviceName: t.device_name, deviceIp: t.device_ip,
      status: statusMetaOf(t.task_status, 'quick'), timestamp: t.created_at, href: `/analysis/${t.id}`, raw: t,
    }
  }
  const p = item as AnalysisProject
  const mod = PROJECT_MODULES.find((m) => m.type === p.module_type)
  return {
    id: `project-${p.id}`, kind, typeKey: p.module_type, typeLabel: mod?.label ?? p.module_type, title: p.name,
    deviceId: p.device_id, deviceName: p.device_name, deviceIp: p.device_ip,
    status: statusMetaOf(p.status, 'project'), timestamp: p.created_at, href: `/analysis/projects/${p.module_type}/${p.id}`, raw: p,
  }
}

const byNewest = (a: HistoryRow, b: HistoryRow) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()

export interface HistoryFilters { search: string; typeFilter: string; statusFilter: StatusGroup | 'all' }

/**
 * 분석 실행(quick)과 프로젝트(삭제 워크플로우 등)를 하나의 이력으로 합쳐 돌려준다.
 * 두 조회는 따로 실패할 수 있으므로 오류를 각각 노출해, 한쪽이 실패해도 다른 쪽 이력은 보여주고 빠진 종류를 알릴 수 있게 한다.
 * 진행 중인 작업이 있는 동안에만 3초마다 자동 갱신한다.
 */
export function useAnalysisHistory({ search, typeFilter, statusFilter }: HistoryFilters) {
  const isProjectType = PROJECT_MODULES.some((m) => m.type === typeFilter)
  const quickTypeFilter = typeFilter === 'all' || isProjectType ? undefined : typeFilter

  const quick = useQuery({
    queryKey: queryKeys.analysisTasksList(search, quickTypeFilter ?? 'all', 'all', 1),
    queryFn: () => listAnalysisTasks({ search: search || undefined, analysisType: quickTypeFilter, page: 1, pageSize: HISTORY_FETCH_SIZE }),
    enabled: !isProjectType,
    staleTime: 5_000,
    refetchInterval: (q) => (q.state.data?.items.some(isActiveTask) ? POLL_MS : false),
  })

  const projects = useQuery({
    queryKey: queryKeys.analysisProjects(isProjectType ? typeFilter : 'all'),
    queryFn: async () => {
      if (isProjectType) return listAnalysisProjects(typeFilter)
      return (await Promise.all(PROJECT_MODULES.map((m) => listAnalysisProjects(m.type)))).flat()
    },
    enabled: typeFilter === 'all' || isProjectType,
    staleTime: 5_000,
    refetchInterval: (q) => (q.state.data?.some((p) => p.status === 'running') ? POLL_MS : false),
  })

  // 프로젝트 목록 API는 검색을 지원하지 않아 장비명 검색은 여기서 적용한다(분석 실행은 서버에서 이미 필터링됨).
  const rows = useMemo(() => {
    const q = search.toLowerCase()
    const projectRows = (projects.data ?? [])
      .filter((p) => !q || p.device_name.toLowerCase().includes(q) || p.device_ip.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .map((p) => toRow(p, 'project'))
    const quickRows = (quick.data?.items ?? []).map((t) => toRow(t, 'quick'))
    return [...quickRows, ...projectRows]
      .filter((r) => statusFilter === 'all' || r.status.group === statusFilter)
      .sort(byNewest)
  }, [quick.data, projects.data, search, statusFilter])

  const quickEnabled = !isProjectType
  const projectsEnabled = typeFilter === 'all' || isProjectType
  const truncated = quickEnabled && !!quick.data && quick.data.total > quick.data.items.length

  return {
    rows,
    quick, projects, quickEnabled, projectsEnabled,
    truncated, quickTotal: quick.data?.total ?? 0,
    isLoading: (quickEnabled && quick.isLoading) || (projectsEnabled && projects.isLoading),
    // 둘 다 실패했거나, 하나만 켜져 있는데 그 하나가 실패했으면 "이력을 불러오지 못함"으로 취급한다.
    failedAll: (!quickEnabled || (quick.isError && !quick.data)) && (!projectsEnabled || (projects.isError && !projects.data)),
    isFetching: quick.isFetching || projects.isFetching,
    refetch: () => { void quick.refetch(); void projects.refetch() },
  }
}

/** 장비×유형 "마지막 실행 현황"의 원천 — 필터와 무관한 최근 이력. 필터가 없으면 이력 표와 같은 쿼리를 공유한다. */
export function useRecentTasks() {
  return useQuery({
    queryKey: queryKeys.analysisTasksList('', 'all', 'all', 1),
    queryFn: () => listAnalysisTasks({ page: 1, pageSize: HISTORY_FETCH_SIZE }),
    staleTime: 5_000,
    refetchInterval: (q) => (q.state.data?.items.some(isActiveTask) ? POLL_MS : false),
  })
}
