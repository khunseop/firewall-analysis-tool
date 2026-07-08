import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PolicySearchRequest } from '@/api/firewall'
import type { FilterTree } from '@/components/shared/queryBuilderModel'

/**
 * 정책 검색 화면의 "조건" 상태만 보관합니다.
 * 검색 결과(policies 등 대용량)는 React Query 캐시가 단일 소스입니다 —
 * 마지막 실행 조건(searchRequest)을 persist해 두면 새로고침 시 쿼리가 자동 재실행됩니다.
 */
interface PolicySearchStore {
  filterTree: FilterTree
  filtersOpen: boolean
  quickFilterText: string
  // 마지막으로 실행한 검색 요청 (null이면 아직 검색 전)
  searchRequest: PolicySearchRequest | null

  setFilterTree: (tree: FilterTree) => void
  setFiltersOpen: (v: boolean) => void
  setQuickFilterText: (text: string) => void
  setSearchRequest: (req: PolicySearchRequest | null) => void
  reset: () => void
}

const INITIAL = {
  filterTree: [] as FilterTree,
  filtersOpen: false,
  quickFilterText: '',
  searchRequest: null as PolicySearchRequest | null,
}

export const usePolicySearchStore = create<PolicySearchStore>()(
  persist(
    (set) => ({
      ...INITIAL,
      setFilterTree: (filterTree) => set({ filterTree }),
      setFiltersOpen: (filtersOpen) => set({ filtersOpen }),
      setQuickFilterText: (quickFilterText) => set({ quickFilterText }),
      setSearchRequest: (searchRequest) => set({ searchRequest }),
      reset: () => set(INITIAL),
    }),
    { name: 'fat-policy-search' }
  )
)
