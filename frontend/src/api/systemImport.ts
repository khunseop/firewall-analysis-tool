import { apiClient } from './client'
import { getSetting, updateSetting } from './settings'

/** 시스템 현황 대시보드 주소를 저장하는 설정 키 (백엔드 SETTING_KEY와 동일). */
export const SYSTEM_DASHBOARD_URL_KEY = 'system_dashboard_url'

export type ChangeKind = 'override' | 'fill' | 'connection'

export interface FieldChange {
  device_id: number
  field: string
  old: string | null
  new: string | null
  kind: ChangeKind
  set_manual: boolean | null
}

/** 변경 한 건을 가리키는 키 (선택 상태 관리용). 같은 장비의 같은 필드는 한 요청에 한 번만 나온다. */
export const changeKey = (c: Pick<FieldChange, 'device_id' | 'field'>) => `${c.device_id}:${c.field}`

export interface Mismatch {
  device_id: number
  field: string
  fat_value: string
  dashboard_value: string
}

export interface DeviceDiff {
  device_id: number
  device_name: string
  via: 'ip' | 'hostname'
  changes: FieldChange[]
  mismatches: Mismatch[]
  partner_hostname: string | null
  dashboard_retired: boolean
}

export interface UnmatchedDevice { id: number; name: string; ip_address: string }
export interface UnmatchedRow { hostname: string | null; ip: string | null; vendor: string | null; model: string | null }

export interface SystemImportPreview {
  diffs: DeviceDiff[]
  unmatched_devices: UnmatchedDevice[]
  unmatched_rows: UnmatchedRow[]
  skipped_vendor_count: number
  warnings: string[]
}

export interface ApplyResult {
  applied: FieldChange[]
  skipped_conflicts: FieldChange[]
  skipped_invalid: FieldChange[]
  reverse: FieldChange[]
}

export const previewSystemImport = async (baseUrl?: string): Promise<SystemImportPreview> => {
  const res = await apiClient.post<SystemImportPreview>('/system-import/preview', { base_url: baseUrl || null })
  return res.data
}

export const applySystemImport = async (changes: FieldChange[], confirmConnection: boolean): Promise<ApplyResult> => {
  const res = await apiClient.post<ApplyResult>('/system-import/apply', { changes, confirm_connection: confirmConnection })
  return res.data
}

/** 저장된 대시보드 주소. 설정이 아직 없으면(404) 빈 문자열. */
export const getSavedDashboardUrl = async (): Promise<string> => {
  try {
    return (await getSetting(SYSTEM_DASHBOARD_URL_KEY)).value
  } catch {
    return ''
  }
}

export const saveDashboardUrl = (url: string) =>
  updateSetting(SYSTEM_DASHBOARD_URL_KEY, url.trim(), '시스템 현황 대시보드 주소')
