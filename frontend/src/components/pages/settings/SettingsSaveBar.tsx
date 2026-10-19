import { Save, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * 모든 설정 탭이 공유하는 저장 바 — 탭마다 저장 방식이 달라 헷갈리던 문제를 없애려고 한 곳에서 맡는다.
 * 변경이 있을 때만 저장·되돌리기가 켜지고, 저장이 막힌 이유(blockedReason)는 상태 문구 자리에 보인다.
 */
export function SettingsSaveBar({ dirty, saving, onSave, onRevert, blockedReason, children }: {
  dirty: boolean
  saving?: boolean
  onSave: () => void
  onRevert: () => void
  /** 값이 잘못돼 저장할 수 없을 때 이유 */
  blockedReason?: string | null
  /** 저장 바 오른쪽에 붙는 보조 동작(백업·복구 등) */
  children?: React.ReactNode
}) {
  const blocked = dirty && !!blockedReason
  return (
    <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex flex-wrap items-center gap-3 border-t border-ds-outline-variant/15 bg-white px-6 py-3">
      <p role="status" aria-live="polite" className={`text-xs font-medium ${blocked ? 'text-ds-error' : dirty ? 'text-amber-800' : 'text-ds-on-surface-variant'}`}>
        {blocked ? blockedReason : dirty ? '저장되지 않은 변경사항이 있습니다' : '변경사항이 없습니다'}
      </p>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onRevert}
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-ds-on-surface-variant rounded-lg border border-ds-outline-variant/30 hover:bg-ds-surface-container-low disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
        >
          <Undo2 className="w-3.5 h-3.5" />되돌리기
        </button>
        <Button
          type="button"
          variant="gradient"
          size="auto"
          onClick={onSave}
          disabled={!dirty || blocked || saving}
          className="gap-1.5 px-4 py-2 text-13 font-semibold rounded-lg"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? '저장 중…' : '저장'}
        </Button>
      </div>
    </div>
  )
}
