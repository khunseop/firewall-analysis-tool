import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Upload, Download, RefreshCw } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import {
  listDevices, createDevice, updateDevice, deleteDevice,
  testConnection, syncAll, downloadDeviceTemplate, bulkImportDevices,
  type Device, type DeviceCreate, type DeviceUpdate,
} from '@/api/devices'
import { formatDate } from '@/lib/utils'

const VENDOR_OPTIONS = [
  { code: 'paloalto', label: 'Palo Alto' },
  { code: 'ngf', label: 'SECUI NGF' },
  { code: 'mock', label: 'Mock' },
]

interface DeviceFormData {
  name: string; ip_address: string; vendor: string; username: string
  password: string; password_confirm: string; ha_peer_ip: string
  model: string; description: string; collect_last_hit_date: boolean
  use_ssh_for_last_hit_date: boolean
}

const DEFAULT_FORM: DeviceFormData = {
  name: '', ip_address: '', vendor: 'paloalto', username: '', password: '', password_confirm: '',
  ha_peer_ip: '', model: '', description: '', collect_last_hit_date: true, use_ssh_for_last_hit_date: false,
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
            ].map(({ label, key, required }) => (
              <div key={key} className="space-y-1">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} required={required} className="bg-ds-surface-container-low border-ds-outline-variant/30 text-sm" />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">벤더 *</Label>
              <ShadSelect value={form.vendor} onValueChange={(v) => set('vendor', v)}>
                <SelectTrigger className="bg-ds-surface-container-low border-ds-outline-variant/30 text-sm">
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
              <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} required={!initial?.name} className="bg-ds-surface-container-low border-ds-outline-variant/30 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">
                비밀번호 확인 {!initial?.name && '*'}
              </Label>
              <Input type="password" value={form.password_confirm} onChange={(e) => set('password_confirm', e.target.value)} required={!initial?.name} className="bg-ds-surface-container-low border-ds-outline-variant/30 text-sm" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">설명</Label>
            <Input value={form.description} onChange={(e) => set('description', e.target.value)} className="bg-ds-surface-container-low border-ds-outline-variant/30 text-sm" />
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

const SYNC_STATUS_PILL: Record<string, { label: string; classes: string }> = {
  success:     { label: '완료',   classes: 'bg-green-100 text-green-700' },
  in_progress: { label: '진행중', classes: 'bg-amber-100 text-amber-700' },
  pending:     { label: '대기중', classes: 'bg-blue-100 text-blue-700' },
  failure:     { label: '실패',   classes: 'bg-red-100 text-red-700' },
  error:       { label: '오류',   classes: 'bg-red-100 text-red-700' },
}

