import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getObjectDetails, getNetworkObjects, getNetworkGroups } from '@/api/firewall'
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
  protocol: '프로토콜', port: '포트', members: '멤버',
  ip_version: 'IP 버전', port_start: '포트 시작', port_end: '포트 끝',
}
const SKIP_FIELDS = ['id', 'device_id', 'is_active', 'last_seen_at', 'ip_start', 'ip_end', 'members']

type ObjData = Record<string, unknown>

/** 멤버 트리 노드 — 재귀 */
function MemberTree({ deviceId, name, depth = 0 }: { deviceId: number; name: string; depth?: number }) {
  const [expanded, setExpanded] = useState(false)

  const { data: allObjects } = useQuery({
    queryKey: ['network-objects', deviceId],
    queryFn: () => getNetworkObjects(deviceId),
    staleTime: 60_000,
    enabled: expanded,
  })
  const { data: allGroups } = useQuery({
    queryKey: ['network-groups', deviceId],
    queryFn: () => getNetworkGroups(deviceId),
    staleTime: 60_000,
    enabled: expanded,
  })

  const group = allGroups?.find(g => g.name === name)
  const obj   = allObjects?.find(o => o.name === name)

  const isGroup = !!group
  const members = group ? group.members.split(',').map(m => m.trim()).filter(Boolean) : []

  return (
    <div style={{ marginLeft: depth * 14 }}>
      <div className="flex items-center gap-1 py-0.5">
        {isGroup ? (
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-[11px] font-mono font-semibold text-ds-tertiary hover:underline"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {name}
            <span className="ml-1 text-[9px] font-bold uppercase bg-ds-secondary-container text-ds-tertiary px-1 rounded">그룹</span>
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-ds-on-surface">
            <span className="w-1.5 h-1.5 rounded-full bg-ds-outline shrink-0" />
            {name}
            {obj && obj.ip_address && (
              <span className="text-ds-on-surface-variant font-normal">({obj.ip_address as string})</span>
            )}
          </span>
        )}
      </div>
      {expanded && isGroup && members.map(m => (
        <MemberTree key={m} deviceId={deviceId} name={m} depth={depth + 1} />
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
  const members = isGroup ? String(obj['members'] ?? '').split(',').map(m => m.trim()).filter(Boolean) : []

  const handleGoToPolicies = () => {
    onClose()
    navigate(`/policies?src_ip=${encodeURIComponent(name)}`)
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface font-mono">{name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
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
                  <div key={k} className="flex gap-3 text-sm">
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
                멤버 ({members.length}개)
              </h3>
              <div className="bg-ds-surface-container-low rounded-lg p-3 space-y-0.5">
                {members.map(m => (
                  <MemberTree key={m} deviceId={deviceId} name={m} />
                ))}
              </div>
            </div>
          )}

          {/* 정책 검색 연결 */}
          <div className="pt-1">
            <button
              onClick={handleGoToPolicies}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-ds-tertiary/8 text-ds-tertiary text-sm font-semibold hover:bg-ds-tertiary/15 transition-colors border border-ds-tertiary/20"
            >
              이 객체를 참조하는 정책 검색
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
