import { cn } from '@/lib/utils'
import { Spinner } from '@/components/shared/Spinner'

interface LoadingOverlayProps {
  show: boolean
  label?: string
  className?: string
}

/**
 * 컨테이너 중앙에 살짝 표시되는 로딩 오버레이.
 * 배경은 옅게 dim 처리만 하고(블러 없음), 실제 표현은 중앙의 유리질감 pill에 집중한다.
 * 부모 요소에 position: relative가 필요하다.
 */
export function LoadingOverlay({ show, label, className }: LoadingOverlayProps) {
  return (
    <div
      aria-hidden={!show}
      className={cn(
        'absolute inset-0 z-20 flex items-center justify-center bg-ds-surface/35 transition-opacity duration-200 ease-out',
        show ? 'opacity-100' : 'pointer-events-none opacity-0',
        className
      )}
    >
      <div className="glass-panel ambient-shadow-md flex items-center gap-2.5 rounded-full px-4 py-2.5">
        <Spinner size="sm" />
        <span className="text-[12px] font-semibold text-ds-on-surface-variant">{label ?? '불러오는 중…'}</span>
      </div>
    </div>
  )
}
