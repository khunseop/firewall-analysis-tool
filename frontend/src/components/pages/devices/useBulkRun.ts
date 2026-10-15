import { useState, useCallback } from 'react'
import type { Device } from '@/api/devices'
import type { BulkRunState, BulkResultRow } from './BulkResultDialog'

const CONCURRENCY = 4

/**
 * 장비 여러 대에 같은 작업을 동시 4개씩 실행하고 장비별 결과를 모아 결과표 상태로 노출한다.
 * 개별 실패가 전체를 멈추지 않으며(allSettled와 같은 의미), 실패한 장비만 다시 실행할 수 있다.
 */
export function useBulkRun() {
  const [bulkState, setBulkState] = useState<BulkRunState | null>(null)

  const runBulk = useCallback(async (
    title: string,
    devices: Device[],
    action: (device: Device) => Promise<string>,
    opts: { onSettled?: () => void; onAllOk?: () => void } = {},
  ) => {
    const byId = new Map<number, BulkResultRow>()
    const ordered = () => devices.map((d) => byId.get(d.id)).filter((r): r is BulkResultRow => !!r)

    const pass = async (targets: Device[]) => {
      setBulkState({ title, rows: ordered(), total: devices.length, running: true, retry: null })
      let next = 0
      const worker = async () => {
        while (next < targets.length) {
          const d = targets[next++]
          try {
            byId.set(d.id, { id: d.id, name: d.name, ok: true, message: await action(d) })
          } catch (e) {
            byId.set(d.id, { id: d.id, name: d.name, ok: false, message: (e as Error).message })
          }
          setBulkState((s) => (s ? { ...s, rows: ordered() } : s))
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
      opts.onSettled?.()
      const failedDevices = devices.filter((d) => byId.get(d.id)?.ok === false)
      if (failedDevices.length === 0 && opts.onAllOk) {
        setBulkState(null)
        opts.onAllOk()
        return
      }
      setBulkState({
        title, rows: ordered(), total: devices.length, running: false,
        retry: failedDevices.length > 0 ? () => { void pass(failedDevices) } : null,
      })
    }

    await pass(devices)
  }, [])

  const closeBulk = useCallback(() => setBulkState(null), [])

  return { bulkState, runBulk, closeBulk }
}
