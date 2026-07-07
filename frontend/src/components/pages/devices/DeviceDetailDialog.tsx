import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Pencil } from 'lucide-react'
import type { Device } from '@/api/devices'
import { resourceLevel, RESOURCE_LEVEL_BAR_COLOR, RESOURCE_LEVEL_TEXT_COLOR } from '@/lib/deviceResource'

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-bold uppercase tracking-widest text-ds-primary/70">{label}</div>
      <div className="text-[13px] text-ds-on-surface">{value || '—'}</div>
    </div>
  )
}

function ResourceRow({ label, usage, threshold, unit }: { label: string; usage: number | null; threshold: number | null; unit: string }) {
  const level = resourceLevel(usage, threshold)
  const pct = usage != null && threshold != null && threshold > 0 ? Math.min(100, Math.round((usage / threshold) * 100)) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[12px]">
        <span className="font-semibold text-ds-on-surface">{label}</span>
        <span className={`font-bold tabular-nums ${RESOURCE_LEVEL_TEXT_COLOR[level]}`}>
          {usage != null ? `${usage}${unit}` : '—'} / {threshold != null ? `${threshold}${unit}` : '—'}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-ds-outline-variant/20 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${RESOURCE_LEVEL_BAR_COLOR[level]}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function DeviceDetailDialog({ device, onClose, onEdit }: {
  device: Device | null
  onClose: () => void
  onEdit: (device: Device) => void
}) {
  return (
    <Dialog open={!!device} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">{device?.name} 상세 정보</DialogTitle>
        </DialogHeader>
        {device && (
          <div className="space-y-5">
            <div>
              <div className="text-[11px] font-bold text-ds-on-surface-variant/60 mb-2">기본정보</div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="IP 주소" value={device.ip_address} />
                <Field label="HA Peer IP" value={device.ha_peer_ip} />
                <Field label="벤더" value={device.vendor} />
                <Field label="모델" value={device.model} />
                <Field label="그룹" value={device.group} />
                <Field label="설명" value={device.description} />
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold text-ds-on-surface-variant/60 mb-2">상세정보</div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="시리얼 번호" value={device.serial_number} />
                <Field label="OS명" value={device.os_name} />
                <Field label="OS버전" value={device.os_version} />
                <Field label="도입일" value={device.install_date} />
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold text-ds-on-surface-variant/60 mb-2">설치정보</div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="지역" value={device.location_region} />
                <Field label="설치동" value={device.location_building} />
                <Field label="층" value={device.location_floor} />
                <Field label="Room" value={device.location_room} />
                <Field label="좌표 X" value={device.location_x} />
                <Field label="좌표 Y" value={device.location_y} />
                <Field label="좌표 Z" value={device.location_z} />
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold text-ds-on-surface-variant/60 mb-2">리소스 현황 (수기 입력)</div>
              <div className="space-y-2.5">
                <ResourceRow label="CPU" usage={device.cpu_usage} threshold={device.cpu_threshold} unit="%" />
                <ResourceRow label="메모리" usage={device.memory_usage} threshold={device.memory_threshold} unit="%" />
                <ResourceRow label="세션" usage={device.session_usage} threshold={device.session_threshold} unit="건" />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">닫기</button>
          {device && (
            <button
              type="button"
              onClick={() => onEdit(device)}
              className="flex items-center gap-1.5 px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md"
            >
              <Pencil className="w-3.5 h-3.5" />
              수정
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
