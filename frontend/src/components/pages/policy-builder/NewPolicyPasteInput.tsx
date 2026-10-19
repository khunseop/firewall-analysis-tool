import { useState } from 'react'
import { Trash2, Copy, AlertTriangle, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { parsePastedPolicies } from '@/lib/policyBuilderParse'
import type { NewPolicyRow } from '@/api/policyBuilder'
import type { SkippedLine } from '@/lib/policyBuilderParse'

// 파싱 가능한(수정 가능한) 전체 컬럼 — lib/policyBuilderParse.ts의 HEADER_TO_FIELD와 동기화되어야 한다.
const TEMPLATE_HEADER = ['정책명', '액션', '비활성화', '출발지존', '출발지', '사용자', '목적지존', '목적지', '서비스', '애플리케이션', '설명', 'log_end', 'log_setting']
const TEMPLATE_EXAMPLE_ROW = ['ALLOW-WEB-EXAMPLE', 'allow', '', 'any', '10.0.0.0/24', '', 'any', 'any', 'tcp-443', '', '업무용 웹 접근 허용', 'yes', '']
const TEMPLATE = [TEMPLATE_HEADER.join('\t'), TEMPLATE_EXAMPLE_ROW.join('\t')].join('\n')

// 객체 수 복사 대상 컬럼 — [헤더 라벨, NewPolicyRow 필드]
const COUNT_COLUMNS: { label: string; field: keyof NewPolicyRow }[] = [
  { label: '출발지', field: 'source' },
  { label: '목적지', field: 'destination' },
  { label: '서비스', field: 'service' },
  { label: '애플리케이션', field: 'application' },
]

function countTokens(value: string): number {
  return value.split(',').map((s) => s.trim()).filter(Boolean).length
}

function MultiValueCell({ value }: { value: string }) {
  const count = countTokens(value)
  return (
    <span className="inline-flex items-center gap-1">
      <span className="truncate max-w-[220px] inline-block align-bottom">{value}</span>
      {count > 1 && <span className="text-10 text-ds-on-surface-variant shrink-0">({count})</span>}
    </span>
  )
}

export function NewPolicyPasteInput({ rows, onChange, children }: {
  rows: NewPolicyRow[]
  onChange: (rows: NewPolicyRow[]) => void
  /** 입력 열 아래에 이어서 보여줄 내용 — 부족 오브젝트 패널 등 */
  children?: React.ReactNode
}) {
  const [text, setText] = useState('')
  const [unknownColumns, setUnknownColumns] = useState<string[]>([])
  const [skippedLines, setSkippedLines] = useState<SkippedLine[]>([])

  const handleParse = () => {
    const result = parsePastedPolicies(text)
    onChange(result.rows)
    setUnknownColumns(result.unknownColumns)
    setSkippedLines(result.skippedLines)
    if (result.skippedLines.length > 0) {
      toast.warning(`파싱하지 못한 줄이 ${result.skippedLines.length}건 있습니다. 아래 목록을 확인하세요.`)
    }
  }

  const handleRemoveRow = (rowIndex: number) => {
    onChange(rows.filter((r) => r.row_index !== rowIndex).map((r, i) => ({ ...r, row_index: i })))
  }

  const handleCopyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(TEMPLATE)
      toast.success('템플릿을 클립보드에 복사했습니다. 엑셀에 붙여넣어 작성한 뒤 다시 이 화면에 붙여넣으세요.')
    } catch {
      toast.error('클립보드 복사에 실패했습니다.')
    }
  }

  // 정책명 + 컬럼별 객체 개수를 탭 구분 텍스트로 복사 — 엑셀에 붙여넣어 요청 건수 대조용으로 쓸 수 있다.
  const handleCopyCounts = async () => {
    const header = ['정책명', ...COUNT_COLUMNS.map((c) => c.label)].join('\t')
    const lines = rows.map((row) =>
      [row.rule_name, ...COUNT_COLUMNS.map((c) => countTokens(row[c.field] as string))].join('\t')
    )
    try {
      await navigator.clipboard.writeText([header, ...lines].join('\n'))
      toast.success(`정책 ${rows.length}건의 객체 수를 클립보드에 복사했습니다.`)
    } catch {
      toast.error('클립보드 복사에 실패했습니다.')
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:h-full">
      {/* 왼쪽: 입력 — 결과가 늘어나도 입력창이 밀려나지 않도록 열을 분리한다 */}
      <section aria-label="붙여넣기 입력" className="space-y-2 min-w-0 lg:overflow-y-auto lg:pr-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-13 font-semibold text-ds-on-surface">엑셀에서 복사해 붙여넣기</h3>
          <button
            type="button"
            onClick={handleCopyTemplate}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
          >
            <Copy className="w-3.5 h-3.5" /> 템플릿 복사
          </button>
        </div>
        <details className="text-xs text-ds-on-surface-variant group">
          <summary className="cursor-pointer select-none font-medium hover:text-ds-on-surface">컬럼 안내</summary>
          <p className="mt-1.5 leading-relaxed">
            첫 줄에 헤더({TEMPLATE_HEADER.join('/')})를 포함해 복사하세요.
            정책명이 비어 있는 행은 바로 위 정책의 연속(다중값 이어붙임)으로 처리됩니다.
          </p>
        </details>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={TEMPLATE}
          rows={10}
          aria-label="붙여넣을 정책 목록"
          className="font-mono text-xs"
        />
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="gradient"
            size="auto"
            onClick={handleParse}
            disabled={!text.trim()}
            className="px-4 py-1.5 text-sm font-bold rounded-md"
          >
            파싱
          </Button>
          {unknownColumns.length > 0 && (
            <span className="text-xs text-amber-700 text-right">알 수 없는 컬럼(무시됨): {unknownColumns.join(', ')}</span>
          )}
        </div>

        {skippedLines.length > 0 && (
          <div className="rounded-lg border border-ds-error/30 bg-ds-error/5 px-3 py-2 space-y-1">
            <p className="flex items-start gap-1.5 text-xs font-semibold text-ds-error">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> 파싱하지 못한 줄 {skippedLines.length}건 — 헤더 매핑이 어긋났거나 정책명 없이 단독으로 붙여넣힌 줄입니다.
            </p>
            <ul className="text-11 text-ds-error/80 font-mono space-y-0.5 max-h-24 overflow-y-auto">
              {skippedLines.map((s) => (
                <li key={s.line} className="truncate">#{s.line}: {s.raw || '(빈 줄)'}</li>
              ))}
            </ul>
          </div>
        )}
        {children}
      </section>

      {/* 오른쪽: 결과 */}
      <section aria-label="파싱 결과" className="space-y-3 min-w-0 lg:overflow-y-auto lg:pr-1">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ds-outline-variant/40 px-4 py-10 text-center text-xs text-ds-on-surface-variant leading-relaxed">
            왼쪽에 붙여넣고 <strong className="font-semibold text-ds-on-surface">파싱</strong>을 누르면<br />정책 목록이 여기에 표시됩니다.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-13 font-semibold text-ds-on-surface">파싱된 정책 {rows.length}건 <span className="font-normal text-ds-on-surface-variant">· 이 순서대로 추가됩니다</span></span>
              <button
                type="button"
                onClick={handleCopyCounts}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-ds-on-surface-variant bg-ds-surface-container-low rounded-lg border border-ds-outline-variant/10 hover:text-ds-on-surface transition-colors"
              >
                <ClipboardList className="w-3.5 h-3.5" /> 객체 수 복사
              </button>
            </div>
            <div className="border border-ds-outline-variant/20 rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>정책명</TableHead>
                    <TableHead>액션</TableHead>
                    <TableHead>출발지</TableHead>
                    <TableHead>목적지</TableHead>
                    <TableHead>서비스</TableHead>
                    <TableHead>애플리케이션</TableHead>
                    <TableHead className="w-10"><span className="sr-only">삭제</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.row_index}>
                      <TableCell className="py-1.5 tabular-nums text-ds-on-surface-variant">{row.row_index + 1}</TableCell>
                      <TableCell className="py-1.5 font-medium">{row.rule_name}</TableCell>
                      <TableCell className="py-1.5">{row.rule_action}</TableCell>
                      <TableCell className="py-1.5"><MultiValueCell value={row.source} /></TableCell>
                      <TableCell className="py-1.5"><MultiValueCell value={row.destination} /></TableCell>
                      <TableCell className="py-1.5"><MultiValueCell value={row.service} /></TableCell>
                      <TableCell className="py-1.5"><MultiValueCell value={row.application} /></TableCell>
                      <TableCell className="py-1.5">
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.row_index)}
                          aria-label={`${row.rule_name} 제거`}
                          className="p-1 rounded text-ds-on-surface-variant hover:text-ds-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
