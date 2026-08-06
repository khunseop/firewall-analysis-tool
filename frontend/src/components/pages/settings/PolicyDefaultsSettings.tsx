import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { getSettings, updateSetting } from '@/api/settings'
import { queryKeys } from '@/api/queryKeys'

const POLICY_BUILDER_DEFAULTS_KEY = 'policy_builder_defaults'

interface PolicyBuilderDefaults {
  from_zone: string
  source: string
  source_user: string
  to_zone: string
  destination: string
  service: string
  application: string
  log_end: string
  log_setting: string
}

const DEFAULT_POLICY_BUILDER_DEFAULTS: PolicyBuilderDefaults = {
  from_zone: 'any', source: 'any', source_user: 'any',
  to_zone: 'any', destination: 'any', service: 'any', application: 'any',
  log_end: 'yes', log_setting: '',
}

const FIELD_LABELS: { key: keyof PolicyBuilderDefaults; label: string }[] = [
  { key: 'from_zone', label: 'from (출발지 존)' },
  { key: 'source', label: 'source (출발지)' },
  { key: 'source_user', label: 'source-user' },
  { key: 'to_zone', label: 'to (목적지 존)' },
  { key: 'destination', label: 'destination (목적지)' },
  { key: 'service', label: 'service' },
  { key: 'application', label: 'application' },
  { key: 'log_end', label: 'log-end' },
  { key: 'log_setting', label: 'log-setting (로그 포워딩 프로파일, 비워두면 미지정)' },
]

export function PolicyDefaultsSettings() {
  const queryClient = useQueryClient()
  const { data: settings = [] } = useQuery({ queryKey: queryKeys.settings, queryFn: getSettings })
  const [values, setValues] = useState<PolicyBuilderDefaults>(DEFAULT_POLICY_BUILDER_DEFAULTS)
  const [dirty, setDirty] = useState(false)

  const [prevSettings, setPrevSettings] = useState(settings)
  if (settings !== prevSettings) {
    setPrevSettings(settings)
    const s = settings.find((s) => s.key === POLICY_BUILDER_DEFAULTS_KEY)
    if (s) {
      try { setValues({ ...DEFAULT_POLICY_BUILDER_DEFAULTS, ...JSON.parse(s.value) }) } catch { /* 무시 */ }
    }
  }

  const saveMutation = useMutation({
    mutationFn: () => updateSetting(POLICY_BUILDER_DEFAULTS_KEY, JSON.stringify(values)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      toast.success('정책 생성 기본값이 저장되었습니다.')
      setDirty(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const update = (key: keyof PolicyBuilderDefaults, val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }))
    setDirty(true)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ds-on-surface-variant">
        Policies 편집모드에서 신규 정책을 생성할 때, 붙여넣은 데이터에 컬럼이 없거나 값이 비어 있는 필드에
        자동으로 채워지는 기본값입니다. PAN-OS는 값이 아예 없는 필드를 허용하지 않으므로 비워두면 안 됩니다
        (단, log-setting은 로그 포워딩 프로파일을 지정하지 않는 것도 유효한 상태라 비워둘 수 있습니다).
      </p>

      <div className="grid grid-cols-2 gap-3 max-w-2xl">
        {FIELD_LABELS.map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <label className="text-[11px] font-semibold text-ds-on-surface-variant">{label}</label>
            <input
              value={values[key]}
              onChange={(e) => update(key, e.target.value)}
              className="w-full h-8 px-2 text-sm font-mono bg-ds-surface-container-lowest border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
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
