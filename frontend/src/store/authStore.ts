import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  token: string | null
  setToken: (token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      setToken: (token: string) => {
        const maxAge = 60 * 60 * 8
        document.cookie = `access_token=${token}; path=/; max-age=${maxAge}; SameSite=Strict`
        set({ token })
      },
      logout: () => {
        document.cookie = 'access_token=; path=/; max-age=0'
        set({ token: null })
      },
    }),
    { name: 'fat_token' }
  )
)
