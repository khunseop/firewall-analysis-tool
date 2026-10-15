import type { Phase } from './guideContent'

export function FlowDiagram({ phases }: { phases: Phase[] }) {
  const go = (id: number) => {
    window.location.assign(`#phase-${id}`)
  }
  return (
    <ol className="flex flex-col items-stretch">
      {phases.map((p, i) => (
        <li key={p.id} className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => go(p.id)}
            className="w-full max-w-2xl rounded-xl border border-ds-outline-variant/30 bg-ds-surface-container-lowest p-4 text-left transition-colors hover:border-ds-tertiary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-ds-tertiary px-1.5 text-10 font-bold text-ds-on-tertiary">
                {p.id}
              </span>
              <span className="text-sm font-semibold text-ds-on-surface">{p.title}</span>
              <span className="ml-auto text-10 text-ds-on-surface-variant/70">Task {p.steps.map((s) => s.id).join('·')}</span>
            </div>
            <p className="mt-1.5 text-xs text-ds-on-surface-variant">{p.summary}</p>
            <div className="mt-2 grid gap-1 text-11 text-ds-on-surface-variant/80 sm:grid-cols-2">
              <span>입력: {p.input}</span>
              <span>산출: {p.output}</span>
            </div>
          </button>
          {i < phases.length - 1 && (
            <svg aria-hidden width="16" height="24" viewBox="0 0 16 24" className="text-ds-outline-variant">
              <path d="M8 0v18M3 13l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </li>
      ))}
    </ol>
  )
}
