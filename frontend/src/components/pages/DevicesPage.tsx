import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, RefreshCw, Upload, Download, TestTube } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { StatusBadge } from '@/components/shared/StatusBadge'
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
  name: string
  ip_address: string
  vendor: string
  username: string
  password: string
  password_confirm: string
  ha_peer_ip: string
  model: string
  description: string
  collect_last_hit_date: boolean
  use_ssh_for_last_hit_date: boolean
}

const DEFAULT_FORM: DeviceFormData = {
  name: '', ip_address: '', vendor: 'paloalto', username: '', password: '', password_confirm: '',
  ha_peer_ip: '', model: '', description: '', collect_last_hit_date: true, use_ssh_for_last_hit_date: false,
}

function DeviceFormDialog({
  open, onClose, initial, onSubmit, isPending,
}: {
  open: boolean
  onClose: () => void
  initial?: DeviceFormData
  onSubmit: (data: DeviceFormData) => void
  isPending: boolean
}) {
  const [form, setForm] = useState<DeviceFormData>(initial ?? DEFAULT_FORM)
  const set = (key: keyof DeviceFormData, val: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(form)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial?.name ? '장비 수정' : '장비 추가'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>장비명 *</Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>IP 주소 *</Label>
              <Input value={form.ip_address} onChange={(e) => set('ip_address', e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>벤더 *</Label>
              <ShadSelect value={form.vendor} onValueChange={(v) => set('vendor', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VENDOR_OPTIONS.map((o) => (
                    <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>
            <div className="space-y-1">
              <Label>모델</Label>
              <Input value={form.model} onChange={(e) => set('model', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>사용자명 *</Label>
              <Input value={form.username} onChange={(e) => set('username', e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>HA Peer IP</Label>
              <Input value={form.ha_peer_ip} onChange={(e) => set('ha_peer_ip', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>비밀번호 {!initial?.name && '*'}</Label>
              <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} required={!initial?.name} />
            </div>
            <div className="space-y-1">
              <Label>비밀번호 확인 {!initial?.name && '*'}</Label>
              <Input type="password" value={form.password_confirm} onChange={(e) => set('password_confirm', e.target.value)} required={!initial?.name} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>설명</Label>
            <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div className="flex gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={form.collect_last_hit_date}
                onCheckedChange={(v) => set('collect_last_hit_date', !!v)}
              />
              최근 사용일 수집
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={form.use_ssh_for_last_hit_date}
                onCheckedChange={(v) => set('use_ssh_for_last_hit_date', !!v)}
              />
              SSH로 최근 사용일 수집
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>취소</Button>
            <Button type="submit" disabled={isPending}>{isPending ? '처리중...' : '저장'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const COLUMN_DEFS: ColDef<Device>[] = [
  { field: 'name', headerName: '장비명', filter: 'agTextColumnFilter', width: 150 },
  { field: 'vendor', headerName: '벤더', filter: 'agTextColumnFilter', width: 100 },
  { field: 'ip_address', headerName: 'IP 주소', filter: 'agTextColumnFilter', width: 130 },
  { field: 'model', headerName: '모델', filter: 'agTextColumnFilter', width: 120 },
  { field: 'username', headerName: '사용자명', filter: 'agTextColumnFilter', width: 110 },
  { field: 'ha_peer_ip', headerName: 'HA Peer IP', filter: 'agTextColumnFilter', width: 120 },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 150 },
  {
    field: 'last_sync_at',
    headerName: '마지막 동기화',
    filter: 'agTextColumnFilter',
    width: 160,
    valueFormatter: (p) => formatDate(p.value),
  },
  {
    field: 'last_sync_status',
    headerName: '동기화 상태',
    width: 120,
    cellRenderer: (params: { value: string | null }) => {
      const colors: Record<string, string> = { success: '#22c55e', in_progress: '#3b82f6', pending: '#f59e0b', failure: '#ef4444', error: '#ef4444' }
      const bg = colors[params.value ?? ''] ?? '#94a3b8'
      return (
        <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: bg, display: 'inline-block' }} />
        </div>
      )
    },
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
    onSuccess: () => { toast.success('동기화가 시작되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })

  const bulkImportMutation = useMutation({
    mutationFn: (file: File) => bulkImportDevices(file),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['devices'] })
      setBulkOpen(false)
      setBulkFile(null)
      toast.success(`등록 완료: ${result.success_count}/${result.total}개 성공`)
      if (result.failed_count > 0) {
        toast.warning(`실패: ${result.failed_devices.join(', ')}`)
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleFormSubmit = (data: DeviceFormData) => {
    if (editTarget) {
      const payload: DeviceUpdate = { ...data }
      if (!data.password) { delete payload.password; delete payload.password_confirm }
      updateMutation.mutate({ id: editTarget.id, data: payload })
    } else {
      createMutation.mutate(data as DeviceCreate)
    }
  }

  const handleDelete = async (device: Device) => {
    const ok = await confirm({ title: '장비 삭제', description: `'${device.name}'을(를) 삭제하시겠습니까?`, variant: 'destructive', confirmLabel: '삭제' })
    if (ok) deleteMutation.mutate(device.id)
  }

  const handleTestConnection = async (device: Device) => {
    toast.info(`'${device.name}' 연결 테스트 중...`)
    try {
      const result = await testConnection(device.id)
      toast.success(result.message)
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  }

  const handleSync = (device: Device) => {
    syncMutation.mutate(device.id)
  }

  const actionColDef: ColDef<Device> = {
    headerName: '작업',
    width: 230,
    sortable: false,
    filter: false,
    cellRenderer: (params: { data: Device }) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: '100%' }}>
        {[
          { label: '수정', color: '#1d4ed8', border: '#93c5fd', onClick: () => { setEditTarget(params.data); setFormOpen(true) } },
          { label: '삭제', color: '#b91c1c', border: '#fca5a5', onClick: () => handleDelete(params.data) },
          { label: '연결테스트', color: '#374151', border: '#d1d5db', onClick: () => handleTestConnection(params.data) },
          { label: '동기화', color: '#15803d', border: '#86efac', onClick: () => handleSync(params.data) },
        ].map(({ label, color, border, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            style={{ padding: '1px 6px', fontSize: 11, borderRadius: 4, border: `1px solid ${border}`, color, cursor: 'pointer', background: 'white' }}
          >
            {label}
          </button>
        ))}
      </div>
    ),
  }

  return (
    <div className="space-y-4">
      {ConfirmDialogElement}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">장비 관리</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder="빠른 검색..."
              value={quickFilter}
              onChange={(e) => setQuickFilter(e.target.value)}
              className="h-8 w-48 text-sm"
            />
            <Button size="sm" className="h-8 gap-1.5" onClick={() => { setEditTarget(null); setFormOpen(true) }}>
              <Plus className="h-3 w-3" /> 장비 추가
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setBulkOpen(true)}>
              <Upload className="h-3 w-3" /> 대량 등록
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={downloadDeviceTemplate}>
              <Download className="h-3 w-3" /> 템플릿
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => queryClient.invalidateQueries({ queryKey: ['devices'] })}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 px-4 pb-4">
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">로딩 중...</div>
          ) : (
            <AgGridWrapper<Device>
              ref={gridRef}
              columnDefs={[...COLUMN_DEFS, actionColDef]}
              rowData={devices}
              getRowId={(p) => String(p.data.id)}
              quickFilterText={quickFilter}
              height={500}
              noRowsText="등록된 장비가 없습니다."
            />
          )}
        </CardContent>
      </Card>

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
        onSubmit={handleFormSubmit}
        isPending={createMutation.isPending || updateMutation.isPending}
      />

      {/* Bulk import dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>장비 대량 등록</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Excel 파일을 업로드하여 여러 장비를 한번에 등록합니다.</p>
            <Input type="file" accept=".xlsx,.xls" onChange={(e) => setBulkFile(e.target.files?.[0] ?? null)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>취소</Button>
            <Button
              disabled={!bulkFile || bulkImportMutation.isPending}
              onClick={() => bulkFile && bulkImportMutation.mutate(bulkFile)}
            >
              {bulkImportMutation.isPending ? '등록 중...' : '등록'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
