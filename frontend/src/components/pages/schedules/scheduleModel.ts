import type { SyncSchedule } from '@/api/schedules'

/** 화면 순서 = 서버 값(0=월요일 … 6=일요일). APScheduler 숫자 요일과 같아서 변환이 필요 없다. */
export const DAYS = ['월', '화', '수', '목', '금', '토', '일']

export const DAY_PRESETS: { label: string; days: number[] }[] = [
  { label: '매일', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: '평일', days: [0, 1, 2, 3, 4] },
  { label: '주말', days: [5, 6] },
]

const same = (a: number[], b: number[]) => a.length === b.length && a.every((d, i) => d === b[i])

export function formatDays(days: number[]): string {
  if (!days || days.length === 0) return '-'
  const sorted = [...days].sort((a, b) => a - b)
  const preset = DAY_PRESETS.find((p) => same(sorted, p.days))
  if (preset) return preset.label
  return sorted.map((d) => DAYS[d] ?? '?').join(', ')
}

/** (연, 월, 일, 시, 분) → "10/20(월) 22:09". 요일은 날짜에서 직접 계산한다(브라우저 시간대와 무관). */
function label(y: number, m: number, d: number, hh: number, mm: number): string {
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  return `${m}/${d}(${DAYS[weekday]}) ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** 서버가 준 시각("2026-10-20T22:09:00", 서울 기준)을 "10/20(월) 22:09"로. */
export function formatServerTime(iso: string | null): string | null {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  return m ? label(+m[1], +m[2], +m[3], +m[4], +m[5]) : null
}

/** 폼에서 저장 전에 보여주는 "다음 실행" 미리보기 — 서울 시각 기준으로 계산한다. */
export function previewNextRun(days: number[], time: string, now: Date = new Date()): string | null {
  const t = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!t || days.length === 0) return null
  const [hh, mm] = [+t[1], +t[2]]
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(now).map((p) => [p.type, +p.value]),
  ) as Record<string, number>
  const nowMinutes = parts.hour * 60 + parts.minute
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset))
    const weekday = (day.getUTCDay() + 6) % 7
    if (!days.includes(weekday)) continue
    if (offset === 0 && hh * 60 + mm <= nowMinutes) continue
    return label(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm)
  }
  return null
}

export const RUN_STATUS: Record<string, { label: string; className: string }> = {
  success: { label: '성공', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  partial: { label: '일부 실패', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  failure: { label: '실패', className: 'bg-red-50 text-red-700 border-red-100' },
}

/** 목록 정렬: 다음 실행이 가까운 순 → 다음 실행 없는 활성 → 비활성(이름순). */
export function sortSchedules(list: SyncSchedule[]): SyncSchedule[] {
  const rank = (s: SyncSchedule) => (!s.enabled ? 2 : s.next_run_at ? 0 : 1)
  return [...list].sort((a, b) =>
    rank(a) - rank(b) || (a.next_run_at ?? '').localeCompare(b.next_run_at ?? '') || a.name.localeCompare(b.name, 'ko'))
}
