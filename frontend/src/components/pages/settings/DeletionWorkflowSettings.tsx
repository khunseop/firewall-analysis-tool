import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Save, ChevronDown, ChevronUp, Download, Upload } from 'lucide-react'
import { getDeletionWorkflowConfig, updateDeletionWorkflowConfig, exportDeletionWorkflowConfig, importDeletionWorkflowConfig, getDeletionWorkflowConfigYaml, updateDeletionWorkflowConfigYaml } from '@/api/settings'
import { listDevices } from '@/api/devices'
import { queryKeys } from '@/api/queryKeys'
import { ExceptionTable, type ExceptionItem } from './ExceptionTable'
import { DuplicatePolicyTable, type DuplicatePolicyItem } from './DuplicatePolicyTable'

export function DeletionWorkflowSettings() {
  const queryClient = useQueryClient()
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [dirty, setDirty] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [yamlText, setYamlText] = useState('')
  const [yamlDirty, setYamlDirty] = useState(false)
  const [yamlSaving, setYamlSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.deletionWorkflowConfig,
    queryFn: getDeletionWorkflowConfig,
  })

  const { data: devices = [] } = useQuery({
    queryKey: queryKeys.devices,
    queryFn: listDevices,
  })

  useEffect(() => {
    if (data) setConfig(data)
  }, [data])

  useEffect(() => {
    if (!advancedOpen) return
    getDeletionWorkflowConfigYaml()
      .then((yaml) => { setYamlText(yaml); setYamlDirty(false) })
      .catch(() => toast.error('YAML 설정 로드에 실패했습니다.'))
  }, [advancedOpen])

  const handleYamlSave = async () => {
    setYamlSaving(true)
    try {
      await updateDeletionWorkflowConfigYaml(yamlText)
      await queryClient.invalidateQueries({ queryKey: queryKeys.deletionWorkflowConfig })
      toast.success('YAML 설정이 저장되었습니다.')
      setYamlDirty(false)
    } catch {
      toast.error('YAML 저장에 실패했습니다. 형식을 확인해 주세요.')
    } finally {
      setYamlSaving(false)
    }
  }

  const saveMutation = useMutation({
    mutationFn: () => updateDeletionWorkflowConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.deletionWorkflowConfig })
      toast.success('설정이 저장되었습니다.')
      setDirty(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleExport = async () => {
    try {
      const { blob, filename } = await exportDeletionWorkflowConfig()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('백업 파일 다운로드에 실패했습니다.')
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      await importDeletionWorkflowConfig(file)
      await queryClient.invalidateQueries({ queryKey: queryKeys.deletionWorkflowConfig })
      setDirty(false)
      toast.success('설정이 복구되었습니다.')
    } catch {
      toast.error('설정 복구에 실패했습니다. JSON 형식을 확인하세요.')
    } finally {
      setImporting(false)
      if (importRef.current) importRef.current.value = ''
    }
  }

  const getExceptions = (key: string): ExceptionItem[] =>
    ((config as { exceptions?: Record<string, unknown> }).exceptions?.[key] ?? []) as ExceptionItem[]

  const setExceptions = (key: string, items: ExceptionItem[]) => {
    setConfig((prev) => ({
      ...prev,
      exceptions: { ...(prev.exceptions as Record<string, unknown> ?? {}), [key]: items },
    }))
    setDirty(true)
  }

  const addItem = (key: string, keyField: 'id' | 'name' | 'pattern') => {
    setExceptions(key, [...getExceptions(key), { [keyField]: '', reason: '' } as ExceptionItem])
  }

  const removeItem = (key: string, idx: number) => {
    setExceptions(key, getExceptions(key).filter((_, i) => i !== idx))
  }

  const updateItem = (key: string, idx: number, patch: Partial<ExceptionItem>) => {
    setExceptions(key, getExceptions(key).map((item, i) => i === idx ? { ...item, ...patch } : item))
  }

  const getCriteria = () => (config as { analysis_criteria?: Record<string, number> }).analysis_criteria ?? {}
  const setCriteria = (patch: Record<string, number>) => {
    setConfig((prev) => ({ ...prev, analysis_criteria: { ...(prev.analysis_criteria as Record<string, number> ?? {}), ...patch } }))
    setDirty(true)
  }

  if (isLoading) return <div className="py-8 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>

  return (
    <div className="space-y-6">
      {/* 예외 설정 */}
      <div className="space-y-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">예외 설정</p>
        <ExceptionTable
          title="신청번호 예외"
          items={getExceptions('request_ids')}
          keyField="id"
          keyPlaceholder="신청번호 (예: REQ-1234)"
          onAdd={() => addItem('request_ids', 'id')}
          onRemove={(i) => removeItem('request_ids', i)}
          onUpdate={(i, patch) => updateItem('request_ids', i, patch)}
        />
        <ExceptionTable
          title="고정 예외 목록 (정책명 완전일치)"
          items={getExceptions('static_list')}
          keyField="name"
          keyPlaceholder="정책명"
          onAdd={() => addItem('static_list', 'name')}
          onRemove={(i) => removeItem('static_list', i)}
          onUpdate={(i, patch) => updateItem('static_list', i, patch)}
        />
      </div>

      {/* 중복정책 예외 (장비별, Task 17 자동 주입) */}
      <div className="space-y-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">중복정책 예외</p>
        <DuplicatePolicyTable
          items={(getExceptions('duplicate_policies') as unknown as DuplicatePolicyItem[])}
          devices={devices}
          onAdd={() => {
            const today = new Date().toISOString().slice(0, 10)
            setExceptions('duplicate_policies', [
              ...(getExceptions('duplicate_policies') as unknown as DuplicatePolicyItem[]),
              { device_id: 0, name: '', reason: '', registered_at: today, expires_at: '' },
            ] as unknown as ExceptionItem[])
          }}
          onRemove={(i) => {
            const items = (getExceptions('duplicate_policies') as unknown as DuplicatePolicyItem[])
            setExceptions('duplicate_policies', items.filter((_, idx) => idx !== i) as unknown as ExceptionItem[])
          }}
          onUpdate={(i, patch) => {
            const items = (getExceptions('duplicate_policies') as unknown as DuplicatePolicyItem[])
            setExceptions('duplicate_policies', items.map((item, idx) => idx === i ? { ...item, ...patch } : item) as unknown as ExceptionItem[])
          }}
          onBulkAdd={(newItems) => {
            const existing = (getExceptions('duplicate_policies') as unknown as DuplicatePolicyItem[])
            setExceptions('duplicate_policies', [...existing, ...newItems] as unknown as ExceptionItem[])
          }}
        />
      </div>

      {/* 분석 기준 */}
      <div className="space-y-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">분석 기준</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-ds-surface-container-low/50 rounded-lg border border-ds-outline-variant/8 px-4 py-3">
            <p className="text-[12px] font-semibold text-ds-on-surface">신규정책 기준 (일)</p>
            <p className="text-[11px] text-ds-on-surface-variant/70 mt-0.5 mb-2">이 기간 이내에 생성된 정책은 신규정책으로 분류됩니다.</p>
            <input
              type="number" min={1} max={3650}
              value={getCriteria().recent_policy_days ?? 90}
              onChange={(e) => setCriteria({ recent_policy_days: Number(e.target.value) })}
              className="w-24 h-8 px-3 text-[12px] text-center bg-white border border-ds-outline-variant/30 rounded-lg focus:outline-none focus:border-ds-tertiary"
            />
          </div>
          <div className="bg-ds-surface-container-low/50 rounded-lg border border-ds-outline-variant/8 px-4 py-3">
            <p className="text-[12px] font-semibold text-ds-on-surface">미사용 기준 (일)</p>
            <p className="text-[11px] text-ds-on-surface-variant/70 mt-0.5 mb-2">이 기간 동안 hit가 없는 정책은 미사용으로 분류됩니다.</p>
            <input
              type="number" min={1} max={3650}
              value={getCriteria().unused_threshold_days ?? 90}
              onChange={(e) => setCriteria({ unused_threshold_days: Number(e.target.value) })}
              className="w-24 h-8 px-3 text-[12px] text-center bg-white border border-ds-outline-variant/30 rounded-lg focus:outline-none focus:border-ds-tertiary"
            />
          </div>
        </div>
      </div>

      {/* 고급 설정 — YAML 직접 편집 */}
      <div className="border border-ds-outline-variant/8 rounded-lg overflow-hidden">
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-ds-surface-container-low/30 hover:bg-ds-surface-container-low/50 transition-colors text-left"
        >
          <span className="text-[12px] font-semibold text-ds-on-surface-variant">고급 설정 (YAML 직접 편집)</span>
          {advancedOpen ? <ChevronUp className="w-4 h-4 text-ds-on-surface-variant" /> : <ChevronDown className="w-4 h-4 text-ds-on-surface-variant" />}
        </button>
        {advancedOpen && (
          <div className="p-4 space-y-3 border-t border-ds-outline-variant/8">
            <p className="text-[11px] text-ds-on-surface-variant/70">
              전체 설정을 YAML로 직접 편집합니다. 저장하면 fpat.yaml과 DB에 동시에 반영됩니다.
            </p>
            <textarea
              value={yamlText}
              onChange={(e) => { setYamlText(e.target.value); setYamlDirty(true) }}
              spellCheck={false}
              rows={30}
              className="w-full px-3 py-2 text-[12px] font-mono leading-relaxed bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary resize-y"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={handleYamlSave}
                disabled={!yamlDirty || yamlSaving}
                className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold text-ds-on-tertiary btn-primary-gradient rounded-lg shadow-sm disabled:opacity-50 transition-all"
              >
                <Save className="w-3.5 h-3.5" />
                {yamlSaving ? '저장 중…' : 'YAML 저장'}
              </button>
              {yamlDirty && (
                <span className="text-[11px] text-amber-600">저장되지 않은 변경사항이 있습니다.</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 저장 / 백업 / 복구 */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || saveMutation.isPending}
          className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold text-ds-on-tertiary btn-primary-gradient rounded-lg shadow-sm disabled:opacity-50 transition-all"
        >
          <Save className="w-3.5 h-3.5" />
          {saveMutation.isPending ? '저장 중…' : '저장'}
        </button>
        <div className="h-5 w-px bg-ds-outline-variant/30" />
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container border border-ds-outline-variant/30 rounded-lg hover:bg-ds-surface-container-high transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          백업
        </button>
        <button
          onClick={() => importRef.current?.click()}
          disabled={importing}
          className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-ds-on-surface-variant bg-ds-surface-container border border-ds-outline-variant/30 rounded-lg hover:bg-ds-surface-container-high disabled:opacity-50 transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />
          {importing ? '복구 중…' : '복구'}
        </button>
        <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        {dirty && <span className="text-[11px] text-amber-600 font-semibold">저장되지 않은 변경사항이 있습니다</span>}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────
