import { Copy, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { BulkPolicyPlanResponse, GeneratedCommand, PolicyVerifyResult } from '@/api/policyBuilder'

// HTTP(비보안 컨텍스트)로 접속한 경우 navigator.clipboard 자체가 존재하지 않아
// 외부 접속 사용자는 execCommand 폴백이 없으면 복사가 조용히 실패한다.
function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(textarea)
  return ok
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else if (!legacyCopy(text)) {
      throw new Error('clipboard unavailable')
    }
    toast.success('복사되었습니다')
  } catch {
    toast.error('복사에 실패했습니다. 브라우저 클립보드 권한을 확인해주세요.')
  }
}

function CommandSection({ title, commands }: { title: string; commands: GeneratedCommand[] }) {
  const successCommands = commands.filter((c) => c.command)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ds-on-surface-variant">{title} ({commands.length}건)</p>
        {successCommands.length > 0 && (
          <button
            type="button"
            onClick={() => copyText(successCommands.map((c) => c.command).join('\n'))}
            className="text-11 flex items-center gap-1 text-ds-tertiary hover:underline"
          >
            <Copy className="w-3 h-3" /> 성공한 명령어 전체 복사
          </button>
        )}
      </div>
      <div className="space-y-1 max-h-[220px] overflow-y-auto">
        {commands.map((c, idx) => (
          <div
            key={idx}
            className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs font-mono ${
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
                  <p className="text-10 text-ds-on-surface-variant mt-1 ml-5">
                    {Object.entries(c.counts).map(([field, n]) => `${field}:${n}`).join(' · ')}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
        {commands.length === 0 && <p className="text-xs text-ds-on-surface-variant italic">없음</p>}
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
        <p className="text-xs text-ds-on-surface-variant">
          총 {allSuccessCommands.length}건의 명령어
          {totalErrors > 0 && <span className="text-ds-error font-semibold"> · 오류 {totalErrors}건</span>}
        </p>
        {allSuccessCommands.length > 0 && (
          <Button
            type="button"
            variant="gradient"
            size="auto"
            onClick={() => copyText(allSuccessCommands.map((c) => c.command).join('\n'))}
            className="text-xs font-semibold gap-1.5 px-3 py-1.5 rounded-md"
          >
            <Copy className="w-3.5 h-3.5" /> 전체 명령어 한번에 복사
          </Button>
        )}
      </div>

      {plan.warnings.length > 0 && (
        <div className="space-y-1">
          {plan.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-amber-600 bg-amber-50 rounded-md px-2.5 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {plan.conflicts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-ds-error">삽입 충돌 ({plan.conflicts.length}건)</p>
          <div className="space-y-1 max-h-[220px] overflow-y-auto">
            {plan.conflicts.map((c, i) => (
              <div key={i} className="text-xs bg-ds-error/10 text-ds-error rounded-md px-2.5 py-1.5">
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

const VERIFY_FIELD_LABEL: Record<string, string> = {
  enable: '활성화', action: '액션', from_zone: '출발지 존', source: '출발지', user: '사용자',
  to_zone: '목적지 존', destination: '목적지', service: '서비스', application: '애플리케이션',
  description: '설명', log_setting: '로그 설정', security_profile: '보안 프로필', category: '카테고리',
  position: '위치',
}

function formatCompareValue(value: string, count: number | null) {
  const text = value || '(없음)'
  return count === null ? text : `${count}개 · ${text}`
}

export function VerifyResultPanel({ results }: { results: PolicyVerifyResult[] }) {
  const matchCount = results.filter((r) => r.status === 'match').length
  const mismatchCount = results.length - matchCount

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-ds-on-surface-variant">
        대기중 변경사항 {results.length}건 검증 · <span className="text-emerald-600 font-semibold">일치 {matchCount}건</span>
        {mismatchCount > 0 && <span className="text-ds-error font-semibold"> · 불일치 {mismatchCount}건</span>}
      </p>
      <div className="space-y-2">
        {results.map((r, i) => (
          <div
            key={i}
            className={`px-2.5 py-1.5 rounded-md text-xs border ${
              r.status === 'match' ? 'border-emerald-200 bg-emerald-50/50' : 'border-ds-error/30 bg-ds-error/5'
            }`}
          >
            <div className={`flex items-center gap-2 font-semibold ${r.status === 'match' ? 'text-emerald-700' : 'text-ds-error'}`}>
              <span>{r.status === 'match' ? '일치' : '불일치'}</span>
              <span className="font-mono">{r.rule_name}</span>
              <span className="text-10 font-normal opacity-70">({PENDING_STATUS_LABEL[r.pending_status]})</span>
            </div>
            {r.fields.length > 0 && (
              <table className="mt-1.5 w-full table-fixed text-11">
                <thead>
                  <tr className="text-left text-ds-on-surface-variant">
                    <th className="w-24 font-medium py-0.5">컬럼</th>
                    <th className="font-medium py-0.5">기대값 (FAT)</th>
                    <th className="font-medium py-0.5">실제값 (장비)</th>
                    <th className="w-12 font-medium py-0.5">결과</th>
                  </tr>
                </thead>
                <tbody>
                  {r.fields.map((f) => (
                    <tr
                      key={f.field}
                      className={`border-t border-ds-outline-variant/30 align-top ${f.match ? 'text-ds-on-surface' : 'text-ds-error font-semibold'}`}
                    >
                      <td className="py-0.5">{VERIFY_FIELD_LABEL[f.field] ?? f.field}</td>
                      <td className="py-0.5 pr-2 font-mono break-all">{formatCompareValue(f.expected, f.expected_count)}</td>
                      <td className="py-0.5 pr-2 font-mono break-all">{formatCompareValue(f.actual, f.actual_count)}</td>
                      <td className={`py-0.5 ${f.match ? 'text-emerald-600' : 'text-ds-error'}`}>{f.match ? '일치' : '불일치'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
        {results.length === 0 && <p className="text-xs text-ds-on-surface-variant italic">대기중 변경사항이 없습니다.</p>}
      </div>
    </div>
  )
}
