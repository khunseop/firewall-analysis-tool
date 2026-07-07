export type ResourceLevel = 'normal' | 'warning' | 'danger'

export function resourceLevel(usage: number | null, threshold: number | null): ResourceLevel {
  if (usage == null || threshold == null || threshold <= 0) return 'normal'
  const ratio = usage / threshold
  if (ratio >= 1) return 'danger'
  if (ratio >= 0.8) return 'warning'
  return 'normal'
}

export const RESOURCE_LEVEL_BAR_COLOR: Record<ResourceLevel, string> = {
  normal: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-ds-error',
}

export const RESOURCE_LEVEL_TEXT_COLOR: Record<ResourceLevel, string> = {
  normal: 'text-emerald-600',
  warning: 'text-amber-600',
  danger: 'text-ds-error',
}
