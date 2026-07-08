import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { CheckCircle2, Loader2, AlertTriangle, XCircle, Clock, Activity, Search, X } from 'lucide-react'
import { getNotifications, type NotificationCategory, type NotificationType } from '@/api/notifications'
import { formatRelativeTime } from '@/lib/utils'
import { TableSkeleton } from '@/components/shared/Skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { queryKeys } from '@/api/queryKeys'

const TYPE_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  success: { icon: CheckCircle2,  color: 'text-green-600',     label: '성공' },
  info:    { icon: Clock,         color: 'text-ds-tertiary',   label: '정보' },
  warning: { icon: AlertTriangle, color: 'text-amber-600',     label: '경고' },
  error:   { icon: XCircle,       color: 'text-ds-error',      label: '오류' },
}

const TYPE_BADGE: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  info:    'bg-blue-100 text-blue-700',
  warning: 'bg-amber-100 text-amber-700',
  error:   'bg-red-100 text-red-700',
}

const CATEGORY_BORDER: Record<string, string> = {
  sync:     'border-l-ds-tertiary',
  analysis: 'border-l-purple-500',
  system:   'border-l-ds-outline-variant',
}

const CATEGORY_LABEL: Record<string, string> = {
  sync:     '동기화',
  analysis: '분석',
  system:   '시스템',
}

type TabKey = 'all' | NotificationCategory | 'error'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all',      label: '전체' },
  { key: 'sync',     label: '동기화' },
  { key: 'analysis', label: '분석' },
  { key: 'system',   label: '시스템' },
  { key: 'error',    label: '오류' },
]

const PAGE_SIZE = 50

