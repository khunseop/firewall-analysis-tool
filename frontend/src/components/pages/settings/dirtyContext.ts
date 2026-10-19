import { createContext, useContext, useEffect } from 'react'

/** 설정 탭이 "저장하지 않은 변경이 있는지"를 SettingsPage에 알리는 채널 — 탭 이동·페이지 이탈 경고에 쓰인다. */
export const SettingsDirtyContext = createContext<(dirty: boolean) => void>(() => {})

export function useReportDirty(dirty: boolean) {
  const report = useContext(SettingsDirtyContext)
  useEffect(() => {
    report(dirty)
    return () => report(false)
  }, [dirty, report])
}
