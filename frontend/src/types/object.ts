export interface NetworkObject {
  id: number
  device_id: number
  name: string
  ip_address: string
  type: string
  description: string | null
  ip_version: string | null
  ip_start: string | null
  ip_end: string | null
  is_active: boolean
  last_seen_at: string | null
}

export interface NetworkGroup {
  id: number
  device_id: number
  name: string
  members: string
  description: string | null
  is_active: boolean
  last_seen_at: string | null
}

export interface Service {
  id: number
  device_id: number
  name: string
  protocol: string
  port: string
  description: string | null
  port_start: number | null
  port_end: number | null
  is_active: boolean
  last_seen_at: string | null
}

export interface ServiceGroup {
  id: number
  device_id: number
  name: string
  members: string
  description: string | null
  is_active: boolean
  last_seen_at: string | null
}

export interface ObjectSearchRequest {
  device_ids: number[]
  object_type: string
  name?: string
  description?: string
  ip_address?: string
  type?: string
  members?: string
  protocol?: string
  port?: string
  names?: string[]
  ip_addresses?: string[]
  protocols?: string[]
  ports?: string[]
  skip?: number
  limit?: number
}

export interface ObjectSearchResponse {
  network_objects: NetworkObject[]
  network_groups: NetworkGroup[]
  services: Service[]
  service_groups: ServiceGroup[]
}
