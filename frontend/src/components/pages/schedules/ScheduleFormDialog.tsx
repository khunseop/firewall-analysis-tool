import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { GroupedDeviceMultiSelect } from '@/components/shared/GroupedDeviceMultiSelect'
import { listDevices } from '@/api/devices'
import { queryKeys } from '@/api/queryKeys'
import { cn } from '@/lib/utils'
import { DAYS, DAY_PRESETS, previewNextRun } from './scheduleModel'

export interface ScheduleFormData {
  name: string; enabled: boolean; days_of_week: number[]
  time: string; device_ids: number[]; description: string
}

const DEFAULT_FORM: ScheduleFormData = {
  name: '', enabled: true, days_of_week: [], time: '02:00', device_ids: [], description: '',
}

const INPUT = 'w-full h-9 px-3 text-sm bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40 focus:border-ds-tertiary aria-[invalid=true]:border-ds-error'
const LABEL = 'text-xs font-semibold text-ds-primary'

type Errors = Partial<Record<'name' | 'days' | 'time' | 'devices', string>>

function validate(form: ScheduleFormData): Errors {
  const errors: Errors = {}
  if (!form.name.trim()) errors.name = '스케줄명을 입력하세요.'
  if (form.days_of_week.length === 0) errors.days = '실행할 요일을 하나 이상 선택하세요.'
  if (!/^\d{1,2}:\d{2}$/.test(form.time)) errors.time = '실행 시각을 입력하세요.'
  if (form.device_ids.length === 0) errors.devices = '동기화할 장비를 하나 이상 선택하세요.'
  return errors
}

export function ScheduleFormDialog({ open, onClose, initial, isEdit, onSubmit, isPending }: {
  open: boolean; onClose: () => void; initial?: ScheduleFormData; isEdit: boolean
  onSubmit: (data: ScheduleFormData) => void; isPending: boolean
}) {
  const uid = useId()
  const [form, setForm] = useState<ScheduleFormData>(initial ?? DEFAULT_FORM)
  const [submitted, setSubmitted] = useState(false)
  const { data: devices = [] } = useQuery({ queryKey: queryKeys.devices, queryFn: listDevices })
  const set = (key: keyof ScheduleFormData, val: unknown) => setForm((p) => ({ ...p, [key]: val }))

  // 저장을 한 번 시도한 뒤부터 오류를 보여준다 — 입력 중에 빨간 글씨로 방해하지 않는다.
  const errors = submitted ? validate(form) : {}
  const nextRun = form.enabled ? previewNextRun(form.days_of_week, form.time) : null

  const toggleDay = (day: number) => {
    set('days_of_week', form.days_of_week.includes(day)
      ? form.days_of_week.filter((d) => d !== day)
      : [...form.days_of_week, day].sort((a, b) => a - b))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (Object.keys(validate(form)).length > 0) return
    onSubmit({ ...form, name: form.name.trim() })
  }

  const isPreset = (days: number[]) => form.days_of_week.length === days.length && days.every((d) => form.days_of_week.includes(d))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">{isEdit ? '스케줄 수정' : '스케줄 추가'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-name`} className={LABEL}>스케줄명 *</label>
            <input
              id={`${uid}-name`} value={form.name} onChange={(e) => set('name', e.target.value)}
              aria-invalid={!!errors.name} aria-describedby={errors.name ? `${uid}-name-err` : undefined}
              className={INPUT}
            />
            {errors.name && <p id={`${uid}-name-err`} className="text-xs text-ds-error">{errors.name}</p>}
          </div>

          <fieldset className="space-y-1.5">
            <legend className={LABEL}>실행 요일 *</legend>
            <div className="flex flex-wrap items-center gap-1.5">
              {DAYS.map((label, idx) => {
                const on = form.days_of_week.includes(idx)
                return (
                  <button
                    key={idx} type="button" aria-pressed={on} onClick={() => toggleDay(idx)}
                    className={cn(
                      'w-8 h-8 rounded-md text-sm font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40',
                      on
                        ? 'bg-ds-tertiary text-ds-on-tertiary border-ds-tertiary'
                        : 'bg-ds-surface-container-low text-ds-on-surface-variant border-ds-outline-variant/30 hover:bg-ds-surface-container-high',
                    )}
                  >
                    {label}
                  </button>
                )
              })}
              <span className="mx-1 h-5 w-px bg-ds-outline-variant/30" aria-hidden="true" />
              {DAY_PRESETS.map((p) => (
                <button
                  key={p.label} type="button" onClick={() => set('days_of_week', p.days)} aria-pressed={isPreset(p.days)}
                  className="px-2 h-7 rounded-full text-xs font-medium border border-ds-outline-variant/30 text-ds-on-surface-variant hover:bg-ds-surface-container-low aria-[pressed=true]:border-ds-tertiary aria-[pressed=true]:text-ds-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
                >
                  {p.label}
                </button>
              ))}
            </div>
            {errors.days && <p className="text-xs text-ds-error">{errors.days}</p>}
          </fieldset>

          <div className="space-y-1.5">
            <label htmlFor={`${uid}-time`} className={LABEL}>실행 시각 * <span className="font-normal text-ds-on-surface-variant">(서울 시간, 24시간제)</span></label>
            <input
              id={`${uid}-time`} type="time" value={form.time} onChange={(e) => set('time', e.target.value)}
              aria-invalid={!!errors.time} className={`${INPUT} w-32`}
            />
            {errors.time && <p className="text-xs text-ds-error">{errors.time}</p>}
          </div>

          <div className="space-y-1.5">
            <span id={`${uid}-devices`} className={LABEL}>장비 *</span>
            <div aria-labelledby={`${uid}-devices`} role="group">
              <GroupedDeviceMultiSelect devices={devices} value={form.device_ids} onChange={(ids) => set('device_ids', ids)} />
            </div>
            <p className="text-xs text-ds-on-surface-variant">선택한 순서대로 한 대씩 차례로 동기화합니다. 이미 다른 동기화가 진행 중인 장비도 같은 방식으로 처리됩니다.</p>
            {errors.devices && <p className="text-xs text-ds-error">{errors.devices}</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${uid}-desc`} className={LABEL}>설명</label>
            <input id={`${uid}-desc`} value={form.description} onChange={(e) => set('description', e.target.value)} className={INPUT} />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer text-ds-on-surface-variant">
            <Checkbox checked={form.enabled} onCheckedChange={(v) => set('enabled', !!v)} />
            활성화
          </label>

          <p role="status" className="rounded-md bg-ds-surface-container-low px-3 py-2 text-xs text-ds-on-surface-variant">
            {!form.enabled
              ? '비활성 스케줄은 예약 시각이 되어도 실행되지 않습니다.'
              : nextRun
                ? <>저장하면 <strong className="font-semibold text-ds-on-surface">{nextRun}</strong>에 처음 실행됩니다.</>
                : '요일과 시각을 고르면 첫 실행 시각을 알려 드립니다.'}
          </p>

          <DialogFooter>
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
            <Button type="submit" variant="gradient" size="auto" disabled={isPending} className="px-5 py-2 text-sm font-bold rounded-md">
              {isPending ? '저장 중…' : '저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
