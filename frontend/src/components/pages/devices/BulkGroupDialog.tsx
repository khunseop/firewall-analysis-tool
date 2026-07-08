import { useState, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

export function BulkGroupDialog({ open, onClose, count, existingGroups, initial, onSubmit }: {
  open: boolean; onClose: () => void; count: number
  existingGroups: string[]; initial: string
  onSubmit: (group: string) => void
}) {
  const [group, setGroup] = useState(initial)
  useEffect(() => { if (open) setGroup(initial) }, [open])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">그룹 일괄 설정</DialogTitle>
        </DialogHeader>
        <p className="text-[12px] text-ds-on-surface-variant">선택된 {count}개 장비에 동일하게 적용됩니다.</p>
        <div className="space-y-1 py-2">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">그룹명</Label>
          <Input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="그룹명 입력 (비워두면 그룹 해제)"
            list="existing-groups"
            className="bg-white border-ds-outline-variant/30 text-sm"
          />
          {existingGroups.length > 0 && (
            <datalist id="existing-groups">
              {existingGroups.map(g => <option key={g} value={g} />)}
            </datalist>
          )}
          {existingGroups.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {existingGroups.map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroup(g)}
                  className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-ds-tertiary/10 text-ds-tertiary hover:bg-ds-tertiary/20 transition-colors"
                >
                  {g}
                </button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
          <button onClick={() => onSubmit(group)} className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md">적용</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
