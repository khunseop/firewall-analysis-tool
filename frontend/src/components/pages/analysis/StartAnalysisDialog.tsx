import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { DeviceSelectorSingle } from '@/components/shared/DeviceSelector'
import { GroupedDeviceMultiSelect } from '@/components/shared/GroupedDeviceMultiSelect'
import { BulkResultDialog } from '@/components/pages/devices/BulkResultDialog'
import { useBulkRun } from '@/components/pages/devices/useBulkRun'
import { listDevices } from '@/api/devices'
import { startAnalysis } from '@/api/analysis'
import { queryKeys } from '@/api/queryKeys'
import { QUICK_MODULES } from '../analysis-modules'
import type { QuickAnalysisModule } from '../analysis-modules/types'

export interface StartAnalysisInitial { type?: string; deviceId?: number | null; values?: Record<string, unknown> }

const DB_MODULES = QUICK_MODULES.filter((m) => !m.liveConnect)
const LIVE_MODULES = QUICK_MODULES.filter((m) => m.liveConnect)

function ModuleChoice({ module, selected, onSelect }: { module: QuickAnalysisModule; selected: boolean; onSelect: () => void }) {
  const Icon = module.icon
  return (
    <button
      type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={`text-left p-3 rounded-xl border transition-colors ${
        selected ? 'border-ds-primary bg-ds-primary/5' : 'border-ds-outline-variant/30 hover:border-ds-primary/40 hover:bg-ds-surface-container-low'
      }`}
    >
      <Icon className={`w-4 h-4 mb-1.5 ${selected ? 'text-ds-primary' : 'text-ds-on-surface-variant'}`} aria-hidden="true" />
      <p className={`text-13 font-semibold leading-tight mb-1 ${selected ? 'text-ds-primary' : 'text-ds-on-surface'}`}>{module.label}</p>
      <p className="text-11 text-ds-on-surface-variant leading-snug">{module.description}</p>
    </button>
  )
}

/**
 * 분석 실행 — 유형을 "DB 기준(읽기 전용)"과 "장비 접속(라이브)"으로 나눠 보여주고,
 * 장비별 입력이 없는 유형은 여러 장비에 한 번에 실행할 수 있다.
 * 같은 장비에 이미 분석이 돌고 있으면 백엔드가 새 요청을 조용히 버리므로, 그런 장비는 선택할 수 없게 막는다.
 */
