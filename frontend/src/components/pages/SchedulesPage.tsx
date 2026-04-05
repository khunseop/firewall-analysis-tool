import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
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
  name: string
  enabled: boolean
  days_of_week: number[]
  time: string
  device_ids: number[]
  description: string
}

const DEFAULT_FORM: ScheduleFormData = {
  name: '', enabled: true, days_of_week: [], time: '02:00', device_ids: [], description: '',
}

function ScheduleFormDialog({
  open, onClose, initial, onSubmit, isPending,
}: {
  open: boolean
  onClose: () => void
  initial?: ScheduleFormData
  onSubmit: (data: ScheduleFormData) => void
  isPending: boolean
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.name ? '스케줄 수정' : '스케줄 추가'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label>스케줄명 *</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>실행 요일 *</Label>
            <div className="flex gap-1.5">
              {DAYS.map((label, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleDay(idx)}
                  className={cn(
                    'w-8 h-8 rounded text-sm font-medium border transition-colors',
                    form.days_of_week.includes(idx)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-foreground border-border hover:bg-accent'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>실행 시각 *</Label>
            <Input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} required className="w-32" />
          </div>
          <div className="space-y-1">
            <Label>장비 *</Label>
            <DeviceSelect devices={devices} value={form.device_ids} onChange={(ids) => set('device_ids', ids)} isMulti />
          </div>
          <div className="space-y-1">
            <Label>설명</Label>
            <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={form.enabled} onCheckedChange={(v) => set('enabled', !!v)} />
            활성화
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>취소</Button>
            <Button type="submit" disabled={isPending}>{isPending ? '저장 중...' : '저장'}</Button>
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
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, data })
    } else {
      createMutation.mutate(data as SyncScheduleCreate)
    }
  }

  const handleDelete = async (s: SyncSchedule) => {
    const ok = await confirm({ title: '스케줄 삭제', description: `'${s.name}'을(를) 삭제하시겠습니까?`, variant: 'destructive', confirmLabel: '삭제' })
    if (ok) deleteMutation.mutate(s.id)
  }

  return (
    <div className="space-y-4">
      {ConfirmDialogElement}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">동기화 스케줄</CardTitle>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => { setEditTarget(null); setFormOpen(true) }}>
            <Plus className="h-3 w-3" /> 스케줄 추가
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">로딩 중...</p>
          ) : schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">등록된 스케줄이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {schedules.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{s.name}</span>
                      <Badge variant={s.enabled ? 'default' : 'secondary'} className="text-xs">
                        {s.enabled ? '활성' : '비활성'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDays(s.days_of_week)} {s.time} · 장비 {s.device_ids.length}개
                    </p>
                    {s.last_run_at && (
                      <p className="text-xs text-muted-foreground">
                        마지막 실행: {formatDate(s.last_run_at)}
                        {s.last_run_status && (
                          <span className={cn('ml-1', s.last_run_status === 'success' ? 'text-green-600' : 'text-red-600')}>
                            ({s.last_run_status})
                          </span>
                        )}
                      </p>
                    )}
                    {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost" size="sm" className="h-7 w-7 p-0"
                      onClick={() => { setEditTarget(s); setFormOpen(true) }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(s)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
