import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Copy, Play, Loader2 } from 'lucide-react'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { listDevices } from '@/api/devices'
import {
  listSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow,
  type SyncSchedule, type SyncScheduleCreate,
} from '@/api/schedules'
import { formatDate, cn } from '@/lib/utils'
import { errorMessage } from '@/lib/errorMessage'
import { queryKeys } from '@/api/queryKeys'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { ScheduleFormDialog, type ScheduleFormData } from './schedules/ScheduleFormDialog'
import { RUN_STATUS, formatDays, formatServerTime, sortSchedules } from './schedules/scheduleModel'

const ICON_BTN = 'p-2 rounded-lg text-ds-on-surface-variant hover:bg-ds-surface-container-high transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40 disabled:opacity-40'

function toForm(s: SyncSchedule, copy = false): ScheduleFormData {
  return {
    name: copy ? `${s.name} (복사)` : s.name, enabled: s.enabled,
    days_of_week: s.days_of_week, time: s.time,
    device_ids: s.device_ids, description: s.description ?? '',
  }
}

function ActiveSwitch({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40 disabled:opacity-50',
        checked ? 'bg-ds-tertiary' : 'bg-ds-outline-variant',
      )}
    >
      <span className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
    </button>
  )
}

export function SchedulesPage() {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<SyncSchedule | null>(null)
  const [copySource, setCopySource] = useState<SyncSchedule | null>(null)
  const { confirm, ConfirmDialogElement } = useConfirm()

  const { data: schedules = [], isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.schedules,
    queryFn: listSchedules,
    // 실행 중인 스케줄이 있으면 끝날 때까지 3초마다 상태를 다시 읽는다.
    refetchInterval: (q) => (q.state.data?.some((s) => s.is_running) ? 3000 : false),
  })
  const { data: devices = [] } = useQuery({ queryKey: queryKeys.devices, queryFn: listDevices })
  const deviceName = useMemo(() => new Map(devices.map((d) => [d.id, d.name])), [devices])
  const sorted = useMemo(() => sortSchedules(schedules), [schedules])

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.schedules })
  const closeForm = () => { setFormOpen(false); setEditTarget(null); setCopySource(null) }

  const createMutation = useMutation({
    mutationFn: (data: SyncScheduleCreate) => createSchedule(data),
    onSuccess: () => { refresh(); closeForm(); toast.success('스케줄이 추가되었습니다.') },
    onError: (e: unknown) => toast.error(errorMessage(e, '스케줄을 추가하지 못했습니다. 잠시 후 다시 시도하세요.')),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SyncScheduleCreate> }) => updateSchedule(id, data),
    onSuccess: () => { refresh(); closeForm(); toast.success('스케줄이 수정되었습니다.') },
    onError: (e: unknown) => toast.error(errorMessage(e, '스케줄을 수정하지 못했습니다. 잠시 후 다시 시도하세요.')),
  })
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => updateSchedule(id, { enabled }),
    onSuccess: (_d, v) => { refresh(); toast.success(v.enabled ? '스케줄을 활성화했습니다.' : '스케줄을 비활성화했습니다. 다시 켜기 전까지 실행되지 않습니다.') },
    onError: (e: unknown) => toast.error(errorMessage(e, '활성 상태를 바꾸지 못했습니다. 잠시 후 다시 시도하세요.')),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSchedule(id),
    onSuccess: () => { refresh(); toast.success('스케줄이 삭제되었습니다.') },
    onError: (e: unknown) => toast.error(errorMessage(e, '스케줄을 삭제하지 못했습니다. 잠시 후 다시 시도하세요.')),
  })
  const runMutation = useMutation({
    mutationFn: (id: number) => runScheduleNow(id),
    onSuccess: () => { refresh(); toast.success('동기화를 시작했습니다. 끝나면 이 목록에 결과가 표시됩니다.') },
    onError: (e: unknown) => { refresh(); toast.error(errorMessage(e, '스케줄을 실행하지 못했습니다. 잠시 후 다시 시도하세요.')) },
  })

  const handleSubmit = (data: ScheduleFormData) => {
    if (editTarget) updateMutation.mutate({ id: editTarget.id, data })
    else createMutation.mutate(data as SyncScheduleCreate)
  }

  const handleDelete = async (s: SyncSchedule) => {
    const ok = await confirm({ title: '스케줄 삭제', description: `'${s.name}' 스케줄을 삭제합니다. 삭제한 스케줄은 되돌릴 수 없고, 실행 기록도 함께 사라집니다.`, variant: 'destructive', confirmLabel: '삭제' })
    if (ok) deleteMutation.mutate(s.id)
  }

  const handleRun = async (s: SyncSchedule) => {
    const names = s.device_ids.map((id) => deviceName.get(id) ?? `장비 ${id}`)
    const ok = await confirm({
      title: '지금 실행',
      description: `'${s.name}'을(를) 지금 실행합니다. 장비 ${names.length}대(${names.join(', ')})를 순서대로 동기화하며, 장비 수에 따라 시간이 걸립니다.`,
      confirmLabel: '지금 실행',
    })
    if (ok) runMutation.mutate(s.id)
  }

  const formInitial = editTarget ? toForm(editTarget) : copySource ? toForm(copySource, true) : undefined

  return (
    <div className="flex flex-col gap-6">
      {ConfirmDialogElement}

      <PageHeader
        title="스케줄"
        description="정해 둔 요일·시각에 장비를 자동으로 동기화합니다. 모든 시각은 서울 시간 기준입니다."
        actions={
          <Button
            variant="gradient"
            size="auto"
            onClick={() => { setEditTarget(null); setCopySource(null); setFormOpen(true) }}
            className="gap-1.5 px-3 py-1.5 text-13 font-semibold rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" />
            스케줄 추가
          </Button>
        }
      />

      <section aria-labelledby="schedules-title" className="card rounded-xl overflow-hidden">
        <div className="px-5 py-3 flex items-center gap-3">
          <h2 id="schedules-title" className="text-13 font-semibold text-ds-on-surface">등록된 스케줄</h2>
          {schedules.length > 0 && <span className="text-11 text-ds-on-surface-variant tabular-nums">{schedules.length}개</span>}
        </div>
        {isLoading ? (
          <div className="py-16 text-center text-13 text-ds-on-surface-variant">로딩 중…</div>
        ) : isError ? (
          <div role="alert" className="py-16 text-center text-13 text-ds-error">
            스케줄 목록을 불러오지 못했습니다.{' '}
            <button type="button" onClick={() => refetch()} className="font-semibold underline">다시 시도</button>
          </div>
        ) : schedules.length === 0 ? (
          <EmptyState title="등록된 스케줄이 없습니다." description="'스케줄 추가'로 요일과 시각, 동기화할 장비를 정하면 그 시각에 자동으로 동기화합니다." />
        ) : (
          <ul className="divide-y divide-ds-outline-variant/8">
            {sorted.map((s) => {
              const status = s.last_run_status ? RUN_STATUS[s.last_run_status] : null
              const failed = (s.last_run_detail ?? []).filter((d) => d.status !== 'success')
              const names = s.device_ids.map((id) => deviceName.get(id) ?? `장비 ${id}`)
              const nextRun = formatServerTime(s.next_run_at)
              return (
                <li key={s.id} className={cn('px-5 py-4 flex items-start justify-between gap-4 transition-colors hover:bg-ds-surface-container-low/20', !s.enabled && 'bg-ds-surface-container-low/30')}>
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-13 font-semibold', s.enabled ? 'text-ds-on-surface' : 'text-ds-on-surface-variant')}>{s.name}</span>
                      {!s.enabled && <span className="text-11 font-semibold text-ds-on-surface-variant">비활성</span>}
                      {s.is_running && (
                        <span role="status" className="inline-flex items-center gap-1 text-11 font-semibold text-ds-tertiary">
                          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />실행 중…
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ds-on-surface-variant">
                      {formatDays(s.days_of_week)} {s.time}
                      <span aria-hidden="true"> · </span>
                      {s.enabled
                        ? nextRun ? <>다음 실행 <span className="font-semibold text-ds-on-surface">{nextRun}</span></> : '다음 실행 시각을 확인할 수 없습니다'
                        : '꺼져 있어 실행되지 않습니다'}
                    </p>
                    <p className="text-xs text-ds-on-surface-variant" title={names.join(', ')}>
                      장비 {names.length}대: {names.slice(0, 3).join(', ')}{names.length > 3 ? ` 외 ${names.length - 3}대` : ''}
                    </p>
                    {s.last_run_at ? (
                      <div className="text-xs text-ds-on-surface-variant">
                        <span>마지막 실행 {formatDate(s.last_run_at)}</span>
                        {status && <span className={cn('ml-2 inline-flex items-center px-1.5 py-0.5 rounded border text-11 font-semibold', status.className)}>{status.label}</span>}
                        {s.last_run_detail && s.last_run_detail.length > 0 && (
                          <span className="ml-2 tabular-nums">성공 {s.last_run_detail.length - failed.length} · 실패 {failed.length}</span>
                        )}
                        {failed.length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer select-none font-medium text-ds-error">실패한 장비 보기</summary>
                            <ul className="mt-1 space-y-0.5 pl-3">
                              {failed.map((d, i) => <li key={i}><span className="font-mono">{d.device_name}</span> — {d.error ?? '원인을 알 수 없습니다.'}</li>)}
                            </ul>
                          </details>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-ds-on-surface-variant">아직 실행된 적이 없습니다.</p>
                    )}
                    {s.description && <p className="text-xs text-ds-on-surface-variant">{s.description}</p>}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <ActiveSwitch
                      checked={s.enabled} label={`${s.name} 활성`} disabled={toggleMutation.isPending}
                      onChange={(enabled) => toggleMutation.mutate({ id: s.id, enabled })}
                    />
                    <button
                      type="button" onClick={() => handleRun(s)} disabled={s.is_running || runMutation.isPending}
                      className="ml-2 inline-flex items-center gap-1 px-2.5 h-8 rounded-lg border border-ds-outline-variant/30 text-xs font-semibold text-ds-on-surface hover:bg-ds-surface-container-low disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
                    >
                      <Play className="w-3 h-3" aria-hidden="true" />지금 실행
                    </button>
                    <button type="button" onClick={() => { setEditTarget(null); setCopySource(s); setFormOpen(true) }} className={ICON_BTN} title="복제" aria-label={`${s.name} 복제`}>
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => { setCopySource(null); setEditTarget(s); setFormOpen(true) }} className={ICON_BTN} title="수정" aria-label={`${s.name} 수정`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => handleDelete(s)} disabled={deleteMutation.isPending} className={`${ICON_BTN} hover:text-ds-error`} title="삭제" aria-label={`${s.name} 삭제`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <ScheduleFormDialog
        key={`${editTarget?.id ?? 'new'}-${copySource?.id ?? ''}`}
        open={formOpen}
        onClose={closeForm}
        isEdit={!!editTarget}
        initial={formInitial}
        onSubmit={handleSubmit}
        isPending={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  )
}
