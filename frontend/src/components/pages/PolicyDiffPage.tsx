import { useState, useMemo, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertCircle, ArrowLeftRight, FileDown, Loader2, RotateCw, Search, ShieldAlert, Zap } from 'lucide-react'
import { apiClient } from '@/api/client'
import { queryKeys } from '@/api/queryKeys'
import { DeviceSelectorSingle } from '@/components/shared/DeviceSelector'
import { listDevices } from '@/api/devices'
import { exportStyledToExcel } from '@/api/firewall'
import { assessDiffRisk } from '@/lib/policyDiffRisk'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/lib/errorMessage'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { DiffTable, type DiffRowData } from './policy-diff/DiffRow'
import { SyncPointSelector } from './policy-diff/SyncPointSelector'
import { buildDiffWorkbook } from './policy-diff/excel'
import { useExportAction } from '@/hooks/useExportAction'
import { LIVE_RUNNING_ID, LIVE_CANDIDATE_ID, fmt, type DiffResponse, type SyncPoint } from './policy-diff/types'

// ─── API ─────────────────────────────────────────────────────────────────────

async function fetchSyncHistory(deviceId: number): Promise<SyncPoint[]> {
  const res = await apiClient.get('/firewall/sync-history', { params: { device_id: deviceId } })
  return res.data
}

async function fetchPolicyDiff(deviceId: number, fromId: number, toId: number): Promise<DiffResponse> {
  const res = await apiClient.get('/firewall/policy-diff', {
    params: { device_id: deviceId, from_sync_id: fromId, to_sync_id: toId },
  })
  return res.data
}

const DIFF_ERROR_FALLBACK = '비교 결과를 가져오지 못했습니다. 네트워크 상태를 확인하고 다시 시도하세요.'

const DAY_MS = 24 * 60 * 60 * 1000

// ─── Main Page ────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'created' | 'updated' | 'deleted'

interface DiffRequest { deviceId: number; fromId: number; toId: number }

const PRESET_CHIP = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border border-ds-outline-variant/40 bg-white text-ds-on-surface-variant hover:bg-ds-surface-container-low hover:text-ds-on-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40'

