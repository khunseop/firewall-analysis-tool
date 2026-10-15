import { diffMultiValueField } from '@/lib/policyDiff'
import type { StyledExcelPayload, ExcelSheet } from '@/api/firewall'
import {
  LIVE_RUNNING_ID, LIVE_CANDIDATE_ID, FIELD_LABELS, LIST_FIELDS, fmt,
  type DiffEntry, type DiffResponse,
} from './types'

// 추가/삭제 시트에서 "모든 컬럼"을 펼칠 때, DB 내부 관리용 필드(FK/캐시 플래그 등)는 리포트에
// 의미가 없으므로 제외한다. 그 외 필드는 벤더/DB에 어떤 게 있든 전부 다 보여준다.
const EXCEL_INTERNAL_FIELD_BLOCKLIST = new Set(['id', 'device_id', 'is_active', 'is_indexed', 'last_seen_at', 'vsys', 'rule_name'])

const ROW_BG_CREATED = '#E8F5E9'
const ROW_BG_DELETED = '#FFEBEE'
const ROW_BG_UPDATED = '#FFF8E1'

// 추가/삭제 시트에서 known 필드는 이 순서로, 모르는 필드(벤더별 특이 필드 등)는 그 뒤에 알파벳순으로 붙인다.
const PREFERRED_FIELD_ORDER = [
  'action', 'enable', 'from_zone', 'to_zone', 'source', 'user', 'destination', 'service',
  'application', 'category', 'security_profile', 'description', 'log_setting', 'seq',
  'last_hit_date', 'hit_count',
]

function fieldLabel(field: string) {
  return FIELD_LABELS[field] ?? field
}

/** 값 1개(스칼라) 또는 콤마로 구분된 여러 값의 "개수"를 센다 — 빈 값은 0개. */
function countValues(value: string | null | undefined) {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean).length
}

/** created/deleted 정책들의 before/after 스냅샷에 실제로 등장하는 모든 필드를 모아 컬럼 순서를 정한다. */
function collectSnapshotFields(entries: DiffEntry[], side: 'before' | 'after'): string[] {
  const keys = new Set<string>()
  for (const entry of entries) {
    const snapshot = entry[side]
    if (!snapshot) continue
    for (const k of Object.keys(snapshot)) {
      if (!EXCEL_INTERNAL_FIELD_BLOCKLIST.has(k)) keys.add(k)
    }
  }
  const preferred = PREFERRED_FIELD_ORDER.filter((f) => keys.has(f))
  const rest = [...keys].filter((f) => !PREFERRED_FIELD_ORDER.includes(f)).sort()
  return [...preferred, ...rest]
}

function buildSummarySheet(diffResult: DiffResponse, changes: DiffEntry[], searchQuery: string, deviceLabel: string): ExcelSheet {
  const created = changes.filter((c) => c.action === 'created').length
  const updated = changes.filter((c) => c.action === 'updated').length
  const deleted = changes.filter((c) => c.action === 'deleted').length
  const fromLabel = diffResult.from_sync.id === LIVE_RUNNING_ID ? 'Running (실시간)' : fmt(diffResult.from_sync.sync_at)
  const toLabel = diffResult.to_sync.id === LIVE_CANDIDATE_ID ? 'Candidate (실시간)' : fmt(diffResult.to_sync.sync_at)

  const rows: { label: string; value: string }[] = [
    { label: '장비', value: deviceLabel },
    { label: '비교 시작 (From)', value: fromLabel },
    { label: '비교 종료 (To)', value: toLabel },
    { label: '총 변경', value: String(created + updated + deleted) },
    { label: '추가된 정책', value: String(created) },
    { label: '수정된 정책', value: String(updated) },
    { label: '삭제된 정책', value: String(deleted) },
    { label: '내보낸 시각', value: fmt(new Date().toISOString()) },
  ]
  if (searchQuery) rows.push({ label: '검색어 필터', value: searchQuery })

  return {
    name: '요약',
    columns: [{ header: '항목', width: 20 }, { header: '값', width: 40 }],
    rows: rows.map((r) => ({ values: [r.label, r.value], rowBg: null, cellFontColors: [] })),
  }
}

/** 추가/삭제 시트 — 정책 1건당 1행, 스냅샷에 있는 모든 컬럼을 그대로 펼친다. */
function buildSnapshotSheet(name: string, entries: DiffEntry[], side: 'before' | 'after', rowBg: string): ExcelSheet {
  const fields = collectSnapshotFields(entries, side)
  const columns = [
    { header: '정책명', width: 32 },
    { header: 'VSYS', width: 12 },
    ...fields.map((f) => ({ header: fieldLabel(f), width: LIST_FIELDS.has(f) ? 40 : 20 })),
  ]
  const rows = entries.map((entry) => {
    const snapshot = entry[side] ?? {}
    const values = [entry.rule_name, entry.vsys ?? '', ...fields.map((f) => {
      const v = snapshot[f]
      return v == null ? '' : String(v)
    })]
    return { values, rowBg, cellFontColors: [] }
  })
  return { name, columns, rows }
}

/** 변경 시트 — 정책+필드 1행. 이전/이후 값과 개수, 그리고 실제로 추가/삭제된 값만 따로 뽑아 보여준다. */
function buildUpdatedSheet(entries: DiffEntry[]): ExcelSheet {
  const columns = [
    { header: '정책명', width: 32 },
    { header: 'VSYS', width: 12 },
    { header: '필드', width: 16 },
    { header: '이전 값', width: 40 }, { header: '이전 개수', width: 10 },
    { header: '이후 값', width: 40 }, { header: '이후 개수', width: 10 },
    { header: '추가된 값', width: 30 }, { header: '추가 개수', width: 10 },
    { header: '삭제된 값', width: 30 }, { header: '삭제 개수', width: 10 },
  ]
  const rows: ExcelSheet['rows'] = []
  for (const entry of entries) {
    for (const fc of entry.field_changes) {
      const before = fc.before ?? ''
      const after = fc.after ?? ''
      const tokenDiff = diffMultiValueField(before, after)
      rows.push({
        values: [
          entry.rule_name, entry.vsys ?? '', fieldLabel(fc.field),
          before, countValues(before),
          after, countValues(after),
          tokenDiff.added.join(', '), tokenDiff.added.length,
          tokenDiff.removed.join(', '), tokenDiff.removed.length,
        ],
        rowBg: ROW_BG_UPDATED,
        cellFontColors: [],
      })
    }
  }
  return { name: '변경', columns, rows }
}

/** 화면에서 검색어로 좁힌 결과를 요약/추가/삭제/변경 4개 시트로 나눠 담는다 — 상태별로 이미 시트가
 * 나뉘므로 화면의 상태 필터 탭은 적용하지 않고, 정책명 검색만 반영한다. */
export function buildDiffWorkbook(diffResult: DiffResponse, changes: DiffEntry[], searchQuery: string, filename: string, deviceLabel: string): StyledExcelPayload {
  const created = changes.filter((c) => c.action === 'created')
  const deleted = changes.filter((c) => c.action === 'deleted')
  const updated = changes.filter((c) => c.action === 'updated')

  return {
    filename,
    sheets: [
      buildSummarySheet(diffResult, changes, searchQuery, deviceLabel),
      buildSnapshotSheet('추가', created, 'after', ROW_BG_CREATED),
      buildSnapshotSheet('삭제', deleted, 'before', ROW_BG_DELETED),
      buildUpdatedSheet(updated),
    ],
  }
}
