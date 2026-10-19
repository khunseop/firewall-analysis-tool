import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { getSettings, updateSetting } from '@/api/settings'
import { queryKeys } from '@/api/queryKeys'
import { errorMessage } from '@/lib/errorMessage'
import { SettingsSaveBar } from './SettingsSaveBar'
import { useReportDirty } from './dirtyContext'
import { parseRiskyPorts, sameRiskyRows, serializeRiskyPorts, validatePorts, type RiskyPortRow } from './settingsModel'

const INPUT = 'w-full h-8 px-2 text-sm bg-ds-surface-container-lowest border border-ds-outline-variant/20 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40 focus:border-ds-tertiary aria-[invalid=true]:border-ds-error'
const TH = 'px-4 py-2.5 text-11 font-semibold text-ds-on-surface-variant'

export function RiskyPortsSettings() {
  const queryClient = useQueryClient()
  const { data: settings = [], isLoading, isError, refetch } = useQuery({ queryKey: queryKeys.settings, queryFn: getSettings })
  const serverRows = useMemo(() => parseRiskyPorts(settings.find((s) => s.key === 'risky_ports')?.value), [settings])
  // 서버 값 위에 편집본(draft)을 얹는 방식 — 이미 캐시된 설정으로 탭을 열어도 목록이 비지 않고, 저장 전까지는 서버 값이 기준이다.
  const [draft, setDraft] = useState<RiskyPortRow[] | null>(null)
  const nextId = useRef(0)
  const rows = draft ?? serverRows
  const dirty = draft !== null && !sameRiskyRows(draft, serverRows)
  const portErrors = rows.map((r) => (dirty ? validatePorts(r.port) : null))
  const firstError = portErrors.find(Boolean) ?? null
  useReportDirty(dirty)

  const saveMutation = useMutation({
    mutationFn: () => updateSetting('risky_ports', serializeRiskyPorts(rows)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      setDraft(null)
      toast.success('위험 포트 설정이 저장되었습니다.')
    },
    onError: (e: unknown) => toast.error(errorMessage(e, '위험 포트를 저장하지 못했습니다. 잠시 후 다시 시도하세요.')),
  })

  const edit = (fn: (prev: RiskyPortRow[]) => RiskyPortRow[]) => setDraft(fn(rows))
  const update = (id: string, patch: Partial<RiskyPortRow>) => edit((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const addRow = () => edit((prev) => [...prev, { id: `new-${nextId.current++}`, protocol: 'TCP', port: '', description: '' }])
  const removeRow = (id: string) => edit((prev) => prev.filter((r) => r.id !== id))

  if (isLoading) return <div className="py-8 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>
  if (isError) {
    return (
      <div role="alert" className="py-8 text-center text-sm text-ds-error">
        위험 포트 설정을 불러오지 못했습니다.{' '}
        <button type="button" onClick={() => refetch()} className="font-semibold underline">다시 시도</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ds-on-surface-variant">
        정책 분석에서 이 포트를 허용하는 정책이 위험으로 분류됩니다. 저장한 뒤 새로 실행하는 위험 포트 분석부터 적용되고, 이미 끝난 분석 결과는 바뀌지 않습니다.
      </p>

      <div className="overflow-x-auto rounded-lg border border-ds-outline-variant/8">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-ds-outline-variant/8 bg-ds-surface-container-low/30">
              <th className={`${TH} w-28`}>프로토콜</th>
              <th className={`${TH} w-56`}>포트</th>
              <th className={TH}>설명</th>
              <th className="px-4 py-2.5 w-12"><span className="sr-only">삭제</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ds-outline-variant/8">
            {rows.map((row, idx) => (
              <tr key={row.id} className="align-top hover:bg-ds-surface-container-low/20">
                <td className="px-4 py-2">
                  <select
                    aria-label={`${idx + 1}번째 프로토콜`}
                    value={row.protocol}
                    onChange={(e) => update(row.id, { protocol: e.target.value as RiskyPortRow['protocol'] })}
                    className={INPUT}
                  >
                    {['TCP', 'UDP'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <input
                    aria-label={`${idx + 1}번째 포트`}
                    aria-invalid={!!portErrors[idx]}
                    value={row.port}
                    onChange={(e) => update(row.id, { port: e.target.value })}
                    placeholder="예: 23, 3389, 8000-8100"
                    className={`${INPUT} font-mono`}
                  />
                  {portErrors[idx] && <p className="mt-1 text-xs text-ds-error">{portErrors[idx]}</p>}
                </td>
                <td className="px-4 py-2">
                  <input
                    aria-label={`${idx + 1}번째 설명`}
                    value={row.description}
                    onChange={(e) => update(row.id, { description: e.target.value })}
                    placeholder="예: Telnet"
                    className={INPUT}
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    aria-label={`${idx + 1}번째 위험 포트 삭제`}
                    title="삭제"
                    className="p-1.5 rounded hover:bg-ds-error/10 text-ds-error transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-ds-on-surface-variant">
                  등록된 위험 포트가 없습니다. <strong className="font-semibold text-ds-on-surface">포트 추가</strong>로 시작하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ds-tertiary bg-ds-tertiary/10 rounded-lg border border-ds-tertiary/20 hover:bg-ds-tertiary/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
      >
        <Plus className="w-3.5 h-3.5" />
        포트 추가
      </button>

      <SettingsSaveBar
        dirty={dirty}
        saving={saveMutation.isPending}
        blockedReason={firstError ? '포트 입력을 확인하세요.' : null}
        onSave={() => saveMutation.mutate()}
        onRevert={() => setDraft(null)}
      />
    </div>
  )
}
