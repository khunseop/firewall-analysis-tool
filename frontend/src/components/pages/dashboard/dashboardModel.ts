import type { DeviceStats } from '@/api/devices'
import { capacityLevel } from '@/lib/deviceCapacity'

/** 마지막 동기화로부터 이 일수 이상 지나면 "오래된 동기화"로 경보한다. */
export const STALE_SYNC_DAYS = 7

export interface DeviceRow {
  id: number; name: string; vendor: string; ip_address?: string
  model?: string | null; os_version?: string | null
  policies: number; active_policies: number; disabled_policies: number
  network_objects: number; network_groups: number
  services: number; service_groups: number
  sync_status: string | null; sync_step: string | null; sync_time: string | null
  policy_threshold: number | null
  network_object_threshold: number | null
  network_group_threshold: number | null
  service_threshold: number | null
  service_group_threshold: number | null
  /** 목록 기본 정렬용 — 문제가 심한 장비일수록 큰 값 (0 = 정상). */
  problem_rank: number
}

// 퍼센트는 내림한다 — 99.96%가 반올림으로 100%가 되면 '100% 이상' 그룹과 구분되지 않는다.
export interface CapacityMetric { label: string; usage: number; threshold: number; pct: number; level: 'warning' | 'danger' }

export function getHighCapacityMetrics(row: Pick<DeviceRow,
  'policies' | 'network_objects' | 'network_groups' | 'services' | 'service_groups' |
  'policy_threshold' | 'network_object_threshold' | 'network_group_threshold' | 'service_threshold' | 'service_group_threshold'>): CapacityMetric[] {
  const candidates: { label: string; usage: number; threshold: number | null }[] = [
    { label: '정책', usage: row.policies, threshold: row.policy_threshold },
    { label: '네트워크 객체', usage: row.network_objects, threshold: row.network_object_threshold },
    { label: '네트워크 그룹', usage: row.network_groups, threshold: row.network_group_threshold },
    { label: '서비스 객체', usage: row.services, threshold: row.service_threshold },
    { label: '서비스 그룹', usage: row.service_groups, threshold: row.service_group_threshold },
  ]
  const metrics: CapacityMetric[] = []
  for (const c of candidates) {
    const level = capacityLevel(c.usage, c.threshold)
    if (level === 'normal' || c.threshold == null) continue
    metrics.push({ label: c.label, usage: c.usage, threshold: c.threshold, pct: Math.floor((c.usage / c.threshold) * 100), level })
  }
  return metrics
}

const isFailed = (s: string | null) => s === 'failure' || s === 'error'
const isRunning = (s: string | null) => s === 'in_progress' || s === 'pending'

export function daysSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : Math.floor((now - t) / 86_400_000)
}

/** 장비 1대의 문제 심각도 — 오류 > 임계치 초과 > 동기화 이력 없음·오래됨 > 임계치 80% 이상 > 정상. */
export function problemRank(row: Omit<DeviceRow, 'problem_rank'>, now = Date.now()): number {
  if (isFailed(row.sync_status)) return 4
  const metrics = getHighCapacityMetrics(row)
  if (metrics.some((m) => m.level === 'danger')) return 3
  if (!isRunning(row.sync_status)) {
    const age = daysSince(row.sync_time, now)
    if (row.sync_time == null || (age != null && age >= STALE_SYNC_DAYS)) return 2
  }
  if (metrics.length > 0) return 1
  return 0
}

export function transformDeviceStats(d: DeviceStats): DeviceRow {
  const base = {
    id: d.id, name: d.name, vendor: d.vendor, ip_address: d.ip_address,
    model: d.model, os_version: d.os_version,
    policies: d.policies ?? 0,
    active_policies: d.active_policies ?? 0,
    disabled_policies: d.disabled_policies ?? 0,
    network_objects: d.network_objects ?? 0,
    network_groups: d.network_groups ?? 0,
    services: d.services ?? 0,
    service_groups: d.service_groups ?? 0,
    sync_status: d.sync_status,
    sync_step: d.sync_step,
    sync_time: d.sync_time,
    policy_threshold: d.policy_threshold,
    network_object_threshold: d.network_object_threshold,
    network_group_threshold: d.network_group_threshold,
    service_threshold: d.service_threshold,
    service_group_threshold: d.service_group_threshold,
  }
  return { ...base, problem_rank: problemRank(base) }
}

export type AttentionKind = 'error' | 'never' | 'stale' | 'danger' | 'warning'

export interface AttentionItem { id: number; name: string; detail: string }
export interface AttentionGroup { kind: AttentionKind; label: string; tone: 'error' | 'warning'; items: AttentionItem[] }

/** "지금 확인할 장비" 목록 — 한 장비가 여러 그룹에 속할 수 있다(예: 동기화 오류 + 임계치 초과). */
export function computeAttention(rows: DeviceRow[], now = Date.now()): AttentionGroup[] {
  const error: AttentionItem[] = []
  const never: AttentionItem[] = []
  const stale: AttentionItem[] = []
  const danger: (AttentionItem & { pct: number })[] = []
  const warning: (AttentionItem & { pct: number })[] = []

  for (const r of rows) {
    if (isFailed(r.sync_status)) {
      error.push({ id: r.id, name: r.name, detail: r.sync_step ? `실패 단계: ${r.sync_step}` : '동기화 실패' })
    } else if (!isRunning(r.sync_status)) {
      if (r.sync_time == null) {
        never.push({ id: r.id, name: r.name, detail: '동기화 이력 없음' })
      } else {
        const age = daysSince(r.sync_time, now)
        if (age != null && age >= STALE_SYNC_DAYS) stale.push({ id: r.id, name: r.name, detail: `${age}일 전` })
      }
    }
    const metrics = getHighCapacityMetrics(r)
    const worst = [...metrics].sort((a, b) => b.pct - a.pct)[0]
    if (worst) {
      const item = { id: r.id, name: r.name, detail: `${worst.label} ${worst.pct}%`, pct: worst.pct }
      if (metrics.some((m) => m.level === 'danger')) danger.push(item)
      else warning.push(item)
    }
  }

  const byPct = (a: { pct: number }, b: { pct: number }) => b.pct - a.pct
  const strip = (list: (AttentionItem & { pct: number })[]) => list.sort(byPct).map(({ id, name, detail }) => ({ id, name, detail }))
  const groups: AttentionGroup[] = [
    { kind: 'error', label: '동기화 오류', tone: 'error', items: error },
    { kind: 'danger', label: '임계치 초과 (100% 이상)', tone: 'error', items: strip(danger) },
    { kind: 'never', label: '한 번도 동기화되지 않음', tone: 'warning', items: never },
    { kind: 'stale', label: `${STALE_SYNC_DAYS}일 넘게 동기화되지 않음`, tone: 'warning', items: stale },
    { kind: 'warning', label: '임계치 80% 이상', tone: 'warning', items: strip(warning) },
  ]
  return groups.filter((g) => g.items.length > 0)
}
