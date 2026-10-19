import { RotateCcw, Terminal, ShieldCheck, Undo2, X, PanelRightClose, AlertTriangle } from 'lucide-react'
import { sortCreatesInPasteOrder, type PendingPolicyChange } from '@/api/policyBuilder'
import { Button } from '@/components/ui/button'
import { EditActionMenu } from '@/components/pages/policy-builder/EditActionMenu'
import { PENDING_STATUS_META, type PendingStatus } from './policyCellUtils'

export interface PendingCounts { create: number; modify: number; delete: number; move: number; disable: number }

const FIELD_LABEL: Record<string, string> = {
  source: '출발지', destination: '목적지', service: '서비스', application: '애플리케이션',
  source_user: '사용자', from_zone: 'from(존)', to_zone: 'to(존)',
}

const TYPE_META: Record<string, { label: string; status: PendingStatus | 'disable' }> = {
  create:  { label: '생성', status: 'new' },
  modify:  { label: '수정', status: 'modified' },
  delete:  { label: '삭제', status: 'deleted' },
  move:    { label: '이동', status: 'moved' },
  disable: { label: '비활성화', status: 'disable' },
}

function describeChange(c: PendingPolicyChange, nameById: Map<number, string>) {
  const name = c.change_type === 'create'
    ? String(c.payload.rule_name || '신규 정책')
    : (c.target_policy_id != null ? nameById.get(c.target_policy_id) : undefined) ?? `정책 #${c.target_policy_id}`
  let detail = ''
  if (c.change_type === 'modify') {
    detail = Object.keys(c.payload).map((k) => FIELD_LABEL[k] ?? k).join(', ')
  } else if (c.change_type === 'disable') {
    detail = c.payload.disabled ? '비활성화' : '활성화'
  }
  return { name, detail }
}

