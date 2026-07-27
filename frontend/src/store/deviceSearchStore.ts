import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Devices 페이지의 빠른 검색어 — 다른 페이지를 다녀와도 유지되도록 persist. */
interface DeviceSearchStore {
  quickFilter: string
  setQuickFilter: (text: string) => void
}

export const useDeviceSearchStore = create<DeviceSearchStore>()(
  persist(
    (set) => ({
      quickFilter: '',
      setQuickFilter: (quickFilter) => set({ quickFilter }),
    }),
    { name: 'fat-device-search' }
  )
)
