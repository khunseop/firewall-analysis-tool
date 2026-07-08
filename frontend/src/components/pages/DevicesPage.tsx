import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatRelativeTime } from '@/lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Upload, Download, RefreshCw, Pencil, Trash2, Wifi, Search, XCircle, ChevronDown, ExternalLink, Settings2, Tag, CheckCircle2, AlertCircle, Loader2, FileDown, ListFilter, Boxes, BarChart3 } from 'lucide-react'
import type { ColDef, IRowNode } from '@ag-grid-community/core'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import {
  listDevices, createDevice, updateDevice, deleteDevice,
  testConnection, syncAll, downloadDeviceTemplate, bulkImportDevices, directExport, bulkExportDevices,
  type Device, type DeviceCreate, type DeviceUpdate, type DirectExportType,
} from '@/api/devices'
import { useSyncStatusWebSocket, type SyncStatusMessage } from '@/hooks/useWebSocket'
import { notify } from '@/store/notificationStore'
import { useDeviceStore } from '@/store/deviceStore'
import { capacityLevel } from '@/lib/deviceCapacity'
import { DeviceDetailDialog } from './devices/DeviceDetailDialog'

const VENDOR_OPTIONS = [
  { code: 'paloalto', label: 'Palo Alto' },
  { code: 'ngf',      label: 'SECUI NGF' },
  { code: 'mf2',      label: 'SECUI MF2' },
  { code: 'mock',     label: 'Mock' },
]

const VENDOR_BADGE: Record<string, string> = {
  paloalto: 'bg-orange-50 text-orange-600 border border-orange-100',
  ngf:      'bg-blue-50 text-blue-600 border border-blue-100',
  mf2:      'bg-cyan-50 text-cyan-600 border border-cyan-100',
  mock:     'bg-gray-50 text-gray-500 border border-gray-100',
}

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  success:     { label: '완료',   dot: 'bg-emerald-500',              text: 'text-emerald-700' },
  in_progress: { label: '진행중', dot: 'bg-ds-tertiary animate-pulse', text: 'text-ds-tertiary' },
  pending:     { label: '대기',   dot: 'bg-ds-outline',                text: 'text-ds-on-surface-variant' },
  failure:     { label: '실패',   dot: 'bg-ds-error',                  text: 'text-ds-error' },
  error:       { label: '오류',   dot: 'bg-ds-error',                  text: 'text-ds-error' },
}

const STATUS_ORDER: Record<string, number> = {
  pending: 0, in_progress: 1, success: 2, failure: 3, error: 4,
}

interface DeviceFormData {
  name: string; ip_address: string; vendor: string; username: string
  password: string; password_confirm: string; ha_peer_ip: string
  model: string; group: string; description: string; collect_last_hit_date: boolean
  use_ssh_for_last_hit_date: boolean
  serial_number: string; os_name: string; os_version: string; install_date: string
  location_region: string; location_building: string; location_floor: string; location_room: string
  location_x: string; location_y: string; location_z: string
  policy_threshold: string; network_object_threshold: string; service_threshold: string
}

const DEFAULT_FORM: DeviceFormData = {
  name: '', ip_address: '', vendor: 'paloalto', username: '', password: '', password_confirm: '',
  ha_peer_ip: '', model: '', group: '', description: '', collect_last_hit_date: true, use_ssh_for_last_hit_date: false,
  serial_number: '', os_name: '', os_version: '', install_date: '',
  location_region: '', location_building: '', location_floor: '', location_room: '',
  location_x: '', location_y: '', location_z: '',
  policy_threshold: '', network_object_threshold: '', service_threshold: '',
}

