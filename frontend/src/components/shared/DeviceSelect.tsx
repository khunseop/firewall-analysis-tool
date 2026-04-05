import Select, { type MultiValue, type SingleValue } from 'react-select'
import type { Device } from '@/api/devices'

interface Option {
  value: number
  label: string
}

interface DeviceSelectMultiProps {
  devices: Device[]
  value: number[]
  onChange: (ids: number[]) => void
  isMulti: true
  placeholder?: string
  isDisabled?: boolean
}

interface DeviceSelectSingleProps {
  devices: Device[]
  value: number | null
  onChange: (id: number | null) => void
  isMulti?: false
  placeholder?: string
  isDisabled?: boolean
}

type DeviceSelectProps = DeviceSelectMultiProps | DeviceSelectSingleProps

export function DeviceSelect(props: DeviceSelectProps) {
  const { devices, placeholder = '장비 선택...', isDisabled } = props

  const options: Option[] = devices.map((d) => ({ value: d.id, label: d.name }))

  if (props.isMulti) {
    const selectedOptions = options.filter((o) => props.value.includes(o.value))
    return (
      <Select<Option, true>
        isMulti
        options={options}
        value={selectedOptions}
        onChange={(vals: MultiValue<Option>) => props.onChange(vals.map((v) => v.value))}
        placeholder={placeholder}
        isDisabled={isDisabled}
        classNamePrefix="react-select"
        noOptionsMessage={() => '장비가 없습니다'}
        styles={{
          control: (base) => ({ ...base, minHeight: '36px', fontSize: '14px' }),
          menu: (base) => ({ ...base, fontSize: '14px' }),
        }}
      />
    )
  }

  const selectedOption = options.find((o) => o.value === props.value) ?? null
  return (
    <Select<Option, false>
      options={options}
      value={selectedOption}
      onChange={(val: SingleValue<Option>) => props.onChange(val?.value ?? null)}
      placeholder={placeholder}
      isDisabled={isDisabled}
      classNamePrefix="react-select"
      isClearable
      noOptionsMessage={() => '장비가 없습니다'}
      styles={{
        control: (base) => ({ ...base, minHeight: '36px', fontSize: '14px' }),
        menu: (base) => ({ ...base, fontSize: '14px' }),
      }}
    />
  )
}
