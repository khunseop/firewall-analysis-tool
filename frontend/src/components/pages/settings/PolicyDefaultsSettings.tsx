import { useId, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getSettings, updateSetting } from '@/api/settings'
import { queryKeys } from '@/api/queryKeys'
import { errorMessage } from '@/lib/errorMessage'
import { SettingsSaveBar } from './SettingsSaveBar'
import { useReportDirty } from './dirtyContext'

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
  const uid = useId()
  const { data: settings = [], isLoading, isError, refetch } = useQuery({ queryKey: queryKeys.settings, queryFn: getSettings })
  const serverValues = useMemo<PolicyBuilderDefaults>(() => {
    const s = settings.find((x) => x.key === POLICY_BUILDER_DEFAULTS_KEY)
    if (!s) return DEFAULT_POLICY_BUILDER_DEFAULTS
    try { return { ...DEFAULT_POLICY_BUILDER_DEFAULTS, ...JSON.parse(s.value) } } catch { return DEFAULT_POLICY_BUILDER_DEFAULTS }
  }, [settings])
  // 서버 값 위에 편집본을 얹는 방식 — 캐시된 설정으로 탭을 열어도 저장된 값이 보이고, 저장 전에는 서버 값이 기준이다.
  const [draft, setDraft] = useState<PolicyBuilderDefaults | null>(null)
  const values = draft ?? serverValues
  const dirty = draft !== null && FIELD_LABELS.some(({ key }) => draft[key] !== serverValues[key])
  // PAN-OS는 값이 아예 없는 필드를 허용하지 않는다. log-setting만 비워둘 수 있다.
  const emptyKeys = FIELD_LABELS.filter(({ key }) => key !== 'log_setting' && !values[key].trim()).map((f) => f.key)
  useReportDirty(dirty)

  const saveMutation = useMutation({
    mutationFn: () => updateSetting(POLICY_BUILDER_DEFAULTS_KEY, JSON.stringify(values)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      setDraft(null)
      toast.success('정책 생성 기본값이 저장되었습니다.')
    },
    onError: (e: unknown) => toast.error(errorMessage(e, '정책 생성 기본값을 저장하지 못했습니다. 잠시 후 다시 시도하세요.')),
  })

  if (isLoading) return <div className="py-8 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>
  if (isError) {
    return (
      <div role="alert" className="py-8 text-center text-sm text-ds-error">
        설정을 불러오지 못했습니다.{' '}
        <button type="button" onClick={() => refetch()} className="font-semibold underline">다시 시도</button>
      </div>
    )
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (dirty && emptyKeys.length === 0) saveMutation.mutate() }} className="space-y-4">
      <p className="text-sm text-ds-on-surface-variant max-w-3xl">
        Policies 편집모드에서 신규 정책을 만들 때, 붙여넣은 데이터에 컬럼이 없거나 값이 비어 있는 필드에
        자동으로 채워지는 기본값입니다. PAN-OS는 값이 아예 없는 필드를 허용하지 않으므로 비워두면 안 됩니다
        (단, log-setting은 로그 포워딩 프로파일을 지정하지 않는 것도 유효한 상태라 비워둘 수 있습니다).
      </p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 max-w-2xl">
        {FIELD_LABELS.map(({ key, label }) => {
          const empty = emptyKeys.includes(key)
          return (
            <div key={key} className="space-y-1">
              <label htmlFor={`${uid}-${key}`} className="text-xs font-semibold text-ds-on-surface-variant">{label}</label>
              <input
                id={`${uid}-${key}`}
                value={values[key]}
                onChange={(e) => setDraft({ ...values, [key]: e.target.value })}
                aria-invalid={empty}
                className="w-full h-8 px-2 text-sm font-mono bg-ds-surface-container-lowest border border-ds-outline-variant/20 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40 focus:border-ds-tertiary aria-[invalid=true]:border-ds-error"
              />
              {empty && <p className="text-xs text-ds-error">비워둘 수 없습니다.</p>}
            </div>
          )
        })}
      </div>

      <SettingsSaveBar
        dirty={dirty}
        saving={saveMutation.isPending}
        blockedReason={emptyKeys.length > 0 ? '비어 있는 필수 필드가 있습니다.' : null}
        onSave={() => saveMutation.mutate()}
        onRevert={() => setDraft(null)}
      />
    </form>
  )
}
