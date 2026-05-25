import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Policy, ChangeLogEntry } from '@/api/firewall'
import type { FilterTree } from '@/components/shared/QueryBuilder'

interface PolicySearchStore {
  filterTree: FilterTree
  policies: Policy[]
  searched: boolean
  validObjectNames: string[]
  changeLogEntries: ChangeLogEntry[]
  quickFilterText: string
  filtersOpen: boolean

  setFilterTree: (tree: FilterTree) => void
  setPolicies: (policies: Policy[]) => void
  setSearched: (v: boolean) => void
  setValidObjectNames: (names: string[]) => void
  setChangeLogEntries: (entries: ChangeLogEntry[]) => void
  setQuickFilterText: (text: string) => void
  setFiltersOpen: (v: boolean) => void
  reset: () => void
}

const INITIAL: Pick<
  PolicySearchStore,
  'filterTree' | 'policies' | 'searched' | 'validObjectNames' | 'changeLogEntries' | 'quickFilterText' | 'filtersOpen'
> = {
  filterTree: [],
  policies: [],
  searched: false,
  validObjectNames: [],
  changeLogEntries: [],
  quickFilterText: '',
  filtersOpen: false,
}

export const usePolicySearchStore = create<PolicySearchStore>()(
  persist(
    (set) => ({
      ...INITIAL,
      setFilterTree: (filterTree) => set({ filterTree }),
      setPolicies: (policies) => set({ policies }),
      setSearched: (searched) => set({ searched }),
      setValidObjectNames: (validObjectNames) => set({ validObjectNames }),
      setChangeLogEntries: (changeLogEntries) => set({ changeLogEntries }),
      setQuickFilterText: (quickFilterText) => set({ quickFilterText }),
      setFiltersOpen: (filtersOpen) => set({ filtersOpen }),
      reset: () => set(INITIAL),
    }),
    { name: 'fat-policy-search' }
  )
)