export function PolicyDiffPage() {
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null)
  const [fromSyncId, setFromSyncId] = useState<number | null>(null)
  const [toSyncId, setToSyncId] = useState<number | null>(null)
  // 실제로 "비교하기"를 누른 요청 — 결과는 이 요청에 묶이고, 이후 선택이 바뀌면 낡은 결과로 표시한다.
  const [request, setRequest] = useState<DiffRequest | null>(null)
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [riskOnly, setRiskOnly] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const { data: syncHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: queryKeys.syncHistory(selectedDeviceId),
    queryFn: () => fetchSyncHistory(selectedDeviceId!),
    enabled: selectedDeviceId != null,
  })

  // DeviceSelectorSingle이 이미 같은 쿼리 키로 장비 목록을 받아와 있으므로 캐시를 그대로 재사용한다.
  const { data: devices = [] } = useQuery({ queryKey: queryKeys.devices, queryFn: listDevices })
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId)
  const isPaloAlto = selectedDevice?.vendor?.toLowerCase() === 'paloalto'

  // Devices 페이지의 "정책 비교" 바로가기에서 넘어온 경우 — 장비를 선택하고, Palo Alto라면
  // Running/Candidate 실시간 비교를 바로 선택해준다. 장비 목록이 로드된 뒤에 판단해야 vendor를 알 수 있다.
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const openDeviceId = (location.state as { openDeviceId?: number } | null)?.openDeviceId
    if (openDeviceId == null || devices.length === 0) return
    setSelectedDeviceId(openDeviceId)
    const vendor = devices.find((d) => d.id === openDeviceId)?.vendor?.toLowerCase()
    if (vendor === 'paloalto') {
      setFromSyncId(LIVE_RUNNING_ID)
      setToSyncId(LIVE_CANDIDATE_ID)
    }
    navigate(location.pathname, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, devices])

  // Palo Alto 장비에서는 From에 "Running(실시간)", To에 "Candidate(실시간)"를 한 항목씩 추가한다 —
  // 과거 sync 시점과는 짝지을 수 없으므로(스냅샷 미보관) 방향을 고정해 한쪽에만 넣는다.
  const fromPoints: SyncPoint[] = useMemo(() => (
    isPaloAlto
      ? [{ id: LIVE_RUNNING_ID, device_id: selectedDeviceId!, sync_at: '', total_policies: null, isLive: true, liveLabel: 'Running (실시간)' }, ...syncHistory]
      : syncHistory
  ), [isPaloAlto, selectedDeviceId, syncHistory])
  const toPoints: SyncPoint[] = useMemo(() => (
    isPaloAlto
      ? [{ id: LIVE_CANDIDATE_ID, device_id: selectedDeviceId!, sync_at: '', total_policies: null, isLive: true, liveLabel: 'Candidate (실시간)' }, ...syncHistory]
      : syncHistory
  ), [isPaloAlto, selectedDeviceId, syncHistory])

  // Running/Candidate는 서로만 짝지을 수 있다 — 한쪽을 실시간으로 고르면 반대쪽을 자동으로 맞추고,
  // 반대쪽에서 다른(과거 sync) 값을 고르면 실시간 선택은 무효가 되어 다시 골라야 한다.
  const handleFromChange = (id: number | null) => {
    setFromSyncId(id)
    if (id === LIVE_RUNNING_ID) setToSyncId(LIVE_CANDIDATE_ID)
    else if (toSyncId === LIVE_CANDIDATE_ID) setToSyncId(null)
  }
  const handleToChange = (id: number | null) => {
    setToSyncId(id)
    if (id === LIVE_CANDIDATE_ID) setFromSyncId(LIVE_RUNNING_ID)
    else if (fromSyncId === LIVE_RUNNING_ID) setFromSyncId(null)
  }

  const canCompare = selectedDeviceId != null && fromSyncId != null && toSyncId != null && fromSyncId !== toSyncId
  const canSwap = fromSyncId != null && toSyncId != null && fromSyncId >= 0 && toSyncId >= 0

  const swapPoints = () => {
    setFromSyncId(toSyncId)
    setToSyncId(fromSyncId)
  }

  // 빠른 비교 프리셋 — 최신 sync 기준으로 From/To를 채우고 바로 실행한다.
  const presets = useMemo(() => {
    const sorted = [...syncHistory].sort((a, b) => new Date(b.sync_at).getTime() - new Date(a.sync_at).getTime())
    const latest = sorted[0]
    const previous = sorted[1]
    const dayAgo = latest ? sorted.find((p) => new Date(p.sync_at).getTime() <= new Date(latest.sync_at).getTime() - DAY_MS) : undefined
    return { latest, previous, dayAgo }
  }, [syncHistory])

  const {
    data: diffResult,
    isFetching: diffFetching,
    error: diffError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.policyDiff(request?.deviceId ?? null, request?.fromId ?? null, request?.toId ?? null),
    queryFn: () => fetchPolicyDiff(request!.deviceId, request!.fromId, request!.toId),
    enabled: request != null,
    staleTime: 0, // 실시간 Running/Candidate는 캐시된 결과를 쓰면 안 된다 — 매번 다시 받아온다
    retry: false,
  })

  const runCompare = (deviceId: number, fromId: number, toId: number) => {
    setFilterTab('all')
    setRiskOnly(false)
    setSearchQuery('')
    if (request && request.deviceId === deviceId && request.fromId === fromId && request.toId === toId) {
      void refetch()
    } else {
      setRequest({ deviceId, fromId, toId })
    }
  }

  const runPreset = (fromId: number, toId: number) => {
    if (selectedDeviceId == null) return
    setFromSyncId(fromId)
    setToSyncId(toId)
    runCompare(selectedDeviceId, fromId, toId)
  }

  const isStale = request != null && (request.fromId !== fromSyncId || request.toId !== toSyncId)
  const requestIsLive = request?.fromId === LIVE_RUNNING_ID

  const rows: DiffRowData[] = useMemo(() => {
    if (!diffResult) return []
    return diffResult.changes.map((entry) => ({ entry, risks: assessDiffRisk(entry) }))
  }, [diffResult])
  const riskCount = rows.filter((r) => r.risks.length > 0).length

  // 정책명 검색어만 적용한 결과 — 엑셀은 상태별로 시트가 이미 나뉘므로 상태 필터 탭은 적용하지 않는다.
  const searchFilteredRows = useMemo(() => {
    if (!searchQuery) return rows
    const q = searchQuery.toLowerCase()
    return rows.filter((r) => r.entry.rule_name.toLowerCase().includes(q))
  }, [rows, searchQuery])

  // 위험 변경을 먼저 보여준다(정렬은 안정적이라 기존 삭제→수정→추가 순서는 그룹 안에서 유지된다).
  const visibleRows = useMemo(() => {
    const byTab = filterTab === 'all' ? searchFilteredRows : searchFilteredRows.filter((r) => r.entry.action === filterTab)
    const byRisk = riskOnly ? byTab.filter((r) => r.risks.length > 0) : byTab
    return [...byRisk].sort((a, b) => Number(b.risks.length > 0) - Number(a.risks.length > 0))
  }, [searchFilteredRows, filterTab, riskOnly])

  const handleDeviceChange = (id: number | null) => {
    setSelectedDeviceId(id)
    setFromSyncId(null)
    setToSyncId(null)
    setRequest(null)
    setFilterTab('all')
    setRiskOnly(false)
    setSearchQuery('')
  }

  const deviceLabel = selectedDevice ? `${selectedDevice.name} (${selectedDevice.vendor})` : `device${selectedDeviceId}`

  const exportAction = useExportAction()
  const handleExport = () => {
    if (!diffResult || searchFilteredRows.length === 0) return
    const stamp = (iso: string) => fmt(iso).replace(/[-: ]/g, '')
    const fromLabel = diffResult.from_sync.id === LIVE_RUNNING_ID ? 'running' : stamp(diffResult.from_sync.sync_at)
    const toLabel = diffResult.to_sync.id === LIVE_CANDIDATE_ID ? 'candidate' : stamp(diffResult.to_sync.sync_at)
    const filename = `정책비교_${selectedDevice?.name ?? `device${selectedDeviceId}`}_${fromLabel}_${toLabel}`
    exportAction.run(() => exportStyledToExcel(buildDiffWorkbook(diffResult, searchFilteredRows.map((r) => r.entry), searchQuery, filename, deviceLabel)))
      .catch((e: Error) => toast.error(e.message))
  }

  const showCompareControls = selectedDeviceId != null && !historyLoading && (syncHistory.length > 0 || isPaloAlto)
  const policyDelta = diffResult && diffResult.from_sync.total_policies != null && diffResult.to_sync.total_policies != null
    ? diffResult.to_sync.total_policies - diffResult.from_sync.total_policies
    : null

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="정책 변경 비교 (Diff)"
        description={
          <>
            두 시점의 정책을 비교해 추가·수정·삭제된 정책과 바뀐 필드를 보여줍니다.
            {isPaloAlto && ' Palo Alto 장비는 Running과 Candidate를 장비에서 직접 받아와 비교할 수도 있습니다.'}
          </>
        }
      />

      {/* 비교 설정 */}
      <div className="card rounded-xl px-5 py-5 space-y-5">
        <div className="space-y-1.5 max-w-sm">
          <span className="block text-xs font-semibold text-ds-primary">장비</span>
          <DeviceSelectorSingle value={selectedDeviceId} onChange={handleDeviceChange} />
        </div>

        {selectedDeviceId == null && (
          <p className="text-13 text-ds-on-surface-variant">장비를 선택하면 비교할 시점을 고를 수 있습니다.</p>
        )}

        {selectedDeviceId != null && historyLoading && (
          <p role="status" className="flex items-center gap-2 text-13 text-ds-on-surface-variant">
            <Loader2 className="w-4 h-4 animate-spin" />동기화 이력을 불러오는 중…
          </p>
        )}

        {selectedDeviceId != null && !historyLoading && syncHistory.length === 0 && !isPaloAlto && (
          <div className="flex items-center gap-2 text-13 text-ds-on-surface-variant">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
            이 장비에 대한 동기화 이력이 없습니다. 동기화를 먼저 실행해주세요.
          </div>
        )}

        {showCompareControls && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-ds-on-surface-variant mr-1">빠른 비교</span>
              <button
                type="button"
                className={PRESET_CHIP}
                disabled={!presets.previous || diffFetching}
                title={presets.previous ? undefined : '비교할 이전 동기화 이력이 없습니다.'}
                onClick={() => presets.previous && presets.latest && runPreset(presets.previous.id, presets.latest.id)}
              >
                직전 동기화와 비교
              </button>
              <button
                type="button"
                className={PRESET_CHIP}
                disabled={!presets.dayAgo || diffFetching}
                title={presets.dayAgo ? undefined : '최신 동기화보다 24시간 이상 앞선 이력이 없습니다.'}
                onClick={() => presets.dayAgo && presets.latest && runPreset(presets.dayAgo.id, presets.latest.id)}
              >
                24시간 전과 비교
              </button>
              {isPaloAlto && (
                <button
                  type="button"
                  className={PRESET_CHIP}
                  disabled={diffFetching}
                  onClick={() => runPreset(LIVE_RUNNING_ID, LIVE_CANDIDATE_ID)}
                >
                  <Zap className="w-3 h-3 text-amber-600" />Running ↔ Candidate
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-3 items-end">
              <SyncPointSelector
                label="비교 시작 (From)"
                points={fromPoints}
                value={fromSyncId}
                onChange={handleFromChange}
                disabledId={toSyncId}
              />
              <button
                type="button"
                onClick={swapPoints}
                disabled={!canSwap}
                aria-label="From과 To 바꾸기"
                title={canSwap ? 'From과 To를 서로 바꿉니다' : 'Running/Candidate 비교는 방향이 고정되어 있습니다'}
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md border border-ds-outline-variant/40 text-ds-on-surface-variant hover:bg-ds-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
              >
                <ArrowLeftRight className="w-4 h-4" />
              </button>
              <SyncPointSelector
                label="비교 종료 (To)"
                points={toPoints}
                value={toSyncId}
                onChange={handleToChange}
                disabledId={fromSyncId}
              />
              <Button
                variant="gradient"
                size="auto"
                onClick={() => canCompare && runCompare(selectedDeviceId!, fromSyncId!, toSyncId!)}
                disabled={!canCompare || diffFetching}
                className="gap-2 px-5 h-9 text-sm font-bold rounded-lg"
              >
                {diffFetching ? '비교 중…' : '비교하기'}
              </Button>
            </div>
            {fromSyncId === toSyncId && fromSyncId != null && (
              <p className="text-xs text-ds-error">동일한 시점은 비교할 수 없습니다.</p>
            )}
          </>
        )}
      </div>

      {/* 로딩 (첫 결과를 기다리는 동안) */}
      {request != null && diffFetching && !diffResult && (
        <div role="status" className="card rounded-xl px-5 py-8 flex items-center gap-3 text-13 text-ds-on-surface-variant">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          {requestIsLive
            ? '장비에 접속해 Running과 Candidate를 가져오는 중입니다. 장비 응답에 따라 시간이 걸릴 수 있습니다.'
            : '두 시점 사이의 변경 이력을 비교하는 중…'}
        </div>
      )}

      {/* 에러 */}
      {diffError && !diffFetching && (
        <div role="alert" className="card rounded-xl px-5 py-4 flex flex-wrap items-center gap-3 text-13 text-ds-error">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-[200px]">{errorMessage(diffError, DIFF_ERROR_FALLBACK)}</span>
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border border-ds-error/40 hover:bg-ds-error/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-error/40"
          >
            <RotateCw className="w-3 h-3" />다시 시도
          </button>
        </div>
      )}

      {/* 결과 — 기간/요약/필터/표를 한 카드로 묶는다 */}
      {diffResult && (
        <div className={cn('card rounded-xl', isStale && 'opacity-70')}>
          {isStale && (
            <p role="status" className="px-5 py-2 text-xs font-medium text-amber-800 bg-amber-50 border-b border-amber-100 rounded-t-xl">
              선택이 바뀌었습니다. 아래는 이전에 비교한 결과입니다. 새 선택으로 보려면 다시 비교하세요.
            </p>
          )}

          <div className="px-5 py-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-13">
            <span className="font-semibold text-ds-on-surface">{deviceLabel}</span>
            <span className="inline-flex items-center gap-2 font-mono text-ds-on-surface-variant">
              {diffResult.from_sync.id === LIVE_RUNNING_ID && <Zap className="w-3.5 h-3.5 text-amber-600" />}
              {diffResult.from_sync.id === LIVE_RUNNING_ID ? 'Running (실시간)' : fmt(diffResult.from_sync.sync_at)}
              <span aria-hidden>→</span>
              {diffResult.to_sync.id === LIVE_CANDIDATE_ID ? 'Candidate (실시간)' : fmt(diffResult.to_sync.sync_at)}
            </span>
            {policyDelta != null && (
              <span className="text-xs text-ds-on-surface-variant">
                정책 수 {diffResult.from_sync.total_policies!.toLocaleString()} → {diffResult.to_sync.total_policies!.toLocaleString()}
                {' '}({policyDelta > 0 ? '+' : ''}{policyDelta.toLocaleString()})
              </span>
            )}
          </div>

          {diffResult.summary.total === 0 ? (
            <p className="px-5 pb-5 text-13 text-ds-on-surface-variant">
              <span className="font-semibold text-ds-on-surface">변경 없음</span> — 두 시점 사이에 추가·수정·삭제된 정책이 없습니다.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 px-5 py-3 border-t border-b border-ds-outline-variant/10 flex-wrap">
                <div role="group" aria-label="변경 유형 필터" className="flex items-center gap-2 flex-wrap">
                  {(
                    [
                      { key: 'all',     label: '전체',  count: diffResult.summary.total },
                      { key: 'created', label: '추가',  count: diffResult.summary.created },
                      { key: 'updated', label: '수정',  count: diffResult.summary.updated },
                      { key: 'deleted', label: '삭제',  count: diffResult.summary.deleted },
                    ] as const
                  ).map(({ key, label, count }) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={filterTab === key}
                      onClick={() => setFilterTab(key)}
                      className={cn(
                        'px-3 py-1 rounded-full text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40',
                        filterTab === key
                          ? 'bg-ds-primary text-white'
                          : 'bg-ds-surface-container text-ds-on-surface-variant hover:bg-ds-surface-container-high'
                      )}
                    >
                      {label} {count.toLocaleString()}
                    </button>
                  ))}
                </div>
                {riskCount > 0 && (
                  <button
                    type="button"
                    aria-pressed={riskOnly}
                    onClick={() => setRiskOnly((v) => !v)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40',
                      riskOnly ? 'bg-red-600 border-red-600 text-white' : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                    )}
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />위험 변경 {riskCount.toLocaleString()}
                  </button>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ds-on-surface-variant pointer-events-none" />
                    <input
                      type="text"
                      aria-label="정책명 검색"
                      placeholder="정책명 검색…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 w-48 pl-8 pr-3 text-xs bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md placeholder:text-ds-on-surface-variant focus:outline-none focus:border-ds-tertiary"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={searchFilteredRows.length === 0 || exportAction.busy}
                    aria-busy={exportAction.busy}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold border border-ds-outline-variant/40 bg-white text-ds-on-surface hover:bg-ds-surface-container-low transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
                  >
                    {exportAction.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                    {exportAction.busy ? '엑셀 준비 중…' : '엑셀로 저장'}
                  </button>
                </div>
              </div>
              <p className="px-5 py-1.5 text-11 text-ds-on-surface-variant border-b border-ds-outline-variant/10">
                엑셀은 요약·추가·삭제·변경 시트로 나뉘어 저장되며, 유형 필터와 상관없이 정책명 검색어만 반영됩니다.
              </p>

              <DiffTable rows={visibleRows} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
