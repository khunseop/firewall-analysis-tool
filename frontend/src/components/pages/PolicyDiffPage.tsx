import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus, Minus, Edit2, AlertCircle } from 'lucide-react'
import { listDevices } from '@/api/devices'
import { apiClient } from '@/api/client'
import { queryKeys } from '@/api/queryKeys'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SyncPoint {
  id: number
  device_id: number
  sync_at: string
  total_policies: number | null
}

interface FieldChange {
  field: string
  before: string | null
  after: string | null
}

interface DiffEntry {
  rule_name: string
  vsys: string | null
  action: 'created' | 'updated' | 'deleted'
  field_changes: FieldChange[]
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  change_count: number
}

interface DiffResponse {
  from_sync: { id: number; sync_at: string; total_policies: number | null }
  to_sync: { id: number; sync_at: string; total_policies: number | null }
  summary: { created: number; updated: number; deleted: number; total: number }
  changes: DiffEntry[]
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function fetchSyncHistory(deviceId: number): Promise<SyncPoint[]> {
  const res = await apiClient.get('/firewall/sync-history', { params: { device_id: deviceId } })
  return res.data
}

async function fetchPolicyDiff(deviceId: number, fromId: number, toId: number): Promise<DiffResponse> {
  const res = await apiClient.get('/firewall/policy-diff', {
    params: { device_id: deviceId, from_sync_id: fromId, to_sync_id: toId },
  })
  return res.data
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

const FIELD_LABELS: Record<string, string> = {
  enable: '활성화', action: '액션', source: '출발지', destination: '목적지',
  service: '서비스', description: '설명', user: '사용자',
  application: '애플리케이션', security_profile: '보안 프로파일', category: '카테고리',
}

const SNAPSHOT_FIELDS = ['action', 'enable', 'source', 'destination', 'service', 'description', 'user', 'application', 'security_profile']

// ─── Sub-components ──────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: DiffEntry['action'] }) {
  if (action === 'created')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-100">
        <Plus className="w-2.5 h-2.5" />추가
      </span>
    )
  if (action === 'deleted')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 border border-red-100">
        <Minus className="w-2.5 h-2.5" />삭제
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-700 border border-amber-100">
      <Edit2 className="w-2.5 h-2.5" />수정
    </span>
  )
}

