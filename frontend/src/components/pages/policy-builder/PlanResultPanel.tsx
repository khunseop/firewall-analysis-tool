import { Copy, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { PolicyMiniRow } from '@/components/shared/PolicyMiniRow'
import type { BulkPolicyPlanResponse, GeneratedCommand } from '@/api/policyBuilder'

function copyText(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('복사되었습니다')
}

function CommandSection({ title, commands }: { title: string; commands: GeneratedCommand[] }) {
  const successCommands = commands.filter((c) => c.command)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-ds-on-surface-variant">{title} ({commands.length}건)</p>
        {successCommands.length > 0 && (
          <button
            type="button"
            onClick={() => copyText(successCommands.map((c) => c.command).join('\n'))}
            className="text-[11px] flex items-center gap-1 text-ds-tertiary hover:underline"
          >
            <Copy className="w-3 h-3" /> 성공한 명령어 전체 복사
          </button>
        )}
      </div>
      <div className="space-y-1 max-h-[220px] overflow-y-auto">
        {commands.map((c, idx) => (
          <div
            key={idx}
            className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md text-[12px] font-mono ${
              c.error ? 'bg-ds-error/10 text-ds-error' : 'bg-ds-surface-container-low text-ds-on-surface'
            }`}
          >
            {c.error ? (
              <span>[row {c.row_index}] 오류: {c.error}</span>
            ) : (
              <>
                <button type="button" onClick={() => copyText(c.command!)} className="shrink-0 text-ds-on-surface-variant hover:text-ds-tertiary">
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <span className="flex-1 break-all">{c.command}</span>
              </>
            )}
          </div>
        ))}
        {commands.length === 0 && <p className="text-[12px] text-ds-on-surface-variant italic">없음</p>}
      </div>
    </div>
  )
}

export function PlanResultPanel({ plan }: { plan: BulkPolicyPlanResponse }) {
  return (
    <div className="space-y-4">
      {plan.warnings.length > 0 && (
        <div className="space-y-1">
          {plan.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[12px] text-amber-600 bg-amber-50 rounded-md px-2.5 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {plan.conflicts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[12px] font-semibold text-ds-error">삽입 충돌 ({plan.conflicts.length}건)</p>
          <div className="space-y-1">
            {plan.conflicts.map((c, i) => (
              <div key={i} className="text-[12px] bg-ds-error/10 text-ds-error rounded-md px-2.5 py-1.5">
                [{c.conflict_type === 'blocking' ? '차단' : '가려짐'}] {c.reason}
              </div>
            ))}
          </div>
        </div>
      )}

      <CommandSection title="오브젝트 생성 명령어" commands={plan.object_commands} />
      <CommandSection title="정책 생성 명령어" commands={plan.policy_commands} />
      <CommandSection title="이동 명령어" commands={plan.move_commands} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] font-semibold text-ds-on-surface-variant mb-1.5 px-1">이동 전 배치</p>
          <div className="border border-ds-outline-variant/20 rounded-lg p-1 space-y-0.5 max-h-[360px] overflow-y-auto">
            {plan.preview_before.map((r) => (
              <PolicyMiniRow key={r.id} ruleName={r.rule_name} action={r.action} seq={r.seq} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-ds-on-surface-variant mb-1.5 px-1">이동 후 배치</p>
          <div className="border border-ds-outline-variant/20 rounded-lg p-1 space-y-0.5 max-h-[360px] overflow-y-auto">
            {plan.preview_after.map((r) => (
              <PolicyMiniRow key={r.id} ruleName={r.rule_name} action={r.action} seq={r.seq} isNew={r.is_new} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