export function DevicesPage() {
  const queryClient = useQueryClient()
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const [quickFilter, setQuickFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Device | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkFile, setBulkFile] = useState<File | null>(null)
  const { confirm, ConfirmDialogElement } = useConfirm()

  const { data: devices = [], isLoading } = useQuery({ queryKey: ['devices'], queryFn: listDevices })

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
  const bulkImportMutation = useMutation({
    mutationFn: (file: File) => bulkImportDevices(file),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['devices'] }); setBulkOpen(false); setBulkFile(null)
      toast.success(`등록 완료: ${result.success_count}/${result.total}개 성공`)
      if (result.failed_count > 0) toast.warning(`실패: ${result.failed_devices.join(', ')}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleDelete = async (device: Device) => {
    const ok = await confirm({ title: '장비 삭제', description: `'${device.name}'을(를) 삭제하시겠습니까?`, variant: 'destructive', confirmLabel: '삭제' })
    if (ok) deleteMutation.mutate(device.id)
  }

  const handleTestConnection = async (device: Device) => {
    toast.info(`'${device.name}' 연결 테스트 중…`)
    try { toast.success((await testConnection(device.id)).message) }
    catch (e: unknown) { toast.error((e as Error).message) }
  }

  const actionColDef: ColDef<Device> = {
    headerName: '작업',
    width: 240,
    sortable: false,
    filter: false,
    cellRenderer: (params: { data: Device }) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: '100%' }}>
        {[
          { label: '수정',     classes: 'text-ds-tertiary border border-ds-tertiary/30 hover:bg-ds-secondary-container',   onClick: () => { setEditTarget(params.data); setFormOpen(true) } },
          { label: '삭제',     classes: 'text-ds-error border border-ds-error/30 hover:bg-red-50',                         onClick: () => handleDelete(params.data) },
          { label: '연결테스트', classes: 'text-ds-on-surface-variant border border-ds-outline-variant/30 hover:bg-ds-surface-container-low', onClick: () => handleTestConnection(params.data) },
          { label: '동기화',   classes: 'text-green-700 border border-green-200 hover:bg-green-50',                        onClick: () => syncMutation.mutate(params.data.id) },
        ].map(({ label, classes, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            className={`px-2 py-0.5 text-[11px] font-semibold rounded-md transition-colors bg-white ${classes}`}
          >
            {label}
          </button>
        ))}
      </div>
    ),
  }

  const columnDefs: ColDef<Device>[] = [
    { field: 'name', headerName: '장비명', filter: 'agTextColumnFilter', width: 150 },
    { field: 'vendor', headerName: '벤더', filter: 'agTextColumnFilter', width: 100 },
    { field: 'ip_address', headerName: 'IP 주소', filter: 'agTextColumnFilter', width: 130 },
    { field: 'model', headerName: '모델', filter: 'agTextColumnFilter', width: 120 },
    { field: 'username', headerName: '사용자명', filter: 'agTextColumnFilter', width: 110 },
    { field: 'ha_peer_ip', headerName: 'HA Peer IP', filter: 'agTextColumnFilter', width: 120 },
    { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 150 },
    { field: 'last_sync_at', headerName: '마지막 동기화', filter: 'agTextColumnFilter', width: 160, valueFormatter: (p) => formatDate(p.value) },
    {
      field: 'last_sync_status',
      headerName: '동기화 상태',
      width: 110,
      cellRenderer: (params: { value: string | null }) => {
        const conf = SYNC_STATUS_PILL[params.value ?? '']
        if (!conf) return <span className="text-ds-on-surface-variant text-xs">-</span>
        return (
          <div className="flex items-center h-full">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${conf.classes}`}>
              {conf.label}
            </span>
          </div>
        )
      },
    },
    actionColDef,
  ]

  return (
    <div className="space-y-6">
      {ConfirmDialogElement}

      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ds-on-surface font-headline">장비 관리</h1>
          <p className="text-ds-on-surface-variant text-sm mt-1">방화벽 장비 등록, 연결 테스트 및 동기화를 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setEditTarget(null); setFormOpen(true) }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-lg ambient-shadow-sm hover:opacity-90 transition-all"
          >
            <Plus className="w-4 h-4" />
            장비 추가
          </button>
          <button
            onClick={() => setBulkOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-ds-on-surface bg-ds-surface-container-lowest ghost-border rounded-lg ambient-shadow-sm hover:bg-ds-surface-container-low transition-colors"
          >
            <Upload className="w-4 h-4" />
            대량 등록
          </button>
          <button
            onClick={downloadDeviceTemplate}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-ds-on-surface bg-ds-surface-container-lowest ghost-border rounded-lg ambient-shadow-sm hover:bg-ds-surface-container-low transition-colors"
          >
            <Download className="w-4 h-4" />
            템플릿
          </button>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['devices'] })}
            className="p-2 text-ds-on-surface-variant bg-ds-surface-container-lowest ghost-border rounded-lg ambient-shadow-sm hover:bg-ds-surface-container-low transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ds-outline-variant/10">
          <span className="text-xs text-ds-on-surface-variant">{devices.length.toLocaleString()}개 장비</span>
          <input
            placeholder="빠른 검색…"
            value={quickFilter}
            onChange={(e) => setQuickFilter(e.target.value)}
            className="h-8 w-48 text-sm px-3 bg-ds-surface-container-low rounded-md border border-ds-outline-variant/30 focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary"
          />
        </div>
        {isLoading ? (
          <div className="py-16 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>
        ) : (
          <AgGridWrapper<Device>
            ref={gridRef}
            columnDefs={columnDefs}
            rowData={devices}
            getRowId={(p) => String(p.data.id)}
            quickFilterText={quickFilter}
            height={500}
            noRowsText="등록된 장비가 없습니다."
          />
        )}
      </div>

      {/* Device form dialog */}
      <DeviceFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null) }}
        initial={editTarget ? {
          name: editTarget.name, ip_address: editTarget.ip_address, vendor: editTarget.vendor,
          username: editTarget.username, password: '', password_confirm: '',
          ha_peer_ip: editTarget.ha_peer_ip ?? '', model: editTarget.model ?? '',
          description: editTarget.description ?? '',
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

      {/* Bulk import dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="bg-ds-surface-container-lowest">
          <DialogHeader>
            <DialogTitle className="font-headline text-ds-on-surface">장비 대량 등록</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-ds-on-surface-variant">Excel 파일을 업로드하여 여러 장비를 한번에 등록합니다.</p>
            <Input type="file" accept=".xlsx,.xls" onChange={(e) => setBulkFile(e.target.files?.[0] ?? null)} className="bg-ds-surface-container-low border-ds-outline-variant/30" />
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
