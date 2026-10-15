import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TabKey } from './useObjectsData'

const SEARCH_META: Record<TabKey, { label: string; placeholder: string; hint: string }> = {
  network_objects: {
    label: 'IP 범위 검색',
    placeholder: '예: 10.1.2.3, 10.1.0.0/16, 10.1.1.1-10.1.1.9',
    hint: '입력한 IP·대역과 일부라도 겹치는 객체를 찾습니다.',
  },
  services: {
    label: '포트 검색',
    placeholder: '예: 443, 8000-8100, tcp/443',
    hint: '입력한 포트·범위와 일부라도 겹치는 서비스를 찾습니다.',
  },
  network_groups: {
    label: '멤버 검색',
    placeholder: '그룹에 포함된 객체 이름 (부분 일치)',
    hint: '해당 이름을 멤버로 가진 그룹을 찾습니다.',
  },
  service_groups: {
    label: '멤버 검색',
    placeholder: '그룹에 포함된 서비스 이름 (부분 일치)',
    hint: '해당 이름을 멤버로 가진 그룹을 찾습니다.',
  },
}

/**
 * 서버 검색 입력 — Enter 또는 "검색"으로 실행한다. 결과 내 텍스트 필터와 달리,
 * 숫자 범위(IP·포트)로 겹침을 비교하므로 10.1.2.3을 입력하면 10.1.2.0/24 같은 상위 대역 객체도 찾는다.
 */
export function ObjectSearchBar({
  tab, applied, disabled, searching, resultCount, onSearch, onClear,
}: {
  tab: TabKey
  applied: string | null
  disabled: boolean
  searching: boolean
  resultCount: number | null
  onSearch: (expr: string) => void
  onClear: () => void
}) {
  const meta = SEARCH_META[tab]
  const [draft, setDraft] = useState(applied ?? '')
  const submit = () => { const v = draft.trim(); if (v) onSearch(v) }
  const clear = () => { setDraft(''); onClear() }

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-ds-outline-variant/10 bg-ds-surface-container-low/40">
      <div className="flex items-center gap-1.5 bg-white rounded-lg px-2.5 py-1.5 border border-ds-outline-variant/20 focus-within:border-ds-tertiary focus-within:ring-1 focus-within:ring-ds-tertiary w-[28rem] max-w-full">
        <Search className="w-3.5 h-3.5 text-ds-on-surface-variant shrink-0" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          disabled={disabled}
          aria-label={meta.label}
          placeholder={meta.placeholder}
          className="flex-1 min-w-0 text-xs bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/70 disabled:opacity-50"
        />
        {draft && (
          <button type="button" onClick={clear} aria-label="검색어 지우기" className="shrink-0 text-ds-on-surface-variant hover:text-ds-on-surface">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <Button
        variant="gradient" size="auto" onClick={submit}
        disabled={disabled || !draft.trim() || searching}
        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg"
      >
        {searching ? '검색 중…' : '검색'}
      </Button>
      {applied != null ? (
        <span className="flex items-center gap-2 text-11" aria-live="polite">
          <span className="font-semibold text-ds-tertiary">
            “{applied}” {resultCount != null ? `— ${resultCount.toLocaleString()}건` : ''}
          </span>
          <button type="button" onClick={clear} className="font-semibold text-ds-on-surface-variant hover:text-ds-on-surface underline underline-offset-2">
            검색 해제
          </button>
        </span>
      ) : (
        <span className="text-11 text-ds-on-surface-variant">{meta.hint}</span>
      )}
    </div>
  )
}
