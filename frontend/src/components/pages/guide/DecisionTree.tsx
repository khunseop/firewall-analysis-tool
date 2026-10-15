import { DECISION_NOTE, DECISION_STEPS, OUTCOMES } from './guideContent'

export function DecisionTree() {
  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {DECISION_STEPS.map((s, i) => (
          <li key={s.q} className="rounded-xl border border-ds-outline-variant/30 bg-ds-surface-container-lowest p-4">
            <p className="text-13 font-semibold text-ds-on-surface">
              <span className="mr-2 text-ds-tertiary">Q{i + 1}</span>
              {s.q}
            </p>
            <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-md bg-ds-surface-container-low p-2">
                <dt className="font-semibold text-ds-on-surface">예</dt>
                <dd className="text-ds-on-surface-variant">{s.yes}</dd>
              </div>
              <div className="rounded-md bg-ds-surface-container-low p-2">
                <dt className="font-semibold text-ds-on-surface">아니오</dt>
                <dd className="text-ds-on-surface-variant">{s.no === 'next' ? '다음 질문으로' : s.no}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      <p className="text-xs text-ds-on-surface-variant/80">{DECISION_NOTE}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {OUTCOMES.map((o) => (
          <div key={o.key} className="rounded-xl border border-ds-tertiary/40 bg-ds-surface-container-lowest p-3">
            <p className="text-13 font-semibold text-ds-on-surface">{o.label}</p>
            <p className="mt-0.5 text-xs text-ds-on-surface-variant">{o.audience}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
