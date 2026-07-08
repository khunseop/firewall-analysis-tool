import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/store/authStore'

export interface SyncStatusMessage {
  type: 'device_sync_status'
  device_id: number
  status: 'pending' | 'in_progress' | 'success' | 'failure'
  step: string | null
}

const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 30_000

/**
 * 동기화 진행 상태 WebSocket 구독 훅.
 * 연결이 끊기면 지수 백오프(1s → 2s → … 최대 30s)로 재연결하며,
 * 현재 연결 상태(isConnected)를 반환한다.
 */
export function useSyncStatusWebSocket(onMessage: (msg: SyncStatusMessage) => void): boolean {
  const token = useAuthStore((s) => s.token)
  const [isConnected, setIsConnected] = useState(false)
  const isMounted = useRef(true)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCount = useRef(0)
  const onMessageRef = useRef(onMessage)

  // 항상 최신 콜백을 ref에 유지 (stale closure 방지 — 렌더 중 ref 쓰기 대신 effect 사용)
  useEffect(() => {
    onMessageRef.current = onMessage
  })

  useEffect(() => {
    isMounted.current = true

    function connect() {
      if (!isMounted.current || !token) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      // 인증은 access_token 쿠키로 처리 (쿼리스트링 토큰은 서버 로그 노출 우려로 제거)
      const ws = new WebSocket(`${protocol}//${location.host}/api/v1/ws/sync-status`)
      wsRef.current = ws

      ws.onopen = () => {
        if (!isMounted.current) return
        retryCount.current = 0
        setIsConnected(true)
      }

      ws.onmessage = (e) => {
        if (!isMounted.current) return
        try {
          const data = JSON.parse(e.data) as SyncStatusMessage
          if (data.type === 'device_sync_status') {
            onMessageRef.current(data)
          }
        } catch { /* JSON이 아닌 메시지는 무시 */ }
      }

      ws.onerror = () => {
        // 오류 발생 시 브라우저가 곧 onclose를 호출하므로 재연결은 onclose에서 처리
        ws.close()
      }

      ws.onclose = () => {
        if (!isMounted.current) return
        setIsConnected(false)
        const delay = Math.min(
          RECONNECT_BASE_DELAY_MS * 2 ** retryCount.current,
          RECONNECT_MAX_DELAY_MS
        )
        retryCount.current += 1
        reconnectTimer.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      isMounted.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      setIsConnected(false)
    }
  }, [token])

  return isConnected
}
