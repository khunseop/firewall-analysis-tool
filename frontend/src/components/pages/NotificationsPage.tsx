import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { CheckCircle2, Loader2, AlertTriangle, XCircle, Clock, Activity } from 'lucide-react'
import { getNotifications, type NotificationCategory, type NotificationType } from '@/api/notifications'
import { formatRelativeTime } from '@/lib/utils'
import { TableSkeleton } from '@/components/shared/Skeleton'

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

const PAGE_SIZE = 30

export function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('all')

  const category = activeTab !== 'all' && activeTab !== 'error'
    ? (activeTab as NotificationCategory)
    : undefined
  const type: NotificationType | undefined = activeTab === 'error' ? 'error' : undefined

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['notifications', activeTab],
    queryFn: ({ pageParam = 0 }) =>
      getNotifications({ skip: pageParam as number, limit: PAGE_SIZE, category, type }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((s, p) => s + p.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    initialPageParam: 0,
    staleTime: 30_000,
  })

  const items = data?.pages.flatMap((p) => p.items) ?? []
  const total = data?.pages[0]?.total ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tighter text-ds-on-surface font-headline">활동 로그</h1>
        <p className="text-ds-on-surface-variant text-sm mt-1">동기화, 분석, 시스템 이벤트 기록을 확인합니다.</p>
      </div>

      {/* Tabs + table */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center justify-between border-b border-ds-outline-variant/10 px-6 pt-2">
          <div className="flex items-center">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-sm font-semibold font-headline tracking-tight transition-colors duration-200 border-b-2 -mb-px ${
                  activeTab === tab.key
                    ? 'text-ds-tertiary border-ds-tertiary'
                    : 'text-ds-on-surface-variant border-transparent hover:text-ds-on-surface'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {total > 0 && (
            <span className="text-xs text-ds-on-surface-variant pb-2">총 {total.toLocaleString()}건</span>
          )}
        </div>

        {isLoading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : items.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-3 text-center">
            <div className="p-4 bg-ds-surface-container rounded-full">
              <Activity className="w-6 h-6 text-ds-on-surface-variant" />
            </div>
            <p className="text-sm font-semibold text-ds-on-surface">활동 기록이 없습니다</p>
            <p className="text-xs text-ds-on-surface-variant">동기화 또는 분석을 실행하면 여기에 기록됩니다.</p>
          </div>
        ) : (
          <>
            {/* Table */}
            <table className="w-full text-left border-collapse">
              <thead className="bg-ds-surface-container-low/50">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary">시간</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary">구분</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary">타입</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary">제목</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary">장비</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary">메시지</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ds-outline-variant/10">
                {items.map((n) => {
                  const typeConf = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.info
                  const Icon = typeConf.icon
                  const borderCls = CATEGORY_BORDER[n.category ?? 'system'] ?? 'border-l-ds-outline-variant'
                  return (
                    <tr key={n.id} className={`hover:bg-ds-surface-container-low/30 transition-colors border-l-2 ${borderCls}`}>
                      <td className="px-6 py-4">
                        <span className="text-xs text-ds-on-surface-variant whitespace-nowrap">{formatRelativeTime(n.timestamp)}</span>
                      </td>
                      <td className="px-6 py-4">
                        {n.category && (
                          <span className="text-[10px] font-bold text-ds-on-surface-variant uppercase tracking-wide">
                            {CATEGORY_LABEL[n.category] ?? n.category}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${TYPE_BADGE[n.type] ?? TYPE_BADGE.info}`}>
                          <Icon className="w-2.5 h-2.5" />
                          {typeConf.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-semibold text-ds-on-surface">{n.title}</span>
                      </td>
                      <td className="px-6 py-4">
                        {n.device_name && (
                          <span className="text-xs font-mono text-ds-tertiary">{n.device_name}</span>
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
              <div className="px-6 py-4 border-t border-ds-outline-variant/10 flex justify-center">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="flex items-center gap-2 text-sm font-semibold text-ds-tertiary hover:underline disabled:opacity-50"
                >
                  {isFetchingNextPage ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {isFetchingNextPage ? '로딩 중…' : '더 보기'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
