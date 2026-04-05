import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/authStore'

export interface SyncStatusMessage {
  type: 'device_sync_status'
  device_id: number
  status: 'pending' | 'in_progress' | 'success' | 'failure'
  step: string | null
}

export function useSyncStatusWebSocket(onMessage: (msg: SyncStatusMessage) => void): void {
  const token = useAuthStore((s) => s.token)
  const isMounted = useRef(true)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    isMounted.current = true

    function connect() {
      if (!isMounted.current || !token) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(
        `${protocol}//${location.host}/api/v1/ws/sync-status?token=${encodeURIComponent(token)}`
      )
      wsRef.current = ws

      ws.onmessage = (e) => {
        if (!isMounted.current) return
        try {
          const data = JSON.parse(e.data) as SyncStatusMessage
          if (data.type === 'device_sync_status') {
            onMessage(data)
          }
        } catch {}
      }

      ws.onclose = () => {
        if (!isMounted.current) return
        reconnectTimer.current = setTimeout(connect, 5000)
      }
    }

    connect()

    return () => {
      isMounted.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
}
