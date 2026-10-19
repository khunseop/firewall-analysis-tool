import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Download, Upload, Loader2 } from 'lucide-react'
import { useExportAction } from '@/hooks/useExportAction'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { errorMessage } from '@/lib/errorMessage'
import { SettingsSaveBar } from './SettingsSaveBar'
import { useReportDirty } from './dirtyContext'
import { getDeletionWorkflowConfig, updateDeletionWorkflowConfig, exportDeletionWorkflowConfig, importDeletionWorkflowConfig, getDeletionWorkflowConfigYaml, updateDeletionWorkflowConfigYaml } from '@/api/settings'
import { listDevices } from '@/api/devices'
import { queryKeys } from '@/api/queryKeys'
import { ExceptionTable, type ExceptionItem } from './ExceptionTable'
import { DuplicatePolicyTable, type DuplicatePolicyItem } from './DuplicatePolicyTable'

const CRITERIA_MIN = 1
const CRITERIA_MAX = 3650
const criteriaInvalid = (v: number | undefined) => !Number.isInteger(v ?? 90) || (v ?? 90) < CRITERIA_MIN || (v ?? 90) > CRITERIA_MAX
const CRITERIA_ERROR = `${CRITERIA_MIN}~${CRITERIA_MAX} 사이의 정수를 입력하세요.`

const SECTIONS = [
  { id: 'dw-exceptions', label: '예외' },
  { id: 'dw-criteria', label: '분석 기준' },
  { id: 'dw-advanced', label: '고급 (YAML)' },
  { id: 'dw-backup', label: '백업·복구' },
]

function SectionTitle({ id, title, description }: { id: string; title: string; description?: string }) {
  return (
    <div id={id} className="scroll-mt-4">
      <h3 className="text-sm font-semibold text-ds-on-surface">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-ds-on-surface-variant">{description}</p>}
    </div>
  )
}

