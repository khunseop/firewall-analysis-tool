import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, ChevronUp, History, Search, X } from 'lucide-react'
import type { Policy } from '@/api/firewall'
import { getObjectDetails, getNetworkObjects, getNetworkGroups, type NetworkObject, type NetworkGroup } from '@/api/firewall'
import { daysSinceHit } from '@/lib/utils'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useNavigate } from 'react-router-dom'
import { Skeleton } from './Skeleton'
import { queryKeys } from '@/api/queryKeys'

const ACTION_BADGE: Record<string, string> = {
  allow:  'bg-green-100 text-green-700',
  deny:   'bg-red-100 text-red-700',
  drop:   'bg-red-100 text-red-700',
  reject: 'bg-orange-100 text-orange-700',
}

const COLLAPSE_AT = 8
const FILTER_AT = 15

// ─── Object explorer panel ───────────────────────────────────────────────────

function ObjectFields({ obj }: { obj: NetworkObject }) {
  const fields = [
    { key: 'ip_address', label: 'IP 주소', value: obj.ip_address },
    { key: 'type',       label: '타입',    value: obj.type },
    { key: 'description', label: '설명',   value: obj.description },
  ].filter(f => f.value)
  if (fields.length === 0) return null
  return (
    <div className="mt-1 ml-4 bg-ds-surface-container-lowest rounded p-2 space-y-1 border border-ds-outline-variant/15">
      {fields.map(f => (
        <div key={f.key} className="flex gap-2 text-[11px]">
          <span className="text-ds-primary/60 font-bold uppercase tracking-wider min-w-[60px] shrink-0">{f.label}</span>
          <span className="font-mono text-ds-on-surface break-all">{String(f.value)}</span>
        </div>
      ))}
    </div>
  )
}

