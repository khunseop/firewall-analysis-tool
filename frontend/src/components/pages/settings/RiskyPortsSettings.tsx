import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save, Plus, Trash2 } from 'lucide-react'
import { getSettings, updateSetting } from '@/api/settings'
import { queryKeys } from '@/api/queryKeys'

interface RiskyPort {
  protocol: string
  port: string
  description: string
}

export function RiskyPortsSettings() {
  const queryClient = useQueryClient()
  const { data: settings = [] } = useQuery({ queryKey: queryKeys.settings, queryFn: getSettings })
  const [rows, setRows] = useState<RiskyPort[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const s = settings.find(s => s.key === 'risky_ports')
    if (s) {
      try { setRows(JSON.parse(s.value) as RiskyPort[]) } catch { setRows([]) }
    }
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: () => updateSetting('risky_ports', JSON.stringify(rows)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      toast.success('위험 포트 설정이 저장되었습니다.')
      setDirty(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const update = (idx: number, key: keyof RiskyPort, val: string) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [key]: val } : r))
    setDirty(true)
  }

  const addRow = () => { setRows(prev => [...prev, { protocol: 'TCP', port: '', description: '' }]); setDirty(true) }

  const removeRow = (idx: number) => { setRows(prev => prev.filter((_, i) => i !== idx)); setDirty(true) }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ds-on-surface-variant">위험 포트 목록을 관리합니다. 정책 분석 시 해당 포트를 허용하는 정책이 위험으로 분류됩니다.</p>

      <div className="overflow-x-auto rounded-lg border border-ds-outline-variant/8">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-ds-outline-variant/8 bg-ds-surface-container-low/30">
              <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 w-28">프로토콜</th>
              <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 w-36">포트</th>
              <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">설명</th>
              <th className="px-4 py-2.5 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ds-outline-variant/8">
            {rows.map((row, idx) => (
              <tr key={idx} className="hover:bg-ds-surface-container-low/20">
                <td className="px-4 py-2">
                  <select
                    value={row.protocol}
                    onChange={(e) => update(idx, 'protocol', e.target.value)}
                    className="w-full h-8 px-2 text-sm bg-ds-surface-container-lowest border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
                  >
                    {['TCP', 'UDP', 'ICMP', 'ANY'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <input
                    value={row.port}
                    onChange={(e) => update(idx, 'port', e.target.value)}
                    placeholder="예: 23, 3389"
                    className="w-full h-8 px-2 text-sm font-mono bg-ds-surface-container-lowest border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    value={row.description}
                    onChange={(e) => update(idx, 'description', e.target.value)}
                    placeholder="예: Telnet"
                    className="w-full h-8 px-2 text-sm bg-ds-surface-container-lowest border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => removeRow(idx)} className="p-1 rounded hover:bg-red-50 text-ds-error transition-colors" title="삭제">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-ds-on-surface-variant italic">등록된 위험 포트가 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={addRow}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-tertiary bg-ds-tertiary/10 rounded-lg border border-ds-tertiary/20 hover:bg-ds-tertiary/15 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          포트 추가
        </button>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || saveMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold text-ds-on-tertiary btn-primary-gradient rounded-lg shadow-sm disabled:opacity-50 transition-all"
        >
          <Save className="w-3.5 h-3.5" />
          저장
        </button>
        {dirty && <span className="text-[11px] text-amber-600 font-semibold">저장되지 않은 변경사항이 있습니다</span>}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// 계정 관리
// ──────────────────────────────────────────────────────────────────