function FieldDiffTable({ changes }: { changes: FieldChange[] }) {
  return (
    <div className="rounded-lg overflow-hidden border border-ds-outline-variant/20 bg-white/60">
      <div className="grid grid-cols-[140px_1fr_1fr] text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 px-3 py-2 bg-ds-surface-container border-b border-ds-outline-variant/20">
        <span>필드</span>
        <span className="flex items-center gap-1"><Minus className="w-2.5 h-2.5 text-red-400" />이전 값</span>
        <span className="flex items-center gap-1"><Plus className="w-2.5 h-2.5 text-emerald-500" />이후 값</span>
      </div>
      {changes.map((fc, i) => (
        <div
          key={i}
          className="grid grid-cols-[140px_1fr_1fr] gap-2 text-[12px] px-3 py-2 border-b border-ds-outline-variant/10 last:border-0"
        >
          <span className="font-medium text-ds-on-surface-variant">{FIELD_LABELS[fc.field] ?? fc.field}</span>
          <div className="bg-red-50 rounded px-2 py-1 font-mono text-[11px] text-red-700 break-all">
            {fc.before || <span className="italic text-ds-on-surface-variant/30">없음</span>}
          </div>
          <div className="bg-emerald-50 rounded px-2 py-1 font-mono text-[11px] text-emerald-700 break-all">
            {fc.after || <span className="italic text-ds-on-surface-variant/30">없음</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function PolicySnapshotDetail({
  data,
  colorClass,
}: {
  data: Record<string, unknown> | null
  colorClass: 'emerald' | 'red'
}) {
  if (!data) return null
  const isEmerald = colorClass === 'emerald'
  const bg = isEmerald ? 'bg-emerald-50' : 'bg-red-50'
  const border = isEmerald ? 'border-emerald-100' : 'border-red-100'
  const label = isEmerald ? 'text-emerald-600' : 'text-red-500'
  const value = isEmerald ? 'text-emerald-900' : 'text-red-800'

  return (
    <div className={`rounded-lg ${bg} border ${border} p-3`}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
        {SNAPSHOT_FIELDS.map((f) => {
          const v = data[f]
          if (v == null || v === '') return null
          return (
            <div key={f} className="flex gap-1.5 min-w-0">
              <span className={`font-semibold ${label} shrink-0`}>{FIELD_LABELS[f] ?? f}:</span>
              <span className={`${value} truncate`} title={String(v)}>{String(v)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DiffRow({ entry }: { entry: DiffEntry }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = entry.field_changes.length > 0 || entry.before != null || entry.after != null

  const rowBg =
    entry.action === 'created' ? 'bg-emerald-50/30 hover:bg-emerald-50/60' :
    entry.action === 'deleted' ? 'bg-red-50/30 hover:bg-red-50/60' :
    'hover:bg-ds-surface-container-low/60'

  return (
    <>
      <tr
        className={`${rowBg} transition-colors ${hasDetail ? 'cursor-pointer' : ''} select-none`}
        onClick={() => hasDetail && setExpanded((v) => !v)}
      >
        <td className="pl-4 pr-2 py-3 w-6">
          {hasDetail && (
            expanded
              ? <ChevronDown className="w-3.5 h-3.5 text-ds-on-surface-variant/50" />
              : <ChevronRight className="w-3.5 h-3.5 text-ds-on-surface-variant/50" />
          )}
        </td>
        <td className="px-3 py-3 w-20">
          <ActionBadge action={entry.action} />
        </td>
        <td className="px-3 py-3">
          <span className="font-mono text-[13px] font-medium text-ds-on-surface">{entry.rule_name}</span>
          {entry.vsys && (
            <span className="ml-2 text-[11px] text-ds-on-surface-variant/60">({entry.vsys})</span>
          )}
        </td>
        <td className="px-3 py-3 text-center">
          {entry.action === 'updated' && entry.field_changes.length > 0
            ? <span className="text-[12px] text-ds-on-surface-variant">{entry.field_changes.length}개 필드</span>
            : <span className="text-[12px] text-ds-on-surface-variant/30">—</span>}
        </td>
        <td className="px-3 py-3 text-center">
          {entry.change_count > 1
            ? <span className="text-[12px] text-ds-on-surface-variant">{entry.change_count}회</span>
            : <span className="text-[12px] text-ds-on-surface-variant/30">—</span>}
        </td>
      </tr>
      {expanded && (
        <tr className={rowBg}>
          <td />
          <td colSpan={4} className="px-4 pb-4 pt-1">
            {entry.action === 'updated' && entry.field_changes.length > 0 && (
              <FieldDiffTable changes={entry.field_changes} />
            )}
            {entry.action === 'created' && (
              <PolicySnapshotDetail data={entry.after as Record<string, unknown>} colorClass="emerald" />
            )}
            {entry.action === 'deleted' && (
              <PolicySnapshotDetail data={entry.before as Record<string, unknown>} colorClass="red" />
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'created' | 'updated' | 'deleted'

export function PolicyDiffPage() {
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null)
  const [fromSyncId, setFromSyncId] = useState<number | null>(null)
  const [toSyncId, setToSyncId] = useState<number | null>(null)
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const { data: devices = [] } = useQuery({ queryKey: queryKeys.devices, queryFn: listDevices })

  const { data: syncHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: queryKeys.syncHistory(selectedDeviceId),
    queryFn: () => fetchSyncHistory(selectedDeviceId!),
    enabled: selectedDeviceId != null,
  })

  const canCompare = selectedDeviceId != null && fromSyncId != null && toSyncId != null && fromSyncId !== toSyncId

  const {
    data: diffResult,
    isLoading: diffLoading,
    error: diffError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.policyDiff(selectedDeviceId, fromSyncId, toSyncId),
    queryFn: () => fetchPolicyDiff(selectedDeviceId!, fromSyncId!, toSyncId!),
    enabled: false,
  })

  const filteredChanges = useMemo(() => {
    if (!diffResult) return []
    return diffResult.changes.filter((c) => {
      if (filterTab !== 'all' && c.action !== filterTab) return false
      if (searchQuery && !c.rule_name.toLowerCase().includes(searchQuery.toLowerCase())) return false
      return true
    })
  }, [diffResult, filterTab, searchQuery])

  const handleDeviceChange = (id: number) => {
    setSelectedDeviceId(id || null)
    setFromSyncId(null)
    setToSyncId(null)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">정책 변경 비교 (Diff)</h1>
        <p className="text-[13px] text-ds-on-surface-variant/70 mt-0.5">두 동기화 시점을 선택하여 정책 변경사항을 필드 레벨까지 상세히 비교합니다.</p>
      </div>

      {/* 카드: 비교 설정 */}
      <div className="card rounded-xl">
        <div className="px-5 py-3 border-b border-ds-outline-variant/10">
          <span className="text-[13px] font-semibold text-ds-on-surface">비교 설정</span>
        </div>
        <div className="px-5 py-5 space-y-5">
          {/* 장비 선택 */}
          <div className="space-y-1.5 max-w-sm">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">장비</label>
            <select
              className="w-full h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary text-ds-on-surface"
              value={selectedDeviceId ?? ''}
              onChange={(e) => handleDeviceChange(Number(e.target.value))}
            >
              <option value="">-- 장비 선택 --</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.ip_address})</option>
              ))}
            </select>
          </div>

          {/* 동기화 시점 선택 */}
          {selectedDeviceId != null && (
            historyLoading ? (
              <p className="text-[13px] text-ds-on-surface-variant/60">동기화 이력 로딩 중...</p>
            ) : syncHistory.length === 0 ? (
              <div className="flex items-center gap-2 text-[13px] text-ds-on-surface-variant/70">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-500" />
                이 장비에 대한 동기화 이력이 없습니다. 동기화를 먼저 실행해주세요.
              </div>
            ) : (
              <div className="flex flex-wrap gap-5 items-end">
                <div className="space-y-1.5 flex-1 min-w-[220px]">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">비교 시작 (From)</label>
                  <select
                    className="w-full h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary text-ds-on-surface"
                    value={fromSyncId ?? ''}
                    onChange={(e) => setFromSyncId(Number(e.target.value) || null)}
                  >
                    <option value="">-- 시점 선택 --</option>
                    {syncHistory.map((p) => (
                      <option key={p.id} value={p.id} disabled={p.id === toSyncId}>
                        {fmt(p.sync_at)}{p.total_policies != null ? `  (${p.total_policies.toLocaleString()}개)` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <span className="text-ds-on-surface-variant/40 font-medium pb-2 shrink-0">→</span>

                <div className="space-y-1.5 flex-1 min-w-[220px]">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">비교 종료 (To)</label>
                  <select
                    className="w-full h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary text-ds-on-surface"
                    value={toSyncId ?? ''}
                    onChange={(e) => setToSyncId(Number(e.target.value) || null)}
                  >
                    <option value="">-- 시점 선택 --</option>
                    {syncHistory.map((p) => (
                      <option key={p.id} value={p.id} disabled={p.id === fromSyncId}>
                        {fmt(p.sync_at)}{p.total_policies != null ? `  (${p.total_policies.toLocaleString()}개)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* 실행 버튼 */}
      {selectedDeviceId != null && syncHistory.length > 0 && (
        <div className="flex items-center gap-4">
          <button
            onClick={() => canCompare && refetch()}
            disabled={!canCompare || diffLoading}
            className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-white btn-primary-gradient rounded-lg disabled:opacity-50 transition-all"
          >
            {diffLoading ? '비교 중…' : '비교하기'}
          </button>
          {fromSyncId === toSyncId && fromSyncId != null && (
            <span className="text-[12px] text-ds-error/80">동일한 시점은 비교할 수 없습니다.</span>
          )}
        </div>
      )}

      {/* 에러 */}
      {diffError && (
        <div className="card rounded-xl px-5 py-3 flex items-center gap-2 text-[13px] text-ds-error">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {(diffError as Error).message}
        </div>
      )}

      {/* 결과 */}
      {diffResult && (
        <>
          {/* 기간 정보 */}
          <div className="card rounded-xl px-5 py-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="w-1.5 h-1.5 rounded-full bg-ds-tertiary shrink-0" />
            <span className="font-semibold text-ds-on-surface">{fmt(diffResult.from_sync.sync_at)}</span>
            <span className="text-ds-on-surface-variant/40">→</span>
            <span className="font-semibold text-ds-on-surface">{fmt(diffResult.to_sync.sync_at)}</span>
            {diffResult.from_sync.total_policies != null && diffResult.to_sync.total_policies != null && (
              <span className="ml-2 text-[12px] text-ds-on-surface-variant/60">
                정책 수: {diffResult.from_sync.total_policies.toLocaleString()} → {diffResult.to_sync.total_policies.toLocaleString()}
                {' '}
                <span className={diffResult.to_sync.total_policies - diffResult.from_sync.total_policies >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                  ({diffResult.to_sync.total_policies - diffResult.from_sync.total_policies >= 0 ? '+' : ''}
                  {diffResult.to_sync.total_policies - diffResult.from_sync.total_policies})
                </span>
              </span>
            )}
          </div>

          {/* 요약 KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: '총 변경',  value: diffResult.summary.total,   valueClass: 'text-ds-on-surface' },
              { label: '추가된 정책', value: diffResult.summary.created, valueClass: 'text-emerald-600' },
              { label: '수정된 정책', value: diffResult.summary.updated, valueClass: 'text-amber-600' },
              { label: '삭제된 정책', value: diffResult.summary.deleted, valueClass: 'text-red-500' },
            ].map(({ label, value, valueClass }) => (
              <div key={label} className="card rounded-xl px-5 py-4">
                <div className={`text-[28px] font-bold leading-none ${valueClass}`}>{value.toLocaleString()}</div>
                <div className="text-[12px] text-ds-on-surface-variant/70 mt-1">{label}</div>
              </div>
            ))}
          </div>

          {diffResult.summary.total === 0 ? (
            <div className="card rounded-xl px-5 py-12 text-center">
              <p className="text-[14px] text-ds-on-surface-variant/60">두 시점 사이에 정책 변경사항이 없습니다.</p>
            </div>
          ) : (
            <div className="card rounded-xl">
              {/* 필터 + 검색 */}
              <div className="flex items-center gap-2 px-5 py-3 border-b border-ds-outline-variant/10 flex-wrap">
                {(
                  [
                    { key: 'all',     label: `전체 (${diffResult.summary.total})` },
                    { key: 'created', label: `추가 (${diffResult.summary.created})` },
                    { key: 'updated', label: `수정 (${diffResult.summary.updated})` },
                    { key: 'deleted', label: `삭제 (${diffResult.summary.deleted})` },
                  ] as const
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setFilterTab(key)}
                    className={`px-3 py-1 rounded-full text-[12px] font-semibold transition-colors ${
                      filterTab === key
                        ? 'bg-ds-primary text-white'
                        : 'bg-ds-surface-container text-ds-on-surface-variant hover:bg-ds-surface-container-high'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <input
                  type="text"
                  placeholder="정책명 검색…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ml-auto h-8 w-44 px-3 text-[12px] bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary"
                />
              </div>

              {/* 테이블 */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-ds-outline-variant/10">
                      <th className="w-8 pl-4" />
                      <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 w-20">상태</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">정책명</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 w-28">변경 필드</th>
                      <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 w-24">변경 횟수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChanges.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-10 text-center text-[13px] text-ds-on-surface-variant/60">
                          해당 조건에 맞는 변경사항이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      filteredChanges.map((entry) => (
                        <DiffRow key={`${entry.rule_name}-${entry.vsys ?? ''}`} entry={entry} />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
