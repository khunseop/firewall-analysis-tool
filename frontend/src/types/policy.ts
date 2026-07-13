export interface Policy {
  id: number
  device_id: number
  rule_name: string
  source: string
  destination: string
  service: string
  action: string
  vsys: string | null
  seq: number | null
  enable: boolean
  user: string | null
  application: string | null
  security_profile: string | null
  category: string | null
  description: string | null
  last_hit_date: string | null
  hit_count: number | null
  is_active: boolean
  last_seen_at: string | null
}

export interface FilterLeafNode {
  type: 'LEAF'
  field: string
  operator: 'contains' | 'equals' | 'not_equals' | 'not_contains' | 'gte' | 'lte' | 'only_within'
  value: string
}
export interface FilterGroupNode {
  type: 'AND' | 'OR'
  children: FilterExprNode[]
}
export type FilterExprNode = FilterLeafNode | FilterGroupNode

export interface PolicySearchRequest {
  device_ids: number[]
  vsys?: string
  vsys_negate?: boolean
  rule_name?: string
  rule_name_negate?: boolean
  action?: string
  action_negate?: boolean
  enable?: boolean
  user?: string
  user_negate?: boolean
  application?: string
  application_negate?: boolean
  security_profile?: string
  category?: string
  description?: string
  description_negate?: boolean
  last_hit_date_from?: string
  last_hit_date_to?: string
  src_ip?: string
  dst_ip?: string
  protocol?: string
  port?: string
  src_ips?: string[]
  dst_ips?: string[]
  src_ips_exact?: string[]
  dst_ips_exact?: string[]
  services?: string[]
  src_names?: string[]
  dst_names?: string[]
  service_names?: string[]
  src_ips_exclude?: string[]
  dst_ips_exclude?: string[]
  src_ips_exact_exclude?: string[]
  dst_ips_exact_exclude?: string[]
  services_exclude?: string[]
  src_names_exclude?: string[]
  dst_names_exclude?: string[]
  service_names_exclude?: string[]
  skip?: number
  limit?: number
  filter_expression?: FilterExprNode
}

export interface ChangeLogEntry {
  id: number
  device_id: number
  object_name: string
  action: 'created' | 'updated' | 'deleted' | 'hit_date_updated'
  timestamp: string | null
}

export interface PolicyHistoryEntry extends ChangeLogEntry {
  details: Record<string, unknown> | string | null
}

export interface PolicySearchResponse {
  policies: Policy[]
  valid_object_names: string[]
}
