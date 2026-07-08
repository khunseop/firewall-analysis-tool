import { useQuery } from '@tanstack/react-query'
import { getPolicyHistory, type PolicyHistoryEntry } from '@/api/firewall'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { queryKeys } from '@/api/queryKeys'

// ─── 필드 한글 레이블 ─────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  rule_name: '정책명', vsys: '가상시스템', enable: '활성화', action: '액션',
  source: '출발지', destination: '목적지', service: '서비스',
  application: '애플리케이션', user: '사용자', description: '설명',
  security_profile: '보안프로파일', category: '카테고리',
  last_hit_date: '마지막매칭일시', seq: '순서',
}

const ACTION_META: Record<string, { label: string; color: string; bg: string }> = {
  created:          { label: '신규 추가', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  updated:          { label: '변경',      color: 'text-amber-700',   bg: 'bg-amber-100' },
  deleted:          { label: '삭제',      color: 'text-red-700',     bg: 'bg-red-100' },
  hit_date_updated: { label: '히트 갱신', color: 'text-gray-600',    bg: 'bg-gray-100' },
}

// ─── diff 파싱 ────────────────────────────────────────────────────────────────

type RawDetails = Record<string, unknown> | string | null | undefined

function parseDetails(raw: RawDetails): { before: Record<string, unknown>; after: Record<string, unknown> } {
  if (!raw) return { before: {}, after: {} }
  let parsed: Record<string, unknown>
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return { before: {}, after: {} } }
  } else {
    parsed = raw as Record<string, unknown>
  }
  return {
    before: (parsed.before as Record<string, unknown>) ?? {},
    after:  (parsed.after  as Record<string, unknown>) ?? {},
  }
}

// ─── diff 테이블 렌더 ─────────────────────────────────────────────────────────

function DiffTable({ entry }: { entry: PolicyHistoryEntry }) {
  const { before, after } = parseDetails(entry.details)
  const SKIP = new Set(['id', 'device_id'])

  if (entry.action === 'created') {
    const rows = Object.entries(after).filter(([k, v]) => !SKIP.has(k) && v !== null && v !== '')
    if (rows.length === 0) return <p className="text-xs text-gray-400">상세 정보 없음</p>
    return (
      <table className="w-full text-[11px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-gray-50">
              <td className="py-0.5 pr-3 text-gray-400 font-medium whitespace-nowrap w-32">{FIELD_LABELS[k] ?? k}</td>
              <td className="py-0.5 font-mono text-emerald-700 break-all">{String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  if (entry.action === 'deleted') {
    const rows = Object.entries(before).filter(([k, v]) => !SKIP.has(k) && v !== null && v !== '')
    if (rows.length === 0) return <p className="text-xs text-gray-400">상세 정보 없음</p>
    return (
      <table className="w-full text-[11px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-gray-50">
              <td className="py-0.5 pr-3 text-gray-400 font-medium whitespace-nowrap w-32">{FIELD_LABELS[k] ?? k}</td>
              <td className="py-0.5 font-mono text-red-600 line-through break-all">{String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  // updated / hit_date_updated
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].filter(k => !SKIP.has(k)))
  const rows = [...keys].filter(k => {
    const bv = before[k]
    const av = after[k]
    return JSON.stringify(bv) !== JSON.stringify(av)
  })
  if (rows.length === 0) return <p className="text-xs text-gray-400">변경된 필드 없음</p>
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-[10px] text-gray-400 border-b border-gray-100">
          <th className="pb-1 pr-3 text-left font-semibold w-32">필드</th>
          <th className="pb-1 pr-3 text-left font-semibold text-red-500">변경 전</th>
          <th className="pb-1 text-left font-semibold text-emerald-600">변경 후</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(k => (
          <tr key={k} className="border-b border-amber-50 bg-amber-50/30">
            <td className="py-0.5 pr-3 text-gray-500 font-medium whitespace-nowrap">{FIELD_LABELS[k] ?? k}</td>
            <td className="py-0.5 pr-3 font-mono text-red-600 break-all">{String(before[k] ?? '—')}</td>
            <td className="py-0.5 font-mono text-emerald-700 break-all">{String(after[k] ?? '—')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── 메인 모달 ────────────────────────────────────────────────────────────────

interface PolicyHistoryModalProps {
  deviceId: number
  ruleName: string
  onClose: () => void
}

export function PolicyHistoryModal({ deviceId, ruleName, onClose }: PolicyHistoryModalProps) {
  const { data: logs, isLoading, isError } = useQuery({
    queryKey: queryKeys.policyHistory(deviceId, ruleName),
    queryFn: () => getPolicyHistory(deviceId, ruleName),
    staleTime: 30_000,
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-ds-outline-variant/10 shrink-0">
          <DialogTitle className="text-base font-bold font-headline">
            변경 이력
          </DialogTitle>
          <p className="text-[11px] font-mono text-ds-on-surface-variant mt-0.5">{ruleName}</p>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-10 text-ds-on-surface-variant">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              불러오는 중…
            </div>
          )}
          {isError && (
            <p className="text-center text-ds-error text-sm py-10">이력 조회에 실패했습니다.</p>
          )}
          {logs && logs.length === 0 && (
            <p className="text-center text-ds-on-surface-variant text-sm py-10">변경 이력이 없습니다.</p>
          )}
          {logs?.map(log => {
            const meta = ACTION_META[log.action] ?? { label: log.action, color: 'text-gray-600', bg: 'bg-gray-100' }
            const date = log.timestamp
              ? new Date(log.timestamp).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })
              : '—'
            return (
              <div key={log.id} className="border-l-2 border-ds-outline-variant/20 pl-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${meta.bg} ${meta.color}`}>
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-ds-on-surface-variant">{date}</span>
                </div>
                <DiffTable entry={log} />
              </div>
            )
          })}
        </div>

        <div className="px-6 py-3 border-t border-ds-outline-variant/10 shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-ds-surface-container-low hover:bg-ds-surface-container text-ds-on-surface transition-colors"
          >
            닫기
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
