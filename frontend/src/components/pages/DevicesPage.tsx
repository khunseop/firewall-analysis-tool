import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { formatRelativeTime } from '@/lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Upload, Download, RefreshCw, Pencil, Trash2, Wifi, Search, XCircle, ChevronDown } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import {
  listDevices, createDevice, updateDevice, deleteDevice,
  testConnection, syncAll, downloadDeviceTemplate, bulkImportDevices,
  type Device, type DeviceCreate, type DeviceUpdate,
} from '@/api/devices'
import { useSyncStatusWebSocket, type SyncStatusMessage } from '@/hooks/useWebSocket'
import { notify } from '@/store/notificationStore'

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

interface DeviceFormData {
  name: string; ip_address: string; vendor: string; username: string
  password: string; password_confirm: string; ha_peer_ip: string
  model: string; group: string; description: string; collect_last_hit_date: boolean
  use_ssh_for_last_hit_date: boolean
}

const DEFAULT_FORM: DeviceFormData = {
  name: '', ip_address: '', vendor: 'paloalto', username: '', password: '', password_confirm: '',
  ha_peer_ip: '', model: '', group: '', description: '', collect_last_hit_date: true, use_ssh_for_last_hit_date: false,
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
      <DialogContent className="max-w-lg bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">
            {initial?.name ? '장비 수정' : '장비 추가'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(form) }} className="space-y-3">
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

const COLUMN_DEFS: ColDef<Device>[] = [
  {
    checkboxSelection: true,
    headerCheckboxSelection: true,
    headerCheckboxSelectionFilteredOnly: true,
    width: 44, minWidth: 44, maxWidth: 44,
    sortable: false, resizable: false,
  },
  {
    headerName: '상태', minWidth: 80,
    valueGetter: (p) => STATUS_CONFIG[p.data?.last_sync_status ?? '']?.label ?? '',
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
    headerName: '장비명', flex: 2, minWidth: 160,
    valueGetter: (p) => `${p.data?.name ?? ''} ${p.data?.ip_address ?? ''}`,
    cellRenderer: (p: { data: Device }) => (
      <div className="flex flex-col leading-tight">
        <span className="text-[12px] font-semibold text-ds-on-surface">{p.data?.name}</span>
        <span className="text-[10px] text-ds-on-surface-variant/60 font-mono mt-0.5">{p.data?.ip_address}</span>
      </div>
    ),
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
    field: 'ha_peer_ip', headerName: 'HA Peer IP', minWidth: 120,
    cellRenderer: (p: { value: string }) => <span className="font-mono text-[11px] text-ds-on-surface-variant">{p.value ?? '—'}</span>,
  },
  {
    headerName: '수집 옵션', minWidth: 100, sortable: false,
    cellRenderer: (p: { data: Device }) => (
      <div className="flex gap-1 flex-wrap items-center">
        {p.data?.collect_last_hit_date && <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">히트수집</span>}
        {p.data?.use_ssh_for_last_hit_date && <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-100">SSH</span>}
        {!p.data?.collect_last_hit_date && !p.data?.use_ssh_for_last_hit_date && <span className="text-[12px] text-ds-on-surface-variant/40">—</span>}
      </div>
    ),
  },
  {
    headerName: '마지막 동기화', minWidth: 120,
    valueGetter: (p) => formatRelativeTime(p.data?.last_sync_at ?? null),
    cellRenderer: (p: { value: string }) => <span className="text-[12px] text-ds-on-surface-variant">{p.value}</span>,
  },
]

export function DevicesPage() {
  const queryClient = useQueryClient()
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const [quickFilter, setQuickFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Device | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkFile, setBulkFile] = useState<File | null>(null)
  const [selectedDevices, setSelectedDevices] = useState<Device[]>([])
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const { confirm, ConfirmDialogElement } = useConfirm()

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

      {/* KPI */}
      <div className="shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card rounded-xl px-4 py-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ds-on-surface-variant/60">전체 장비</p>
          <p className="text-2xl font-bold tabular-nums text-ds-on-surface mt-1.5">
            {isLoading ? '…' : syncCounts.total}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1 bg-ds-surface-container-high rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${syncPct}%` }} />
            </div>
            <span className="text-[10px] font-semibold tabular-nums text-ds-on-surface-variant">{syncPct}%</span>
          </div>
          <p className="text-[10px] text-ds-on-surface-variant/60 mt-1">{syncCounts.synced}대 동기화 완료</p>
        </div>

        <div className="card rounded-xl px-4 py-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ds-on-surface-variant/60">동기화 완료</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-600 mt-1.5">
            {isLoading ? '…' : syncCounts.synced}
          </p>
          <p className="text-[10px] text-ds-on-surface-variant/60 mt-3">정상 수집 장비</p>
        </div>

        <div className="card rounded-xl px-4 py-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ds-on-surface-variant/60">동기화 중</p>
          <p className={`text-2xl font-bold tabular-nums mt-1.5 ${syncCounts.syncing > 0 ? 'text-ds-tertiary' : 'text-ds-on-surface'}`}>
            {isLoading ? '…' : syncCounts.syncing}
          </p>
          <p className="text-[10px] text-ds-on-surface-variant/60 mt-3">
            {syncCounts.syncing > 0 ? '수집 진행 중' : '진행 없음'}
          </p>
        </div>

        <div className="card rounded-xl px-4 py-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ds-on-surface-variant/60">오류</p>
          <p className={`text-2xl font-bold tabular-nums mt-1.5 ${syncCounts.error > 0 ? 'text-ds-error' : 'text-ds-on-surface'}`}>
            {isLoading ? '…' : syncCounts.error}
          </p>
          <p className="text-[10px] text-ds-on-surface-variant/60 mt-3">
            {syncCounts.error > 0 ? '조치 필요' : '정상'}
          </p>
        </div>
      </div>

      {/* 장비 테이블 */}
      <div className="card rounded-xl flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-5 py-3 gap-3">
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
                placeholder="장비명, IP 검색"
                className="text-[12px] bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/40 w-36"
              />
              {quickFilter && (
                <button onClick={() => setQuickFilter('')}>
                  <XCircle className="w-3 h-3 text-ds-on-surface-variant hover:text-ds-on-surface" />
                </button>
              )}
            </div>
          </div>
        </div>

        <AgGridWrapper<Device>
          ref={gridRef}
          columnDefs={COLUMN_DEFS}
          rowData={devices}
          getRowId={(p) => String(p.data.id)}
          quickFilterText={quickFilter}
          height="calc(100vh - 380px)"
          noRowsText="등록된 장비가 없습니다."
          rowSelection="multiple"
          onSelectionChanged={(rows) => setSelectedDevices(rows)}
          defaultColDefOverride={{ filter: false, resizable: true, sortable: true }}
          fitColumns
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
        } : undefined}
        onSubmit={(data) => {
          if (editTarget) {
            const payload: DeviceUpdate = { ...data }
            if (!data.password) { delete payload.password; delete payload.password_confirm }
            updateMutation.mutate({ id: editTarget.id, data: payload })
          } else {
            createMutation.mutate(data as DeviceCreate)
          }
        }}
        isPending={createMutation.isPending || updateMutation.isPending}
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
