import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SSH_HIT_COMMAND_OPTIONS, fromSshHitCommandChoice, type SshHitCommandChoice } from './constants'

export function BulkOptionsDialog({ open, onClose, count, initial, onSubmit }: {
  open: boolean; onClose: () => void; count: number
  initial: { collect_last_hit_date: boolean; use_ssh_for_last_hit_date: boolean; ssh_hit_command_mode: SshHitCommandChoice }
  onSubmit: (opts: { collect_last_hit_date: boolean; use_ssh_for_last_hit_date: boolean; ssh_hit_command_mode: 'vsys_all' | 'vsys_name' | null }) => void
}) {
  const [form, setForm] = useState(initial)
  // 열릴 때 초기값 재설정 (렌더 중 상태 조정 패턴)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setForm(initial)
  }
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">수집 옵션 일괄 변경</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-ds-on-surface-variant">선택된 {count}개 장비에 동일하게 적용됩니다.</p>
        <div className="flex flex-col gap-3 py-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer text-ds-on-surface-variant">
            <Checkbox checked={form.collect_last_hit_date} onCheckedChange={(v) => setForm(f => ({ ...f, collect_last_hit_date: !!v }))} />
            최근 사용일 수집
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-ds-on-surface-variant">
            <Checkbox checked={form.use_ssh_for_last_hit_date} onCheckedChange={(v) => setForm(f => ({ ...f, use_ssh_for_last_hit_date: !!v }))} />
            SSH로 최근 사용일 수집
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-ds-on-surface-variant shrink-0">SSH 수집 명령</span>
            <ShadSelect value={form.ssh_hit_command_mode} onValueChange={(v) => setForm(f => ({ ...f, ssh_hit_command_mode: v as SshHitCommandChoice }))}>
              <SelectTrigger className="bg-white border-ds-outline-variant/30 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SSH_HIT_COMMAND_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </ShadSelect>
          </div>
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
          <Button variant="gradient" size="auto" onClick={() => onSubmit({ ...form, ssh_hit_command_mode: fromSshHitCommandChoice(form.ssh_hit_command_mode) })} className="px-5 py-2 text-sm font-bold rounded-md">적용</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