export function StartAnalysisDialog({
  open, onClose, initial, busyDeviceIds,
}: {
  open: boolean
  onClose: () => void
  initial?: StartAnalysisInitial | null
  busyDeviceIds: Set<number>
}) {
  const queryClient = useQueryClient()
  const { bulkState, runBulk, closeBulk } = useBulkRun()
  const { data: devices = [] } = useQuery({ queryKey: queryKeys.devices, queryFn: listDevices, staleTime: 5 * 60_000 })

  const [type, setType] = useState(QUICK_MODULES[0].type)
  const [deviceIds, setDeviceIds] = useState<number[]>([])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [liveAck, setLiveAck] = useState(false)
  const setValue = (key: string, value: unknown) => setValues((prev) => ({ ...prev, [key]: value }))

  // 다이얼로그가 열릴 때 입력값 초기화 (렌더 중 상태 조정 패턴 — effect 내 동기 setState 회피)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setType(initial?.type && QUICK_MODULES.some((m) => m.type === initial.type) ? initial.type : QUICK_MODULES[0].type)
      setDeviceIds(initial?.deviceId ? [initial.deviceId] : [])
      setValues(initial?.values ?? {})
      setLiveAck(false)
    }
  }

  const module = QUICK_MODULES.find((m) => m.type === type) ?? QUICK_MODULES[0]
  const multi = !!module.multiDevice
  const selectableDevices = devices.filter((d) => !busyDeviceIds.has(d.id))
  const busyDevices = devices.filter((d) => busyDeviceIds.has(d.id))
  const selectedBusy = deviceIds.filter((id) => busyDeviceIds.has(id))

  const chooseType = (next: QuickAnalysisModule) => {
    setType(next.type)
    setValues({})
    setLiveAck(false)
    if (!next.multiDevice) setDeviceIds((ids) => ids.slice(0, 1))
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.analysisTasks })
    // 작업 생성은 백그라운드라 응답 직후에는 목록에 아직 없을 수 있다
    setTimeout(() => queryClient.invalidateQueries({ queryKey: queryKeys.analysisTasks }), 1500)
  }

  const singleMutation = useMutation({
    mutationFn: () => {
      const ctx = { deviceId: deviceIds[0] ?? null, values, setValue }
      const validationError = module.validate?.(ctx)
      if (validationError) throw new Error(validationError)
      return startAnalysis(deviceIds[0], module.type, module.buildParams(ctx))
    },
    onSuccess: () => {
      toast.success('분석을 요청했습니다. 진행 상황은 이력에서 확인할 수 있습니다.')
      invalidate()
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const submit = () => {
    if (deviceIds.length <= 1) { singleMutation.mutate(); return }
    const ctx = { deviceId: deviceIds[0] ?? null, values, setValue }
    const validationError = module.validate?.(ctx)
    if (validationError) { toast.error(validationError); return }
    const params = module.buildParams(ctx)
    const targets = devices.filter((d) => deviceIds.includes(d.id))
    onClose()
    void runBulk('분석 실행 요청 결과', targets, async (d) => {
      await startAnalysis(d.id, module.type, params)
      return '요청됨 — 진행 상황은 이력에서 확인하세요.'
    }, {
      onSettled: invalidate,
      onAllOk: () => toast.success(`장비 ${targets.length}대에 ${module.label}을 요청했습니다.`),
    })
  }

  const canRun = deviceIds.length > 0 && selectedBusy.length === 0 && (!module.liveConnect || liveAck) && !singleMutation.isPending

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl bg-ds-surface-container-lowest max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-headline text-ds-on-surface">분석 실행</DialogTitle>
            <DialogDescription className="text-13 text-ds-on-surface-variant">
              유형과 장비를 고르면 분석이 백그라운드로 실행되고, 결과는 이력에 시점별로 남습니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-1">
            <div role="radiogroup" aria-label="분석 유형" className="space-y-3">
              <div>
                <p className="text-11 font-semibold text-ds-on-surface-variant mb-1.5">DB 기준 분석 · 수집된 데이터만 사용 (장비에 접속하지 않음)</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                  {DB_MODULES.map((m) => <ModuleChoice key={m.type} module={m} selected={type === m.type} onSelect={() => chooseType(m)} />)}
                </div>
              </div>
              <div>
                <p className="text-11 font-semibold text-amber-900 mb-1.5">장비 접속 분석 · 실행 중 장비에 직접 접속</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                  {LIVE_MODULES.map((m) => <ModuleChoice key={m.type} module={m} selected={type === m.type} onSelect={() => chooseType(m)} />)}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <p id="analysis-device-label" className="text-11 font-semibold text-ds-on-surface-variant">
                장비 {multi ? '(여러 대 선택 가능)' : ''} <span aria-hidden="true">*</span>
              </p>
              {multi ? (
                <GroupedDeviceMultiSelect devices={selectableDevices} value={deviceIds} onChange={setDeviceIds} />
              ) : (
                <div aria-labelledby="analysis-device-label">
                  <DeviceSelectorSingle value={deviceIds[0] ?? null} onChange={(id) => setDeviceIds(id ? [id] : [])} />
                </div>
              )}
              {!multi && <p className="text-11 text-ds-on-surface-variant">이 분석은 정책 등 장비별 입력이 필요해 장비를 한 대씩 실행합니다.</p>}
              {selectedBusy.length > 0 && (
                <p role="alert" className="text-11 text-amber-900">
                  선택한 장비에 이미 분석이 진행 중이라 지금은 실행할 수 없습니다. 끝난 뒤 다시 시도하세요.
                </p>
              )}
              {multi && busyDevices.length > 0 && (
                <p className="text-11 text-ds-on-surface-variant">
                  분석이 진행 중이라 선택할 수 없는 장비: <span className="font-mono">{busyDevices.map((d) => d.name).join(', ')}</span>
                </p>
              )}
            </div>

            {module.renderParams?.({ deviceId: deviceIds[0] ?? null, values, setValue })}

            {module.liveConnect && (
              <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-2">
                <p className="flex items-center gap-1.5 text-13 font-semibold text-amber-900">
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" />선택한 장비에 직접 접속합니다
                </p>
                <p className="text-11 text-amber-900 leading-relaxed">
                  이 분석은 실행 중에 장비에 접속해 정책 사용이력을 수집합니다(읽기 전용, 장비 설정은 바꾸지 않음).
                  장비 수가 많거나 정책이 많으면 시간이 걸릴 수 있습니다.
                </p>
                <label className="flex items-center gap-2 text-xs font-semibold text-amber-900 cursor-pointer">
                  <Checkbox checked={liveAck} onCheckedChange={(v) => setLiveAck(!!v)} />
                  장비에 접속해 수집하는 것을 확인했습니다
                </label>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 flex items-center justify-between gap-2 pt-3 pb-1 border-t border-ds-outline-variant/10 bg-ds-surface-container-lowest">
            <span className="text-11 text-ds-on-surface-variant tabular-nums">
              {module.label} · 장비 {deviceIds.length}대
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
              <Button type="button" variant="gradient" size="auto" onClick={submit} disabled={!canRun} className="px-5 py-2 text-sm font-bold rounded-md">
                {singleMutation.isPending ? '요청 중…' : deviceIds.length > 1 ? `${deviceIds.length}대에 실행` : '실행'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <BulkResultDialog state={bulkState} onClose={closeBulk} />
    </>
  )
}
