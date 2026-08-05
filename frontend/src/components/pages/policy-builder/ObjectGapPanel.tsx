import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { checkObjectGaps, type NewObjectSpec, type NewPolicyRow } from '@/api/policyBuilder'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function ObjectGapPanel({ deviceId, rows, newObjects, onChange }: {
  deviceId: number | null
  rows: NewPolicyRow[]
  newObjects: NewObjectSpec[]
  onChange: (objects: NewObjectSpec[]) => void
}) {
  const { data: missing = [], isFetching } = useQuery({
    queryKey: ['policy-builder-object-gaps', deviceId, rows],
    queryFn: () => checkObjectGaps(deviceId!, rows),
    enabled: !!deviceId && rows.length > 0,
    staleTime: 0,
  })

  const specByName = useMemo(() => new Map(newObjects.map((o) => [o.name, o])), [newObjects])

  const updateSpec = (name: string, kind: 'address' | 'service', patch: Partial<NewObjectSpec>) => {
    // 화면에 보이는 select 기본값(주소=ip-mask, 서비스=tcp)은 사용자가 건드리지 않으면 state에 반영되지 않으므로,
    // 최초 생성 시점에 그 기본값을 함께 채워 넣는다 (그렇지 않으면 protocol/address_type이 빈 값으로 제출됨).
    const existing = specByName.get(name) ?? {
      name,
      object_kind: kind,
      ...(kind === 'address' ? { address_type: 'ip-mask' as const } : { protocol: 'tcp' as const }),
    }
    const updated = { ...existing, ...patch }
    onChange([...newObjects.filter((o) => o.name !== name), updated])
  }

  if (rows.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-[12px] font-semibold text-ds-on-surface-variant">
        부족한 오브젝트 {isFetching ? '(확인 중…)' : `(${missing.length}건)`}
      </p>
      {missing.length === 0 && !isFetching && (
        <p className="text-[12px] text-emerald-600">신규 정책이 참조하는 오브젝트가 모두 장비에 존재합니다.</p>
      )}
      <div className="space-y-2">
        {missing.map((item) => {
          const spec = specByName.get(item.name)
          return (
            <div key={`${item.object_kind}:${item.name}`} className="flex items-center gap-2 bg-ds-surface-container-low rounded-lg px-3 py-2">
              <span className="text-[10px] font-bold uppercase w-14 shrink-0 text-ds-on-surface-variant">{item.object_kind === 'address' ? '주소' : '서비스'}</span>
              <span className="text-[13px] font-mono w-40 shrink-0 truncate" title={item.referenced_by_rule_names.join(', ')}>{item.name}</span>

              {item.object_kind === 'address' ? (
                <>
                  <Select
                    value={spec?.address_type ?? 'ip-mask'}
                    onValueChange={(v) => updateSpec(item.name, 'address', { address_type: v as NewObjectSpec['address_type'] })}
                  >
                    <SelectTrigger className="w-28 h-8 text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ip-mask">ip-netmask</SelectItem>
                      <SelectItem value="ip-range">ip-range</SelectItem>
                      <SelectItem value="fqdn">fqdn</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="예: 10.0.0.5/32"
                    value={spec?.ip_address ?? ''}
                    onChange={(e) => updateSpec(item.name, 'address', { ip_address: e.target.value })}
                    className="h-8 text-[12px] flex-1"
                  />
                </>
              ) : (
                <>
                  <Select
                    value={spec?.protocol ?? 'tcp'}
                    onValueChange={(v) => updateSpec(item.name, 'service', { protocol: v as NewObjectSpec['protocol'] })}
                  >
                    <SelectTrigger className="w-24 h-8 text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tcp">tcp</SelectItem>
                      <SelectItem value="udp">udp</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="예: 8443"
                    value={spec?.port ?? ''}
                    onChange={(e) => updateSpec(item.name, 'service', { port: e.target.value })}
                    className="h-8 text-[12px] flex-1"
                  />
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
