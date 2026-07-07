import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Search, Copy, Clock, ArrowLeftRight, Unlink, ShieldAlert, Expand, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DeviceSelectorSingle } from '@/components/shared/DeviceSelectorSingle'
import { PolicyGridPicker } from '@/components/shared/PolicyGridPicker'
import Select from 'react-select'
import { getPolicies } from '@/api/firewall'
import { startAnalysis, listAnalysisTasks, type StartAnalysisParams, type AnalysisTaskListItem } from '@/api/analysis'
import { formatDate } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

interface AnalysisTypeOption {
  value: string
  label: string
  icon: LucideIcon
  description: string
}

const ANALYSIS_TYPES: AnalysisTypeOption[] = [
  { value: 'redundancy',           label: '중복 정책 분석',      icon: Copy,          description: '동일하거나 포함 관계에 있는 정책을 탐지합니다. 상위/하위 정책 쌍으로 결과를 보여줍니다.' },
  { value: 'unused',               label: '미사용 정책 분석',     icon: Clock,         description: '설정 기간 동안 트래픽이 발생하지 않은 정책을 탐지합니다.' },
  { value: 'impact',               label: '정책 이동 영향 분석',  icon: ArrowLeftRight, description: '정책을 다른 순번으로 이동했을 때 차단·섀도우 영향을 사전 분석합니다.' },
  { value: 'unreferenced_objects', label: '미참조 오브젝트 분석', icon: Unlink,        description: '어떤 정책에도 사용되지 않는 네트워크/서비스 객체를 탐지합니다.' },
  { value: 'risky_ports',          label: '위험 포트 분석',       icon: ShieldAlert,   description: 'Well-known 위험 포트(예: Telnet, FTP)가 허용된 정책을 탐지합니다.' },
  { value: 'over_permissive',      label: '과허용 정책 분석',     icon: Expand,        description: '출발지·목적지·서비스 범위가 과도하게 넓게 설정된 정책을 탐지합니다.' },
]

const ANALYSIS_TYPE_LABELS: Record<string, string> = Object.fromEntries(ANALYSIS_TYPES.map((t) => [t.value, t.label]))

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  pending:     { label: '대기중', cls: 'bg-gray-100 text-gray-600' },
  in_progress: { label: '분석중', cls: 'bg-blue-50 text-blue-600' },
  success:     { label: '완료',   cls: 'bg-emerald-50 text-emerald-600' },
  failure:     { label: '실패',   cls: 'bg-red-50 text-red-600' },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' }
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>
}

