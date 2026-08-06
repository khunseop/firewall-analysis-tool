import { useState } from 'react'
import { toast } from 'sonner'
import { FileDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { directExport, bulkExportDevices, type Device, type DirectExportType } from '@/api/devices'

const EXPORT_TYPE_OPTIONS: { type: DirectExportType; label: string; desc: string }[] = [
  { type: 'policies',  label: '정책',    desc: '보안 정책 목록 전체' },
  { type: 'objects',   label: '객체',    desc: '주소/서비스 객체·그룹 (4개 시트)' },
  { type: 'hit_dates', label: '사용이력', desc: 'HA Peer 포함 최신 히트 일시' },
]

export function DirectExportDialog({ open, onClose, devices, onTasksStarted }: {
  open: boolean; onClose: () => void; devices: Device[]
  onTasksStarted: (taskIds: number[], exportType: DirectExportType) => void
}) {
  const [exportType, setExportType] = useState<DirectExportType>('policies')
  const [source, setSource] = useState<'live' | 'db'>('live')
  const [merge, setMerge] = useState(false)
  const [useSsh, setUseSsh] = useState(false)
  const [timeout, setTimeout_] = useState(600)
  const [submitting, setSubmitting] = useState(false)

  // 열릴 때 초기값 재설정 (렌더 중 상태 조정 패턴)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setExportType('policies')
      setSource('live')
      setMerge(false)
      setUseSsh(devices.length === 1 ? devices[0].use_ssh_for_last_hit_date : false)
      setTimeout_(600)
      setSubmitting(false)
    }
  }

  const handleExport = async () => {
    if (devices.length === 0) return
    const label = EXPORT_TYPE_OPTIONS.find(o => o.type === exportType)?.label ?? exportType
    setSubmitting(true)

    try {
      if (merge && devices.length > 1) {
        const { task_id } = await bulkExportDevices(devices, exportType, {
          source, merge: true,
          use_ssh: exportType === 'hit_dates' ? useSsh : false,
          timeout_seconds: timeout,
        })
        onTasksStarted([task_id], exportType)
        toast.success(`${devices.length}개 장비 ${label} 통합 추출을 백그라운드에서 시작했습니다.`)
      } else {
        // 장비별로 요청이 응답되는 즉시 등록 — 모든 요청이 끝나길 기다리면
        // 먼저 완료된 장비의 WebSocket 상태 메시지가 아직 등록되지 않은 태스크를 못 찾아 유실될 수 있음
        let startedCount = 0
        const failed: string[] = []
        const results = await Promise.allSettled(devices.map(async (d) => {
          const { task_id } = await (
            source === 'db'
              ? bulkExportDevices([d], exportType, {
                  source: 'db',
                  use_ssh: exportType === 'hit_dates' ? useSsh : false,
                  timeout_seconds: timeout,
                })
              : directExport(d, exportType, {
                  use_ssh: exportType === 'hit_dates' ? useSsh : false,
                  timeout_seconds: timeout,
                })
          )
          onTasksStarted([task_id], exportType)
          startedCount += 1
        }))

        results.forEach((res, i) => {
          if (res.status === 'rejected') failed.push(devices[i].name)
        })

        if (startedCount > 0) {
          toast.success(`${startedCount}개 장비 ${label} 추출을 백그라운드에서 시작했습니다.`)
        }
        if (failed.length > 0) {
          toast.error(`${failed.join(', ')} 추출 시작 실패`)
        }
      }
      onClose()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const needsTimeout = exportType !== 'objects'

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">직접 추출</DialogTitle>
        </DialogHeader>
        <p className="text-[12px] text-ds-on-surface-variant">
          {devices.length === 1
            ? <>
                <span className="font-semibold text-ds-on-surface">{devices[0].name}</span>
                {devices[0].ha_peer_ip && <span className="ml-1.5 text-[10px] text-ds-tertiary font-semibold">HA</span>}
              </>
            : <><span className="font-semibold text-ds-on-surface">{devices.length}개 장비</span>에서 백그라운드로 추출</>
          }
        </p>
        <div className="space-y-2 py-1">
          {EXPORT_TYPE_OPTIONS.map(({ type, label, desc }) => (
            <button
              key={type}
              type="button"
              onClick={() => setExportType(type)}
              className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${exportType === type ? 'border-ds-primary bg-ds-primary/5' : 'border-ds-outline-variant/20 hover:border-ds-outline-variant/40 bg-white'}`}
            >
              <span className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 ${exportType === type ? 'border-ds-primary bg-ds-primary' : 'border-ds-outline-variant'}`} />
              <span>
                <span className="text-[13px] font-semibold text-ds-on-surface">{label}</span>
                <span className="block text-[11px] text-ds-on-surface-variant mt-0.5">{desc}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 px-1">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary shrink-0">추출 방식</Label>
          <div className="flex gap-1.5">
            <button
              type="button" onClick={() => setSource('live')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${source === 'live' ? 'border-ds-primary bg-ds-primary/5 text-ds-primary' : 'border-ds-outline-variant/30 text-ds-on-surface-variant hover:bg-ds-surface-container-low'}`}
            >
              실시간(장비 접속)
            </button>
            <button
              type="button" onClick={() => setSource('db')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${source === 'db' ? 'border-ds-primary bg-ds-primary/5 text-ds-primary' : 'border-ds-outline-variant/30 text-ds-on-surface-variant hover:bg-ds-surface-container-low'}`}
            >
              DB(동기화 데이터)
            </button>
          </div>
        </div>

        {devices.length > 1 && (
          <div className="flex items-center gap-2 px-1">
            <Checkbox id="merge-export" checked={merge} onCheckedChange={(v) => setMerge(!!v)} />
            <label htmlFor="merge-export" className="text-[12px] text-ds-on-surface-variant cursor-pointer select-none">
              하나의 엑셀로 합치기
            </label>
          </div>
        )}

        {exportType === 'hit_dates' && (
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              id="use-ssh"
              checked={useSsh}
              onCheckedChange={(v) => setUseSsh(!!v)}
            />
            <label htmlFor="use-ssh" className="text-[12px] text-ds-on-surface-variant cursor-pointer select-none">
              SSH로 수집 (API 대신)
            </label>
          </div>
        )}

        {needsTimeout && (
          <div className="flex items-center gap-2 px-1">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary shrink-0">타임아웃</Label>
            <Input
              type="number"
              min={30}
              max={7200}
              value={timeout}
              onChange={(e) => setTimeout_(Number(e.target.value))}
              className="bg-white border-ds-outline-variant/30 text-sm w-24 text-right"
            />
            <span className="text-[11px] text-ds-on-surface-variant">초 / 장비 (최대 2시간)</span>
          </div>
        )}

        <p className="px-1 text-[11px] text-ds-on-surface-variant">
          추출은 백그라운드에서 진행되며, 완료되면 알림으로 다운로드 링크가 표시됩니다.
        </p>

        <DialogFooter>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">
            취소
          </button>
          <button
            onClick={handleExport}
            disabled={submitting}
            className="flex items-center gap-1.5 px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
          >
            <FileDown className="w-3.5 h-3.5" />추출 시작
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
