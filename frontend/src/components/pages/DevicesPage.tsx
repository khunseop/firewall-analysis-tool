import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Upload, Download, RefreshCw, Pencil, Trash2, Wifi, Search, XCircle, ChevronDown, Settings2, Tag, CheckCircle2, AlertCircle, Loader2, FileDown } from 'lucide-react'
import type { IRowNode } from '@ag-grid-community/core'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { rowIdFromId } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { listDevices, createDevice, updateDevice, deleteDevice, testConnection, syncAll, downloadDeviceTemplate, bulkImportDevices, type Device, type DeviceCreate, type DeviceUpdate } from '@/api/devices'
import { useSyncStatusWebSocket, type SyncStatusMessage } from '@/hooks/useWebSocket'
import { notify } from '@/lib/notify'
import { DeviceDetailDialog } from './devices/DeviceDetailDialog'
import { queryKeys } from '@/api/queryKeys'
import { DeviceFormDialog } from './devices/DeviceFormDialog'
import { BulkOptionsDialog } from './devices/BulkOptionsDialog'
import { BulkGroupDialog } from './devices/BulkGroupDialog'
import { DirectExportDialog } from './devices/DirectExportDialog'
import { buildColumnDefs } from './devices/deviceColumns'

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

  const { data: devices = [], isLoading } = useQuery({ queryKey: queryKeys.devices, queryFn: listDevices })

  // devices 쿼리가 갱신될 때 그리드에서 최신 선택 행 데이터를 재동기화
  useEffect(() => {
    const api = gridRef.current?.gridApi
    if (!api) return
    const fresh = api.getSelectedRows() as Device[]
    // Ag-Grid는 외부 시스템이므로 effect 동기화가 적절 (렌더 파생으로 대체 불가)
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.devices }); setFormOpen(false); toast.success('장비가 추가되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: DeviceUpdate }) => updateDevice(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.devices }); setFormOpen(false); setEditTarget(null); toast.success('장비가 수정되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDevice(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.devices }); toast.success('장비가 삭제되었습니다.') },
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
      queryClient.invalidateQueries({ queryKey: queryKeys.devices })
    } else if (msg.status === 'failure') {
      notify('동기화 실패', deviceName ?? `장비 ID ${msg.device_id}`, 'error', { category: 'sync', device_id: msg.device_id, device_name: deviceName })
      queryClient.invalidateQueries({ queryKey: queryKeys.devices })
    }
  }, [queryClient])

  useSyncStatusWebSocket(handleSyncMessage)

  const bulkImportMutation = useMutation({
    mutationFn: (file: File) => bulkImportDevices(file),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.devices }); setBulkOpen(false); setBulkFile(null)
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
      queryClient.invalidateQueries({ queryKey: queryKeys.devices })
      toast.success(`${selectedDevices.length}개 장비 수집 옵션이 변경되었습니다.`)
    } catch (e: unknown) { toast.error((e as Error).message) }
  }, [selectedDevices, queryClient])

  const handleBulkSetGroup = useCallback(async (group: string) => {
    setBulkGroupOpen(false)
    try {
      await Promise.all(selectedDevices.map(d => updateDevice(d.id, { group })))
      queryClient.invalidateQueries({ queryKey: queryKeys.devices })
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
            onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.devices })}
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
          getRowId={rowIdFromId}
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
