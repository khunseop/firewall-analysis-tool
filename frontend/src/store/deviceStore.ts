import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DeviceStore {
  selectedIds: number[]
  setSelectedIds: (ids: number[]) => void
  toggleId: (id: number) => void
  clearSelection: () => void
  selectAll: (allIds: number[]) => void
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
    }),
    { name: 'fat-device-selection' }
  )
)
