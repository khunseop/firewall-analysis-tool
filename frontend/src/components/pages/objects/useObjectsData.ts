import { useQuery } from '@tanstack/react-query'
import {
  getNetworkObjects, getNetworkGroups, getServices, getServiceGroups, searchObjects,
  type ObjectSearchRequest,
} from '@/api/firewall'
import { queryKeys } from '@/api/queryKeys'

export type TabKey = 'network_objects' | 'network_groups' | 'services' | 'service_groups'

export interface DeviceFailure { deviceId: number; message: string }
export interface ObjectsResult { rows: unknown[]; failed: DeviceFailure[] }

const FETCHERS: Record<TabKey, (deviceId: number) => Promise<unknown[]>> = {
  network_objects: getNetworkObjects,
  network_groups: getNetworkGroups,
  services: getServices,
  service_groups: getServiceGroups,
}

/**
 * 장비별로 따로 조회해 일부만 실패해도 나머지 결과는 보여준다(Promise.all은 한 대만 실패해도 전체가 빈 화면이 된다).
 * 전부 실패하면 오류를 던져 "결과 없음"과 구분되게 한다.
 */
async function loadPerDevice(deviceIds: number[], tab: TabKey): Promise<ObjectsResult> {
  const results = await Promise.allSettled(deviceIds.map((id) => FETCHERS[tab](id)))
  const rows: unknown[] = []
  const failed: DeviceFailure[] = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') rows.push(...r.value)
    else failed.push({ deviceId: deviceIds[i], message: (r.reason as Error)?.message ?? '알 수 없는 오류' })
  })
  if (deviceIds.length > 0 && failed.length === deviceIds.length) throw new Error(failed[0].message)
  return { rows, failed }
}

const SEARCH_TYPE: Record<TabKey, string> = {
  network_objects: 'network-objects', network_groups: 'network-groups',
  services: 'services', service_groups: 'service-groups',
}

/** 탭별 검색 입력을 서버 검색 조건으로 바꾼다 — IP·포트는 서버가 숫자 범위 겹침으로 비교한다. */
export function buildObjectSearch(tab: TabKey, deviceIds: number[], expr: string): ObjectSearchRequest {
  const base = { device_ids: deviceIds, object_type: SEARCH_TYPE[tab] }
  if (tab === 'network_objects') return { ...base, ip_address: expr }
  if (tab === 'services') {
    const m = expr.match(/^(tcp|udp|icmp)\s*[/:]\s*(.+)$/i)
    return m ? { ...base, protocol: m[1], port: m[2] } : { ...base, port: expr }
  }
  return { ...base, members: expr }
}

const RESPONSE_KEY: Record<TabKey, 'network_objects' | 'network_groups' | 'services' | 'service_groups'> = {
  network_objects: 'network_objects', network_groups: 'network_groups',
  services: 'services', service_groups: 'service_groups',
}

export function useObjectsData(deviceIds: number[], tab: TabKey, searchExpr: string | null) {
  const hasDevices = deviceIds.length > 0
  const searching = searchExpr != null

  const list = useQuery({
    queryKey: queryKeys.objectsList(tab, deviceIds),
    queryFn: () => loadPerDevice(deviceIds, tab),
    enabled: hasDevices && !searching, staleTime: 30_000,
  })

  const search = useQuery({
    queryKey: queryKeys.objectSearch(tab, searchExpr ?? '', deviceIds),
    queryFn: async (): Promise<ObjectsResult> => {
      const res = await searchObjects(buildObjectSearch(tab, deviceIds, searchExpr as string))
      return { rows: res[RESPONSE_KEY[tab]] as unknown[], failed: [] }
    },
    enabled: hasDevices && searching, staleTime: 30_000,
  })

  return searching ? search : list
}
