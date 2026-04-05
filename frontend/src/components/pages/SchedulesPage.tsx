import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DeviceSelect } from '@/components/shared/DeviceSelect'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { listDevices } from '@/api/devices'
import {
  listSchedules, createSchedule, updateSchedule, deleteSchedule,
  type SyncSchedule, type SyncScheduleCreate,
} from '@/api/schedules'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

const DAYS = ['일', '월', '화', '수', '목', '금', '토']

interface ScheduleFormData {
  name: string; enabled: boolean; days_of_week: number[]
  time: string; device_ids: number[]; description: string
}

const DEFAULT_FORM: ScheduleFormData = {
  name: '', enabled: true, days_of_week: [], time: '02:00', device_ids: [], description: '',
}

function ScheduleFormDialog({ open, onClose, initial, onSubmit, isPending }: {
  open: boolean; onClose: () => void; initial?: ScheduleFormData
  onSubmit: (data: ScheduleFormData) => void; isPending: boolean
}) {
  const [form, setForm] = useState<ScheduleFormData>(initial ?? DEFAULT_FORM)
  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const set = (key: keyof ScheduleFormData, val: unknown) => setForm((p) => ({ ...p, [key]: val }))

  const toggleDay = (day: number) => {
    set('days_of_week', form.days_of_week.includes(day)
      ? form.days_of_week.filter((d) => d !== day)
      : [...form.days_of_week, day].sort())
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (form.days_of_week.length === 0) { toast.warning('요일을 선택하세요.'); return }
    if (form.device_ids.length === 0) { toast.warning('장비를 선택하세요.'); return }
    onSubmit(form)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">
            {initial?.name ? '스케줄 수정' : '스케줄 추가'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">스케줄명 *</label>
            <input
              value={form.name} onChange={(e) => set('name', e.target.value)} required
              className="w-full h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">실행 요일 *</label>
            <div className="flex gap-1.5">
              {DAYS.map((label, idx) => (
                <button
                  key={idx} type="button" onClick={() => toggleDay(idx)}
                  className={cn(
                    'w-8 h-8 rounded-md text-sm font-semibold border transition-colors',
                    form.days_of_week.includes(idx)
                      ? 'bg-ds-tertiary text-ds-on-tertiary border-ds-tertiary'
                      : 'bg-ds-surface-container-low text-ds-on-surface-variant border-ds-outline-variant/30 hover:bg-ds-surface-container-high'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">실행 시각 *</label>
            <input
              type="time" value={form.time} onChange={(e) => set('time', e.target.value)} required
              className="w-32 h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">장비 *</label>
            <DeviceSelect devices={devices} value={form.device_ids} onChange={(ids) => set('device_ids', ids)} isMulti />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">설명</label>
            <input
              value={form.description} onChange={(e) => set('description', e.target.value)}
              className="w-full h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary"
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-ds-on-surface-variant">
            <Checkbox checked={form.enabled} onCheckedChange={(v) => set('enabled', !!v)} />
            활성화
          </label>
          <DialogFooter>
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
            <button type="submit" disabled={isPending} className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50">
              {isPending ? '저장 중…' : '저장'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function formatDays(days: number[]): string {
  if (!days || days.length === 0) return '-'
  if (days.length === 7) return '매일'
  return days.map((d) => DAYS[d]).join(', ')
}

export function SchedulesPage() {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<SyncSchedule | null>(null)
  const { confirm, ConfirmDialogElement } = useConfirm()

  const { data: schedules = [], isLoading } = useQuery({ queryKey: ['schedules'], queryFn: listSchedules })

  const createMutation = useMutation({
    mutationFn: (data: SyncScheduleCreate) => createSchedule(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); setFormOpen(false); toast.success('스케줄이 추가되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<SyncScheduleCreate> }) => updateSchedule(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); setFormOpen(false); setEditTarget(null); toast.success('스케줄이 수정되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSchedule(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); toast.success('스케줄이 삭제되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSubmit = (data: ScheduleFormData) => {
    if (editTarget) updateMutation.mutate({ id: editTarget.id, data })
    else createMutation.mutate(data as SyncScheduleCreate)
  }

  const handleDelete = async (s: SyncSchedule) => {
    const ok = await confirm({ title: '스케줄 삭제', description: `'${s.name}'을(를) 삭제하시겠습니까?`, variant: 'destructive', confirmLabel: '삭제' })
    if (ok) deleteMutation.mutate(s.id)
  }

  return (
    <div className="space-y-6">
      {ConfirmDialogElement}

      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ds-on-surface font-headline">동기화 스케줄</h1>
          <p className="text-ds-on-surface-variant text-sm mt-1">주기적인 자동 동기화 스케줄을 관리합니다.</p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setFormOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-lg ambient-shadow-sm hover:opacity-90 transition-all"
        >
          <Plus className="w-4 h-4" />
          스케줄 추가
        </button>
      </div>

      {/* Schedule list */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>
        ) : schedules.length === 0 ? (
          <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border py-16 text-center">
            <p className="text-sm text-ds-on-surface-variant">등록된 스케줄이 없습니다.</p>
          </div>
        ) : (
          schedules.map((s) => (
            <div key={s.id} className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border p-5 flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-ds-on-surface font-headline">{s.name}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${s.enabled ? 'bg-green-100 text-green-700' : 'bg-ds-surface-container text-ds-on-surface-variant'}`}>
                    {s.enabled ? '활성' : '비활성'}
                  </span>
                </div>
                <p className="text-xs text-ds-on-surface-variant">
                  {formatDays(s.days_of_week)} · {s.time} · 장비 {s.device_ids.length}개
                </p>
                {s.last_run_at && (
                  <p className="text-xs text-ds-on-surface-variant">
                    마지막 실행: {formatDate(s.last_run_at)}
                    {s.last_run_status && (
                      <span className={cn('ml-1 font-medium', s.last_run_status === 'success' ? 'text-green-600' : 'text-ds-error')}>
                        ({s.last_run_status})
                      </span>
                    )}
                  </p>
                )}
                {s.description && <p className="text-xs text-ds-on-surface-variant">{s.description}</p>}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setEditTarget(s); setFormOpen(true) }}
                  className="p-2 text-ds-on-surface-variant hover:text-ds-on-surface hover:bg-ds-surface-container-low rounded-lg transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(s)}
                  className="p-2 text-ds-on-surface-variant hover:text-ds-error hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <ScheduleFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null) }}
        initial={editTarget ? {
          name: editTarget.name, enabled: editTarget.enabled,
          days_of_week: editTarget.days_of_week, time: editTarget.time,
          device_ids: editTarget.device_ids, description: editTarget.description ?? '',
        } : undefined}
        onSubmit={handleSubmit}
        isPending={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  )
}
