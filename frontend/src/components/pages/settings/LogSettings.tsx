import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { deleteOldNotifications } from '@/api/notifications'

export function LogSettings() {
  const [days, setDays] = useState(90)
  const [isDeleting, setIsDeleting] = useState(false)
  const { confirm, ConfirmDialogElement } = useConfirm()

  const handleCleanup = async () => {
    const ok = await confirm({
      title: '오래된 로그 정리',
      description: `${days}일 이상 된 활동 로그를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
      variant: 'destructive',
      confirmLabel: '삭제'
    })
    if (!ok) return
    setIsDeleting(true)
    try {
      const result = await deleteOldNotifications(days)
      toast.success(`${result.deleted}건의 로그가 삭제되었습니다.`)
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      {ConfirmDialogElement}
      <div className="bg-ds-surface-container-low/50 rounded-lg border border-ds-outline-variant/8 px-4 py-4">
        <p className="text-[12px] font-semibold text-ds-on-surface mb-0.5">로그 자동 정리</p>
        <p className="text-[11px] text-ds-on-surface-variant/70 mb-4">지정한 일수보다 오래된 활동 로그를 삭제합니다.</p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-20 h-8 px-3 text-[12px] bg-white border border-ds-outline-variant/30 rounded-lg focus:outline-none focus:border-ds-tertiary text-center"
            />
            <span className="text-[12px] text-ds-on-surface-variant">일 이상 된 로그 삭제</span>
          </div>
          <button
            onClick={handleCleanup}
            disabled={isDeleting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-ds-error text-white rounded-lg hover:brightness-110 transition-all disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isDeleting ? '삭제 중…' : '지금 정리'}
          </button>
        </div>
        <p className="text-[10px] text-ds-on-surface-variant/60 mt-3">권장 보존 기간: 90일 이상</p>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// 삭제 워크플로우 설정
// ──────────────────────────────────────────────────────────────────
