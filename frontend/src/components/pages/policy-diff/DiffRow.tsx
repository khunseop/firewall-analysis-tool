import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Minus, Edit2, ShieldAlert } from 'lucide-react'
import { diffMultiValueField, isFieldDiffEmpty } from '@/lib/policyDiff'
import { seqMove } from '@/lib/policyDiffRisk'
import { FIELD_LABELS, LIST_FIELDS, SNAPSHOT_FIELDS, type DiffEntry, type FieldChange } from './types'

function ActionBadge({ action }: { action: DiffEntry['action'] }) {
  if (action === 'created')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-11 font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
        <Plus className="w-2.5 h-2.5" />추가
      </span>
    )
  if (action === 'deleted')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-11 font-bold bg-red-50 text-red-700 border border-red-100">
        <Minus className="w-2.5 h-2.5" />삭제
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-11 font-bold bg-amber-50 text-amber-700 border border-amber-100">
      <Edit2 className="w-2.5 h-2.5" />수정
    </span>
  )
}

function FieldDiffTable({ changes }: { changes: FieldChange[] }) {
  return (
    <div className="rounded-lg overflow-hidden border border-ds-outline-variant/20 bg-white/60">
      <div className="grid grid-cols-[140px_1fr_1fr] text-xs font-semibold text-ds-on-surface-variant px-3 py-2 bg-ds-surface-container border-b border-ds-outline-variant/20">
        <span>필드</span>
        <span className="flex items-center gap-1"><Minus className="w-2.5 h-2.5 text-red-600" />이전 값</span>
        <span className="flex items-center gap-1"><Plus className="w-2.5 h-2.5 text-emerald-600" />이후 값</span>
      </div>
      {changes.map((fc, i) => {
        const tokenDiff = LIST_FIELDS.has(fc.field) ? diffMultiValueField(fc.before ?? '', fc.after ?? '') : null
        return (
          <div key={i} className="px-3 py-2 border-b border-ds-outline-variant/10 last:border-0 space-y-1.5">
            <div className="grid grid-cols-[140px_1fr_1fr] gap-2 text-xs">
              <span className="font-medium text-ds-on-surface-variant">{FIELD_LABELS[fc.field] ?? fc.field}</span>
              <div className="bg-red-50 rounded px-2 py-1 font-mono text-11 text-red-700 break-all">
                {fc.before || <span className="italic text-ds-on-surface-variant">없음</span>}
              </div>
              <div className="bg-emerald-50 rounded px-2 py-1 font-mono text-11 text-emerald-700 break-all">
                {fc.after || <span className="italic text-ds-on-surface-variant">없음</span>}
              </div>
            </div>
            {/* 콤마로 구분된 값 전체가 아니라, 실제로 추가/삭제된 항목만 따로 뽑아 보여준다 */}
            {tokenDiff && !isFieldDiffEmpty(tokenDiff) && (
              <div className="pl-[148px] flex flex-wrap gap-1">
                {tokenDiff.added.map((t) => (
                  <span key={`+${t}`} className="px-1.5 py-0.5 rounded text-11 font-mono bg-emerald-100 text-emerald-700">+{t}</span>
                ))}
                {tokenDiff.removed.map((t) => (
                  <span key={`-${t}`} className="px-1.5 py-0.5 rounded text-11 font-mono bg-red-100 text-red-700">-{t}</span>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function PolicySnapshotDetail({
  data,
  colorClass,
}: {
  data: Record<string, unknown> | null
  colorClass: 'emerald' | 'red'
}) {
  if (!data) return null
  const isEmerald = colorClass === 'emerald'
  const bg = isEmerald ? 'bg-emerald-50' : 'bg-red-50'
  const border = isEmerald ? 'border-emerald-100' : 'border-red-100'
  const label = isEmerald ? 'text-emerald-700' : 'text-red-700'
  const value = isEmerald ? 'text-emerald-900' : 'text-red-800'

  return (
    <div className={`rounded-lg ${bg} border ${border} p-3`}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        {SNAPSHOT_FIELDS.map((f) => {
          const v = data[f]
          if (v == null || v === '') return null
          return (
            <div key={f} className="flex gap-1.5 min-w-0">
              <span className={`font-semibold ${label} shrink-0`}>{FIELD_LABELS[f] ?? f}:</span>
              <span className={`${value} truncate`} title={String(v)}>{String(v)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function DiffRow({ entry, risks }: { entry: DiffEntry; risks: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = entry.field_changes.length > 0 || entry.before != null || entry.after != null
  const move = entry.action === 'updated' ? seqMove(entry.before, entry.after) : null

  const rowBg =
    entry.action === 'created' ? 'bg-emerald-50/30 hover:bg-emerald-50/60' :
    entry.action === 'deleted' ? 'bg-red-50/30 hover:bg-red-50/60' :
    'hover:bg-ds-surface-container-low/60'

  // 정책명을 드래그해 복사하는 중에는 행이 접히고 펼쳐지지 않게 한다.
  const handleRowClick = () => {
    if (!hasDetail || window.getSelection()?.toString()) return
    setExpanded((v) => !v)
  }

  return (
    <>
      <tr className={`${rowBg} transition-colors ${hasDetail ? 'cursor-pointer' : ''}`} onClick={handleRowClick}>
        <td className="pl-3 pr-1 py-2.5 w-8 align-top">
          {hasDetail && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${entry.rule_name} 상세 ${expanded ? '접기' : '펼치기'}`}
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
              className="p-1 rounded text-ds-on-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
            >
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          )}
        </td>
        <td className="px-3 py-3 w-24 align-top">
          <ActionBadge action={entry.action} />
        </td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-13 font-medium text-ds-on-surface">{entry.rule_name}</span>
            {entry.vsys && <span className="text-11 text-ds-on-surface-variant">({entry.vsys})</span>}
            {risks.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-11 font-bold bg-red-600 text-white">
                <ShieldAlert className="w-3 h-3" />위험
              </span>
            )}
            {move && (
              <span className="text-11 text-ds-on-surface-variant font-mono">순서 {move.from} → {move.to}</span>
            )}
          </div>
          {risks.length > 0 && (
            <ul className="mt-1 text-xs font-medium text-red-700 space-y-0.5">
              {risks.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
        </td>
        <td className="px-3 py-3 text-center align-top">
          {entry.action === 'updated' && entry.field_changes.length > 0
            ? <span className="text-xs text-ds-on-surface-variant">{entry.field_changes.length}개 필드</span>
            : <span className="text-xs text-ds-on-surface-variant" aria-label="해당 없음">—</span>}
        </td>
        <td className="px-3 py-3 text-center align-top">
          {entry.change_count > 1
            ? <span className="text-xs text-ds-on-surface-variant">{entry.change_count}회</span>
            : <span className="text-xs text-ds-on-surface-variant" aria-label="해당 없음">—</span>}
        </td>
      </tr>
      {expanded && (
        <tr className={rowBg}>
          <td />
          <td colSpan={4} className="px-4 pb-4 pt-1">
            {entry.action === 'updated' && entry.field_changes.length > 0 && (
              <FieldDiffTable changes={entry.field_changes} />
            )}
            {entry.action === 'created' && (
              <PolicySnapshotDetail data={entry.after as Record<string, unknown>} colorClass="emerald" />
            )}
            {entry.action === 'deleted' && (
              <PolicySnapshotDetail data={entry.before as Record<string, unknown>} colorClass="red" />
            )}
          </td>
        </tr>
      )}
    </>
  )
}

const TH = 'px-3 py-2.5 text-xs font-semibold text-ds-on-surface-variant'

export interface DiffRowData { entry: DiffEntry; risks: string[] }

export function DiffTable({ rows }: { rows: DiffRowData[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ds-outline-variant/10">
            <th className="w-8 pl-3"><span className="sr-only">상세 펼침</span></th>
            <th className={`${TH} text-left w-24`}>상태</th>
            <th className={`${TH} text-left`}>정책명</th>
            <th className={`${TH} text-center w-28`}>변경 필드</th>
            <th
              className={`${TH} text-center w-24 cursor-help`}
              title="조회 구간 안에서 이 정책에 기록된 변경 이력 건수입니다. Running/Candidate 실시간 비교에서는 변경된 필드 수와 같습니다."
            >
              변경 횟수
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-10 text-center text-13 text-ds-on-surface-variant">
                해당 조건에 맞는 변경사항이 없습니다.
              </td>
            </tr>
          ) : (
            rows.map(({ entry, risks }) => (
              <DiffRow key={`${entry.rule_name}-${entry.vsys ?? ''}`} entry={entry} risks={risks} />
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
