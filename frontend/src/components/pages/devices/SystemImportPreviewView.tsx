import { Checkbox } from '@/components/ui/checkbox'
import { changeKey, type DeviceDiff, type FieldChange, type SystemImportPreview } from '@/api/systemImport'

const FIELD_LABELS: Record<string, string> = {
  hostname: 'Hostname', ip_address: 'IP 주소', vendor: '벤더', model: '모델', serial_number: 'Serial',
  os_name: 'OS 이름', os_version: 'OS 버전', install_date: '설치일', description: '설명', ha_peer_ip: 'HA Peer IP',
  location_region: '지역', location_building: '설치동', location_floor: '층', location_room: 'Room',
  location_x: 'X좌표', location_y: 'Y좌표', location_z: 'Z좌표',
}
const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field

const KIND_LABEL: Record<FieldChange['kind'], string> = {
  override: '대시보드 기준', fill: '빈 칸 채움', connection: '연결 정보',
}

function Section({ title, count, tone = 'default', children, defaultOpen = false }: {
  title: string; count: number; tone?: 'default' | 'danger'; children: React.ReactNode; defaultOpen?: boolean
}) {
  if (count === 0) return null
  return (
    <details open={defaultOpen} className="rounded-lg border border-ds-outline-variant/30">
      <summary className={`cursor-pointer select-none px-3 py-2 text-sm font-semibold ${tone === 'danger' ? 'text-ds-error' : 'text-ds-on-surface'}`}>
        {title} <span className="font-mono text-xs font-normal text-ds-on-surface-variant">{count}</span>
      </summary>
      <div className="border-t border-ds-outline-variant/20 p-2 text-xs">{children}</div>
    </details>
  )
}

function ChangeRow({ change, checked, onToggle }: { change: FieldChange; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-black/5">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="w-24 shrink-0 text-ds-on-surface-variant">{fieldLabel(change.field)}</span>
      <span className="min-w-0 truncate font-mono text-ds-on-surface-variant">{change.old ?? '(비어 있음)'}</span>
      <span className="text-ds-on-surface-variant">→</span>
      <span className="min-w-0 truncate font-mono font-semibold text-ds-on-surface">{change.new ?? '(비움)'}</span>
      <span className="ml-auto shrink-0 text-11 text-ds-on-surface-variant">{KIND_LABEL[change.kind]}</span>
    </label>
  )
}

function DeviceChanges({ diff, kind, selected, onToggle }: {
  diff: DeviceDiff; kind: 'connection' | 'plain'; selected: Set<string>; onToggle: (keys: string[]) => void
}) {
  const changes = diff.changes.filter((c) => (kind === 'connection') === (c.kind === 'connection'))
  if (changes.length === 0) return null
  const keys = changes.map(changeKey)
  const all = keys.every((k) => selected.has(k))
  return (
    // 연결 정보(IP·벤더·HA Peer) 변경은 바뀌는 값을 보지 않고 확인 체크를 누르지 못하도록 항상 펼쳐서 보여준다
    <details open={kind === 'connection'} className="rounded border border-ds-outline-variant/20">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-2 py-1.5">
        <Checkbox checked={all} onCheckedChange={() => onToggle(keys)} onClick={(e) => e.stopPropagation()} />
        <span className="font-semibold text-ds-on-surface">{diff.device_name}</span>
        <span className="text-ds-on-surface-variant">{changes.length}건</span>
        {diff.via === 'hostname' && <span className="text-11 text-ds-error">IP가 달라 hostname으로 찾음</span>}
        {diff.dashboard_retired && <span className="text-11 text-ds-error">대시보드에서 폐기 상태</span>}
      </summary>
      <div className="p-1">
        {changes.map((c) => <ChangeRow key={changeKey(c)} change={c} checked={selected.has(changeKey(c))} onToggle={() => onToggle([changeKey(c)])} />)}
      </div>
    </details>
  )
}

export function SystemImportPreviewView({ preview, selected, onToggle }: {
  preview: SystemImportPreview; selected: Set<string>; onToggle: (keys: string[]) => void
}) {
  const connection = preview.diffs.filter((d) => d.changes.some((c) => c.kind === 'connection'))
  const plain = preview.diffs.filter((d) => d.changes.some((c) => c.kind !== 'connection'))
  const mismatches = preview.diffs.flatMap((d) => d.mismatches.map((m) => ({ ...m, name: d.device_name })))
  const pairs = preview.diffs.filter((d) => d.partner_hostname)
  const noChanges = preview.diffs.filter((d) => d.changes.length === 0 && d.mismatches.length === 0).length

  return (
    <div className="flex flex-col gap-2">
      <Section title="연결 정보 변경 (IP·벤더·HA Peer)" count={connection.length} tone="danger" defaultOpen>
        <p className="px-2 pb-2 text-ds-error">접속 대상이나 수집기가 바뀝니다. 적용 후 연결 테스트를 권장합니다.</p>
        <div className="flex flex-col gap-1">
          {connection.map((d) => <DeviceChanges key={d.device_id} diff={d} kind="connection" selected={selected} onToggle={onToggle} />)}
        </div>
      </Section>
      <Section title="변경 제안" count={plain.length} defaultOpen>
        <div className="flex flex-col gap-1">
          {plain.map((d) => <DeviceChanges key={d.device_id} diff={d} kind="plain" selected={selected} onToggle={onToggle} />)}
        </div>
      </Section>
      <Section title="불일치 (적용하지 않음 · FAT 수집값 유지)" count={mismatches.length}>
        {mismatches.map((m) => (
          <div key={`${m.device_id}:${m.field}`} className="flex gap-2 px-2 py-1">
            <span className="w-32 shrink-0 truncate font-semibold">{m.name}</span>
            <span className="w-24 shrink-0 text-ds-on-surface-variant">{fieldLabel(m.field)}</span>
            <span className="min-w-0 truncate font-mono">FAT {m.fat_value}</span>
            <span className="min-w-0 truncate font-mono text-ds-on-surface-variant">대시보드 {m.dashboard_value}</span>
          </div>
        ))}
      </Section>
      <Section title="HA 쌍" count={pairs.length}>
        {pairs.map((d) => <div key={d.device_id} className="px-2 py-1"><span className="font-semibold">{d.device_name}</span> ↔ <span className="font-mono">{d.partner_hostname}</span></div>)}
      </Section>
      <Section title="FAT에만 있는 장비 (대시보드에서 찾지 못함)" count={preview.unmatched_devices.length}>
        {preview.unmatched_devices.map((d) => <div key={d.id} className="px-2 py-1"><span className="font-semibold">{d.name}</span> <span className="font-mono text-ds-on-surface-variant">{d.ip_address}</span></div>)}
      </Section>
      <Section title="대시보드에만 있는 장비 (FAT 미등록 · 가져오지 않음)" count={preview.unmatched_rows.length}>
        {preview.unmatched_rows.map((r, i) => <div key={i} className="px-2 py-1"><span className="font-semibold">{r.hostname ?? '(hostname 없음)'}</span> <span className="font-mono text-ds-on-surface-variant">{r.ip ?? '-'} · {r.vendor} {r.model}</span></div>)}
      </Section>
      <Section title="경고" count={preview.warnings.length} tone="danger" defaultOpen>
        {preview.warnings.map((w, i) => <div key={i} className="px-2 py-1">{w}</div>)}
      </Section>
      <p className="px-1 text-11 text-ds-on-surface-variant">
        변경 없음 {noChanges}대 · 대상 벤더가 아니라 제외한 행 {preview.skipped_vendor_count}건
      </p>
    </div>
  )
}
