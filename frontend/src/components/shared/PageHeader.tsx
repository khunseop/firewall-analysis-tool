import { cn } from '@/lib/utils'

/**
 * 공통 페이지 헤더 — 페이지마다 제각각 복붙되던 타이틀/설명/액션 레이아웃을 표준화한다.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between shrink-0 gap-4', className)}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">{title}</h1>
        {description && <p className="text-[13px] text-ds-on-surface-variant/70 mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