function MemberNode({
  name, allObjects, allGroups, depth,
}: {
  name: string; allObjects: NetworkObject[]; allGroups: NetworkGroup[]; depth: number
}) {
  const [expanded, setExpanded] = useState(false)
  const group = allGroups.find(g => g.name === name)
  const obj   = allObjects.find(o => o.name === name)
  const isGroup = !!group
  const members = isGroup ? group.members.split(',').map(m => m.trim()).filter(Boolean) : []

  if (isGroup) {
    return (
      <div style={{ marginLeft: depth * 12 }}>
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 py-0.5 text-[11px] font-mono font-semibold text-ds-tertiary hover:underline"
        >
          {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
          {name}
          <span className="ml-1 text-[9px] font-bold uppercase bg-ds-secondary-container text-ds-tertiary px-1 rounded">그룹 {members.length}</span>
        </button>
        {expanded && (
          <div className="mt-0.5 ml-2 pl-2 border-l border-ds-outline-variant/20">
            {members.map(m => (
              <MemberNode key={m} name={m} allObjects={allObjects} allGroups={allGroups} depth={0} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ marginLeft: depth * 12 }}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1 py-0.5 text-[11px] font-mono text-ds-on-surface hover:text-ds-tertiary transition-colors"
      >
        {obj
          ? (expanded
              ? <ChevronDown className="w-3 h-3 shrink-0 text-ds-on-surface-variant" />
              : <ChevronRight className="w-3 h-3 shrink-0 text-ds-on-surface-variant" />)
          : <span className="w-3 h-3 shrink-0 flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-ds-outline-variant" />
            </span>
        }
        {name}
        {obj?.ip_address && !expanded && (
          <span className="text-ds-on-surface-variant font-normal ml-1">({obj.ip_address})</span>
        )}
      </button>
      {expanded && obj && <ObjectFields obj={obj} />}
      {expanded && !obj && (
        <p className="ml-4 text-[11px] text-ds-on-surface-variant italic">객체 정보를 찾을 수 없습니다.</p>
      )}
    </div>
  )
}

function MemberTree({ deviceId, members }: { deviceId: number; members: string[] }) {
  const { data: allObjects = [], isLoading: loadingObj } = useQuery({
    queryKey: queryKeys.networkObjects([deviceId]),
    queryFn: () => getNetworkObjects(deviceId),
    staleTime: 60_000,
  })
  const { data: allGroups = [], isLoading: loadingGrp } = useQuery({
    queryKey: queryKeys.networkGroups([deviceId]),
    queryFn: () => getNetworkGroups(deviceId),
    staleTime: 60_000,
  })
  if (loadingObj || loadingGrp) return (
    <div className="space-y-1.5">
      {[1, 2, 3].map(i => <Skeleton key={i} className="h-4 w-full" />)}
    </div>
  )
  return (
    <div className="space-y-0.5">
      {members.map(m => (
        <MemberNode key={m} name={m} allObjects={allObjects} allGroups={allGroups} depth={0} />
      ))}
    </div>
  )
}

function ObjectPanel({
  deviceId, name, onClose, onCloseModal,
}: {
  deviceId: number; name: string; onClose: () => void; onCloseModal: () => void
}) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.objectDetail(deviceId, name),
    queryFn: () => getObjectDetails(deviceId, name),
    staleTime: 60_000,
  })

  type ObjData = Record<string, unknown>
  const obj = data as ObjData | null
  const isGroup = obj && 'members' in obj
  const members = isGroup
    ? String(obj['members'] ?? '').split(',').map(m => m.trim()).filter(Boolean)
    : []

  const SKIP = ['id', 'device_id', 'is_active', 'last_seen_at', 'ip_start', 'ip_end', 'members', 'name']
  const LABELS: Record<string, string> = {
    name: '이름', ip_address: 'IP 주소', type: '타입', description: '설명',
    protocol: '프로토콜', port: '포트', ip_version: 'IP 버전',
    port_start: '포트 시작', port_end: '포트 끝',
  }

  const goToPolicies = (direction: 'src' | 'dst') => {
    onClose()
    onCloseModal()
    const param = direction === 'src' ? 'src_name' : 'dst_name'
    navigate(`/policies?${param}=${encodeURIComponent(name)}`)
  }

  return (
    <div className="flex flex-col h-full border-l border-ds-outline-variant/15">
      <div className="px-4 pt-4 pb-3 border-b border-ds-outline-variant/10 flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/50 mb-1">객체 상세</p>
          <p className="text-sm font-bold font-mono text-ds-on-surface break-all">{name}</p>
          {isGroup && (
            <span className="inline-block mt-1 text-[9px] font-bold uppercase bg-ds-secondary-container text-ds-tertiary px-1.5 py-0.5 rounded">그룹</span>
          )}
        </div>
        <button onClick={onClose} className="shrink-0 p-1 rounded hover:bg-ds-surface-container text-ds-on-surface-variant transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-5 w-full" />)}</div>
        ) : !obj ? (
          <p className="text-xs text-ds-on-surface-variant">데이터를 찾을 수 없습니다.</p>
        ) : (
          <div className="bg-ds-surface-container-low rounded-lg p-3 space-y-2">
            {Object.entries(obj)
              .filter(([k]) => !SKIP.includes(k))
              .map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-ds-primary min-w-[70px] shrink-0 mt-0.5">
                    {LABELS[k] ?? k}
                  </span>
                  <span className="text-xs text-ds-on-surface font-mono break-all">{String(v ?? '-')}</span>
                </div>
              ))}
          </div>
        )}

        {isGroup && members.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-ds-primary mb-2">
              멤버 ({members.length}개)
            </p>
            <div className="bg-ds-surface-container-low rounded-lg p-3">
              <MemberTree deviceId={deviceId} members={members} />
            </div>
          </div>
        )}

        <div className="space-y-2 pt-1">
          <p className="text-[10px] text-ds-on-surface-variant font-medium uppercase tracking-wider">이 객체를 포함하는 정책</p>
          <div className="grid grid-cols-1 gap-1.5">
            <button
              onClick={() => goToPolicies('src')}
              className="flex items-center justify-between gap-1.5 px-3 py-2 rounded-lg bg-ds-tertiary/8 text-ds-tertiary text-xs font-semibold hover:bg-ds-tertiary/15 transition-colors border border-ds-tertiary/20"
            >
              출발지 기준 검색 <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => goToPolicies('dst')}
              className="flex items-center justify-between gap-1.5 px-3 py-2 rounded-lg bg-ds-tertiary/8 text-ds-tertiary text-xs font-semibold hover:bg-ds-tertiary/15 transition-colors border border-ds-tertiary/20"
            >
              목적지 기준 검색 <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── ChipList ────────────────────────────────────────────────────────────────

