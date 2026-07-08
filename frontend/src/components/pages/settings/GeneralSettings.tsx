import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { getSettings, updateSetting } from '@/api/settings'
import { queryKeys } from '@/api/queryKeys'

// ──────────────────────────────────────────────────────────────────
// 일반 설정
// ──────────────────────────────────────────────────────────────────
export function GeneralSettings() {
  const queryClient = useQueryClient()
  const { data: settings = [], isLoading } = useQuery({ queryKey: queryKeys.settings, queryFn: getSettings })
  const [values, setValues] = useState<Record<string, string>>({})

  // 서버 설정이 갱신되면 편집값 재동기화 (렌더 중 상태 조정 패턴)
  const [prevSettings, setPrevSettings] = useState(settings)
  if (settings !== prevSettings) {
    setPrevSettings(settings)
    if (settings.length > 0) {
      const map: Record<string, string> = {}
      settings.forEach((s) => { map[s.key] = s.value })
      setValues(map)
    }
  }

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => updateSetting(key, value),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.settings }); toast.success('설정이 저장되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) return <div className="py-8 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>

  // 별도 탭에서 관리하는 키 제외
  const generalSettings = settings.filter(s => !['risky_ports', 'deletion_workflow_config'].includes(s.key))

  return (
    <div className="space-y-3">
      {generalSettings.map((s) => (
        <div key={s.key} className="bg-ds-surface-container-low/50 rounded-lg border border-ds-outline-variant/8 px-4 py-3.5">
          <p className="text-[12px] font-semibold text-ds-on-surface">{s.key}</p>
          {s.description && <p className="text-[11px] text-ds-on-surface-variant/70 mt-0.5 mb-3">{s.description}</p>}
          <div className="flex gap-2 mt-2">
            <input
              value={values[s.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [s.key]: e.target.value }))}
              className="flex-1 max-w-sm h-8 px-3 text-[12px] bg-white border border-ds-outline-variant/30 rounded-lg focus:outline-none focus:border-ds-tertiary"
            />
            <button
              onClick={() => updateMutation.mutate({ key: s.key, value: values[s.key] ?? '' })}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-ds-on-tertiary btn-primary-gradient rounded-lg shadow-sm disabled:opacity-50"
            >
              <Save className="w-3 h-3" />
              저장
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// 위험 포트 설정
// ──────────────────────────────────────────────────────────────────
