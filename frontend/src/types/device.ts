export interface Device {
  id: number
  name: string
  ip_address: string
  vendor: string
  username: string
  description: string | null
  ha_peer_ip: string | null
  use_ssh_for_last_hit_date: boolean
  collect_last_hit_date: boolean
  model: string | null
  group: string | null
  last_sync_at: string | null
  last_sync_status: string | null
  last_sync_step: string | null
  serial_number: string | null
  os_name: string | null
  os_version: string | null
  install_date: string | null
  location_region: string | null
  location_building: string | null
  location_floor: string | null
  location_room: string | null
  location_x: string | null
  location_y: string | null
  location_z: string | null
  policy_threshold: number | null
  policy_threshold_manual: boolean
  network_object_threshold: number | null
  network_object_threshold_manual: boolean
  network_group_threshold: number | null
  network_group_threshold_manual: boolean
  service_threshold: number | null
  service_threshold_manual: boolean
  service_group_threshold: number | null
  service_group_threshold_manual: boolean
  cached_policies: number | null
  cached_active_policies: number | null
  cached_disabled_policies: number | null
  cached_network_objects: number | null
  cached_network_groups: number | null
  cached_services: number | null
  cached_service_groups: number | null
}

export interface DeviceCreate {
  name: string
  ip_address: string
  vendor: string
  username: string
  password: string
  password_confirm: string
  ha_peer_ip?: string
  description?: string
  use_ssh_for_last_hit_date?: boolean
  collect_last_hit_date?: boolean
  model?: string
  group?: string
  serial_number?: string
  os_name?: string
  os_version?: string
  install_date?: string
  location_region?: string
  location_building?: string
  location_floor?: string
  location_room?: string
  location_x?: string
  location_y?: string
  location_z?: string
  policy_threshold?: number
  policy_threshold_manual?: boolean
  network_object_threshold?: number
  network_object_threshold_manual?: boolean
  network_group_threshold?: number
  network_group_threshold_manual?: boolean
  service_threshold?: number
  service_threshold_manual?: boolean
  service_group_threshold?: number
  service_group_threshold_manual?: boolean
}

export interface DeviceUpdate {
  name?: string
  ip_address?: string
  vendor?: string
  username?: string
  password?: string
  password_confirm?: string
  ha_peer_ip?: string
  description?: string
  use_ssh_for_last_hit_date?: boolean
  collect_last_hit_date?: boolean
  model?: string
  group?: string
  serial_number?: string
  os_name?: string
  os_version?: string
  install_date?: string
  location_region?: string
  location_building?: string
  location_floor?: string
  location_room?: string
  location_x?: string
  location_y?: string
  location_z?: string
  policy_threshold?: number
  policy_threshold_manual?: boolean
  network_object_threshold?: number
  network_object_threshold_manual?: boolean
  network_group_threshold?: number
  network_group_threshold_manual?: boolean
  service_threshold?: number
  service_threshold_manual?: boolean
  service_group_threshold?: number
  service_group_threshold_manual?: boolean
}

export interface DeviceStats {
  id: number
  name: string
  vendor: string
  ip_address?: string
  sync_time: string | null
  sync_status: string | null
  sync_step: string | null
  policies: number
  active_policies: number
  disabled_policies: number
  network_objects: number
  network_groups: number
  services: number
  service_groups: number
  policy_threshold: number | null
  network_object_threshold: number | null
  network_group_threshold: number | null
  service_threshold: number | null
  service_group_threshold: number | null
}

export interface DashboardStats {
  total_devices: number
  active_devices: number
  total_policies: number
  total_active_policies: number
  total_disabled_policies: number
  total_network_objects: number
  total_network_groups: number
  total_services: number
  total_service_groups: number
  device_stats: DeviceStats[]
}