function DeviceFormDialog({ open, onClose, initial, onSubmit, isPending }: {
  open: boolean; onClose: () => void; initial?: DeviceFormData
  onSubmit: (data: DeviceFormData) => void; isPending: boolean
}) {
  const [form, setForm] = useState<DeviceFormData>(initial ?? DEFAULT_FORM)
  const set = (key: keyof DeviceFormData, val: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">
            {initial?.name ? '장비 수정' : '장비 추가'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(form) }} className="space-y-3">
          <Tabs defaultValue="basic">
            <TabsList>
              <TabsTrigger value="basic">기본정보</TabsTrigger>
              <TabsTrigger value="detail">상세정보</TabsTrigger>
              <TabsTrigger value="location">설치정보</TabsTrigger>
              <TabsTrigger value="resource">임계치</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '장비명 *', key: 'name' as const, required: true },
                  { label: 'IP 주소 *', key: 'ip_address' as const, required: true },
                  { label: '모델', key: 'model' as const },
                  { label: '사용자명 *', key: 'username' as const, required: true },
                  { label: 'HA Peer IP', key: 'ha_peer_ip' as const },
                  { label: '그룹', key: 'group' as const },
                ].map(({ label, key, required }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                    <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} required={required} className="bg-white border-ds-outline-variant/30 text-sm" />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">벤더 *</Label>
                  <ShadSelect value={form.vendor} onValueChange={(v) => set('vendor', v)}>
                    <SelectTrigger className="bg-white border-ds-outline-variant/30 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VENDOR_OPTIONS.map((o) => <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </ShadSelect>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">
                    비밀번호 {!initial?.name && '*'}
                  </Label>
                  <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} required={!initial?.name} className="bg-white border-ds-outline-variant/30 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">
                    비밀번호 확인 {!initial?.name && '*'}
                  </Label>
                  <Input type="password" value={form.password_confirm} onChange={(e) => set('password_confirm', e.target.value)} required={!initial?.name} className="bg-white border-ds-outline-variant/30 text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">설명</Label>
                <Input value={form.description} onChange={(e) => set('description', e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
              </div>
              <div className="flex gap-4 pt-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer text-ds-on-surface-variant">
                  <Checkbox checked={form.collect_last_hit_date} onCheckedChange={(v) => set('collect_last_hit_date', !!v)} />
                  최근 사용일 수집
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer text-ds-on-surface-variant">
                  <Checkbox checked={form.use_ssh_for_last_hit_date} onCheckedChange={(v) => set('use_ssh_for_last_hit_date', !!v)} />
                  SSH로 최근 사용일 수집
                </label>
              </div>
            </TabsContent>

            <TabsContent value="detail" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '시리얼 번호', key: 'serial_number' as const },
                  { label: 'OS명', key: 'os_name' as const },
                  { label: 'OS버전', key: 'os_version' as const },
                ].map(({ label, key }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                    <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">도입일</Label>
                  <Input type="date" value={form.install_date} onChange={(e) => set('install_date', e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="location" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '지역', key: 'location_region' as const },
                  { label: '설치동', key: 'location_building' as const },
                  { label: '층', key: 'location_floor' as const },
                  { label: 'Room', key: 'location_room' as const },
                ].map(({ label, key }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                    <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '좌표 X', key: 'location_x' as const },
                  { label: '좌표 Y', key: 'location_y' as const },
                  { label: '좌표 Z', key: 'location_z' as const },
                ].map(({ label, key }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                    <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="resource" className="space-y-3">
              <p className="text-[11px] text-ds-on-surface-variant">임계치는 관리자가 직접 입력하며, 사용량은 동기화된 정책·객체 수와 자동으로 비교됩니다.</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '정책 수 임계치', key: 'policy_threshold' as const },
                  { label: '네트워크 객체 수 임계치', key: 'network_object_threshold' as const },
                  { label: '서비스 객체 수 임계치', key: 'service_threshold' as const },
                ].map(({ label, key }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                    <Input type="number" min={0} value={form[key] as string} onChange={(e) => set(key, e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
            <button type="submit" disabled={isPending} className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50">
              {isPending ? '처리중…' : '저장'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BulkOptionsDialog({ open, onClose, count, initial, onSubmit }: {
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

function BulkGroupDialog({ open, onClose, count, existingGroups, initial, onSubmit }: {
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

const EXPORT_TYPE_OPTIONS: { type: DirectExportType; label: string; desc: string }[] = [
  { type: 'policies',  label: '정책',    desc: '보안 정책 목록 전체' },
  { type: 'objects',   label: '객체',    desc: '주소/서비스 객체·그룹 (4개 시트)' },
  { type: 'hit_dates', label: '사용이력', desc: 'HA Peer 포함 최신 히트 일시' },
]

function DirectExportDialog({ open, onClose, devices }: {
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

  useEffect(() => {
    if (open) {
      setExportType('policies')
      setSource('live')
      setMerge(false)
      setUseSsh(devices.length === 1 ? devices[0].use_ssh_for_last_hit_date : false)
      setTimeout_(600)
      setProgress(null)
      setErrors([])
    }
  }, [open])  // eslint-disable-line react-hooks/exhaustive-deps

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

function DeviceNameCell({ data, onShowDetail }: { data: Device; onShowDetail: (device: Device) => void }) {
  const navigate = useNavigate()
  const setSelectedIds = useDeviceStore((s) => s.setSelectedIds)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  if (!data) return null

  const goToPolicies = () => { setSelectedIds([data.id]); setOpen(false); navigate('/policies') }
  const goToObjects = () => { setSelectedIds([data.id]); setOpen(false); navigate('/objects') }
  const goToAnalysis = () => { setOpen(false); navigate('/analysis', { state: { openCreateWithDeviceId: data.id } }) }
  const showDetail = () => { setOpen(false); onShowDetail(data) }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className="text-[12px] font-semibold text-ds-on-surface hover:text-ds-tertiary transition-colors truncate max-w-full text-left"
        title={data.name}
      >
        {data.name}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-ds-outline-variant/15 py-1 z-50">
          <button onClick={showDetail} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] font-medium text-ds-on-surface hover:bg-ds-surface-container-low transition-colors">
            <Search className="w-3.5 h-3.5 text-ds-on-surface-variant" />
            상세보기
          </button>
          <button onClick={goToPolicies} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] font-medium text-ds-on-surface hover:bg-ds-surface-container-low transition-colors">
            <ListFilter className="w-3.5 h-3.5 text-ds-on-surface-variant" />
            정책 조회
          </button>
          <button onClick={goToObjects} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] font-medium text-ds-on-surface hover:bg-ds-surface-container-low transition-colors">
            <Boxes className="w-3.5 h-3.5 text-ds-on-surface-variant" />
            객체 조회
          </button>
          <button onClick={goToAnalysis} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] font-medium text-ds-on-surface hover:bg-ds-surface-container-low transition-colors">
            <BarChart3 className="w-3.5 h-3.5 text-ds-on-surface-variant" />
            분석 실행
          </button>
        </div>
      )}
    </div>
  )
}

function ResourceWarningBadge({ data }: { data: Device }) {
  if (!data) return null
  const networkObjectUsage = (data.cached_network_objects ?? 0) + (data.cached_network_groups ?? 0)
  const serviceUsage = (data.cached_services ?? 0) + (data.cached_service_groups ?? 0)
  const levels = [
    capacityLevel(data.cached_policies, data.policy_threshold),
    capacityLevel(networkObjectUsage, data.network_object_threshold),
    capacityLevel(serviceUsage, data.service_threshold),
  ]
  const hasAnyThreshold = data.policy_threshold != null || data.network_object_threshold != null || data.service_threshold != null
  if (!hasAnyThreshold) return <span className="text-[12px] text-ds-on-surface-variant/40">—</span>
  if (levels.includes('danger')) {
    return <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-50 text-ds-error border border-red-100">위험</span>
  }
  if (levels.includes('warning')) {
    return <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-100">경고</span>
  }
  return <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">정상</span>
}

function buildColumnDefs(onShowDetail: (device: Device) => void): ColDef<Device>[] {
  return [
  {
    width: 44, minWidth: 44, maxWidth: 44,
    sortable: false, resizable: false, filter: false,
  },
  {
    headerName: '상태', minWidth: 80,
    valueGetter: (p) => STATUS_CONFIG[p.data?.last_sync_status ?? '']?.label ?? '',
    comparator: (_a, _b, nodeA, nodeB) =>
      (STATUS_ORDER[nodeA.data?.last_sync_status ?? ''] ?? -1) - (STATUS_ORDER[nodeB.data?.last_sync_status ?? ''] ?? -1),
    cellRenderer: (p: { data: Device }) => {
      const conf = STATUS_CONFIG[p.data?.last_sync_status ?? '']
      return conf
        ? <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${conf.text}`} title={p.data?.last_sync_step ?? ''}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${conf.dot}`} />
            {conf.label}
          </span>
        : <span className="text-ds-on-surface-variant/40 text-xs">—</span>
    },
  },
  {
    headerName: '장비명', flex: 1.4, minWidth: 140,
    valueGetter: (p) => p.data?.name ?? '',
    cellRenderer: (p: { data: Device }) => <DeviceNameCell data={p.data as Device} onShowDetail={onShowDetail} />,
  },
  {
    field: 'ip_address', headerName: 'IP 주소', minWidth: 140,
    cellRenderer: (p: { data: Device }) => (
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-ds-on-surface-variant font-mono">{p.data?.ip_address}</span>
        {p.data?.ip_address && (
          <a
            href={`https://${p.data.ip_address}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="웹 관리 콘솔 열기"
            className="shrink-0 text-ds-tertiary/50 hover:text-ds-tertiary transition-colors"
          >
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </div>
    ),
  },
  {
    headerName: 'HA Peer IP', minWidth: 140,
    valueGetter: (p) => p.data?.ha_peer_ip ?? '',
    cellRenderer: (p: { data: Device }) => p.data?.ha_peer_ip ? (
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold text-ds-tertiary">HA</span>
        <span className="text-[10px] text-ds-on-surface-variant/70 font-mono">{p.data.ha_peer_ip}</span>
        <a
          href={`https://${p.data.ha_peer_ip}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="HA Peer 웹 관리 콘솔 열기"
          className="shrink-0 text-ds-tertiary/50 hover:text-ds-tertiary transition-colors"
        >
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>
    ) : <span className="text-[12px] text-ds-on-surface-variant/40">—</span>,
  },
  {
    field: 'vendor', headerName: '벤더', minWidth: 90,
    valueGetter: (p) => VENDOR_OPTIONS.find(v => v.code === p.data?.vendor)?.label ?? p.data?.vendor ?? '',
    cellRenderer: (p: { data: Device }) => (
      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${VENDOR_BADGE[p.data?.vendor?.toLowerCase() ?? ''] ?? 'bg-gray-50 text-gray-500 border border-gray-100'}`}>
        {VENDOR_OPTIONS.find(v => v.code === p.data?.vendor)?.label ?? p.data?.vendor}
      </span>
    ),
  },
  {
    field: 'model', headerName: '모델', minWidth: 100,
    cellRenderer: (p: { value: string }) => <span className="text-[12px] text-ds-on-surface-variant">{p.value ?? '—'}</span>,
  },
  {
    field: 'group', headerName: '그룹', minWidth: 90,
    cellRenderer: (p: { value: string }) => p.value
      ? <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-ds-tertiary/10 text-ds-tertiary">{p.value}</span>
      : <span className="text-[12px] text-ds-on-surface-variant/40">—</span>,
  },
  {
    field: 'description', headerName: '설명', minWidth: 120, flex: 1,
    cellRenderer: (p: { value: string }) => <span className="text-[12px] text-ds-on-surface-variant">{p.value ?? '—'}</span>,
  },
  {
    headerName: '수집 옵션', minWidth: 100, sortable: false, filter: false,
    cellRenderer: (p: { data: Device }) => (
      <div className="flex gap-1 flex-wrap items-center">
        {p.data?.collect_last_hit_date && <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">히트수집</span>}
        {p.data?.use_ssh_for_last_hit_date && <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-100">SSH</span>}
        {!p.data?.collect_last_hit_date && !p.data?.use_ssh_for_last_hit_date && <span className="text-[12px] text-ds-on-surface-variant/40">—</span>}
      </div>
    ),
  },
  {
    headerName: '마지막 동기화', minWidth: 120, filter: false,
    valueGetter: (p) => formatRelativeTime(p.data?.last_sync_at ?? null),
    comparator: (_a, _b, nodeA, nodeB) =>
      new Date(nodeA.data?.last_sync_at ?? 0).getTime() - new Date(nodeB.data?.last_sync_at ?? 0).getTime(),
    cellRenderer: (p: { value: string }) => <span className="text-[12px] text-ds-on-surface-variant">{p.value}</span>,
  },
  {
    headerName: '임계치', minWidth: 90, sortable: false, filter: false,
    cellRenderer: (p: { data: Device }) => <ResourceWarningBadge data={p.data as Device} />,
  },
  ]
}

export function DevicesPage() {
  const queryClient = useQueryClient()
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const [quickFilter, setQuickFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Device | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkFile, setBulkFile] = useState<File | null>(null)
  const [selectedDevices, setSelectedDevices] = useState<Device[]>([])
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [bulkOptionsOpen, setBulkOptionsOpen] = useState(false)
  const [bulkGroupOpen, setBulkGroupOpen] = useState(false)
  const [directExportOpen, setDirectExportOpen] = useState(false)
  const [detailTarget, setDetailTarget] = useState<Device | null>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const { confirm, ConfirmDialogElement } = useConfirm()

  const columnDefs = useMemo(() => buildColumnDefs(setDetailTarget), [])

  useEffect(() => {
    if (!addMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [addMenuOpen])

  const { data: devices = [], isLoading } = useQuery({ queryKey: ['devices'], queryFn: listDevices })

  // devices 쿼리가 갱신될 때 그리드에서 최신 선택 행 데이터를 재동기화
  useEffect(() => {
    const api = gridRef.current?.gridApi
    if (!api) return
    const fresh = api.getSelectedRows() as Device[]
    if (fresh.length > 0) setSelectedDevices(fresh)
  }, [devices])

  const existingGroups = useMemo(() =>
    [...new Set(devices.map(d => d.group).filter(Boolean) as string[])].sort()
  , [devices])

  const hasUngrouped = useMemo(() => devices.some(d => d.group == null), [devices])

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const d of devices) {
      const key = d.group ?? '__ungrouped__'
      counts[key] = (counts[key] ?? 0) + 1
    }
    return counts
  }, [devices])

  useEffect(() => {
    gridRef.current?.gridApi?.onFilterChanged()
  }, [groupFilter])

  const isExternalFilterPresent = useCallback(() => groupFilter !== null, [groupFilter])
  const doesExternalFilterPass = useCallback((node: IRowNode<Device>) => {
    if (groupFilter === '__ungrouped__') return node.data?.group == null
    return node.data?.group === groupFilter
  }, [groupFilter])

  const syncCounts = useMemo(() => ({
    total:   devices.length,
    synced:  devices.filter(d => d.last_sync_status === 'success').length,
    syncing: devices.filter(d => d.last_sync_status === 'in_progress' || d.last_sync_status === 'pending').length,
    error:   devices.filter(d => d.last_sync_status === 'failure' || d.last_sync_status === 'error').length,
  }), [devices])

  const syncPct = syncCounts.total > 0 ? Math.round(syncCounts.synced / syncCounts.total * 100) : 0

  const createMutation = useMutation({
    mutationFn: (data: DeviceCreate) => createDevice(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devices'] }); setFormOpen(false); toast.success('장비가 추가되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: DeviceUpdate }) => updateDevice(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devices'] }); setFormOpen(false); setEditTarget(null); toast.success('장비가 수정되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDevice(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devices'] }); toast.success('장비가 삭제되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })
  const syncMutation = useMutation({
    mutationFn: (id: number) => syncAll(id),
    onSuccess: () => toast.success('동기화가 시작되었습니다.'),
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSyncMessage = useCallback((msg: SyncStatusMessage) => {
    const api = gridRef.current?.gridApi ?? null
    let deviceName: string | undefined
    if (api) {
      const node = api.getRowNode(String(msg.device_id))
      if (node?.data) {
        deviceName = node.data.name
        node.setData({
          ...node.data,
          last_sync_status: msg.status,
          last_sync_step: msg.step,
          last_sync_at: (msg.status === 'success' || msg.status === 'failure')
            ? new Date().toISOString()
            : node.data.last_sync_at,
        })
      }
    }
    if (msg.status === 'success') {
      notify('동기화 완료', deviceName ?? `장비 ID ${msg.device_id}`, 'success', { category: 'sync', device_id: msg.device_id, device_name: deviceName })
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    } else if (msg.status === 'failure') {
      notify('동기화 실패', deviceName ?? `장비 ID ${msg.device_id}`, 'error', { category: 'sync', device_id: msg.device_id, device_name: deviceName })
      queryClient.invalidateQueries({ queryKey: ['devices'] })
    }
  }, [queryClient])

  useSyncStatusWebSocket(handleSyncMessage)

  const bulkImportMutation = useMutation({
    mutationFn: (file: File) => bulkImportDevices(file),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['devices'] }); setBulkOpen(false); setBulkFile(null)
      toast.success(`등록 완료: ${result.success_count}/${result.total}개 성공`)
      if (result.failed_count > 0) toast.warning(`실패: ${result.failed_devices.join(', ')}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleBulkDelete = useCallback(async () => {
    if (selectedDevices.length === 0) return
    const names = selectedDevices.map(d => d.name).join(', ')
    const ok = await confirm({
      title: '장비 삭제',
      description: `${selectedDevices.length}개 장비를 삭제하시겠습니까?\n(${names})`,
      variant: 'destructive',
      confirmLabel: '삭제',
    })
    if (ok) {
      for (const d of selectedDevices) deleteMutation.mutate(d.id)
      setSelectedDevices([])
    }
  }, [selectedDevices, confirm, deleteMutation])

  const handleBulkSync = useCallback(async () => {
    if (selectedDevices.length === 0) return
    const names = selectedDevices.map(d => d.name).join(', ')
    const ok = await confirm({
      title: '동기화 확인',
      description: `${selectedDevices.length}개 장비를 동기화하시겠습니까?\n(${names})`,
      confirmLabel: '동기화',
    })
    if (!ok) return
    selectedDevices.forEach(d => syncMutation.mutate(d.id))
    toast.info(`${selectedDevices.length}개 장비 동기화를 시작합니다.`)
  }, [selectedDevices, syncMutation, confirm])

  const handleBulkTestConnection = useCallback(async () => {
    if (selectedDevices.length === 0) return
    toast.info(`${selectedDevices.length}개 장비 연결 테스트 중…`)
    for (const d of selectedDevices) {
      try { toast.success(`[${d.name}] ${(await testConnection(d.id)).message}`) }
      catch (e: unknown) { toast.error(`[${d.name}] ${(e as Error).message}`) }
    }
  }, [selectedDevices])

  const handleBulkSetOptions = useCallback(async (opts: Pick<DeviceUpdate, 'collect_last_hit_date' | 'use_ssh_for_last_hit_date'>) => {
    setBulkOptionsOpen(false)
    try {
      await Promise.all(selectedDevices.map(d => updateDevice(d.id, opts)))
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      toast.success(`${selectedDevices.length}개 장비 수집 옵션이 변경되었습니다.`)
    } catch (e: unknown) { toast.error((e as Error).message) }
  }, [selectedDevices, queryClient])

  const handleBulkSetGroup = useCallback(async (group: string) => {
    setBulkGroupOpen(false)
    try {
      await Promise.all(selectedDevices.map(d => updateDevice(d.id, { group })))
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      toast.success(`${selectedDevices.length}개 장비 그룹이 변경되었습니다.`)
    } catch (e: unknown) { toast.error((e as Error).message) }
  }, [selectedDevices, queryClient])

  const handleEdit = useCallback(() => {
    if (selectedDevices.length !== 1) return
    setEditTarget(selectedDevices[0])
    setFormOpen(true)
  }, [selectedDevices])

  const sel = selectedDevices.length
  const isSingle = sel === 1

  return (
    <div className="flex flex-col gap-6">
      {ConfirmDialogElement}

      {/* 헤더 */}
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">Devices</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['devices'] })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-ds-on-surface-variant bg-white rounded-lg shadow-sm border border-ds-outline-variant/10 hover:text-ds-on-surface hover:bg-ds-surface-container-low transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            갱신
          </button>

          {/* 장비 추가 드롭다운 */}
          <div className="relative" ref={addMenuRef}>
            <button
              onClick={() => setAddMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold btn-primary-gradient text-ds-on-tertiary rounded-lg shadow-sm hover:opacity-90 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              장비 추가
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${addMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {addMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-44 bg-white rounded-xl shadow-lg border border-ds-outline-variant/15 py-1 z-50">
                <button
                  onClick={() => { setAddMenuOpen(false); setEditTarget(null); setFormOpen(true) }}
                  className="flex items-center gap-2.5 w-full px-3.5 py-2 text-[13px] font-medium text-ds-on-surface hover:bg-ds-surface-container-low transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-ds-on-surface-variant" />
                  장비 추가
                </button>
                <button
                  onClick={() => { setAddMenuOpen(false); setBulkOpen(true) }}
                  className="flex items-center gap-2.5 w-full px-3.5 py-2 text-[13px] font-medium text-ds-on-surface hover:bg-ds-surface-container-low transition-colors"
                >
                  <Upload className="w-3.5 h-3.5 text-ds-on-surface-variant" />
                  일괄 등록
                </button>
                <button
                  onClick={() => { setAddMenuOpen(false); downloadDeviceTemplate() }}
                  className="flex items-center gap-2.5 w-full px-3.5 py-2 text-[13px] font-medium text-ds-on-surface hover:bg-ds-surface-container-low transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-ds-on-surface-variant" />
                  템플릿 다운로드
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI 컴팩트 스트립 */}
      <div className="shrink-0 card rounded-xl px-4 py-2.5 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ds-on-surface-variant/60 font-medium">전체</span>
          <span className="text-[13px] font-bold tabular-nums text-ds-on-surface">{isLoading ? '…' : syncCounts.total}대</span>
        </div>
        <div className="flex items-center gap-2 min-w-[120px]">
          <div className="w-20 h-1.5 bg-ds-surface-container-high rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${syncPct}%` }} />
          </div>
          <span className="text-[11px] font-semibold tabular-nums text-ds-on-surface-variant">{syncPct}%</span>
        </div>
        <div className="w-px h-3 bg-ds-outline-variant/20 shrink-0" />
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="text-[11px] text-ds-on-surface-variant/60">완료</span>
          <span className="text-[13px] font-bold tabular-nums text-emerald-600">{isLoading ? '…' : syncCounts.synced}</span>
        </div>
        <div className="w-px h-3 bg-ds-outline-variant/20 shrink-0" />
        <div className="flex items-center gap-1.5">
          <Loader2 className={`w-3.5 h-3.5 shrink-0 ${syncCounts.syncing > 0 ? 'text-ds-tertiary animate-spin' : 'text-ds-on-surface-variant/30'}`} />
          <span className="text-[11px] text-ds-on-surface-variant/60">진행</span>
          <span className={`text-[13px] font-bold tabular-nums ${syncCounts.syncing > 0 ? 'text-ds-tertiary' : 'text-ds-on-surface-variant/40'}`}>{isLoading ? '…' : syncCounts.syncing}</span>
        </div>
        <div className="w-px h-3 bg-ds-outline-variant/20 shrink-0" />
        <div className="flex items-center gap-1.5">
          <AlertCircle className={`w-3.5 h-3.5 shrink-0 ${syncCounts.error > 0 ? 'text-ds-error' : 'text-ds-on-surface-variant/30'}`} />
          <span className="text-[11px] text-ds-on-surface-variant/60">오류</span>
          <span className={`text-[13px] font-bold tabular-nums ${syncCounts.error > 0 ? 'text-ds-error' : 'text-ds-on-surface-variant/40'}`}>{isLoading ? '…' : syncCounts.error}</span>
        </div>
      </div>

      {/* 장비 테이블 */}
      <div className="card rounded-xl flex flex-col overflow-hidden">
        <div className="shrink-0 px-5 pt-3 pb-2.5">
          {/* 첫 번째 줄: 제목 + 작업 버튼 + 검색 */}
          <div className="flex items-center justify-between gap-3">
            {/* 좌측: 제목 + 장비 수 */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] font-semibold text-ds-on-surface shrink-0">등록된 장비</span>
              {devices.length > 0 && (
                <span className="text-[11px] text-ds-on-surface-variant/50 tabular-nums shrink-0">{devices.length}대</span>
              )}
            </div>

          {/* 우측: 작업 버튼(선택 시) + 검색 */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 선택 시 작업 버튼 */}
            {sel > 0 && (
              <>
                <span className="text-[11px] font-semibold text-ds-tertiary tabular-nums shrink-0">{sel}개 선택</span>
                <button
                  onClick={handleEdit}
                  disabled={!isSingle}
                  title={isSingle ? '수정' : '단일 장비만 수정 가능'}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-ds-outline-variant/20 bg-ds-surface-container-low text-ds-on-surface-variant hover:text-ds-primary hover:bg-ds-surface-container-high disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Pencil className="w-3 h-3" />
                  수정
                </button>
                <button
                  onClick={() => setBulkOptionsOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-ds-outline-variant/20 bg-ds-surface-container-low text-ds-on-surface-variant hover:text-ds-primary hover:bg-ds-surface-container-high transition-colors"
                >
                  <Settings2 className="w-3 h-3" />
                  수집 옵션
                </button>
                <button
                  onClick={() => setBulkGroupOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-ds-outline-variant/20 bg-ds-surface-container-low text-ds-on-surface-variant hover:text-ds-primary hover:bg-ds-surface-container-high transition-colors"
                >
                  <Tag className="w-3 h-3" />
                  그룹 설정
                </button>
                <button
                  onClick={handleBulkSync}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-ds-outline-variant/20 bg-ds-surface-container-low text-ds-on-surface-variant hover:text-ds-primary hover:bg-ds-surface-container-high transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  동기화
                </button>
                <button
                  onClick={handleBulkTestConnection}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-ds-outline-variant/20 bg-ds-surface-container-low text-ds-on-surface-variant hover:text-ds-primary hover:bg-ds-surface-container-high transition-colors"
                >
                  <Wifi className="w-3 h-3" />
                  연결 테스트
                </button>
                <button
                  onClick={() => setDirectExportOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-ds-outline-variant/20 bg-ds-surface-container-low text-ds-on-surface-variant hover:text-ds-primary hover:bg-ds-surface-container-high transition-colors"
                >
                  <FileDown className="w-3 h-3" />
                  직접 추출
                </button>
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium rounded-lg border border-ds-error/20 bg-ds-error/5 text-ds-error hover:bg-ds-error/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  삭제
                </button>
                <span className="w-px h-4 bg-ds-outline-variant/30 shrink-0" />
              </>
            )}

            <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-2.5 py-1.5 border border-ds-outline-variant/10">
              <Search className="w-3 h-3 text-ds-on-surface-variant shrink-0" />
              <input
                value={quickFilter}
                onChange={(e) => setQuickFilter(e.target.value)}
                placeholder="장비명, IP, 그룹, 설명 검색"
                className="text-[12px] bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/40 w-48"
              />
              {quickFilter && (
                <button onClick={() => setQuickFilter('')}>
                  <XCircle className="w-3 h-3 text-ds-on-surface-variant hover:text-ds-on-surface" />
                </button>
              )}
            </div>
          </div>
          </div>

          {/* 두 번째 줄: 그룹 필터 버튼 */}
          {(existingGroups.length > 0 || hasUngrouped) && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <button
                onClick={() => setGroupFilter(null)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${groupFilter === null ? 'bg-ds-primary/10 text-ds-primary border-ds-primary/30' : 'bg-ds-surface-container-low text-ds-on-surface-variant border-ds-outline-variant/20 hover:border-ds-outline-variant/40'}`}
              >
                전체
                <span className="tabular-nums opacity-60">{devices.length}</span>
              </button>
              {existingGroups.map((g) => (
                <button
                  key={g}
                  onClick={() => setGroupFilter(groupFilter === g ? null : g)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${groupFilter === g ? 'bg-ds-primary/10 text-ds-primary border-ds-primary/30' : 'bg-ds-surface-container-low text-ds-on-surface-variant border-ds-outline-variant/20 hover:border-ds-outline-variant/40'}`}
                >
                  {g}
                  <span className="tabular-nums opacity-60">{groupCounts[g] ?? 0}</span>
                </button>
              ))}
              {hasUngrouped && (
                <button
                  onClick={() => setGroupFilter(groupFilter === '__ungrouped__' ? null : '__ungrouped__')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${groupFilter === '__ungrouped__' ? 'bg-ds-primary/10 text-ds-primary border-ds-primary/30' : 'bg-ds-surface-container-low text-ds-on-surface-variant border-ds-outline-variant/20 hover:border-ds-outline-variant/40'}`}
                >
                  미분류
                  <span className="tabular-nums opacity-60">{groupCounts['__ungrouped__'] ?? 0}</span>
                </button>
              )}
            </div>
          )}
        </div>

        <AgGridWrapper<Device>
          ref={gridRef}
          columnDefs={columnDefs}
          rowData={devices}
          getRowId={(p) => String(p.data.id)}
          quickFilterText={quickFilter}
          height="calc(100vh - 280px)"
          noRowsText="등록된 장비가 없습니다."
          rowSelection={{ mode: 'multiRow', checkboxes: true, headerCheckbox: true, selectAll: 'filtered' }}
          onSelectionChanged={(rows) => setSelectedDevices(rows)}
          defaultColDefOverride={{ resizable: true, sortable: true }}
          fitColumns
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          getRowStyle={(p) => {
            const s = p.data?.last_sync_status
            if (s === 'failure' || s === 'error') return { borderLeft: '2px solid #9f403d', backgroundColor: 'rgba(254, 226, 226, 0.12)' }
            return undefined
          }}
        />
      </div>

      {/* 장비 폼 다이얼로그 */}
      <DeviceFormDialog
        key={editTarget ? `edit-${editTarget.id}` : 'new'}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null) }}
        initial={editTarget ? {
          name: editTarget.name, ip_address: editTarget.ip_address, vendor: editTarget.vendor,
          username: editTarget.username, password: '', password_confirm: '',
          ha_peer_ip: editTarget.ha_peer_ip ?? '', model: editTarget.model ?? '',
          group: editTarget.group ?? '', description: editTarget.description ?? '',
          collect_last_hit_date: editTarget.collect_last_hit_date,
          use_ssh_for_last_hit_date: editTarget.use_ssh_for_last_hit_date,
          serial_number: editTarget.serial_number ?? '', os_name: editTarget.os_name ?? '',
          os_version: editTarget.os_version ?? '', install_date: editTarget.install_date ?? '',
          location_region: editTarget.location_region ?? '', location_building: editTarget.location_building ?? '',
          location_floor: editTarget.location_floor ?? '', location_room: editTarget.location_room ?? '',
          location_x: editTarget.location_x ?? '', location_y: editTarget.location_y ?? '', location_z: editTarget.location_z ?? '',
          policy_threshold: editTarget.policy_threshold?.toString() ?? '',
          network_object_threshold: editTarget.network_object_threshold?.toString() ?? '',
          service_threshold: editTarget.service_threshold?.toString() ?? '',
        } : undefined}
        onSubmit={(data) => {
          const { policy_threshold, network_object_threshold, service_threshold, install_date, ...rest } = data
          const toNum = (v: string) => v === '' ? undefined : Number(v)
          const payload = {
            ...rest,
            install_date: install_date || undefined,
            policy_threshold: toNum(policy_threshold),
            network_object_threshold: toNum(network_object_threshold),
            service_threshold: toNum(service_threshold),
          }
          if (editTarget) {
            const updatePayload: DeviceUpdate = { ...payload }
            if (!data.password) { delete updatePayload.password; delete updatePayload.password_confirm }
            updateMutation.mutate({ id: editTarget.id, data: updatePayload })
          } else {
            createMutation.mutate(payload as DeviceCreate)
          }
        }}
        isPending={createMutation.isPending || updateMutation.isPending}
      />

      {/* 수집 옵션 일괄 수정 다이얼로그 */}
      <BulkOptionsDialog
        open={bulkOptionsOpen}
        onClose={() => setBulkOptionsOpen(false)}
        count={sel}
        initial={{
          collect_last_hit_date: selectedDevices.every(d => d.collect_last_hit_date),
          use_ssh_for_last_hit_date: selectedDevices.every(d => d.use_ssh_for_last_hit_date),
        }}
        onSubmit={handleBulkSetOptions}
      />

      {/* 직접 추출 다이얼로그 */}
      <DirectExportDialog
        open={directExportOpen}
        onClose={() => setDirectExportOpen(false)}
        devices={selectedDevices}
      />

      {/* 그룹 일괄 설정 다이얼로그 */}
      <BulkGroupDialog
        open={bulkGroupOpen}
        onClose={() => setBulkGroupOpen(false)}
        count={sel}
        existingGroups={existingGroups}
        initial={isSingle ? (selectedDevices[0]?.group ?? '') : ''}
        onSubmit={handleBulkSetGroup}
      />

      {/* 장비 상세보기 다이얼로그 */}
      <DeviceDetailDialog
        device={detailTarget}
        onClose={() => setDetailTarget(null)}
        onEdit={(device) => { setDetailTarget(null); setEditTarget(device); setFormOpen(true) }}
      />

      {/* 일괄 등록 다이얼로그 */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="bg-ds-surface-container-lowest">
          <DialogHeader>
            <DialogTitle className="font-headline text-ds-on-surface">장비 일괄 등록</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-ds-on-surface-variant">Excel 파일을 업로드하여 여러 장비를 한번에 등록합니다.</p>
            <Input type="file" accept=".xlsx,.xls" onChange={(e) => setBulkFile(e.target.files?.[0] ?? null)} className="bg-white border-ds-outline-variant/30" />
          </div>
          <DialogFooter>
            <button onClick={() => setBulkOpen(false)} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
            <button
              disabled={!bulkFile || bulkImportMutation.isPending}
              onClick={() => bulkFile && bulkImportMutation.mutate(bulkFile)}
              className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
            >
              {bulkImportMutation.isPending ? '등록 중…' : '등록'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
