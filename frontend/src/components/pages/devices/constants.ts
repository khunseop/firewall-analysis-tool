
export const VENDOR_OPTIONS = [
  { code: 'paloalto', label: 'Palo Alto' },
  { code: 'ngf',      label: 'SECUI NGF' },
  { code: 'mf2',      label: 'SECUI MF2' },
  { code: 'mock',     label: 'Mock' },
]

export const VENDOR_BADGE: Record<string, string> = {
  paloalto: 'bg-orange-50 text-orange-600 border border-orange-100',
  ngf:      'bg-blue-50 text-blue-600 border border-blue-100',
  mf2:      'bg-cyan-50 text-cyan-600 border border-cyan-100',
  mock:     'bg-gray-50 text-gray-500 border border-gray-100',
}

export const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string }> = {
  success:     { label: '완료',   dot: 'bg-emerald-500',              text: 'text-emerald-700' },
  in_progress: { label: '진행중', dot: 'bg-ds-tertiary animate-pulse', text: 'text-ds-tertiary' },
  pending:     { label: '대기',   dot: 'bg-ds-outline',                text: 'text-ds-on-surface-variant' },
  failure:     { label: '실패',   dot: 'bg-ds-error',                  text: 'text-ds-error' },
  error:       { label: '오류',   dot: 'bg-ds-error',                  text: 'text-ds-error' },
}

export const STATUS_ORDER: Record<string, number> = {
  pending: 0, in_progress: 1, success: 2, failure: 3, error: 4,
}

export interface DeviceFormData {
  name: string; ip_address: string; vendor: string; username: string
  password: string; password_confirm: string; ha_peer_ip: string
  model: string; group: string; description: string; collect_last_hit_date: boolean
  use_ssh_for_last_hit_date: boolean
  serial_number: string; os_name: string; os_version: string; install_date: string
  location_region: string; location_building: string; location_floor: string; location_room: string
  location_x: string; location_y: string; location_z: string
  policy_threshold: string; network_object_threshold: string; service_threshold: string
}

export const DEFAULT_FORM: DeviceFormData = {
  name: '', ip_address: '', vendor: 'paloalto', username: '', password: '', password_confirm: '',
  ha_peer_ip: '', model: '', group: '', description: '', collect_last_hit_date: true, use_ssh_for_last_hit_date: false,
  serial_number: '', os_name: '', os_version: '', install_date: '',
  location_region: '', location_building: '', location_floor: '', location_room: '',
  location_x: '', location_y: '', location_z: '',
  policy_threshold: '', network_object_threshold: '', service_threshold: '',
}
