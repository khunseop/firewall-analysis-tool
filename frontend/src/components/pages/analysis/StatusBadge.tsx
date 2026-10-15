import type { StatusMeta } from './analysisModel'

export function AnalysisStatus({ meta }: { meta: StatusMeta }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-11 font-semibold ${meta.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} aria-hidden="true" />
      {meta.label}
    </span>
  )
}
