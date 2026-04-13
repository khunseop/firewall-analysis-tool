import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface DeviceGroup {
  id: string
  name: string
  deviceIds: number[]
  color?: string
}

interface DeviceStore {
  selectedIds: number[]
  setSelectedIds: (ids: number[]) => void
  toggleId: (id: number) => void
  clearSelection: () => void
  selectAll: (allIds: number[]) => void

  // 장비 그룹 (향후 그룹 관리 UI에서 사용)
  groups: DeviceGroup[]
  addGroup: (group: DeviceGroup) => void
  removeGroup: (id: string) => void
  updateGroup: (id: string, patch: Partial<Omit<DeviceGroup, 'id'>>) => void
  selectGroup: (groupId: string) => void
}

export const useDeviceStore = create<DeviceStore>()(
  persist(
    (set, get) => ({
      selectedIds: [],
      setSelectedIds: (ids) => set({ selectedIds: ids }),
      toggleId: (id) => {
        const cur = get().selectedIds
        set({ selectedIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
      },
      clearSelection: () => set({ selectedIds: [] }),
      selectAll: (allIds) => set({ selectedIds: allIds }),

      groups: [],
      addGroup: (g) => set({ groups: [...get().groups, g] }),
      removeGroup: (id) => set({ groups: get().groups.filter((g) => g.id !== id) }),
      updateGroup: (id, patch) =>
        set({ groups: get().groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }),
      selectGroup: (gid) => {
        const grp = get().groups.find((g) => g.id === gid)
        if (grp) set({ selectedIds: grp.deviceIds })
      },
    }),
    { name: 'fat-device-selection' }
  )
)
