import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getObjectDetails, getNetworkObjects, getNetworkGroups, type NetworkObject, type NetworkGroup } from '@/api/firewall'
import { ArrowRight, ChevronRight, ChevronDown } from 'lucide-react'
import { Skeleton } from './Skeleton'
import { useState } from 'react'

interface Props {
  deviceId: number
  name: string
  onClose: () => void
}

const FIELD_LABELS: Record<string, string> = {
  name: '이름', ip_address: 'IP 주소', type: '타입', description: '설명',
  protocol: '프로토콜', port: '포트', ip_version: 'IP 버전',
  port_start: '포트 시작', port_end: '포트 끝',
}
const SKIP_FIELDS = ['id', 'device_id', 'is_active', 'last_seen_at', 'ip_start', 'ip_end', 'members']

type ObjData = Record<string, unknown>

/** 객체 상세 필드 렌더 (인라인 사용용) */
function ObjectFields({ obj }: { obj: NetworkObject }) {
  const fields = [
    { key: 'ip_address', label: 'IP 주소', value: obj.ip_address },
    { key: 'type',       label: '타입',    value: obj.type },
    { key: 'description', label: '설명',   value: obj.description },
  ].filter(f => f.value)
  if (fields.length === 0) return null
  return (
    <div className="mt-1 ml-5 bg-ds-surface-container-lowest rounded p-2 space-y-1 border border-ds-outline-variant/15">
      {fields.map(f => (
        <div key={f.key} className="flex gap-2 text-[11px]">
          <span className="text-ds-primary/60 font-bold uppercase tracking-wider min-w-[60px] shrink-0">{f.label}</span>
          <span className="font-mono text-ds-on-surface break-all">{String(f.value)}</span>
        </div>
      ))}
    </div>
  )
}

/** 멤버 트리 노드 */
function MemberNode({
  name, allObjects, allGroups, depth,
}: {
  name: string
  allObjects: NetworkObject[]
  allGroups: NetworkGroup[]
  depth: number
}) {
  const [expanded, setExpanded] = useState(false)

  const group = allGroups.find(g => g.name === name)
  const obj   = allObjects.find(o => o.name === name)
  const isGroup = !!group
  const members = isGroup
    ? group.members.split(',').map(m => m.trim()).filter(Boolean)
    : []

  if (isGroup) {
    return (
      <div style={{ marginLeft: depth * 12 }}>
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 py-0.5 text-[11px] font-mono font-semibold text-ds-tertiary hover:underline"
        >
          {expanded
            ? <ChevronDown className="w-3 h-3 shrink-0" />
            : <ChevronRight className="w-3 h-3 shrink-0" />}
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
        <p className="ml-5 text-[11px] text-ds-on-surface-variant italic">객체 정보를 찾을 수 없습니다.</p>
      )}
    </div>
  )
}

/** 멤버 트리 컨테이너 — allObjects/allGroups 로드 */
function MemberTree({ deviceId, members }: { deviceId: number; members: string[] }) {
  const { data: allObjects = [], isLoading: loadingObj } = useQuery({
    queryKey: ['network-objects', deviceId],
    queryFn: () => getNetworkObjects(deviceId),
    staleTime: 60_000,
  })
  const { data: allGroups = [], isLoading: loadingGrp } = useQuery({
    queryKey: ['network-groups', deviceId],
    queryFn: () => getNetworkGroups(deviceId),
    staleTime: 60_000,
  })

  if (loadingObj || loadingGrp) {
    return (
      <div className="space-y-1.5">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-4 w-full" />)}
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {members.map(m => (
        <MemberNode key={m} name={m} allObjects={allObjects} allGroups={allGroups} depth={0} />
      ))}
    </div>
  )
}

export function ObjectDetailModal({ deviceId, name, onClose }: Props) {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['object-detail', deviceId, name],
    queryFn: () => getObjectDetails(deviceId, name),
    staleTime: 60_000,
  })

  const obj = data as ObjData | null
  const isGroup = obj && 'members' in obj
  const members = isGroup
    ? String(obj['members'] ?? '').split(',').map(m => m.trim()).filter(Boolean)
    : []

  const handleGoToPolicies = (direction: 'src' | 'dst' = 'src') => {
    onClose()
    const param = direction === 'src' ? 'src_ip' : 'dst_ip'
    navigate(`/policies?${param}=${encodeURIComponent(name)}`)
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface font-mono flex items-center gap-2">
            {name}
            {isGroup && (
              <span className="text-[10px] font-bold uppercase bg-ds-secondary-container text-ds-tertiary px-1.5 py-0.5 rounded">그룹</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[72vh] overflow-y-auto pr-1">
          {/* 객체 상세 정보 */}
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-5 w-full" />)}
            </div>
          ) : !obj ? (
            <p className="text-sm text-ds-on-surface-variant">데이터를 찾을 수 없습니다.</p>
          ) : (
            <div className="bg-ds-surface-container-low rounded-lg p-4 space-y-2">
              {Object.entries(obj)
                .filter(([k]) => !SKIP_FIELDS.includes(k))
                .map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-ds-primary min-w-[90px] shrink-0 mt-0.5">
                      {FIELD_LABELS[k] ?? k}
                    </span>
                    <span className="text-xs text-ds-on-surface font-mono break-all">{String(v ?? '-')}</span>
                  </div>
                ))}
            </div>
          )}

          {/* 그룹 멤버 트리 */}
          {isGroup && members.length > 0 && (
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-ds-primary mb-2">
                멤버 ({members.length}개) — 클릭하여 상세 확인
              </h3>
              <div className="bg-ds-surface-container-low rounded-lg p-3">
                <MemberTree deviceId={deviceId} members={members} />
              </div>
            </div>
          )}

          {/* 정책 검색 연결 */}
          <div className="space-y-2 pt-1">
            <p className="text-[10px] text-ds-on-surface-variant font-medium uppercase tracking-wider">이 객체를 포함하는 정책</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleGoToPolicies('src')}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-ds-tertiary/8 text-ds-tertiary text-xs font-semibold hover:bg-ds-tertiary/15 transition-colors border border-ds-tertiary/20"
              >
                출발지 기준 검색 <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleGoToPolicies('dst')}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-ds-tertiary/8 text-ds-tertiary text-xs font-semibold hover:bg-ds-tertiary/15 transition-colors border border-ds-tertiary/20"
              >
                목적지 기준 검색 <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
