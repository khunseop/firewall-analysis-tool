import { formatRelativeTime } from '@/lib/utils'
import { ExternalLink } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { type Device } from '@/api/devices'
import { VENDOR_OPTIONS, VENDOR_BADGE, STATUS_CONFIG, STATUS_ORDER } from './constants'
import { DeviceNameCell, ResourceWarningBadge } from './DeviceGridCells'
import { SshLinkButton } from './SshLinkButton'

export function buildColumnDefs(onShowDetail: (device: Device) => void, hidden: Set<string>): ColDef<Device>[] {
  return [
  {
    width: 44, minWidth: 44, maxWidth: 44,
    sortable: false, resizable: false, filter: false,
  },
  {
    headerName: '상태', minWidth: 110, flex: 0.9,
    valueGetter: (p) => STATUS_CONFIG[p.data?.last_sync_status ?? '']?.label ?? '',
    comparator: (_a, _b, nodeA, nodeB) =>
      (STATUS_ORDER[nodeA.data?.last_sync_status ?? ''] ?? -1) - (STATUS_ORDER[nodeB.data?.last_sync_status ?? ''] ?? -1),
    cellRenderer: (p: { data: Device }) => {
      const conf = STATUS_CONFIG[p.data?.last_sync_status ?? '']
      const failed = p.data?.last_sync_status === 'failure' || p.data?.last_sync_status === 'error'
      const step = p.data?.last_sync_step
      // 실패 사유(마지막 진행 단계)를 툴팁에만 두면 키보드·터치로 볼 수 없어 텍스트로 병기한다.
      return conf
        ? <span className={`flex items-center gap-1.5 text-11 font-semibold min-w-0 ${conf.text}`} title={step ?? ''}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${conf.dot}`} />
            <span className="shrink-0">{conf.label}</span>
            {failed && step && <span className="font-normal truncate">· {step}</span>}
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
        <span className="text-11 text-ds-on-surface-variant font-mono">{p.data?.ip_address}</span>
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
        {p.data?.ip_address && <SshLinkButton host={p.data.ip_address} />}
      </div>
    ),
  },
  {
    colId: 'ha', hide: hidden.has('ha'),
    headerName: 'HA Peer IP', minWidth: 140,
    valueGetter: (p) => p.data?.ha_peer_ip ?? '',
    cellRenderer: (p: { data: Device }) => p.data?.ha_peer_ip ? (
      <div className="flex items-center gap-1">
        <span className="text-11 text-ds-on-surface-variant font-mono">{p.data.ha_peer_ip}</span>
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
        <SshLinkButton host={p.data.ha_peer_ip} />
      </div>
    ) : <span className="text-xs text-ds-on-surface-variant/40">—</span>,
  },
  {
    field: 'vendor', headerName: '벤더', minWidth: 90,
    valueGetter: (p) => VENDOR_OPTIONS.find(v => v.code === p.data?.vendor)?.label ?? p.data?.vendor ?? '',
    cellRenderer: (p: { data: Device }) => (
      <span className={`inline-flex px-2 py-0.5 rounded text-10 font-bold uppercase tracking-wide ${VENDOR_BADGE[p.data?.vendor?.toLowerCase() ?? ''] ?? 'bg-gray-50 text-gray-500 border border-gray-100'}`}>
        {VENDOR_OPTIONS.find(v => v.code === p.data?.vendor)?.label ?? p.data?.vendor}
      </span>
    ),
  },
  {
    colId: 'model', hide: hidden.has('model'),
    field: 'model', headerName: '모델', minWidth: 100,
    cellRenderer: (p: { value: string }) => <span className="text-xs text-ds-on-surface-variant">{p.value ?? '—'}</span>,
  },
  {
    colId: 'group', hide: hidden.has('group'),
    field: 'group', headerName: '그룹', minWidth: 90,
    cellRenderer: (p: { value: string }) => p.value
      ? <span className="inline-flex px-2 py-0.5 rounded text-10 font-bold bg-ds-tertiary/10 text-ds-tertiary">{p.value}</span>
      : <span className="text-xs text-ds-on-surface-variant/40">—</span>,
  },
  {
    colId: 'description', hide: hidden.has('description'),
    field: 'description', headerName: '설명', minWidth: 120, flex: 1,
    cellRenderer: (p: { value: string }) => <span className="text-xs text-ds-on-surface-variant">{p.value ?? '—'}</span>,
  },
  {
    colId: 'collect', hide: hidden.has('collect'),
    headerName: '수집 옵션', minWidth: 100, sortable: false, filter: false,
    cellRenderer: (p: { data: Device }) => (
      <div className="flex gap-1 flex-wrap items-center">
        {p.data?.collect_last_hit_date && <span className="inline-flex px-1.5 py-0.5 rounded text-9 font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">히트수집</span>}
        {p.data?.use_ssh_for_last_hit_date && <span className="inline-flex px-1.5 py-0.5 rounded text-9 font-bold bg-blue-50 text-blue-700 border border-blue-100">SSH</span>}
        {!p.data?.collect_last_hit_date && !p.data?.use_ssh_for_last_hit_date && <span className="text-xs text-ds-on-surface-variant/40">—</span>}
      </div>
    ),
  },
  {
    headerName: '마지막 동기화', minWidth: 120, filter: false,
    valueGetter: (p) => formatRelativeTime(p.data?.last_sync_at ?? null),
    comparator: (_a, _b, nodeA, nodeB) =>
      new Date(nodeA.data?.last_sync_at ?? 0).getTime() - new Date(nodeB.data?.last_sync_at ?? 0).getTime(),
    cellRenderer: (p: { value: string }) => <span className="text-xs text-ds-on-surface-variant">{p.value}</span>,
  },
  {
    colId: 'threshold', hide: hidden.has('threshold'),
    headerName: '임계치', minWidth: 90, sortable: false, filter: false,
    cellRenderer: (p: { data: Device }) => <ResourceWarningBadge data={p.data as Device} />,
  },
  ]
}
