import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, GitCompare, Plus, Minus, Edit2, AlertCircle } from 'lucide-react'
import { listDevices } from '@/api/devices'
import { apiClient } from '@/api/client'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SyncPoint {
  id: number
  device_id: number
  sync_at: string
  total_policies: number | null
  created_count: number
  updated_count: number
  deleted_count: number
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

// ─── API helpers ─────────────────────────────────────────────────────────────

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

// ─── Sub-components ──────────────────────────────────────────────────────────

function SyncSelect({
  label, points, value, onChange, disabledId,
}: {
  label: string
  points: SyncPoint[]
  value: number | null
  onChange: (id: number) => void
  disabledId: number | null
}) {
  return (
    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
      <span className="text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wide">{label}</span>
      <select
        className="w-full rounded-lg border border-ds-outline-variant bg-ds-surface-container px-3 py-2 text-sm text-ds-on-surface focus:outline-none focus:ring-2 focus:ring-ds-primary/40"
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value="">-- 동기화 시점 선택 --</option>
        {points.map((p) => (
          <option key={p.id} value={p.id} disabled={p.id === disabledId}>
            {fmt(p.sync_at)}
            {p.total_policies != null ? `  (총 ${p.total_policies.toLocaleString()}개)` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

function ActionBadge({ action }: { action: DiffEntry['action'] }) {
  if (action === 'created')
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"><Plus className="w-3 h-3" />추가</span>
  if (action === 'deleted')
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-red-50 text-red-700 border border-red-200"><Minus className="w-3 h-3" />삭제</span>
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200"><Edit2 className="w-3 h-3" />수정</span>
}

function FieldDiffRow({ fc }: { fc: FieldChange }) {
  return (
    <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-xs py-1 border-b border-ds-outline-variant/20 last:border-0">
      <span className="font-medium text-ds-on-surface-variant">{FIELD_LABELS[fc.field] ?? fc.field}</span>
      <div className="bg-red-50 rounded px-2 py-1 font-mono text-red-800 break-all">
        {fc.before || <span className="text-ds-on-surface-variant/40 italic">없음</span>}
      </div>
      <div className="bg-emerald-50 rounded px-2 py-1 font-mono text-emerald-800 break-all">
        {fc.after || <span className="text-ds-on-surface-variant/40 italic">없음</span>}
      </div>
    </div>
  )
}

function PolicySnapshot({ data, action }: { data: Record<string, unknown> | null; action: 'created' | 'deleted' }) {
  if (!data) return null
  const color = action === 'created' ? 'emerald' : 'red'
  const fields = ['source', 'destination', 'service', 'action', 'enable', 'description', 'user', 'application', 'security_profile']
  return (
    <div className={`rounded-lg bg-${color}-50 border border-${color}-200 p-3 mt-1`}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {fields.map((f) => {
          const v = data[f]
          if (v == null || v === '') return null
          return (
            <div key={f} className="flex gap-1">
              <span className={`font-medium text-${color}-700 shrink-0`}>{FIELD_LABELS[f] ?? f}:</span>
              <span className={`text-${color}-900 break-all`}>{String(v)}</span>
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
    entry.action === 'created' ? 'bg-emerald-50/60 hover:bg-emerald-50' :
    entry.action === 'deleted' ? 'bg-red-50/60 hover:bg-red-50' :
    'bg-amber-50/40 hover:bg-amber-50/70'

  return (
    <>
      <tr
        className={`${rowBg} transition-colors cursor-pointer select-none`}
        onClick={() => hasDetail && setExpanded((v) => !v)}
      >
        <td className="px-3 py-2.5 w-8">
          {hasDetail && (
            expanded
              ? <ChevronDown className="w-4 h-4 text-ds-on-surface-variant" />
              : <ChevronRight className="w-4 h-4 text-ds-on-surface-variant" />
          )}
        </td>
        <td className="px-3 py-2.5">
          <ActionBadge action={entry.action} />
        </td>
        <td className="px-3 py-2.5 font-mono text-sm font-medium text-ds-on-surface">
          {entry.rule_name}
          {entry.vsys && <span className="ml-2 text-xs text-ds-on-surface-variant font-sans">({entry.vsys})</span>}
        </td>
        <td className="px-3 py-2.5 text-xs text-ds-on-surface-variant text-center">
          {entry.action === 'updated' && entry.field_changes.length > 0
            ? `${entry.field_changes.length}개 필드`
            : '—'}
        </td>
        <td className="px-3 py-2.5 text-xs text-ds-on-surface-variant text-center">
          {entry.change_count > 1 ? `${entry.change_count}회` : '—'}
        </td>
      </tr>
      {expanded && (
        <tr className={`${rowBg}`}>
          <td />
          <td colSpan={4} className="px-4 pb-3 pt-0">
            {entry.action === 'updated' && entry.field_changes.length > 0 && (
              <div className="rounded-lg border border-ds-outline-variant/30 overflow-hidden bg-white">
                <div className="grid grid-cols-[120px_1fr_1fr] gap-2 px-3 py-1.5 bg-ds-surface-container text-[11px] font-semibold text-ds-on-surface-variant uppercase tracking-wide border-b border-ds-outline-variant/20">
                  <span>필드</span>
                  <span className="flex items-center gap-1"><Minus className="w-3 h-3 text-red-500" />이전</span>
                  <span className="flex items-center gap-1"><Plus className="w-3 h-3 text-emerald-500" />이후</span>
                </div>
                <div className="px-3 py-1">
                  {entry.field_changes.map((fc, i) => <FieldDiffRow key={i} fc={fc} />)}
                </div>
              </div>
            )}
            {entry.action !== 'updated' && (
              <PolicySnapshot
                data={(entry.action === 'created' ? entry.after : entry.before) as Record<string, unknown>}
                action={entry.action as 'created' | 'deleted'}
              />
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

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: listDevices,
  })

  const { data: syncHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ['sync-history', selectedDeviceId],
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
    queryKey: ['policy-diff', selectedDeviceId, fromSyncId, toSyncId],
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

  const handleCompare = () => {
    if (canCompare) refetch()
  }

  const handleDeviceChange = (id: number) => {
    setSelectedDeviceId(id)
    setFromSyncId(null)
    setToSyncId(null)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <GitCompare className="w-6 h-6 text-ds-tertiary" />
        <div>
          <h1 className="text-xl font-bold text-ds-on-surface">정책 변경 비교 (Diff)</h1>
          <p className="text-sm text-ds-on-surface-variant mt-0.5">두 동기화 시점 사이의 정책 변경사항을 상세히 비교합니다</p>
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-ds-outline-variant bg-ds-surface p-5 flex flex-col gap-4">
        {/* Device */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wide">장비</span>
          <select
            className="w-full max-w-xs rounded-lg border border-ds-outline-variant bg-ds-surface-container px-3 py-2 text-sm text-ds-on-surface focus:outline-none focus:ring-2 focus:ring-ds-primary/40"
            value={selectedDeviceId ?? ''}
            onChange={(e) => handleDeviceChange(Number(e.target.value))}
          >
            <option value="">-- 장비 선택 --</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.ip_address})</option>
            ))}
          </select>
        </div>

        {/* Sync point selectors */}
        {selectedDeviceId != null && (
          <div className="flex gap-4 items-end flex-wrap">
            {historyLoading ? (
              <p className="text-sm text-ds-on-surface-variant">동기화 이력 로딩 중...</p>
            ) : syncHistory.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-ds-on-surface-variant">
                <AlertCircle className="w-4 h-4" />
                <span>이 장비에 대한 동기화 이력이 없습니다. 동기화를 먼저 실행해주세요.</span>
              </div>
            ) : (
              <>
                <SyncSelect
                  label="비교 시작 (From)"
                  points={syncHistory}
                  value={fromSyncId}
                  onChange={setFromSyncId}
                  disabledId={toSyncId}
                />
                <div className="pb-2 text-ds-on-surface-variant font-bold text-lg self-end">→</div>
                <SyncSelect
                  label="비교 종료 (To)"
                  points={syncHistory}
                  value={toSyncId}
                  onChange={setToSyncId}
                  disabledId={fromSyncId}
                />
                <button
                  onClick={handleCompare}
                  disabled={!canCompare || diffLoading}
                  className="self-end px-5 py-2 rounded-lg bg-ds-tertiary text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-ds-tertiary/90 transition-colors whitespace-nowrap"
                >
                  {diffLoading ? '비교 중...' : '비교하기'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {diffError && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {(diffError as Error).message}
        </div>
      )}

      {/* Result */}
      {diffResult && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: '총 변경', value: diffResult.summary.total, color: 'text-ds-on-surface', bg: 'bg-ds-surface-container' },
              { label: '추가', value: diffResult.summary.created, color: 'text-emerald-700', bg: 'bg-emerald-50' },
              { label: '수정', value: diffResult.summary.updated, color: 'text-amber-700', bg: 'bg-amber-50' },
              { label: '삭제', value: diffResult.summary.deleted, color: 'text-red-700', bg: 'bg-red-50' },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`rounded-xl border border-ds-outline-variant ${bg} px-4 py-3`}>
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-ds-on-surface-variant mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* Period info */}
          <div className="flex items-center gap-2 text-sm text-ds-on-surface-variant bg-ds-surface-container rounded-lg px-4 py-2 border border-ds-outline-variant/40">
            <span className="font-medium text-ds-on-surface">{fmt(diffResult.from_sync.sync_at)}</span>
            <span>→</span>
            <span className="font-medium text-ds-on-surface">{fmt(diffResult.to_sync.sync_at)}</span>
            {diffResult.from_sync.total_policies != null && diffResult.to_sync.total_policies != null && (
              <span className="ml-2 text-xs">
                정책 수: {diffResult.from_sync.total_policies} → {diffResult.to_sync.total_policies}
                {' '}
                ({diffResult.to_sync.total_policies - diffResult.from_sync.total_policies >= 0 ? '+' : ''}
                {diffResult.to_sync.total_policies - diffResult.from_sync.total_policies})
              </span>
            )}
          </div>

          {diffResult.summary.total === 0 ? (
            <div className="rounded-xl border border-ds-outline-variant bg-ds-surface p-12 text-center">
              <GitCompare className="w-10 h-10 text-ds-on-surface-variant/30 mx-auto mb-3" />
              <p className="text-ds-on-surface-variant font-medium">두 시점 사이에 정책 변경사항이 없습니다.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-ds-outline-variant bg-ds-surface overflow-hidden">
              {/* Filter + Search bar */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-ds-outline-variant/40 flex-wrap">
                {(
                  [
                    { key: 'all', label: `전체 (${diffResult.summary.total})` },
                    { key: 'created', label: `추가 (${diffResult.summary.created})` },
                    { key: 'updated', label: `수정 (${diffResult.summary.updated})` },
                    { key: 'deleted', label: `삭제 (${diffResult.summary.deleted})` },
                  ] as const
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setFilterTab(key)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                      filterTab === key
                        ? 'bg-ds-tertiary text-white'
                        : 'bg-ds-surface-container text-ds-on-surface-variant hover:bg-ds-surface-container-high'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <input
                  type="text"
                  placeholder="정책명 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ml-auto rounded-lg border border-ds-outline-variant px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ds-primary/40 w-48 bg-ds-surface-container"
                />
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-ds-surface-container border-b border-ds-outline-variant/40">
                      <th className="w-8 px-3 py-2.5" />
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wide w-24">상태</th>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wide">정책명</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wide w-28">변경 필드</th>
                      <th className="px-3 py-2.5 text-center text-xs font-semibold text-ds-on-surface-variant uppercase tracking-wide w-24">변경 횟수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChanges.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-ds-on-surface-variant text-sm">
                          해당 조건에 맞는 변경사항이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      filteredChanges.map((entry) => (
                        <DiffRow key={`${entry.rule_name}-${entry.vsys}`} entry={entry} />
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
