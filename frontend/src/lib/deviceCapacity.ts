export type CapacityLevel = 'normal' | 'warning' | 'danger'

export function capacityLevel(usage: number | null, threshold: number | null): CapacityLevel {
  if (usage == null || threshold == null || threshold <= 0) return 'normal'
  const ratio = usage / threshold
  if (ratio >= 1) return 'danger'
  if (ratio >= 0.8) return 'warning'
  return 'normal'
}

export const CAPACITY_LEVEL_BAR_COLOR: Record<CapacityLevel, string> = {
  normal: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-ds-error',
}

export const CAPACITY_LEVEL_TEXT_COLOR: Record<CapacityLevel, string> = {
  normal: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-ds-error',
}
