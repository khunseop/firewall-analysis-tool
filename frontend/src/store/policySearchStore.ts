import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Policy, ChangeLogEntry } from '@/api/firewall'
import type { FilterTree } from '@/components/shared/QueryBuilder'

interface PolicySearchStore {
  // ── localStorage에 persist (소량) ──────────────────────────────────────────
  filterTree: FilterTree
  filtersOpen: boolean
  searched: boolean           // 검색 실행 여부 (새로고침 시 자동 재검색 트리거용)
  quickFilterText: string

  // ── 메모리에만 유지 (대용량 — partialize로 persist 제외) ───────────────────
  policies: Policy[]
  validObjectNames: string[]
  changeLogEntries: ChangeLogEntry[]

  setFilterTree: (tree: FilterTree) => void
  setFiltersOpen: (v: boolean) => void
  setSearched: (v: boolean) => void
  setQuickFilterText: (text: string) => void
  setPolicies: (policies: Policy[]) => void
  setValidObjectNames: (names: string[]) => void
  setChangeLogEntries: (entries: ChangeLogEntry[]) => void
  reset: () => void
}

const INITIAL: Omit<PolicySearchStore, keyof Pick<
  PolicySearchStore,
  'setFilterTree' | 'setFiltersOpen' | 'setSearched' | 'setQuickFilterText' |
  'setPolicies' | 'setValidObjectNames' | 'setChangeLogEntries' | 'reset'
>> = {
  filterTree: [],
  filtersOpen: false,
  searched: false,
  quickFilterText: '',
  policies: [],
  validObjectNames: [],
  changeLogEntries: [],
}

export const usePolicySearchStore = create<PolicySearchStore>()(
  persist(
    (set) => ({
      ...INITIAL,
      setFilterTree: (filterTree) => set({ filterTree }),
      setFiltersOpen: (filtersOpen) => set({ filtersOpen }),
      setSearched: (searched) => set({ searched }),
      setQuickFilterText: (quickFilterText) => set({ quickFilterText }),
      setPolicies: (policies) => set({ policies }),
      setValidObjectNames: (validObjectNames) => set({ validObjectNames }),
      setChangeLogEntries: (changeLogEntries) => set({ changeLogEntries }),
      reset: () => set(INITIAL),
    }),
    {
      name: 'fat-policy-search',
      // policies 등 대용량 데이터는 메모리에만 유지 (localStorage 용량 초과 방지)
      partialize: (state) => ({
        filterTree: state.filterTree,
        filtersOpen: state.filtersOpen,
        searched: state.searched,
        quickFilterText: state.quickFilterText,
      }),
    }
  )
)
