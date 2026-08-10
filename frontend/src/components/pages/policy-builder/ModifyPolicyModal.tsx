import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getPolicies } from '@/api/firewall'
import { queryKeys } from '@/api/queryKeys'
import { addPendingChange } from '@/api/policyBuilder'

const SAMPLE_HEADER = '정책명\t필드\t동작\t값'

const FIELD_OPTIONS: { label: string; backendField: string }[] = [
  { label: '출발지', backendField: 'source' },
  { label: '목적지', backendField: 'destination' },
  { label: '서비스', backendField: 'service' },
  { label: '애플리케이션', backendField: 'application' },
  { label: '사용자', backendField: 'user' },
  { label: 'from(존)', backendField: 'from_zone' },
  { label: 'to(존)', backendField: 'to_zone' },
]
const FIELD_LABEL_TO_BACKEND: Record<string, string> = Object.fromEntries(FIELD_OPTIONS.map((f) => [f.label, f.backendField]))
// user 필드만 그리드 필드명(user)과 백엔드 payload 키(source_user)가 다르다.
const BACKEND_FIELD_OVERRIDE: Record<string, string> = { user: 'source_user' }

interface ParsedRow {
  row_index: number
  rule_name: string
  fieldLabel: string
  action: '추가' | '삭제'
  values: string[]
  policyId: number | null
  error: string | null
}

function parsePastedText(text: string, ruleNameToId: Map<string, number>): ParsedRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const dataLines = lines[0]?.includes('정책명') ? lines.slice(1) : lines
  return dataLines.map((line, i) => {
    const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim())
    const [ruleName = '', fieldLabel = '', actionRaw = '', valueRaw = ''] = cells
    const action: '추가' | '삭제' = actionRaw.includes('삭제') || actionRaw.toLowerCase().includes('remove') || actionRaw.toLowerCase().includes('delete') ? '삭제' : '추가'
    const values = valueRaw.split(',').map((v) => v.trim()).filter(Boolean)
    const policyId = ruleNameToId.get(ruleName) ?? null

    let error: string | null = null
    if (!ruleName) error = '정책명이 비어 있습니다.'
    else if (policyId === null) error = '이 장비에서 해당 정책명을 찾을 수 없습니다.'
    else if (!FIELD_LABEL_TO_BACKEND[fieldLabel]) error = `알 수 없는 필드입니다: ${fieldLabel || '(비어있음)'}`
    else if (values.length === 0) error = '값이 비어 있습니다.'

    return { row_index: i, rule_name: ruleName, fieldLabel, action, values, policyId, error }
  })
}

export function ModifyPolicyModal({ deviceId, onClose, onApplied }: {
  deviceId: number
  onClose: () => void
  onApplied: () => void
}) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<ParsedRow[]>([])

  const { data: policies = [] } = useQuery({
    queryKey: queryKeys.policiesRaw(deviceId),
    queryFn: () => getPolicies(deviceId),
  })
  const ruleNameToId = useMemo(() => new Map(policies.filter((p) => p.enable).map((p) => [p.rule_name, p.id])), [policies])

  const handleParse = () => setRows(parsePastedText(text, ruleNameToId))

  const validRows = rows.filter((r) => !r.error)
  const errorRows = rows.filter((r) => r.error)

  const mutation = useMutation({
    mutationFn: async () => {
      const timestamp = Date.now()
      await Promise.all(validRows.map((row) => {
        const backendField = BACKEND_FIELD_OVERRIDE[FIELD_LABEL_TO_BACKEND[row.fieldLabel]] ?? FIELD_LABEL_TO_BACKEND[row.fieldLabel]
        const diff = row.action === '추가' ? { added: row.values, removed: [] } : { added: [], removed: row.values }
        return addPendingChange(deviceId, {
          change_type: 'modify', target_policy_id: row.policyId!,
          client_key: `bulk-modify-${row.policyId}-${backendField}-${row.action}-${timestamp}-${row.row_index}`,
          payload: { [backendField]: diff },
        })
      }))
    },
    onSuccess: () => {
      toast.success(`${validRows.length}건의 필드 변경이 대기중 변경사항으로 추가되었습니다.`)
      onApplied()
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl bg-ds-surface-container-lowest max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">정책 수정 — 필드 값 일괄 추가/삭제</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-[12px] text-ds-on-surface-variant">
            첫 줄에 헤더(정책명/필드/동작/값)를 포함해 붙여넣으세요. 필드는 {FIELD_OPTIONS.map((f) => f.label).join(', ')} 중 하나,
            동작은 "추가" 또는 "삭제", 값은 콤마로 여러 개 입력할 수 있습니다(삭제는 값 1개당 별도 delete 명령으로 자동 분리됩니다).
            개별 건만 추가하려면 1줄만 붙여넣으면 됩니다.
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`${SAMPLE_HEADER}\nRule_1\t출발지\t추가\t10.0.0.5,10.0.0.6\nRule_2\t서비스\t삭제\tSvc_8080`}
            rows={6}
            className="font-mono text-[12px]"
          />
          <button
            type="button"
            onClick={handleParse}
            disabled={!text.trim()}
            className="px-4 py-1.5 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
          >
            파싱
          </button>

          {rows.length > 0 && (
            <div className="border border-ds-outline-variant/20 rounded-lg max-h-[320px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>정책명</TableHead>
                    <TableHead>필드</TableHead>
                    <TableHead>동작</TableHead>
                    <TableHead>값</TableHead>
                    <TableHead>상태</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.row_index} className={row.error ? 'bg-ds-error/5' : undefined}>
                      <TableCell className="font-medium">{row.rule_name}</TableCell>
                      <TableCell>{row.fieldLabel}</TableCell>
                      <TableCell>{row.action}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{row.values.join(', ')}</TableCell>
                      <TableCell>
                        {row.error ? (
                          <span className="flex items-center gap-1 text-[11px] text-ds-error"><AlertTriangle className="w-3 h-3" />{row.error}</span>
                        ) : (
                          <span className="text-[11px] text-emerald-600">확인됨</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {errorRows.length > 0 && (
            <p className="text-[12px] text-ds-error">오류가 있는 {errorRows.length}건은 제외하고 나머지만 적용됩니다.</p>
          )}
        </div>

        <DialogFooter>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
          <button
            type="button"
            disabled={validRows.length === 0 || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
          >
            {mutation.isPending ? '적용 중…' : `대기중 변경사항으로 추가 (${validRows.length}건)`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