function PolicyMultiSelect({ deviceId, value, onChange, placeholder }: {
  deviceId: number | null; value: number[]; onChange: (ids: number[]) => void; placeholder?: string
}) {
  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['policies-raw', deviceId],
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

function CreateAnalysisDialog({ open, onClose, initialDeviceId }: { open: boolean; onClose: () => void; initialDeviceId?: number | null }) {
  const queryClient = useQueryClient()
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [analysisType, setAnalysisType] = useState('redundancy')
  const [days, setDays] = useState('90')
  const [targetPolicyIds, setTargetPolicyIds] = useState<number[]>([])
  const [referencePolicyId, setReferencePolicyId] = useState<number | null>(null)
  const [moveToEnd, setMoveToEnd] = useState(false)
  const [moveDirection, setMoveDirection] = useState('below')

  useEffect(() => {
    if (!open) return
    setDeviceId(initialDeviceId ?? null); setAnalysisType('redundancy'); setDays('90')
    setTargetPolicyIds([]); setReferencePolicyId(null); setMoveToEnd(false); setMoveDirection('below')
  }, [open, initialDeviceId])

  const startMutation = useMutation({
    mutationFn: () => {
      if (!deviceId) throw new Error('장비를 선택하세요.')
      if (analysisType === 'impact' && targetPolicyIds.length === 0) throw new Error('이동할 정책을 선택하세요.')
      if (analysisType === 'impact' && !moveToEnd && !referencePolicyId) throw new Error('기준 정책을 선택하거나 "맨 아래로 이동"을 선택하세요.')
      const p: StartAnalysisParams = {
        days: analysisType === 'unused' ? Number(days) : undefined,
        targetPolicyIds: targetPolicyIds.length > 0 ? targetPolicyIds : undefined,
        referencePolicyId: analysisType === 'impact' && !moveToEnd && referencePolicyId ? referencePolicyId : undefined,
        moveDirection: analysisType === 'impact' ? moveDirection : undefined,
      }
      return startAnalysis(deviceId, analysisType, p)
    },
    onSuccess: () => {
      toast.success('분석이 시작되었습니다. 목록에서 진행 상황을 확인하세요.')
      queryClient.invalidateQueries({ queryKey: ['analysis-tasks'] })
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const needsPolicySelect = ['impact', 'risky_ports', 'over_permissive'].includes(analysisType)
  const needsMoveTarget = analysisType === 'impact'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl bg-ds-surface-container-lowest max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">새 분석 실행</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">장비 *</label>
            <DeviceSelectorSingle value={deviceId} onChange={setDeviceId} />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">분석 유형</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {ANALYSIS_TYPES.map((t) => {
                const Icon = t.icon
                const selected = analysisType === t.value
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => { setAnalysisType(t.value); setTargetPolicyIds([]); setReferencePolicyId(null); setMoveToEnd(false) }}
                    className={`relative text-left p-3.5 rounded-xl border transition-all ${
                      selected
                        ? 'border-ds-primary bg-ds-primary/5 shadow-sm'
                        : 'border-ds-outline-variant/30 hover:border-ds-primary/40 hover:bg-ds-surface-container-low'
                    }`}
                  >
                    {selected && (
                      <span className="absolute top-2.5 right-2.5 w-4 h-4 rounded-full bg-ds-primary flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                    <Icon className={`w-4 h-4 mb-2 ${selected ? 'text-ds-primary' : 'text-ds-on-surface-variant'}`} />
                    <p className={`text-[13px] font-semibold leading-tight mb-1 ${selected ? 'text-ds-primary' : 'text-ds-on-surface'}`}>{t.label}</p>
                    <p className="text-[11px] text-ds-on-surface-variant/70 leading-snug">{t.description}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {analysisType === 'unused' && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">미사용 기준 (일)</label>
              <input
                type="number" value={days} onChange={(e) => setDays(e.target.value)} min="1"
                className="w-32 h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary"
              />
            </div>
          )}

          {needsPolicySelect && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">
                {analysisType === 'impact' ? '이동할 정책 *' : '분석 대상 정책 (미선택 시 전체)'}
              </label>
              {analysisType === 'impact' ? (
                <PolicyGridPicker
                  mode="multi" deviceId={deviceId} value={targetPolicyIds} onChange={setTargetPolicyIds}
                  placeholder="이동할 정책을 선택하세요…"
                />
              ) : (
                <PolicyMultiSelect
                  deviceId={deviceId} value={targetPolicyIds} onChange={setTargetPolicyIds}
                  placeholder="전체 정책 분석"
                />
              )}
            </div>
          )}

          {needsMoveTarget && (
            <div className="space-y-3 max-w-md">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">기준 정책 *</label>
                <PolicyGridPicker
                  mode="single" deviceId={moveToEnd ? null : deviceId} value={referencePolicyId} onChange={setReferencePolicyId}
                  placeholder="기준 정책을 선택하세요…"
                />
                <label className="flex items-center gap-2 text-[12px] text-ds-on-surface-variant cursor-pointer pt-0.5">
                  <Checkbox checked={moveToEnd} onCheckedChange={(v) => setMoveToEnd(!!v)} />
                  맨 아래로 이동
                </label>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">이동 방향</label>
                <ShadSelect value={moveDirection} onValueChange={setMoveDirection} disabled={moveToEnd}>
                  <SelectTrigger className="bg-ds-surface-container-low border-ds-outline-variant/30 text-sm">
                    <SelectValue placeholder="이동 방향 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="above">기준 정책 위로</SelectItem>
                    <SelectItem value="below">기준 정책 아래로</SelectItem>
                  </SelectContent>
                </ShadSelect>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-ds-outline-variant/10">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
          <button
            type="button"
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
          >
            {startMutation.isPending ? '실행 중…' : '실행'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const PAGE_SIZE = 20

export function AnalysisListPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)
  const [prefillDeviceId, setPrefillDeviceId] = useState<number | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const deviceId = (location.state as { openCreateWithDeviceId?: number } | null)?.openCreateWithDeviceId
    if (deviceId) {
      setPrefillDeviceId(deviceId)
      setCreateOpen(true)
      navigate(location.pathname, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(id)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [search, typeFilter, statusFilter])

  const { data, isLoading } = useQuery({
    queryKey: ['analysis-tasks', search, typeFilter, statusFilter, page],
    queryFn: () => listAnalysisTasks({
      search: search || undefined,
      analysisType: typeFilter === 'all' ? undefined : typeFilter,
      status: statusFilter === 'all' ? undefined : statusFilter,
      page, pageSize: PAGE_SIZE,
    }),
    staleTime: 5_000,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">정책 분석</h1>
          <p className="text-[12px] text-ds-on-surface-variant mt-0.5">장비별 정책 분석 작업을 실행하고 이력을 관리합니다.</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold btn-primary-gradient text-ds-on-tertiary rounded-lg shadow-sm hover:opacity-90 transition-all"
        >
          <Plus className="w-4 h-4" />
          새 분석 실행
        </button>
      </div>

      {/* 필터 바 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-3 py-2 flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-ds-on-surface-variant shrink-0" />
          <input
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="장비명 검색…"
            className="flex-1 text-[13px] bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/50"
          />
        </div>
        <ShadSelect value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44 bg-white border-ds-outline-variant/30 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 유형</SelectItem>
            {ANALYSIS_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </ShadSelect>
        <ShadSelect value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 bg-white border-ds-outline-variant/30 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            <SelectItem value="pending">대기중</SelectItem>
            <SelectItem value="in_progress">분석중</SelectItem>
            <SelectItem value="success">완료</SelectItem>
            <SelectItem value="failure">실패</SelectItem>
          </SelectContent>
        </ShadSelect>
      </div>

      {/* 목록 */}
      <div className="card rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-[13px] text-ds-on-surface-variant">로딩 중…</div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-ds-on-surface-variant">실행된 분석이 없습니다.</div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-ds-outline-variant/20">
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs w-16">#</th>
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs">장비</th>
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs">분석유형</th>
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs w-24">상태</th>
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs w-40">생성일</th>
                <th className="text-left py-2 px-4 font-medium text-ds-on-surface-variant text-xs w-40">완료일</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t: AnalysisTaskListItem) => (
                <tr
                  key={t.id}
                  onClick={() => navigate(`/analysis/${t.id}`)}
                  className="border-b border-ds-outline-variant/10 hover:bg-black/[0.02] cursor-pointer"
                >
                  <td className="py-2.5 px-4 text-ds-on-surface-variant text-xs">{t.id}</td>
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-ds-on-surface text-[13px]">{t.device_name}</div>
                    <div className="text-[11px] text-ds-on-surface-variant">{t.device_ip}</div>
                  </td>
                  <td className="py-2.5 px-4 text-[13px] text-ds-on-surface">{ANALYSIS_TYPE_LABELS[t.task_type] ?? t.task_type}</td>
                  <td className="py-2.5 px-4"><StatusBadge status={t.task_status} /></td>
                  <td className="py-2.5 px-4 text-ds-on-surface-variant text-xs">{formatDate(t.created_at)}</td>
                  <td className="py-2.5 px-4 text-ds-on-surface-variant text-xs">{t.completed_at ? formatDate(t.completed_at) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 페이지네이션 */}
      {total > 0 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-1.5 rounded-lg border border-ds-outline-variant/30 text-ds-on-surface-variant hover:bg-ds-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[12px] text-ds-on-surface-variant tabular-nums">{page} / {totalPages} 페이지 (총 {total.toLocaleString()}건)</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="p-1.5 rounded-lg border border-ds-outline-variant/30 text-ds-on-surface-variant hover:bg-ds-surface-container-low disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      <CreateAnalysisDialog open={createOpen} onClose={() => setCreateOpen(false)} initialDeviceId={prefillDeviceId} />
    </div>
  )
}
