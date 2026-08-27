import { useQuery } from '@tanstack/react-query'
import Select from 'react-select'
import { getPolicies } from '@/api/firewall'
import { queryKeys } from '@/api/queryKeys'

export function PolicyMultiSelect({ deviceId, value, onChange, placeholder }: {
  deviceId: number | null; value: number[]; onChange: (ids: number[]) => void; placeholder?: string
}) {
  const { data: policies = [], isLoading } = useQuery({
    queryKey: queryKeys.policiesRaw(deviceId),
    queryFn: () => getPolicies(deviceId!),
    enabled: !!deviceId, staleTime: 60_000,
  })
  const options = policies.map((p) => ({ value: p.id, label: `[${p.seq}] ${p.rule_name}` }))
  return (
    <Select
      isMulti isLoading={isLoading} options={options}
      value={options.filter((o) => value.includes(o.value))}
      onChange={(vals) => onChange(vals.map((v) => v.value))}
      placeholder={placeholder ?? '정책 선택…'} noOptionsMessage={() => '정책이 없습니다'}
      styles={{
        control: (b) => ({ ...b, fontSize: '14px', minHeight: '36px', borderColor: 'rgba(169,180,185,0.3)', backgroundColor: '#ffffff' }),
        menu: (b) => ({ ...b, fontSize: '14px' }),
      }}
    />
  )
}
