import axios from 'axios'
import { useAuthStore } from '@/store/authStore'

export const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    const detail = err.response?.data?.detail ?? err.response?.data?.msg ?? err.message ?? 'Request failed'
    return Promise.reject(new Error(detail))
  }
)

export async function downloadBlob(url: string, defaultFilename: string): Promise<void> {
  const token = useAuthStore.getState().token
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    let detail = 'Download failed'
    try {
      const data = await res.json()
      detail = data.detail || data.msg || detail
    } catch {}
    throw new Error(detail)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = defaultFilename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(objectUrl)
}

export async function downloadBlobPost(
  url: string,
  body: object,
  defaultFilename: string,
  timeoutMs = 660_000,
): Promise<void> {
  const token = useAuthStore.getState().token
  const controller = new AbortController()
  const timerId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      let detail = 'Download failed'
      try {
        const data = await res.json()
        detail = data.detail || data.msg || detail
      } catch {}
      throw new Error(detail)
    }
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = defaultFilename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(objectUrl)
  } finally {
    clearTimeout(timerId)
  }
}