export function EditChangesPanel({
  deviceName, changes, nameById, counts, selectedCount,
  canUndo, onUndo, onRevertChange, onJumpTo, onClearAll, onVerify, onGenerate, verifyLoading, planLoading,
  loadError, risk, onCollapse, menuProps,
}: {
  deviceName: string
  changes: PendingPolicyChange[]
  nameById: Map<number, string>
  counts: PendingCounts
  selectedCount: number
  canUndo: boolean
  onUndo: () => void
  onRevertChange: (change: PendingPolicyChange) => void
  onJumpTo: (policyId: number) => void
  onClearAll: () => void
  onVerify: () => void
  onGenerate: () => void
  verifyLoading: boolean
  planLoading: boolean
  loadError: string | null
  risk: 'loading' | 'error' | { conflicts: number; warnings: number } | null
  onCollapse: () => void
  menuProps: React.ComponentProps<typeof EditActionMenu>
}) {
  const visible = sortCreatesInPasteOrder(changes).filter((c) => c.change_type !== 'new_object')
  const total = visible.length
  const chips = (Object.keys(TYPE_META) as (keyof PendingCounts)[])
    .filter((k) => counts[k] > 0)

  return (
    <aside aria-label="변경 계획" className="card rounded-xl flex flex-col w-[360px] shrink-0 border-amber-300/60">
      <div className="px-4 py-3 border-b border-ds-outline-variant/10 bg-amber-50/70 rounded-t-xl">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-13 font-semibold text-ds-on-surface">변경 계획 · <span className="font-mono">{deviceName}</span></div>
            <p className="text-11 text-amber-900 mt-1 leading-snug">
              장비에는 반영되지 않습니다. 변경은 CLI 텍스트로만 생성되며, 검토한 뒤 직접 실행합니다.
            </p>
          </div>
          <button type="button" onClick={onCollapse} aria-label="변경 목록 접기" className="p-1 text-ds-on-surface-variant hover:text-ds-on-surface rounded shrink-0">
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-4 py-2.5 border-b border-ds-outline-variant/10 flex items-center gap-2">
        <EditActionMenu {...menuProps} />
        {canUndo && total > 0 && (
          <button type="button" onClick={onUndo} title="마지막 편집 취소 (Ctrl/⌘+Z)" className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-ds-on-surface-variant hover:text-ds-tertiary rounded-lg hover:bg-ds-surface-container-low transition-colors">
            <Undo2 className="w-3.5 h-3.5" /> 실행 취소
          </button>
        )}
        <span className="ml-auto text-11 text-ds-on-surface-variant tabular-nums">
          {selectedCount > 0 ? `${selectedCount}개 선택` : '행을 선택해 편집'}
        </span>
      </div>

      <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-ds-on-surface tabular-nums mr-1">변경 {total}건</span>
        {chips.map((k) => {
          const meta = TYPE_META[k]
          const dot = meta.status === 'disable' ? 'bg-gray-400' : PENDING_STATUS_META[meta.status].dot
          return (
            <span key={k} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-ds-surface-container text-11 text-ds-on-surface">
              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />{meta.label} <span className="font-semibold tabular-nums">{counts[k]}</span>
            </span>
          )
        })}
      </div>

      {total > 0 && (
        <div className="px-4 pb-2 text-11" aria-live="polite">
          {risk === 'loading' || risk === null ? (
            <span className="text-ds-on-surface-variant">충돌 검사 중…</span>
          ) : risk === 'error' ? (
            <span className="text-ds-on-surface-variant">충돌 검사를 건너뛰었습니다. CLI 생성 시 다시 확인합니다.</span>
          ) : risk.conflicts + risk.warnings > 0 ? (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-900 bg-amber-100 rounded px-1.5 py-0.5">
              <AlertTriangle className="w-3 h-3" />삽입 충돌 {risk.conflicts}건 · 경고 {risk.warnings}건 — CLI 생성 후 확인하세요
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-800">충돌·경고 없음</span>
          )}
        </div>
      )}

      <ul className="flex-1 min-h-40 overflow-y-auto px-2 pb-2 divide-y divide-ds-outline-variant/8">
        {loadError && (
          <li role="alert" className="px-3 py-6 text-center text-xs text-ds-error leading-relaxed">
            변경 목록을 불러오지 못했습니다.<br />{loadError}
          </li>
        )}
        {total === 0 && !loadError && (
          <li className="px-3 py-8 text-center text-xs text-ds-on-surface-variant leading-relaxed">
            아직 변경이 없습니다.<br />
            행을 선택하고 <strong className="font-semibold text-ds-on-surface">편집 메뉴</strong>에서 시작하거나,<br />셀을 직접 수정하세요.
          </li>
        )}
        {visible.map((c) => {
          const meta = TYPE_META[c.change_type]
          const { name, detail } = describeChange(c, nameById)
          const jumpId = c.change_type === 'create' ? -c.id : c.target_policy_id
          const badge = meta && meta.status !== 'disable' ? PENDING_STATUS_META[meta.status].badge : 'bg-gray-100 text-gray-800'
          return (
            <li key={c.id} className="flex items-center gap-1 group">
              <button
                type="button"
                onClick={() => jumpId != null && onJumpTo(jumpId)}
                className="flex items-center gap-2 flex-1 min-w-0 px-2 py-2 text-left rounded hover:bg-ds-surface-container-low"
              >
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-11 font-bold ${badge}`}>{meta?.label ?? c.change_type}</span>
                <span className="min-w-0">
                  <span className="block font-mono text-xs font-semibold text-ds-on-surface truncate">{name}</span>
                  {detail && <span className="block text-11 text-ds-on-surface-variant truncate">{detail}</span>}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onRevertChange(c)}
                aria-label={`${name} ${meta?.label ?? ''} 변경 되돌리기`}
                title="이 변경 되돌리기"
                className="p-1.5 text-ds-on-surface-variant hover:text-ds-error rounded shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          )
        })}
      </ul>

      <div className="px-4 py-3 border-t border-ds-outline-variant/10 space-y-2 bg-ds-surface-container-low/40 rounded-b-xl">
        <Button
          variant="gradient"
          size="auto"
          onClick={onGenerate}
          disabled={total === 0 || planLoading}
          className="w-full justify-center gap-1.5 px-4 py-2 text-13 font-bold rounded-md"
        >
          <Terminal className="w-3.5 h-3.5" /> {planLoading ? 'CLI 생성 중…' : `CLI 생성 (${total}건)`}
        </Button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onVerify}
            disabled={total === 0 || verifyLoading}
            title="장비에서 현재 설정을 읽어 변경 계획과 비교합니다. 장비는 변경되지 않습니다."
            className="flex items-center justify-center gap-1.5 flex-1 px-3 py-1.5 text-xs font-semibold text-ds-on-surface border border-ds-outline-variant/30 rounded-md disabled:opacity-50 hover:bg-white transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5" /> {verifyLoading ? '검증 중…' : '장비와 비교 (읽기 전용)'}
          </button>
          <button
            type="button"
            onClick={onClearAll}
            disabled={total === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-ds-error rounded-md hover:bg-ds-error/10 disabled:opacity-40 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" /> 전체 취소
          </button>
        </div>
      </div>
    </aside>
  )
}
