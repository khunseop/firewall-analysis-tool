import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
}

export function formatNumber(num: number | null | undefined): string {
  if (num == null) return '-'
  return num.toLocaleString('ko-KR')
}

/** 현재 시각 기준 상대 시간 ("3분 전", "2시간 전", "3일 전") */
export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return '방금 전'
  if (mins < 60) return `${mins}분 전`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}시간 전`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}일 전`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}개월 전`
  return `${Math.floor(months / 12)}년 전`
}

/** last_hit_date 기준 미사용 일수 */
export function daysSinceHit(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

/** id 필드를 Ag-Grid rowId로 쓰는 공용 getRowId — 렌더마다 새 함수가 생기지 않도록 모듈 레벨로 고정 */
export const rowIdFromId = (p: { data: { id: number | string } }) => String(p.data.id)
