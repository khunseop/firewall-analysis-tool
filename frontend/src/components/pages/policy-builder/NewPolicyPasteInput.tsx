import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { parsePastedPolicies } from '@/lib/policyBuilderParse'
import type { NewPolicyRow } from '@/api/policyBuilder'

const SAMPLE_HEADER = '정책명\t액션\t출발지\t목적지\t서비스\t애플리케이션\t설명'

function countTokens(value: string): number {
  return value.split(',').map((s) => s.trim()).filter(Boolean).length
}

function MultiValueCell({ value }: { value: string }) {
  const count = countTokens(value)
  return (
    <span className="inline-flex items-center gap-1">
      <span className="truncate max-w-[220px] inline-block align-bottom">{value}</span>
      {count > 1 && <span className="text-[10px] text-ds-on-surface-variant shrink-0">({count})</span>}
    </span>
  )
}

export function NewPolicyPasteInput({ rows, onChange }: {
  rows: NewPolicyRow[]
  onChange: (rows: NewPolicyRow[]) => void
}) {
  const [text, setText] = useState('')
  const [unknownColumns, setUnknownColumns] = useState<string[]>([])

  const handleParse = () => {
    const result = parsePastedPolicies(text)
    onChange(result.rows)
    setUnknownColumns(result.unknownColumns)
  }

  const handleRemoveRow = (rowIndex: number) => {
    onChange(rows.filter((r) => r.row_index !== rowIndex).map((r, i) => ({ ...r, row_index: i })))
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-ds-on-surface-variant">
        엑셀에서 첫 줄에 헤더(정책명/액션/출발지/목적지/서비스/애플리케이션/설명 등)를 포함해 복사한 뒤 붙여넣으세요.
        정책명이 비어 있는 행은 바로 위 정책의 연속(다중값 이어붙임)으로 처리됩니다.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={SAMPLE_HEADER}
        rows={8}
        className="font-mono text-[12px]"
      />
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleParse}
          disabled={!text.trim()}
          className="px-4 py-1.5 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
        >
          파싱
        </button>
        {unknownColumns.length > 0 && (
          <span className="text-[12px] text-amber-600">알 수 없는 컬럼(무시됨): {unknownColumns.join(', ')}</span>
        )}
      </div>

      {rows.length > 0 && (
        <div className="border border-ds-outline-variant/20 rounded-lg max-h-[480px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>정책명</TableHead>
                <TableHead>액션</TableHead>
                <TableHead>출발지</TableHead>
                <TableHead>목적지</TableHead>
                <TableHead>서비스</TableHead>
                <TableHead>애플리케이션</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.row_index}>
                  <TableCell className="font-medium">{row.rule_name}</TableCell>
                  <TableCell>{row.rule_action}</TableCell>
                  <TableCell><MultiValueCell value={row.source} /></TableCell>
                  <TableCell><MultiValueCell value={row.destination} /></TableCell>
                  <TableCell><MultiValueCell value={row.service} /></TableCell>
                  <TableCell><MultiValueCell value={row.application} /></TableCell>
                  <TableCell>
                    <button type="button" onClick={() => handleRemoveRow(row.row_index)} className="text-ds-on-surface-variant hover:text-ds-error">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
