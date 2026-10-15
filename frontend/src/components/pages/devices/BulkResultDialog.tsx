import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface BulkResultRow { id: number; name: string; ok: boolean; message: string }

export interface BulkRunState {
  title: string
  rows: BulkResultRow[]
  total: number
  running: boolean
  retry: (() => void) | null
}

/**
 * 여러 장비에 대한 일괄 작업(연결 테스트·동기화 요청·삭제) 결과표.
 * 토스트는 몇 초 뒤 사라져 결과를 비교·재확인할 수 없으므로, 장비별 성공/실패와 사유를 표로 남기고
 * 실패한 장비만 다시 실행할 수 있게 한다.
 */
export function BulkResultDialog({ state, onClose }: { state: BulkRunState | null; onClose: () => void }) {
  const failed = state?.rows.filter((r) => !r.ok).length ?? 0
  const succeeded = (state?.rows.length ?? 0) - failed

  return (
    <Dialog open={!!state} onOpenChange={(open) => { if (!open && !state?.running) onClose() }}>
      <DialogContent className="max-w-2xl bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">{state?.title}</DialogTitle>
          <DialogDescription className="text-13 text-ds-on-surface-variant" aria-live="polite">
            {state?.running
              ? `진행 중… ${state.rows.length} / ${state.total}대`
              : `${state?.total ?? 0}대 중 성공 ${succeeded}대${failed > 0 ? ` · 실패 ${failed}대` : ''}`}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-ds-outline-variant/15">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-ds-surface-container-low text-ds-on-surface-variant">
              <tr>
                <th scope="col" className="text-left font-semibold px-3 py-2 w-48">장비</th>
                <th scope="col" className="text-left font-semibold px-3 py-2 w-20">결과</th>
                <th scope="col" className="text-left font-semibold px-3 py-2">상세</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ds-outline-variant/10">
              {state?.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-mono font-semibold text-ds-on-surface break-all">{r.name}</td>
                  <td className="px-3 py-2">
                    {r.ok
                      ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" />성공</span>
                      : <span className="inline-flex items-center gap-1 font-semibold text-ds-error"><AlertCircle className="w-3.5 h-3.5" />실패</span>}
                  </td>
                  <td className={`px-3 py-2 break-words ${r.ok ? 'text-ds-on-surface-variant' : 'text-ds-error'}`}>{r.message}</td>
                </tr>
              ))}
              {state?.running && (
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-ds-on-surface-variant">
                    <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />나머지 장비 처리 중…</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          {failed > 0 && state?.retry && !state.running && (
            <Button type="button" variant="subtle" size="auto" onClick={state.retry} className="px-4 py-2 text-sm font-semibold rounded-md">
              실패한 {failed}대만 다시 시도
            </Button>
          )}
          <Button type="button" variant="gradient" size="auto" onClick={onClose} disabled={state?.running} className="px-5 py-2 text-sm font-bold rounded-md">
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
