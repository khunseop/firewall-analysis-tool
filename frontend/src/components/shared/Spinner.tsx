import { useId } from 'react'
import { cn } from '@/lib/utils'

const SIZES = { sm: 16, md: 24, lg: 36 } as const

interface SpinnerProps {
  size?: keyof typeof SIZES
  className?: string
}

/** 레이더 스캔을 형상화한 브랜드 스피너 — 정지된 외곽 링 위로 sweep 아크가 회전한다. */
export function Spinner({ size = 'md', className }: SpinnerProps) {
  const dim = SIZES[size]
  const gradientId = useId()

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: dim, height: dim }}>
      <svg viewBox="0 0 24 24" width={dim} height={dim} className="absolute inset-0 text-ds-outline-variant/25">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        width={dim}
        height={dim}
        className="absolute inset-0 animate-spin motion-reduce:animate-none text-ds-tertiary"
        style={{ animationDuration: '1s' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
          </linearGradient>
        </defs>
        <path
          d="M12 2 A10 10 0 0 1 20.66 7"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-[3px] w-[3px] rounded-full bg-ds-tertiary motion-reduce:animate-pulse" />
      </div>
    </div>
  )
}
