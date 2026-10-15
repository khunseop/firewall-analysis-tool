import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Phase } from './guideContent'

export function PhaseCard({ phase }: { phase: Phase }) {
  const anchor = `phase-${phase.id}`
  const [open, setOpen] = useState(false)

  // 해시(#phase-N)로 진입하거나 흐름도에서 클릭하면 펼치고 스크롤
  useEffect(() => {
    const sync = () => {
      if (window.location.hash !== `#${anchor}`) return
      setOpen(true)
      requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [anchor])

  return (
    <section id={anchor} className="scroll-mt-20 rounded-xl border border-ds-outline-variant/30 bg-ds-surface-container-lowest">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 p-4 text-left"
      >
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-ds-tertiary px-1.5 text-10 font-bold text-ds-on-tertiary">
          {phase.id}
        </span>
        <span className="text-sm font-semibold text-ds-on-surface">{phase.title}</span>
        <span className={cn('ml-auto text-ds-on-surface-variant transition-transform', open && 'rotate-180')} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-ds-outline-variant/20 p-4">
          {phase.steps.map((s) => (
            <div key={s.id}>
              <h3 className="text-13 font-semibold text-ds-on-surface">
                Task {s.id}. {s.title}
              </h3>
              <p className="mt-1 text-xs text-ds-on-surface-variant">{s.what}</p>
              {s.rule && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-ds-on-surface-variant">
                  {s.rule.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              {s.meaning && (
                <p className="mt-1.5 rounded-md bg-ds-surface-container-low px-3 py-2 text-xs text-ds-on-surface-variant">
                  <strong className="text-ds-on-surface">실무 의미 </strong>
                  {s.meaning}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
