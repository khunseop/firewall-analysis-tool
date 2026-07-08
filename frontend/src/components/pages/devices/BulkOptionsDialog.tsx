import { useState, useEffect } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

export function BulkOptionsDialog({ open, onClose, count, initial, onSubmit }: {
  open: boolean; onClose: () => void; count: number
  initial: { collect_last_hit_date: boolean; use_ssh_for_last_hit_date: boolean }
  onSubmit: (opts: { collect_last_hit_date: boolean; use_ssh_for_last_hit_date: boolean }) => void
}) {
  const [form, setForm] = useState(initial)
  useEffect(() => { if (open) setForm(initial) }, [open])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">수집 옵션 일괄 변경</DialogTitle>
        </DialogHeader>
        <p className="text-[12px] text-ds-on-surface-variant">선택된 {count}개 장비에 동일하게 적용됩니다.</p>
        <div className="flex flex-col gap-3 py-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer text-ds-on-surface-variant">
            <Checkbox checked={form.collect_last_hit_date} onCheckedChange={(v) => setForm(f => ({ ...f, collect_last_hit_date: !!v }))} />
            최근 사용일 수집
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-ds-on-surface-variant">
            <Checkbox checked={form.use_ssh_for_last_hit_date} onCheckedChange={(v) => setForm(f => ({ ...f, use_ssh_for_last_hit_date: !!v }))} />
            SSH로 최근 사용일 수집
          </label>
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
          <button onClick={() => onSubmit(form)} className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md">적용</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
