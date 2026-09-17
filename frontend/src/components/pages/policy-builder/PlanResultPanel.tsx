import { Copy, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import type { BulkPolicyPlanResponse, GeneratedCommand, PolicyVerifyResult } from '@/api/policyBuilder'

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
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <button type="button" onClick={() => copyText(c.command!)} className="shrink-0 text-ds-on-surface-variant hover:text-ds-tertiary">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <span className="flex-1 break-all">{c.command}</span>
                </div>
                {c.counts && Object.keys(c.counts).length > 0 && (
                  <p className="text-[10px] text-ds-on-surface-variant mt-1 ml-5">
                    {Object.entries(c.counts).map(([field, n]) => `${field}:${n}`).join(' · ')}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
        {commands.length === 0 && <p className="text-[12px] text-ds-on-surface-variant italic">없음</p>}
      </div>
    </div>
  )
}

export function PlanResultPanel({ plan }: { plan: BulkPolicyPlanResponse }) {
  // 오브젝트 생성 → 정책 생성/수정/삭제 → 이동 순서는 CLI를 그대로 순서대로 붙여넣어도
  // 참조 오류 없이 동작하도록 맞춘 순서다 — "전체 복사"도 같은 순서를 따른다.
  const allSections = [
    plan.object_commands, plan.policy_commands, plan.modify_commands, plan.delete_commands, plan.move_commands,
  ]
  const allSuccessCommands = allSections.flat().filter((c) => c.command)
  const totalErrors = allSections.flat().filter((c) => c.error).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[12px] text-ds-on-surface-variant">
          총 {allSuccessCommands.length}건의 명령어
          {totalErrors > 0 && <span className="text-ds-error font-semibold"> · 오류 {totalErrors}건</span>}
        </p>
        {allSuccessCommands.length > 0 && (
          <button
            type="button"
            onClick={() => copyText(allSuccessCommands.map((c) => c.command).join('\n'))}
            className="text-[12px] font-semibold flex items-center gap-1.5 px-3 py-1.5 rounded-md text-ds-on-tertiary btn-primary-gradient"
          >
            <Copy className="w-3.5 h-3.5" /> 전체 명령어 한번에 복사
          </button>
        )}
      </div>

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
          <div className="space-y-1 max-h-[220px] overflow-y-auto">
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
      <CommandSection title="정책 수정 명령어" commands={plan.modify_commands} />
      <CommandSection title="정책 삭제 명령어" commands={plan.delete_commands} />
      <CommandSection title="이동 명령어" commands={plan.move_commands} />
    </div>
  )
}

const PENDING_STATUS_LABEL: Record<PolicyVerifyResult['pending_status'], string> = {
  new: '생성', modified: '수정', deleted: '삭제', moved: '이동',
}

export function VerifyResultPanel({ results }: { results: PolicyVerifyResult[] }) {
  const matchCount = results.filter((r) => r.status === 'match').length
  const mismatchCount = results.length - matchCount

  return (
    <div className="space-y-1.5">
      <p className="text-[12px] text-ds-on-surface-variant">
        대기중 변경사항 {results.length}건 검증 · <span className="text-emerald-600 font-semibold">일치 {matchCount}건</span>
        {mismatchCount > 0 && <span className="text-ds-error font-semibold"> · 불일치 {mismatchCount}건</span>}
      </p>
      <div className="space-y-1 max-h-[320px] overflow-y-auto">
        {results.map((r, i) => (
          <div
            key={i}
            className={`px-2.5 py-1.5 rounded-md text-[12px] ${
              r.status === 'match' ? 'bg-emerald-50 text-emerald-700' : 'bg-ds-error/10 text-ds-error'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              <span>{r.status === 'match' ? '일치' : '불일치'}</span>
              <span className="font-mono">{r.rule_name}</span>
              <span className="text-[10px] font-normal opacity-70">({PENDING_STATUS_LABEL[r.pending_status]})</span>
            </div>
            {r.mismatches.length > 0 && (
              <ul className="mt-1 ml-4 space-y-0.5">
                {r.mismatches.map((m, j) => (
                  <li key={j} className="font-mono text-[11px] break-all">
                    {m.field}: {m.expected || '(없음)'} → {m.actual || '(없음)'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {results.length === 0 && <p className="text-[12px] text-ds-on-surface-variant italic">대기중 변경사항이 없습니다.</p>}
      </div>
    </div>
  )
}
