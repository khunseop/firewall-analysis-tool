import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded bg-ds-surface-container-high/60', className)} />
  )
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full overflow-hidden">
      {/* header */}
      <div className="flex gap-4 px-8 py-4 border-b border-ds-outline-variant/10 bg-ds-surface-container-low/50">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-8 py-5 border-b border-ds-outline-variant/10">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-4 flex-1', c === 0 && 'max-w-[140px]')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border p-6 space-y-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-9 w-20" />
      <Skeleton className="h-3 w-32" />
    </div>
  )
}

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
