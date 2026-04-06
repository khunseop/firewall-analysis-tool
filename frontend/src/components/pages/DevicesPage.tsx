import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Upload, Download, RefreshCw, Pencil, Trash2, Wifi, Server, CheckCircle, Loader2, AlertTriangle } from 'lucide-react'
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
import { formatDate } from '@/lib/utils'

const VENDOR_OPTIONS = [
  { code: 'paloalto', label: 'Palo Alto' },
  { code: 'ngf', label: 'SECUI NGF' },
  { code: 'mf2', label: 'SECUI MF2' },
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

const SYNC_STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  success:     { label: '완료',   classes: 'bg-green-100 text-green-700' },
  in_progress: { label: '진행중', classes: 'bg-amber-100 text-amber-700' },
  pending:     { label: '대기중', classes: 'bg-blue-100 text-blue-700' },
  failure:     { label: '실패',   classes: 'bg-red-100 text-red-700' },
  error:       { label: '오류',   classes: 'bg-red-100 text-red-700' },
}

export function DevicesPage() {
  const queryClient = useQueryClient()
  const [quickFilter, setQuickFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Device | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkFile, setBulkFile] = useState<File | null>(null)
  const { confirm, ConfirmDialogElement } = useConfirm()

  const { data: devices = [], isLoading } = useQuery({ queryKey: ['devices'], queryFn: listDevices })

  const filteredDevices = useMemo(() => {
    if (!quickFilter.trim()) return devices
    const q = quickFilter.toLowerCase()
    return devices.filter(d =>
      d.name?.toLowerCase().includes(q) ||
      d.ip_address?.toLowerCase().includes(q) ||
      d.vendor?.toLowerCase().includes(q) ||
      d.model?.toLowerCase().includes(q) ||
      d.description?.toLowerCase().includes(q)
    )
  }, [devices, quickFilter])

  const syncCounts = useMemo(() => ({
    total: devices.length,
    synced: devices.filter(d => d.last_sync_status === 'success').length,
    syncing: devices.filter(d => d.last_sync_status === 'in_progress' || d.last_sync_status === 'pending').length,
    error: devices.filter(d => d.last_sync_status === 'failure' || d.last_sync_status === 'error').length,
  }), [devices])

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

  const STAT_CARDS = [
    {
      label: '전체 장비', value: syncCounts.total, sub: `활성: ${syncCounts.synced}`,
      icon: Server, iconBg: 'bg-ds-primary-container', iconColor: 'text-ds-on-primary-container',
      valueColor: 'text-ds-on-surface',
    },
    {
      label: '동기화 완료', value: syncCounts.synced,
      sub: syncCounts.total > 0 ? `${Math.round(syncCounts.synced / syncCounts.total * 100)}% Fleet Health` : '',
      icon: CheckCircle, iconBg: 'bg-green-100', iconColor: 'text-green-700',
      valueColor: 'text-ds-on-surface',
    },
    {
      label: '동기화 중', value: syncCounts.syncing, sub: syncCounts.syncing > 0 ? '진행 중' : '',
      icon: Loader2, iconBg: 'bg-amber-100', iconColor: 'text-amber-700',
      valueColor: 'text-ds-on-surface',
    },
    {
      label: '오류', value: syncCounts.error, sub: syncCounts.error > 0 ? 'Critical: 조치 필요' : '',
      icon: AlertTriangle, iconBg: 'bg-red-100', iconColor: 'text-red-700',
      valueColor: syncCounts.error > 0 ? 'text-ds-error' : 'text-ds-on-surface',
    },
  ]

  return (
    <div className="space-y-8">
      {ConfirmDialogElement}

      {/* Page header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tighter text-ds-on-surface font-headline">장비 관리</h1>
          <p className="text-ds-on-surface-variant text-sm mt-1 max-w-lg">방화벽 장비 등록, 연결 테스트 및 동기화를 관리합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['devices'] })}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-ds-on-surface bg-ds-surface-container-lowest ghost-border rounded-xl ambient-shadow hover:bg-ds-surface-container-low transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            새로고침
          </button>
          <button
            onClick={() => { setEditTarget(null); setFormOpen(true) }}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold btn-primary-gradient text-ds-on-tertiary rounded-xl ambient-shadow hover:opacity-90 transition-all"
          >
            <Plus className="w-4 h-4" />
            장비 추가
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {STAT_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="bg-ds-surface-container-lowest p-6 rounded-xl ambient-shadow ghost-border">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-ds-on-surface-variant font-medium text-sm tracking-wide uppercase">{card.label}</p>
                  <h3 className={`text-4xl font-extrabold mt-2 font-headline ${card.valueColor}`}>
                    {isLoading ? '…' : card.value}
                  </h3>
                </div>
                <div className={`p-3 ${card.iconBg} rounded-lg ${card.iconColor}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              {card.sub && (
                <div className={`mt-4 text-xs font-semibold ${card.iconColor}`}>{card.sub}</div>
              )}
            </div>
          )
        })}
      </div>

      {/* Device table */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border overflow-hidden">
        <div className="px-8 py-5 border-b border-ds-outline-variant/10 flex justify-between items-center">
          <h2 className="text-base font-bold tracking-tight text-ds-on-surface font-headline">등록된 장비</h2>
          <div className="flex items-center gap-3">
            <input
              placeholder="장비 검색…"
              value={quickFilter}
              onChange={(e) => setQuickFilter(e.target.value)}
              className="h-8 w-48 text-sm px-3 bg-ds-surface-container-low rounded-md border border-ds-outline-variant/30 focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary"
            />
            <button
              onClick={() => setBulkOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-ds-on-surface ghost-border bg-ds-surface-container-lowest rounded-md hover:bg-ds-surface-container-low transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              대량 등록
            </button>
            <button
              onClick={downloadDeviceTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-ds-on-surface ghost-border bg-ds-surface-container-lowest rounded-md hover:bg-ds-surface-container-low transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              템플릿
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="py-16 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>
          ) : filteredDevices.length === 0 ? (
            <div className="py-16 text-center text-sm text-ds-on-surface-variant">
              {quickFilter ? '검색 결과가 없습니다.' : '등록된 장비가 없습니다.'}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-ds-surface-container-low/50">
                <tr>
                  <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary">장비명</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary">IP 주소</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary">벤더</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary">모델</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary">동기화 상태</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary">마지막 동기화</th>
                  <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-ds-primary text-right">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ds-outline-variant/10">
                {filteredDevices.map((device) => {
                  const statusConf = SYNC_STATUS_CONFIG[device.last_sync_status ?? '']
                  return (
                    <tr key={device.id} className="hover:bg-ds-surface-container-low/30 transition-colors">
                      <td className="px-8 py-5">
                        <div className="flex flex-col">
                          <span className="font-bold text-ds-on-surface text-sm">{device.name}</span>
                          {device.description && (
                            <span className="text-xs text-ds-on-surface-variant mt-0.5">{device.description}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-5 font-mono text-sm text-ds-on-surface">{device.ip_address}</td>
                      <td className="px-6 py-5 text-sm text-ds-on-surface">
                        {VENDOR_OPTIONS.find(v => v.code === device.vendor)?.label ?? device.vendor}
                      </td>
                      <td className="px-6 py-5 text-sm text-ds-on-surface-variant">{device.model ?? '-'}</td>
                      <td className="px-6 py-5">
                        {statusConf ? (
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-tight ${statusConf.classes}`}>
                            {statusConf.label}
                          </span>
                        ) : (
                          <span className="text-xs text-ds-on-surface-variant">-</span>
                        )}
                      </td>
                      <td className="px-6 py-5 text-sm text-ds-on-surface-variant">{formatDate(device.last_sync_at)}</td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => { setEditTarget(device); setFormOpen(true) }}
                            className="p-2 hover:bg-ds-surface-container-high rounded-lg text-ds-primary transition-colors"
                            title="수정"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => syncMutation.mutate(device.id)}
                            className="p-2 hover:bg-ds-surface-container-high rounded-lg text-ds-primary transition-colors"
                            title="동기화"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleTestConnection(device)}
                            className="p-2 hover:bg-ds-surface-container-high rounded-lg text-ds-primary transition-colors"
                            title="연결 테스트"
                          >
                            <Wifi className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(device)}
                            className="p-2 hover:bg-red-50 rounded-lg text-ds-error transition-colors"
                            title="삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-8 py-4 bg-ds-surface-container-low/30 border-t border-ds-outline-variant/10">
          <span className="text-xs text-ds-on-surface-variant">
            {quickFilter
              ? `${filteredDevices.length}개 표시 (전체 ${devices.length}개 중)`
              : `총 ${devices.length}개 장비`}
          </span>
        </div>
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