export function DeletionWorkflowSettings() {
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirm()
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [dirty, setDirty] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [yamlText, setYamlText] = useState('')
  const [yamlDirty, setYamlDirty] = useState(false)
  const [yamlSaving, setYamlSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const { data, isLoading, isError, refetch } = useQuery({
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

  const loadYaml = useCallback(() => {
    getDeletionWorkflowConfigYaml()
      .then((yaml) => { setYamlText(yaml); setYamlDirty(false) })
      .catch(() => toast.error('YAML 설정을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'))
  }, [])

  useEffect(() => {
    if (advancedOpen) loadYaml()
  }, [advancedOpen, loadYaml])

  const handleYamlSave = async () => {
    setYamlSaving(true)
    try {
      await updateDeletionWorkflowConfigYaml(yamlText)
      await queryClient.invalidateQueries({ queryKey: queryKeys.deletionWorkflowConfig })
      toast.success('YAML 설정이 저장되었습니다.')
      setYamlDirty(false)
    } catch {
      toast.error('YAML 저장에 실패했습니다. 들여쓰기와 형식을 확인해 주세요.')
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
    onError: (e: unknown) => toast.error(errorMessage(e, '설정을 저장하지 못했습니다. 잠시 후 다시 시도하세요.')),
  })

  const exportAction = useExportAction()
  const handleExport = async () => {
    try {
      await exportAction.run(async () => {
        const { blob, filename } = await exportDeletionWorkflowConfig()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
      })
    } catch {
      toast.error('백업 파일 다운로드에 실패했습니다.')
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ok = await confirm({
      title: '설정 복구',
      description: `'${file.name}'의 내용으로 현재 삭제 워크플로우 설정을 덮어씁니다.${dirty || yamlDirty ? ' 저장하지 않은 편집 내용도 사라집니다.' : ''} 되돌릴 수 없으니 필요하면 먼저 백업을 받아 두세요.`,
      variant: 'destructive',
      confirmLabel: '덮어쓰기',
    })
    if (!ok) {
      if (importRef.current) importRef.current.value = ''
      return
    }
    setImporting(true)
    try {
      await importDeletionWorkflowConfig(file)
      await queryClient.invalidateQueries({ queryKey: queryKeys.deletionWorkflowConfig })
      setDirty(false)
      if (advancedOpen) loadYaml()
      toast.success('설정이 복구되었습니다.')
    } catch {
      toast.error('설정 복구에 실패했습니다. 백업 파일(JSON)이 맞는지 확인하세요.')
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

  const anyDirty = dirty || yamlDirty
  useReportDirty(anyDirty)
  const recentInvalid = dirty && criteriaInvalid(getCriteria().recent_policy_days)
  const unusedInvalid = dirty && criteriaInvalid(getCriteria().unused_threshold_days)
  // 표 편집과 YAML 편집은 서로 다른 저장 경로라 동시에 저장할 수 없다 — 한쪽을 되돌리도록 안내한다.
  const blockedReason = dirty && yamlDirty
    ? '표 편집과 YAML 편집을 동시에 저장할 수 없습니다. 한쪽을 되돌려 주세요.'
    : recentInvalid || unusedInvalid ? '분석 기준 값을 확인하세요.' : null

  const handleSave = () => { if (yamlDirty) handleYamlSave(); else saveMutation.mutate() }
  const handleRevert = () => {
    if (data) setConfig(data)
    setDirty(false)
    if (advancedOpen) loadYaml(); else setYamlDirty(false)
  }

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  if (isLoading) return <div className="py-8 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>
  if (isError) {
    return (
      <div role="alert" className="py-8 text-center text-sm text-ds-error">
        삭제 워크플로우 설정을 불러오지 못했습니다.{' '}
        <button type="button" onClick={() => refetch()} className="font-semibold underline">다시 시도</button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {ConfirmDialogElement}
      <nav aria-label="삭제 워크플로우 설정 섹션" className="flex flex-wrap gap-1.5">
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            type="button"
            onClick={() => scrollTo(sec.id)}
            className="px-3 py-1 text-xs font-medium text-ds-on-surface-variant rounded-full border border-ds-outline-variant/30 hover:bg-ds-surface-container-low hover:text-ds-on-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
          >
            {sec.label}
          </button>
        ))}
      </nav>

      {/* 예외 */}
      <section className="space-y-4" aria-labelledby="dw-exceptions-title">
        <div id="dw-exceptions" className="scroll-mt-4">
          <h3 id="dw-exceptions-title" className="text-sm font-semibold text-ds-on-surface">예외</h3>
          <p className="mt-0.5 text-xs text-ds-on-surface-variant">삭제 워크플로우에서 삭제 대상으로 분류하지 않을 정책입니다. 신청번호, 정책명, 장비별 중복정책 세 종류가 있습니다.</p>
        </div>
        <ExceptionTable
          title="신청번호 예외"
          items={getExceptions('request_ids')}
          keyField="id"
          keyPlaceholder="신청번호 (예: REQ-1234)"
          category="request_ids"
          onAdd={() => addItem('request_ids', 'id')}
          onRemove={(i) => removeItem('request_ids', i)}
          onUpdate={(i, patch) => updateItem('request_ids', i, patch)}
          onBulkAdd={(items) => setExceptions('request_ids', [...getExceptions('request_ids'), ...items])}
        />
        <ExceptionTable
          title="고정 예외 목록 (정책명 완전일치)"
          items={getExceptions('static_list')}
          keyField="name"
          keyPlaceholder="정책명"
          category="static_list"
          onAdd={() => addItem('static_list', 'name')}
          onRemove={(i) => removeItem('static_list', i)}
          onUpdate={(i, patch) => updateItem('static_list', i, patch)}
          onBulkAdd={(items) => setExceptions('static_list', [...getExceptions('static_list'), ...items])}
        />
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
      </section>

      {/* 분석 기준 */}
      <section className="space-y-3" aria-labelledby="dw-criteria-title">
        <div id="dw-criteria" className="scroll-mt-4">
          <h3 id="dw-criteria-title" className="text-sm font-semibold text-ds-on-surface">분석 기준</h3>
          <p className="mt-0.5 text-xs text-ds-on-surface-variant">정책을 신규·미사용으로 나누는 기간입니다.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            { id: 'recent', field: 'recent_policy_days', title: '신규정책 기준 (일)', desc: '이 기간 이내에 생성된 정책은 신규정책으로 분류됩니다.', invalid: recentInvalid },
            { id: 'unused', field: 'unused_threshold_days', title: '미사용 기준 (일)', desc: '이 기간 동안 hit가 없는 정책은 미사용으로 분류됩니다.', invalid: unusedInvalid },
          ] as const).map((c) => (
            <div key={c.id} className="bg-ds-surface-container-low/50 rounded-lg border border-ds-outline-variant/8 px-4 py-3">
              <label htmlFor={`dw-${c.id}`} className="text-xs font-semibold text-ds-on-surface">{c.title}</label>
              <p id={`dw-${c.id}-desc`} className="text-xs text-ds-on-surface-variant mt-0.5 mb-2">{c.desc}</p>
              <input
                id={`dw-${c.id}`}
                type="number" min={CRITERIA_MIN} max={CRITERIA_MAX}
                value={getCriteria()[c.field] ?? 90}
                onChange={(e) => setCriteria({ [c.field]: Number(e.target.value) })}
                aria-describedby={`dw-${c.id}-desc`}
                aria-invalid={c.invalid}
                className="w-24 h-8 px-3 text-xs text-center bg-white border border-ds-outline-variant/30 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40 focus:border-ds-tertiary aria-[invalid=true]:border-ds-error"
              />
              {c.invalid && <p className="mt-1 text-xs text-ds-error">{CRITERIA_ERROR}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* 고급 설정 — YAML 직접 편집 */}
      <section aria-labelledby="dw-advanced-title" className="space-y-2">
        <SectionTitle id="dw-advanced" title="고급 (YAML)" />
        <div className="border border-ds-outline-variant/8 rounded-lg overflow-hidden">
          <button
            type="button"
            id="dw-advanced-title"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-ds-surface-container-low/30 hover:bg-ds-surface-container-low/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
          >
            <span className="text-xs font-semibold text-ds-on-surface-variant">YAML로 전체 설정 직접 편집</span>
            {advancedOpen ? <ChevronUp className="w-4 h-4 text-ds-on-surface-variant" /> : <ChevronDown className="w-4 h-4 text-ds-on-surface-variant" />}
          </button>
          {advancedOpen && (
            <div className="p-4 space-y-3 border-t border-ds-outline-variant/8">
              <p className="text-xs text-ds-on-surface-variant">
                위의 표·기준 대신 전체 설정을 YAML로 직접 고칩니다. 아래 저장 바의 <strong className="font-semibold">저장</strong>을 누르면 설정 파일과 데이터베이스에 함께 반영됩니다.
              </p>
              <textarea
                aria-label="삭제 워크플로우 설정 YAML"
                value={yamlText}
                onChange={(e) => { setYamlText(e.target.value); setYamlDirty(true) }}
                spellCheck={false}
                rows={30}
                className="w-full px-3 py-2 text-xs font-mono leading-relaxed bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40 focus:border-ds-tertiary resize-y"
              />
            </div>
          )}
        </div>
      </section>

      {/* 백업 / 복구 */}
      <section aria-labelledby="dw-backup-title" className="space-y-2">
        <div id="dw-backup" className="scroll-mt-4">
          <h3 id="dw-backup-title" className="text-sm font-semibold text-ds-on-surface">백업·복구</h3>
          <p className="mt-0.5 text-xs text-ds-on-surface-variant">현재 저장된 설정을 파일로 내려받거나, 백업 파일로 되돌립니다. 복구하면 현재 설정을 덮어씁니다.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleExport}
            disabled={exportAction.busy}
            aria-busy={exportAction.busy}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-ds-on-surface-variant bg-ds-surface-container border border-ds-outline-variant/30 rounded-lg hover:bg-ds-surface-container-high transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
          >
            {exportAction.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {exportAction.busy ? '백업 중…' : '백업 받기'}
          </button>
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-ds-on-surface-variant bg-ds-surface-container border border-ds-outline-variant/30 rounded-lg hover:bg-ds-surface-container-high disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40"
          >
            <Upload className="w-3.5 h-3.5" />
            {importing ? '복구 중…' : '백업 파일로 복구'}
          </button>
          <input ref={importRef} type="file" accept=".json" aria-label="복구할 백업 파일" className="hidden" onChange={handleImport} />
        </div>
      </section>

      <SettingsSaveBar
        dirty={anyDirty}
        saving={saveMutation.isPending || yamlSaving}
        blockedReason={blockedReason}
        onSave={handleSave}
        onRevert={handleRevert}
      />
    </div>
  )
}
