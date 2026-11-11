import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { queryKeys } from '@/api/queryKeys'
import {
  applySystemImport, changeKey, getSavedDashboardUrl, previewSystemImport, saveDashboardUrl,
  type ApplyResult, type FieldChange, type SystemImportPreview,
} from '@/api/systemImport'
import { errorMessage } from '@/lib/errorMessage'
import { SystemImportPreviewView } from './SystemImportPreviewView'

const countDevices = (changes: FieldChange[]) => new Set(changes.map((c) => c.device_id)).size

/** 시스템 현황 대시보드를 읽어 FAT 장비 정보를 갱신한다. 미리보기 → 선택 적용 → (필요 시) 되돌리기. */
export function SystemImportDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const saved = useQuery({ queryKey: queryKeys.systemDashboardUrl, queryFn: getSavedDashboardUrl })
  const [urlEdit, setUrlEdit] = useState<string | null>(null)
  const url = urlEdit ?? saved.data ?? ''

  const [preview, setPreview] = useState<SystemImportPreview | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmConnection, setConfirmConnection] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)

  const refreshDevices = () => queryClient.invalidateQueries({ queryKey: queryKeys.devices })

  const previewMutation = useMutation({
    mutationFn: async () => {
      const data = await previewSystemImport(url.trim())
      // 읽기에 성공한 주소만 저장한다 (잘못된 주소가 설정에 남지 않게)
      if (url.trim() && url.trim() !== (saved.data ?? '')) {
        await saveDashboardUrl(url)
        await queryClient.invalidateQueries({ queryKey: queryKeys.systemDashboardUrl })
        await queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      }
      return data
    },
    onSuccess: (data) => {
      setPreview(data)
      setSelected(new Set(data.diffs.flatMap((d) => d.changes).map(changeKey)))
      setConfirmConnection(false)
      setResult(null)
    },
    onError: (e: unknown) => toast.error(errorMessage(e, '대시보드를 읽지 못했습니다. 주소와 네트워크를 확인하세요.')),
  })

  const selectedChanges = useMemo(
    () => (preview?.diffs ?? []).flatMap((d) => d.changes).filter((c) => selected.has(changeKey(c))),
    [preview, selected],
  )
  const connectionCount = countDevices(selectedChanges.filter((c) => c.kind === 'connection'))

  const applyMutation = useMutation({
    mutationFn: () => applySystemImport(selectedChanges, connectionCount > 0 && confirmConnection),
    onSuccess: async (r) => {
      setResult(r)
      setPreview(null)
      await refreshDevices()
      toast.success(`${r.applied.length}건을 적용했습니다.`)
    },
    onError: (e: unknown) => toast.error(errorMessage(e, '적용하지 못했습니다. 잠시 후 다시 시도하세요.')),
  })

  const undoMutation = useMutation({
    mutationFn: () => applySystemImport(result!.reverse, result!.reverse.some((c) => c.kind === 'connection')),
    onSuccess: async (r) => {
      setResult(null)
      await refreshDevices()
      const skipped = r.skipped_conflicts.length + r.skipped_invalid.length
      toast.success(`${r.applied.length}건을 되돌렸습니다.${skipped ? ` (그 사이 바뀌어 건너뜀 ${skipped}건)` : ''}`)
    },
    onError: (e: unknown) => toast.error(errorMessage(e, '되돌리지 못했습니다. 잠시 후 다시 시도하세요.')),
  })

  const toggle = (keys: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev)
      const all = keys.every((k) => next.has(k))
      keys.forEach((k) => (all ? next.delete(k) : next.add(k)))
      return next
    })

  const canApply = selectedChanges.length > 0 && (connectionCount === 0 || confirmConnection) && !applyMutation.isPending

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">시스템 현황 가져오기</DialogTitle>
        </DialogHeader>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); if (url.trim()) previewMutation.mutate() }}
        >
          <Input
            value={url}
            onChange={(e) => setUrlEdit(e.target.value)}
            placeholder="http://대시보드주소:5012"
            aria-label="시스템 현황 대시보드 주소"
            className="bg-white border-ds-outline-variant/30 text-sm"
          />
          <Button type="submit" variant="gradient" size="auto" disabled={!url.trim() || previewMutation.isPending} className="shrink-0 px-4 py-2 text-sm font-bold rounded-md">
            {previewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '불러오기'}
          </Button>
        </form>
        <p className="text-11 text-ds-on-surface-variant">
          읽기만 하며, 아래 미리보기에서 고른 항목만 FAT에 반영됩니다. 반영 후에는 되돌릴 수 있습니다.
        </p>

        {preview && <SystemImportPreviewView preview={preview} selected={selected} onToggle={toggle} />}

        {result && (
          <div className="rounded-lg border border-ds-outline-variant/30 p-3 text-sm">
            <div className="font-semibold text-ds-on-surface">{result.applied.length}건 적용 완료</div>
            <div className="mt-1 text-xs text-ds-on-surface-variant">
              그 사이 값이 바뀌어 건너뜀 {result.skipped_conflicts.length}건 · 적용할 수 없어 제외 {result.skipped_invalid.length}건
              {result.applied.some((c) => c.kind === 'connection') && ' · IP/벤더가 바뀐 장비는 연결 테스트를 권장합니다.'}
            </div>
          </div>
        )}

        <DialogFooter className="items-center gap-3">
          {preview && connectionCount > 0 && (
            <label className="mr-auto flex cursor-pointer items-center gap-2 text-xs text-ds-error">
              <Checkbox checked={confirmConnection} onCheckedChange={(v) => setConfirmConnection(!!v)} />
              연결 정보(IP·벤더)가 바뀌는 장비 {connectionCount}대를 확인했습니다
            </label>
          )}
          {result && result.reverse.length > 0 && (
            <Button variant="subtle" size="auto" onClick={() => undoMutation.mutate()} disabled={undoMutation.isPending} className="px-4 py-2 text-sm rounded-md">
              {undoMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '되돌리기'}
            </Button>
          )}
          {preview && (
            <Button variant="gradient" size="auto" onClick={() => applyMutation.mutate()} disabled={!canApply} className="px-5 py-2 text-sm font-bold rounded-md">
              {applyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `선택한 ${selectedChanges.length}건 적용`}
            </Button>
          )}
          <Button variant="subtle" size="auto" onClick={onClose} className="px-4 py-2 text-sm rounded-md">닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
