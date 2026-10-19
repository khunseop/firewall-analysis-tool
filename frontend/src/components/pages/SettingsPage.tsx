import { useCallback, useEffect, useRef, useState } from 'react'
import { GeneralSettings } from './settings/GeneralSettings'
import { RiskyPortsSettings } from './settings/RiskyPortsSettings'
import { AccountSettings } from './settings/AccountSettings'
import { LogSettings } from './settings/LogSettings'
import { DeletionWorkflowSettings } from './settings/DeletionWorkflowSettings'
import { PolicyDefaultsSettings } from './settings/PolicyDefaultsSettings'
import { SettingsDirtyContext } from './settings/dirtyContext'
import { PageHeader } from '@/components/shared/PageHeader'
import { useConfirm } from '@/components/shared/ConfirmDialog'

type Tab = 'general' | 'risky_ports' | 'policy_defaults' | 'accounts' | 'log' | 'deletion_workflow'

const TABS: { key: Tab; label: string }[] = [
  { key: 'general',            label: '일반 설정' },
  { key: 'risky_ports',        label: '위험 포트' },
  { key: 'policy_defaults',    label: '정책 생성 기본값' },
  { key: 'accounts',           label: '계정 관리' },
  { key: 'log',                label: '데이터 관리' },
  { key: 'deletion_workflow',  label: '삭제 워크플로우' },
]

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const { confirm, ConfirmDialogElement } = useConfirm()
  const dirtyRef = useRef(false)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const reportDirty = useCallback((dirty: boolean) => { dirtyRef.current = dirty }, [])

  // 새로고침·탭 닫기 때도 저장하지 않은 변경이 있으면 브라우저 기본 경고를 띄운다.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // 탭을 바꾸면 이전 탭이 사라져 저장하지 않은 편집도 같이 사라지므로, 변경이 있으면 먼저 묻는다.
  const selectTab = async (key: Tab) => {
    if (key === activeTab) return
    if (dirtyRef.current) {
      const ok = await confirm({
        title: '저장하지 않은 변경사항',
        description: `'${TABS.find((t) => t.key === activeTab)?.label}' 탭에 저장하지 않은 변경이 있습니다. 이동하면 변경 내용이 사라집니다.`,
        variant: 'destructive',
        confirmLabel: '변경 버리고 이동',
      })
      if (!ok) return
    }
    dirtyRef.current = false
    setActiveTab(key)
  }

  // 탭 목록 키보드 탐색 — 방향키는 포커스만 옮기고, Enter/Space(버튼 기본 동작)로 실제 전환한다.
  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = TABS.length - 1
    const next = e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? last : null
    if (next === null) return
    e.preventDefault()
    tabRefs.current[TABS[next].key]?.focus()
  }

  const active = TABS.find((t) => t.key === activeTab)!

  return (
    <div className="flex flex-col gap-6">
      {ConfirmDialogElement}
      <PageHeader title="설정" />

      <div className="card rounded-xl overflow-hidden">
        <div role="tablist" aria-label="설정 항목" className="flex items-center border-b border-ds-outline-variant/8 px-4 pt-2 overflow-x-auto">
          {TABS.map((tab, i) => {
            const selected = activeTab === tab.key
            return (
              <button
                key={tab.key}
                ref={(el) => { tabRefs.current[tab.key] = el }}
                role="tab"
                id={`settings-tab-${tab.key}`}
                aria-selected={selected}
                aria-controls="settings-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(tab.key)}
                onKeyDown={(e) => handleTabKeyDown(e, i)}
                className={`shrink-0 px-4 py-2 text-13 font-semibold tracking-tight transition-colors duration-200 border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-tertiary/40 rounded-t ${
                  selected
                    ? 'text-ds-tertiary border-ds-tertiary'
                    : 'text-ds-on-surface-variant border-transparent hover:text-ds-on-surface hover:border-ds-outline-variant/30'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`} className="p-6">
          <SettingsDirtyContext.Provider value={reportDirty}>
            <h2 className="mb-4 text-base font-headline font-semibold text-ds-on-surface">{active.label}</h2>
            {activeTab === 'general'           && <GeneralSettings />}
            {activeTab === 'risky_ports'       && <RiskyPortsSettings />}
            {activeTab === 'policy_defaults'   && <PolicyDefaultsSettings />}
            {activeTab === 'accounts'          && <AccountSettings />}
            {activeTab === 'log'               && <LogSettings />}
            {activeTab === 'deletion_workflow' && <DeletionWorkflowSettings />}
          </SettingsDirtyContext.Provider>
        </div>
      </div>
    </div>
  )
}
