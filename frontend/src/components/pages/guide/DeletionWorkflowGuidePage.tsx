import { PageHeader } from '@/components/shared/PageHeader'
import { DecisionTree } from './DecisionTree'
import { FlowDiagram } from './FlowDiagram'
import { PhaseCard } from './PhaseCard'
import { EXCEPTION_ORDER, FAQS, OUTCOMES, PHASES, TERMS } from './guideContent'

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-ds-on-surface">{title}</h2>
        {desc && <p className="mt-0.5 text-xs text-ds-on-surface-variant/80">{desc}</p>}
      </div>
      {children}
    </section>
  )
}

export function DeletionWorkflowGuidePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="삭제 워크플로우 가이드"
        description="방화벽 정책 중 삭제·공지 대상을 어떻게 가려내는지 단계별로 설명합니다."
      />

      <Section
        title="한눈에 보기"
        desc="외부 자료(GSAMS, MIS ID)와 방화벽 정책·사용이력을 결합해 아래 4가지 삭제 대상을 찾고, 신청 부서에 공지할 파일을 만듭니다."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {OUTCOMES.map((o) => (
            <div key={o.key} className="rounded-xl border border-ds-outline-variant/30 bg-ds-surface-container-lowest p-3">
              <p className="text-13 font-semibold text-ds-on-surface">{o.label}</p>
              <p className="mt-0.5 text-xs text-ds-on-surface-variant">{o.audience}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="전체 흐름" desc="단계를 누르면 아래 상세 설명으로 이동합니다.">
        <FlowDiagram phases={PHASES} />
      </Section>

      <Section title="정책 한 건의 운명" desc="정책 하나가 어떤 질문을 거쳐 공지 대상이 되는지 보여줍니다. 위에서부터 차례로 확인합니다.">
        <DecisionTree />
      </Section>

      <Section title="단계별 상세" desc="각 단계를 펼쳐 판단 기준과 실무적 의미를 확인하세요.">
        <div className="space-y-3">
          {PHASES.map((p) => (
            <PhaseCard key={p.id} phase={p} />
          ))}
        </div>
      </Section>

      <Section title="예외 사유 적용 순서" desc="뒤에 적용되는 사유가 앞의 사유를 덮어씁니다.">
        <ol className="flex flex-wrap gap-2">
          {EXCEPTION_ORDER.map((e, i) => (
            <li
              key={e}
              className="rounded-full border border-ds-outline-variant/30 bg-ds-surface-container-low px-3 py-1 text-xs text-ds-on-surface"
            >
              <span className="mr-1 text-ds-tertiary">{i + 1}</span>
              {e}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="용어와 기준">
        <dl className="divide-y divide-ds-outline-variant/20 rounded-xl border border-ds-outline-variant/30 bg-ds-surface-container-lowest">
          {TERMS.map((t) => (
            <div key={t.term} className="grid gap-1 p-3 sm:grid-cols-[8rem_1fr]">
              <dt className="text-xs font-semibold text-ds-on-surface">{t.term}</dt>
              <dd className="text-xs text-ds-on-surface-variant">{t.desc}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="자주 겪는 문제">
        <div className="space-y-2">
          {FAQS.map((f) => (
            <details key={f.q} className="rounded-xl border border-ds-outline-variant/30 bg-ds-surface-container-lowest p-3">
              <summary className="cursor-pointer text-13 font-semibold text-ds-on-surface">{f.q}</summary>
              <p className="mt-2 text-xs text-ds-on-surface-variant">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <p className="pb-4 text-11 text-ds-on-surface-variant/60">
        기준: 삭제 워크플로우 파이프라인(Task 0~19) 코드 · 최종 확인 2026-10-15 · 기준일(90일 등)은 설정에 따라 달라질 수 있습니다.
      </p>
    </div>
  )
}