export function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [appliedDateFrom, setAppliedDateFrom] = useState('')
  const [appliedDateTo, setAppliedDateTo] = useState('')

  const category = activeTab !== 'all' && activeTab !== 'error'
    ? (activeTab as NotificationCategory)
    : undefined
  const type: NotificationType | undefined = activeTab === 'error' ? 'error' : undefined

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch } = useInfiniteQuery({
    queryKey: queryKeys.notifications(activeTab, appliedSearch, appliedDateFrom, appliedDateTo),
    queryFn: ({ pageParam = 0 }) =>
      getNotifications({
        skip: pageParam as number,
        limit: PAGE_SIZE,
        category,
        type,
        search: appliedSearch || undefined,
        date_from: appliedDateFrom || undefined,
        date_to: appliedDateTo || undefined,
      }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((s, p) => s + p.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    initialPageParam: 0,
    staleTime: 30_000,
  })

  const items = data?.pages.flatMap((p) => p.items) ?? []
  const total = data?.pages[0]?.total ?? 0

  const handleApply = () => {
    setAppliedSearch(search)
    setAppliedDateFrom(dateFrom)
    setAppliedDateTo(dateTo)
  }

  const handleReset = () => {
    setSearch(''); setDateFrom(''); setDateTo('')
    setAppliedSearch(''); setAppliedDateFrom(''); setAppliedDateTo('')
  }

  const hasActiveFilter = appliedSearch || appliedDateFrom || appliedDateTo

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">Notifications</h1>
      </div>

      {/* Search / date filter bar */}
      <div className="card rounded-xl px-5 py-4 flex flex-wrap gap-3 items-end shrink-0">
        {/* 검색어 */}
        <div className="flex-1 min-w-48 space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant">검색</label>
          <div className="flex items-center gap-2 bg-ds-surface-container-low rounded-md px-3 py-1.5 border border-ds-outline-variant/20">
            <Search className="w-3.5 h-3.5 text-ds-outline shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleApply()}
              placeholder="제목, 메시지, 장비명…"
              className="flex-1 bg-transparent text-sm focus:outline-none text-ds-on-surface placeholder:text-ds-outline/50"
            />
            {search && (
              <button onClick={() => setSearch('')} className="shrink-0">
                <X className="w-3.5 h-3.5 text-ds-on-surface-variant hover:text-ds-on-surface" />
              </button>
            )}
          </div>
        </div>

        {/* 날짜 시작 */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant">시작일</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 px-2.5 text-sm bg-ds-surface-container-low rounded-md border border-ds-outline-variant/20 focus:outline-none focus:border-ds-tertiary text-ds-on-surface"
          />
        </div>

        {/* 날짜 종료 */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant">종료일</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 px-2.5 text-sm bg-ds-surface-container-low rounded-md border border-ds-outline-variant/20 focus:outline-none focus:border-ds-tertiary text-ds-on-surface"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleReset}
            disabled={!search && !dateFrom && !dateTo && !hasActiveFilter}
            className="h-8 px-3 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors disabled:opacity-40"
          >
            초기화
          </button>
          <button
            onClick={handleApply}
            className="h-8 px-4 text-[12px] font-semibold btn-primary-gradient text-ds-on-tertiary rounded-lg shadow-sm hover:opacity-90 transition-all"
          >
            검색
          </button>
        </div>
      </div>

      {/* Tabs + table */}
      <div className="card rounded-xl overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center justify-between border-b border-ds-outline-variant/8 px-5 pt-2">
          <div className="flex items-center">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-[13px] font-semibold tracking-tight transition-colors duration-200 border-b-2 -mb-px ${
                  activeTab === tab.key
                    ? 'text-ds-tertiary border-ds-tertiary'
                    : 'text-ds-on-surface-variant border-transparent hover:text-ds-on-surface'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 pb-2">
            {hasActiveFilter && (
              <span className="text-[10px] font-bold text-ds-tertiary bg-ds-tertiary/10 px-2 py-0.5 rounded">필터 적용됨</span>
            )}
            {total > 0 && (
              <span className="text-xs text-ds-on-surface-variant">총 {total.toLocaleString()}건</span>
            )}
          </div>
        </div>

        {isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : items.length === 0 ? (
          <EmptyState icon={Activity} title="활동 기록이 없습니다" description="동기화 또는 분석을 실행하면 여기에 기록됩니다." />
        ) : (
          <>
            {/* Table */}
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-ds-outline-variant/8 bg-ds-surface-container-low/30">
                  <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">시간</th>
                  <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">구분</th>
                  <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">타입</th>
                  <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">제목</th>
                  <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">장비</th>
                  <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">사용자</th>
                  <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">메시지</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ds-outline-variant/8">
                {items.map((n) => {
                  const typeConf = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.info
                  const Icon = typeConf.icon
                  const borderCls = CATEGORY_BORDER[n.category ?? 'system'] ?? 'border-l-ds-outline-variant'
                  return (
                    <tr key={n.id} className={`hover:bg-ds-surface-container-low/30 transition-colors border-l-2 ${borderCls}`}>
                      <td className="px-5 py-3">
                        <span className="text-xs text-ds-on-surface-variant whitespace-nowrap">{formatRelativeTime(n.timestamp)}</span>
                      </td>
                      <td className="px-5 py-3">
                        {n.category && (
                          <span className="text-[10px] font-bold text-ds-on-surface-variant uppercase tracking-wide">
                            {CATEGORY_LABEL[n.category] ?? n.category}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${TYPE_BADGE[n.type] ?? TYPE_BADGE.info}`}>
                          <Icon className="w-2.5 h-2.5" />
                          {typeConf.label}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-sm font-semibold text-ds-on-surface">{n.title}</span>
                      </td>
                      <td className="px-5 py-3">
                        {n.device_name && (
                          <span className="text-xs font-mono text-ds-tertiary">{n.device_name}</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {n.username ? (
                          <span className="text-xs font-mono text-ds-on-surface-variant">{n.username}</span>
                        ) : (
                          <span className="text-xs text-ds-on-surface-variant/40">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 max-w-xs">
                        <span className="text-xs text-ds-on-surface-variant truncate block">{n.message}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Load more */}
            {hasNextPage && (
              <div className="px-5 py-3 border-t border-ds-outline-variant/8 flex justify-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="flex items-center gap-2 text-sm font-semibold text-ds-tertiary hover:underline disabled:opacity-50"
                >
                  {isFetchingNextPage ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {isFetchingNextPage ? '로딩 중…' : `더 보기 (${total - items.length}건 남음)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
