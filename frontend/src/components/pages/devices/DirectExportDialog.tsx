import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, FileDown } from 'lucide-react'
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

export function DirectExportDialog({ open, onClose, devices }: {
  open: boolean; onClose: () => void; devices: Device[]
}) {
  const [exportType, setExportType] = useState<DirectExportType>('policies')
  const [source, setSource] = useState<'live' | 'db'>('live')
  const [merge, setMerge] = useState(false)
  const [useSsh, setUseSsh] = useState(false)
  const [timeout, setTimeout_] = useState(600)
  const [progress, setProgress] = useState<{ current: number; total: number; name: string } | null>(null)
  const [errors, setErrors] = useState<{ name: string; msg: string }[]>([])

  const loading = progress !== null

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
      setProgress(null)
      setErrors([])
    }
  }

  const handleExport = async () => {
    if (devices.length === 0) return
    const label = EXPORT_TYPE_OPTIONS.find(o => o.type === exportType)?.label ?? exportType

    if (merge && devices.length > 1) {
      setProgress({ current: 1, total: 1, name: `${devices.length}개 장비 병합 중` })
      try {
        await bulkExportDevices(devices, exportType, {
          source, merge: true,
          use_ssh: exportType === 'hit_dates' ? useSsh : false,
          timeout_seconds: timeout,
        })
        setProgress(null)
        toast.success(`${devices.length}개 장비 ${label} 통합 추출 완료`)
        onClose()
      } catch (e: unknown) {
        setProgress(null)
        setErrors([{ name: '통합 추출', msg: (e as Error).message }])
      }
      return
    }

    const errs: { name: string; msg: string }[] = []
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i]
      setProgress({ current: i + 1, total: devices.length, name: d.name })
      try {
        if (source === 'db') {
          await bulkExportDevices([d], exportType, {
            source: 'db',
            use_ssh: exportType === 'hit_dates' ? useSsh : false,
            timeout_seconds: timeout,
          })
        } else {
          await directExport(d, exportType, {
            use_ssh: exportType === 'hit_dates' ? useSsh : false,
            timeout_seconds: timeout,
          })
        }
      } catch (e: unknown) {
        errs.push({ name: d.name, msg: (e as Error).message })
      }
    }
    setProgress(null)
    setErrors(errs)
    if (errs.length === 0) {
      toast.success(`${devices.length}개 장비 ${label} 추출 완료`)
      onClose()
    } else if (errs.length < devices.length) {
      toast.warning(`${devices.length - errs.length}개 성공, ${errs.length}개 실패`)
    }
  }

  const needsTimeout = exportType !== 'objects'

  return (
    <Dialog open={open} onOpenChange={loading ? undefined : onClose}>
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
            : <><span className="font-semibold text-ds-on-surface">{devices.length}개 장비</span>에서 순차 추출</>
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
              max={3600}
              value={timeout}
              onChange={(e) => setTimeout_(Number(e.target.value))}
              className="bg-white border-ds-outline-variant/30 text-sm w-24 text-right"
            />
            <span className="text-[11px] text-ds-on-surface-variant">초 / 장비</span>
          </div>
        )}

        {progress && (
          <div className="px-1 space-y-1">
            <div className="flex justify-between text-[11px] text-ds-on-surface-variant">
              <span className="truncate">{progress.name}</span>
              <span className="shrink-0 tabular-nums">{progress.current} / {progress.total}</span>
            </div>
            <div className="h-1.5 rounded-full bg-ds-outline-variant/20 overflow-hidden">
              <div
                className="h-full bg-ds-primary rounded-full transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {errors.length > 0 && !loading && (
          <div className="px-1 space-y-1">
            {errors.map(({ name, msg }) => (
              <p key={name} className="text-[11px] text-ds-error">
                <span className="font-semibold">{name}</span>: {msg}
              </p>
            ))}
          </div>
        )}

        <DialogFooter>
          <button type="button" onClick={onClose} disabled={loading} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors disabled:opacity-40">
            {errors.length > 0 && !loading ? '닫기' : '취소'}
          </button>
          <button
            onClick={handleExport}
            disabled={loading}
            className="flex items-center gap-1.5 px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
          >
            {loading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />수집 중…</>
              : <><FileDown className="w-3.5 h-3.5" />추출</>
            }
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
