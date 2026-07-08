/**
 * 공통 빈 상태 컴포넌트 — 페이지마다 제각각이던 "데이터 없음" 표시를 표준화한다.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-8">
      {Icon && (
        <div className="p-4 bg-ds-surface-container rounded-full mb-4">
          <Icon className="w-6 h-6 text-ds-on-surface-variant" />
        </div>
      )}
      <p className="text-sm font-semibold text-ds-on-surface">{title}</p>
      {description && <p className="text-xs text-ds-on-surface-variant mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
