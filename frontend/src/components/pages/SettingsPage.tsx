import { useState } from 'react'
import { GeneralSettings } from './settings/GeneralSettings'
import { RiskyPortsSettings } from './settings/RiskyPortsSettings'
import { AccountSettings } from './settings/AccountSettings'
import { LogSettings } from './settings/LogSettings'
import { DeletionWorkflowSettings } from './settings/DeletionWorkflowSettings'

type Tab = 'general' | 'risky_ports' | 'accounts' | 'log' | 'deletion_workflow'

const TABS: { key: Tab; label: string }[] = [
  { key: 'general',            label: '일반 설정' },
  { key: 'risky_ports',        label: '위험 포트' },
  { key: 'accounts',           label: '계정 관리' },
  { key: 'log',                label: '로그 설정' },
  { key: 'deletion_workflow',  label: '삭제 워크플로우' },
]

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('general')

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface">Settings</h1>
      </div>

      {/* Settings panel */}
      <div className="card rounded-xl overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center border-b border-ds-outline-variant/8 px-4 pt-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-[13px] font-semibold tracking-tight transition-colors duration-200 border-b-2 -mb-px ${
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
          {activeTab === 'general'           && <GeneralSettings />}
          {activeTab === 'risky_ports'       && <RiskyPortsSettings />}
          {activeTab === 'accounts'          && <AccountSettings />}
          {activeTab === 'log'               && <LogSettings />}
          {activeTab === 'deletion_workflow' && <DeletionWorkflowSettings />}
        </div>
      </div>
    </div>
  )
}
