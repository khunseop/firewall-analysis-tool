import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { deleteOldNotifications } from '@/api/notifications'
import { errorMessage } from '@/lib/errorMessage'

const MIN_DAYS = 1
const MAX_DAYS = 3650

export function LogSettings() {
  const uid = useId()
  const [daysText, setDaysText] = useState('90')
  const [isDeleting, setIsDeleting] = useState(false)
  const { confirm, ConfirmDialogElement } = useConfirm()

  const days = Number(daysText)
  const daysError = !/^\d+$/.test(daysText.trim()) || days < MIN_DAYS || days > MAX_DAYS
    ? `${MIN_DAYS}~${MAX_DAYS} 사이의 정수를 입력하세요.` : null

  const handleCleanup = async () => {
    if (daysError) return
    const ok = await confirm({
      title: '오래된 활동 로그 삭제',
      description: `${days}일 이상 된 활동 로그를 삭제합니다. 삭제한 로그는 되돌릴 수 없습니다.`,
      variant: 'destructive',
      confirmLabel: '삭제',
    })
    if (!ok) return
    setIsDeleting(true)
    try {
      const result = await deleteOldNotifications(days)
      toast.success(`${result.deleted}건의 로그가 삭제되었습니다.`)
    } catch (e: unknown) {
      toast.error(errorMessage(e, '로그를 삭제하지 못했습니다. 잠시 후 다시 시도하세요.'))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      {ConfirmDialogElement}
      <section aria-labelledby={`${uid}-title`} className="rounded-lg border border-ds-error/30 px-4 py-4">
        <h3 id={`${uid}-title`} className="text-13 font-semibold text-ds-on-surface">활동 로그 삭제</h3>
        <p className="text-xs text-ds-on-surface-variant mt-0.5 mb-4">
          지정한 일수보다 오래된 활동 로그(알림 기록)를 지금 삭제합니다. 자동으로 예약되어 실행되지는 않으며, 버튼을 누를 때만 실행됩니다.
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <div className="flex items-center gap-2">
              <input
                id={`${uid}-days`}
                type="number"
                inputMode="numeric"
                min={MIN_DAYS}
                max={MAX_DAYS}
                value={daysText}
                onChange={(e) => setDaysText(e.target.value)}
                aria-label="보존할 일수"
                aria-invalid={!!daysError}
                className="w-20 h-8 px-3 text-xs bg-white border border-ds-outline-variant/30 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40 focus:border-ds-tertiary text-center aria-[invalid=true]:border-ds-error"
              />
              <label htmlFor={`${uid}-days`} className="text-xs text-ds-on-surface-variant">일 이상 된 로그 삭제</label>
            </div>
            {daysError && <p className="mt-1 text-xs text-ds-error">{daysError}</p>}
          </div>
          <button
            type="button"
            onClick={handleCleanup}
            disabled={isDeleting || !!daysError}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-ds-error text-white rounded-lg hover:brightness-110 transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isDeleting ? '삭제 중…' : '지금 삭제'}
          </button>
        </div>
        <p className="text-11 text-ds-on-surface-variant mt-3">권장 보존 기간: 90일 이상</p>
      </section>
    </div>
  )
}
