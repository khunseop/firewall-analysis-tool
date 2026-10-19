import { useId, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getSettings, updateSetting } from '@/api/settings'
import { queryKeys } from '@/api/queryKeys'
import { errorMessage } from '@/lib/errorMessage'
import { SettingsSaveBar } from './SettingsSaveBar'
import { useReportDirty } from './dirtyContext'

/** 설정 키별 화면 이름·검증. 목록에 없는 키는 키 이름을 그대로 보여준다. */
const SETTING_META: Record<string, { label: string; integerMin?: number }> = {
  sync_parallel_limit: { label: '동기화 병렬 처리 개수', integerMin: 1 },
}

function fieldError(key: string, value: string): string | null {
  const min = SETTING_META[key]?.integerMin
  if (min === undefined) return null
  if (!/^\d+$/.test(value.trim()) || Number(value) < min) return `${min} 이상의 정수를 입력하세요.`
  return null
}

export function GeneralSettings() {
  const queryClient = useQueryClient()
  const uid = useId()
  const { data: settings = [], isLoading, isError, refetch } = useQuery({ queryKey: queryKeys.settings, queryFn: getSettings })
  // 서버 값 위에 "바꾼 값"만 얹어 둔다 — 서버 값이 다시 로드돼도 편집 중인 값이 덮어써지지 않는다.
  const [edits, setEdits] = useState<Record<string, string>>({})

  // 별도 탭에서 관리하는 키 제외
  const generalSettings = useMemo(
    () => settings.filter((s) => !['risky_ports', 'deletion_workflow_config', 'policy_builder_defaults'].includes(s.key)),
    [settings],
  )
  const changedKeys = generalSettings.filter((s) => edits[s.key] !== undefined && edits[s.key] !== s.value).map((s) => s.key)
  const dirty = changedKeys.length > 0
  const invalid = changedKeys.map((k) => fieldError(k, edits[k])).find(Boolean) ?? null
  useReportDirty(dirty)

  const saveMutation = useMutation({
    mutationFn: async () => { for (const key of changedKeys) await updateSetting(key, edits[key]) },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      setEdits({})
      toast.success('설정이 저장되었습니다.')
    },
    onError: (e: unknown) => toast.error(errorMessage(e, '설정을 저장하지 못했습니다. 잠시 후 다시 시도하세요.')),
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
    <form onSubmit={(e) => { e.preventDefault(); if (dirty && !invalid) saveMutation.mutate() }}>
      <div className="space-y-3">
        {generalSettings.map((s) => {
          const value = edits[s.key] ?? s.value
          const err = changedKeys.includes(s.key) ? fieldError(s.key, value) : null
          const meta = SETTING_META[s.key]
          return (
            <div key={s.key} className="bg-ds-surface-container-low/50 rounded-lg border border-ds-outline-variant/8 px-4 py-3.5">
              <label htmlFor={`${uid}-${s.key}`} className="text-13 font-semibold text-ds-on-surface">{meta?.label ?? s.key}</label>
              {meta && <span className="ml-2 font-mono text-11 text-ds-on-surface-variant">{s.key}</span>}
              {s.description && <p id={`${uid}-${s.key}-desc`} className="text-xs text-ds-on-surface-variant mt-0.5">{s.description}</p>}
              <input
                id={`${uid}-${s.key}`}
                value={value}
                onChange={(e) => setEdits((prev) => ({ ...prev, [s.key]: e.target.value }))}
                aria-invalid={!!err}
                aria-describedby={s.description ? `${uid}-${s.key}-desc` : undefined}
                className="mt-2.5 w-full max-w-sm h-8 px-3 text-xs bg-white border border-ds-outline-variant/30 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40 focus:border-ds-tertiary aria-[invalid=true]:border-ds-error"
              />
              {err && <p className="mt-1 text-xs text-ds-error">{err}</p>}
            </div>
          )
        })}
        {generalSettings.length === 0 && <p className="py-6 text-center text-sm text-ds-on-surface-variant">표시할 일반 설정이 없습니다.</p>}
      </div>
      <SettingsSaveBar dirty={dirty} saving={saveMutation.isPending} blockedReason={invalid} onSave={() => saveMutation.mutate()} onRevert={() => setEdits({})} />
    </form>
  )
}
