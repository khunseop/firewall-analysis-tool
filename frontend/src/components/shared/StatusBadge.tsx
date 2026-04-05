import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  status: string | null | undefined
  showLabel?: boolean
  className?: string
}

const STATUS_MAP: Record<string, { dot: string; label: string }> = {
  success: { dot: 'bg-green-500', label: '완료' },
  in_progress: { dot: 'bg-blue-500 animate-pulse', label: '진행중' },
  pending: { dot: 'bg-amber-400', label: '대기' },
  failure: { dot: 'bg-red-500', label: '실패' },
  error: { dot: 'bg-red-500', label: '오류' },
}

export function StatusBadge({ status, showLabel = true, className }: StatusBadgeProps) {
  const config = status ? STATUS_MAP[status] : null

  if (!config) {
    return (
      <span className={cn('flex items-center gap-1.5 text-sm text-muted-foreground', className)}>
        <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
        {showLabel && <span>-</span>}
      </span>
    )
  }

  return (
    <span className={cn('flex items-center gap-1.5 text-sm', className)}>
      <span className={cn('w-2 h-2 rounded-full inline-block', config.dot)} />
      {showLabel && <span>{config.label}</span>}
    </span>
  )
}
