/**
 * React Query 쿼리키 중앙 팩토리.
 *
 * 문자열 키를 파일마다 하드코딩하면 오타·무효화 누락 위험이 있으므로
 * 모든 queryKey / invalidateQueries 는 이 팩토리를 사용한다.
 */
export const queryKeys = {
  // 장비
  devices: ['devices'] as const,
  device: (deviceId: number | null | undefined) => ['device', deviceId] as const,

  // 객체 (다중 장비 목록 조회)
  networkObjects: (deviceIds: number[]) => ['network-objects', ...deviceIds] as const,
  networkGroups: (deviceIds: number[]) => ['network-groups', ...deviceIds] as const,
  services: (deviceIds: number[]) => ['services', ...deviceIds] as const,
  serviceGroups: (deviceIds: number[]) => ['service-groups', ...deviceIds] as const,
  objectUsageCounts: (deviceIds: number[]) => ['object-usage-counts', ...deviceIds] as const,
  objectDetail: (deviceId: number, name: string) => ['object-detail', deviceId, name] as const,

  // 정책
  policySearch: (req: unknown) => ['policy-search', req] as const,
  policiesRaw: (deviceId: number | null | undefined) => ['policies-raw', deviceId] as const,
  policyHistory: (deviceId: number, ruleName: string) => ['policy-history', deviceId, ruleName] as const,
  policyDiff: (deviceId: number | null, fromSyncId: number | null, toSyncId: number | null) =>
    ['policy-diff', deviceId, fromSyncId, toSyncId] as const,
  syncHistory: (deviceId: number | null) => ['sync-history', deviceId] as const,

  // 분석
  analysisTasks: ['analysis-tasks'] as const,
  analysisTasksList: (search: string, typeFilter: string, statusFilter: string, page: number) =>
    ['analysis-tasks', search, typeFilter, statusFilter, page] as const,
  analysisTask: (taskId: number | string | undefined) => ['analysis-task', taskId] as const,
  analysisTaskResult: (taskId: number | string | undefined) => ['analysis-task-result', taskId] as const,

  // 대시보드 · 통계
  dashboardStats: ['dashboard-stats'] as const,
  changeStats: (...args: unknown[]) => ['change-stats', ...args] as const,

  // 삭제 워크플로우
  deletionWorkflowTasks: ['deletion-workflow-tasks'] as const,
  deletionWorkflowProjects: ['deletion-workflow-projects'] as const,
  deletionWorkflowProject: (projectId: number | string | undefined) =>
    ['deletion-workflow-project', projectId] as const,
  deletionWorkflowConfig: ['deletion-workflow-config'] as const,

  // 기타
  schedules: ['schedules'] as const,
  settings: ['settings'] as const,
  users: ['users'] as const,
  notifications: (tab: string, search: string, dateFrom: string, dateTo: string) =>
    ['notifications', tab, search, dateFrom, dateTo] as const,
}
