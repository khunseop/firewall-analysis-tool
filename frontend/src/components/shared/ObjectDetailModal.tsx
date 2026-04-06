import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getObjectDetails, searchPolicies } from '@/api/firewall'
import { ArrowRight } from 'lucide-react'
import { Skeleton } from './Skeleton'

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

const SKIP_FIELDS = ['id', 'device_id', 'is_active', 'last_seen_at', 'ip_start', 'ip_end']

const ACTION_BADGE: Record<string, string> = {
  allow: 'bg-green-100 text-green-700',
  deny:  'bg-red-100 text-red-700',
  drop:  'bg-red-100 text-red-700',
}

export function ObjectDetailModal({ deviceId, name, onClose }: Props) {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['object-detail', deviceId, name],
    queryFn: () => getObjectDetails(deviceId, name),
    staleTime: 60_000,
  })

  // 이 객체를 참조하는 정책 검색 (src_ip 또는 dst_ip로 객체명 검색)
  const { data: refPolicies, isLoading: refLoading } = useQuery({
    queryKey: ['object-ref-policies', deviceId, name],
    queryFn: async () => {
      // 출발지에서 참조하는 정책 검색
      const [src, dst] = await Promise.all([
        searchPolicies({ device_ids: [deviceId], src_ip: name, limit: 10 }),
        searchPolicies({ device_ids: [deviceId], dst_ip: name, limit: 10 }),
      ])
      // 중복 제거 (같은 정책이 src+dst 모두 있을 수 있음)
      const seen = new Set<number>()
      const merged = [...src.policies, ...dst.policies].filter((p) => {
        if (seen.has(p.id)) return false
        seen.add(p.id)
        return true
      })
      return merged.slice(0, 10)
    },
    staleTime: 60_000,
  })

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

        <div className="space-y-5 py-2 max-h-[70vh] overflow-y-auto pr-1">
          {/* 객체 상세 정보 */}
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-5 w-full" />)}
            </div>
          ) : !data ? (
            <p className="text-sm text-ds-on-surface-variant">데이터를 찾을 수 없습니다.</p>
          ) : (
            <div className="bg-ds-surface-container-low rounded-lg p-4 space-y-2">
              {Object.entries(data as unknown as Record<string, unknown>)
                .filter(([k]) => !SKIP_FIELDS.includes(k))
                .map(([k, v]) => (
                  <div key={k} className="flex gap-3 text-sm">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-ds-primary min-w-[80px] shrink-0 mt-0.5">
                      {FIELD_LABELS[k] ?? k}
                    </span>
                    <span className="text-sm text-ds-on-surface font-mono break-all">{String(v ?? '-')}</span>
                  </div>
                ))}
            </div>
          )}

          {/* 참조 정책 목록 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-ds-primary">참조 정책</h3>
              {refPolicies && refPolicies.length > 0 && (
                <button
                  onClick={handleGoToPolicies}
                  className="flex items-center gap-1 text-xs font-semibold text-ds-tertiary hover:underline"
                >
                  정책 검색에서 보기 <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>

            {refLoading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : !refPolicies || refPolicies.length === 0 ? (
              <p className="text-xs text-ds-on-surface-variant py-3 text-center bg-ds-surface-container-low rounded-lg">
                이 객체를 참조하는 정책이 없습니다.
              </p>
            ) : (
              <div className="space-y-1.5">
                {refPolicies.map((p) => {
                  const badgeCls = ACTION_BADGE[p.action?.toLowerCase()] ?? 'bg-ds-surface-container text-ds-on-surface-variant'
                  return (
                    <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-ds-surface-container-low rounded-lg">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-semibold text-ds-on-surface truncate">{p.rule_name}</span>
                        {p.seq != null && (
                          <span className="text-[10px] font-mono text-ds-on-surface-variant shrink-0">#{p.seq}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${badgeCls}`}>
                          {p.action}
                        </span>
                        {!p.enable && (
                          <span className="text-[10px] text-ds-on-surface-variant font-medium">비활성</span>
                        )}
                      </div>
                    </div>
                  )
                })}
                {refPolicies.length === 10 && (
                  <p className="text-[10px] text-ds-on-surface-variant text-right pt-1">최대 10건 표시</p>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