function ChipList({ value, isClickable, onClickName }: {
  value: string | null
  isClickable?: (name: string) => boolean
  onClickName?: (name: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState('')

  const all = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (all.length === 0) return <span className="text-xs text-ds-on-surface-variant">-</span>

  const showFilter = all.length > FILTER_AT
  const filtered = filter ? all.filter((i) => i.toLowerCase().includes(filter.toLowerCase())) : all
  const needsCollapse = all.length > COLLAPSE_AT
  const visible = needsCollapse && !expanded ? filtered.slice(0, COLLAPSE_AT) : filtered
  const hiddenCount = filtered.length - visible.length

  return (
    <div className="space-y-1.5">
      {showFilter && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ds-on-surface-variant/50" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="필터..."
            className="w-full pl-6 pr-2 py-1 text-[11px] rounded border border-ds-outline-variant/20 bg-ds-surface-container-low text-ds-on-surface placeholder:text-ds-on-surface-variant/40 focus:outline-none focus:border-ds-primary/40"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {visible.map((item, i) => {
          const clickable = isClickable?.(item) && onClickName
          return (
            <span
              key={i}
              onClick={clickable ? () => onClickName!(item) : undefined}
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono leading-tight ${
                clickable
                  ? 'bg-ds-secondary-container text-ds-tertiary cursor-pointer hover:bg-ds-primary-container transition-colors'
                  : 'bg-ds-surface-container text-ds-on-surface'
              }`}
            >
              {item}
            </span>
          )
        })}
      </div>
      {needsCollapse && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors"
        >
          {expanded
            ? <><ChevronUp className="w-3 h-3" />접기</>
            : <><ChevronDown className="w-3 h-3" />+{hiddenCount}개 더보기</>}
        </button>
      )}
    </div>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────

function Section({ label, count, children, className = '' }: {
  label: string; count?: number; children: React.ReactNode; className?: string
}) {
  return (
    <div className={className}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/50 mb-1.5 flex items-center gap-1.5">
        {label}
        {count != null && count > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-ds-surface-container text-[9px] font-semibold text-ds-on-surface-variant normal-case tracking-normal">
            {count}
          </span>
        )}
      </p>
      {children}
    </div>
  )
}

function countItems(value: string | null): number {
  if (!value) return 0
  return value.split(',').map(s => s.trim()).filter(Boolean).length
}

// ─── Main component ───────────────────────────────────────────────────────────

interface PolicyDetailModalProps {
  policy: Policy
  deviceName: string
  validObjectNames: Set<string>
  onObjectClick: (deviceId: number, name: string) => void
  onHistoryClick?: (deviceId: number, ruleName: string) => void
  onClose: () => void
}

export function PolicyDetailModal({
  policy,
  deviceName,
  validObjectNames,
  onHistoryClick,
  onClose,
}: PolicyDetailModalProps) {
  const [selectedObj, setSelectedObj] = useState<string | null>(null)

  const isClickable = (name: string) => validObjectNames.has(name)

  const days = daysSinceHit(policy.last_hit_date)
  const actionCls = ACTION_BADGE[policy.action?.toLowerCase()] ?? 'bg-ds-surface-container text-ds-on-surface-variant'

  const srcCount  = countItems(policy.source)
  const dstCount  = countItems(policy.destination)
  const svcCount  = countItems(policy.service)
  const appCount  = countItems(policy.application)
  const userCount = countItems(policy.user)

  const showPanel = selectedObj !== null

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent
        side="right"
        className="flex flex-col p-0 gap-0 transition-all duration-300"
        style={{ width: showPanel ? '900px' : '640px', maxWidth: '95vw' }}
      >
        <SheetTitle className="sr-only">{policy.rule_name}</SheetTitle>

        <div className="flex flex-1 overflow-hidden">
          {/* ── 왼쪽: 정책 상세 ── */}
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            {/* 헤더 */}
            <div className="px-6 pt-5 pb-4 border-b border-ds-outline-variant/10 shrink-0">
              <div className="flex items-start justify-between gap-3 pr-8">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-bold font-headline font-mono break-all leading-snug">{policy.rule_name}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[11px] font-semibold text-ds-tertiary font-mono">{deviceName}</span>
                    <span className="text-ds-outline-variant/30">·</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${actionCls}`}>{policy.action}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${policy.enable ? 'bg-green-100 text-green-700' : 'bg-ds-surface-container text-ds-on-surface-variant'}`}>
                      {policy.enable ? '활성' : '비활성'}
                    </span>
                    {policy.seq != null && (
                      <span className="text-[10px] text-ds-on-surface-variant font-mono">#{policy.seq}</span>
                    )}
                  </div>
                </div>
                {onHistoryClick && (
                  <button
                    onClick={() => onHistoryClick(policy.device_id, policy.rule_name)}
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg hover:text-ds-on-surface transition-colors"
                  >
                    <History className="w-3.5 h-3.5" />
                    이력
                  </button>
                )}
              </div>
            </div>

            {/* 본문 */}
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
              {/* 출발지 / 목적지 */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Section label="출발지" count={srcCount}>
                  <ChipList
                    value={policy.source}
                    isClickable={isClickable}
                    onClickName={(name) => setSelectedObj(name === selectedObj ? null : name)}
                  />
                </Section>
                <Section label="목적지" count={dstCount}>
                  <ChipList
                    value={policy.destination}
                    isClickable={isClickable}
                    onClickName={(name) => setSelectedObj(name === selectedObj ? null : name)}
                  />
                </Section>
              </div>

              {/* 서비스 / 애플리케이션 */}
              <div className="pt-4 border-t border-ds-outline-variant/10 grid grid-cols-2 gap-x-6 gap-y-4">
                <Section label="서비스" count={svcCount}>
                  <ChipList
                    value={policy.service}
                    isClickable={isClickable}
                    onClickName={(name) => setSelectedObj(name === selectedObj ? null : name)}
                  />
                </Section>
                {policy.application != null && (
                  <Section label="애플리케이션" count={appCount}>
                    <ChipList value={policy.application} />
                  </Section>
                )}
              </div>

              {/* 사용자 / 보안 프로파일 / 카테고리 */}
              {(policy.user || policy.security_profile || policy.category) && (
                <div className="pt-4 border-t border-ds-outline-variant/10 grid grid-cols-2 gap-x-6 gap-y-4">
                  {policy.user && (
                    <Section label="사용자" count={userCount}>
                      <ChipList value={policy.user} />
                    </Section>
                  )}
                  {policy.security_profile && (
                    <Section label="보안 프로파일">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700">
                        {policy.security_profile}
                      </span>
                    </Section>
                  )}
                  {policy.category && (
                    <Section label="카테고리">
                      <span className="text-xs text-ds-on-surface-variant">{policy.category}</span>
                    </Section>
                  )}
                </div>
              )}

              {/* 설명 / VSYS / 마지막 사용일 */}
              <div className="pt-4 border-t border-ds-outline-variant/10 space-y-4">
                {policy.description && (
                  <Section label="설명">
                    <p className="text-xs text-ds-on-surface leading-relaxed whitespace-pre-wrap">{policy.description}</p>
                  </Section>
                )}
                {policy.vsys && (
                  <Section label="VSYS">
                    <span className="font-mono text-xs text-ds-on-surface-variant">{policy.vsys}</span>
                  </Section>
                )}
                <Section label="마지막 사용일">
                  {!policy.last_hit_date ? (
                    <span className="text-[11px] font-medium text-amber-600">사용 기록 없음</span>
                  ) : days === null ? (
                    <span className="text-xs text-ds-on-surface-variant">{policy.last_hit_date}</span>
                  ) : days >= 90 ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ds-error">
                      <AlertTriangle className="w-3 h-3" />{days}일 미사용 ({policy.last_hit_date})
                    </span>
                  ) : (
                    <span className="text-[11px] text-ds-on-surface-variant">{days}일 전 ({policy.last_hit_date})</span>
                  )}
                </Section>
                <Section label="히트 횟수">
                  <span className="text-xs text-ds-on-surface-variant">{policy.hit_count ?? '-'}</span>
                </Section>
              </div>

              {/* 객체 패널 힌트 */}
              {!showPanel && validObjectNames.size > 0 && (
                <p className="text-[10px] text-ds-on-surface-variant/50 text-center pt-2">
                  파란색 칩을 클릭하면 객체 상세를 확인할 수 있습니다
                </p>
              )}
            </div>
          </div>

          {/* ── 오른쪽: 객체 패널 (슬라이드) ── */}
          {showPanel && (
            <div className="w-[280px] shrink-0 flex flex-col overflow-hidden">
              <ObjectPanel
                deviceId={policy.device_id}
                name={selectedObj!}
                onClose={() => setSelectedObj(null)}
                onCloseModal={onClose}
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
