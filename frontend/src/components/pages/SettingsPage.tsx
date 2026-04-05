import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { getSettings, updateSetting, getDeletionWorkflowConfig, updateDeletionWorkflowConfig } from '@/api/settings'

type Tab = 'general' | 'workflow'

function GeneralSettings() {
  const queryClient = useQueryClient()
  const { data: settings = [], isLoading } = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (settings.length > 0) {
      const map: Record<string, string> = {}
      settings.forEach((s) => { map[s.key] = s.value })
      setValues(map)
    }
  }, [settings])

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => updateSetting(key, value),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings'] }); toast.success('설정이 저장되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) return <div className="py-8 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>

  return (
    <div className="space-y-5">
      {settings.map((s) => (
        <div key={s.key} className="bg-ds-surface-container-low rounded-lg p-4">
          <p className="text-sm font-bold text-ds-on-surface font-headline">{s.key}</p>
          {s.description && <p className="text-xs text-ds-on-surface-variant mt-0.5 mb-3">{s.description}</p>}
          <div className="flex gap-2 mt-2">
            <input
              id={s.key}
              value={values[s.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [s.key]: e.target.value }))}
              className="flex-1 max-w-sm h-9 px-3 text-sm bg-ds-surface-container-lowest border border-ds-outline-variant/30 rounded-md focus:outline-none focus:border-ds-tertiary focus:ring-1 focus:ring-ds-tertiary"
            />
            <button
              onClick={() => updateMutation.mutate({ key: s.key, value: values[s.key] ?? '' })}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              저장
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function WorkflowConfigSettings() {
  const queryClient = useQueryClient()
  const { data: config, isLoading } = useQuery({ queryKey: ['workflow-config'], queryFn: getDeletionWorkflowConfig })
  const [rawJson, setRawJson] = useState('')
  const [jsonError, setJsonError] = useState('')

  useEffect(() => {
    if (config) setRawJson(JSON.stringify(config, null, 2))
  }, [config])

  const updateMutation = useMutation({
    mutationFn: (cfg: Record<string, unknown>) => updateDeletionWorkflowConfig(cfg),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['workflow-config'] }); toast.success('설정이 저장되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSave = () => {
    try {
      const parsed = JSON.parse(rawJson)
      setJsonError('')
      updateMutation.mutate(parsed)
    } catch {
      setJsonError('유효하지 않은 JSON 형식입니다.')
    }
  }

  if (isLoading) return <div className="py-8 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>

  return (
    <div className="space-y-3">
      <p className="text-sm text-ds-on-surface-variant">삭제 워크플로우 설정을 JSON 형식으로 수정합니다.</p>
      <Textarea
        value={rawJson}
        onChange={(e) => { setRawJson(e.target.value); setJsonError('') }}
        rows={20}
        className="font-mono text-xs bg-ds-surface-container-low border-ds-outline-variant/30"
      />
      {jsonError && <p className="text-sm text-ds-error">{jsonError}</p>}
      <button
        onClick={handleSave}
        disabled={updateMutation.isPending}
        className="flex items-center gap-1.5 px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50"
      >
        <Save className="w-4 h-4" />
        저장
      </button>
    </div>
  )
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'general', label: '일반 설정' },
  { key: 'workflow', label: '삭제 워크플로우 설정' },
]

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('general')

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ds-on-surface font-headline">설정</h1>
        <p className="text-ds-on-surface-variant text-sm mt-1">시스템 설정을 관리합니다.</p>
      </div>

      {/* Settings panel */}
      <div className="bg-ds-surface-container-lowest rounded-xl ambient-shadow ghost-border overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center border-b border-ds-outline-variant/10 px-4 pt-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-semibold font-headline tracking-tight transition-colors duration-200 border-b-2 -mb-px ${
                activeTab === tab.key
                  ? 'text-ds-tertiary border-ds-tertiary'
                  : 'text-ds-on-surface-variant border-transparent hover:text-ds-on-surface hover:border-ds-outline-variant/30'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'general' ? <GeneralSettings /> : <WorkflowConfigSettings />}
        </div>
      </div>
    </div>
  )
}
