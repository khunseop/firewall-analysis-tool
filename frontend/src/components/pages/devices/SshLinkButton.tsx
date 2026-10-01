import { useState, useRef, useEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import { SquareTerminal } from 'lucide-react'

// 장비 등록 계정과 별개로 사용자가 직접 입력한 SSH 계정 — 마지막 입력값만 기억
const SSH_USER_KEY = 'fat.sshUsername'

/**
 * IP 옆 SSH 바로가기. 계정 입력 후 ssh://user@host 링크를 열면
 * OS에 등록된 ssh:// 핸들러(Windows: /ssh-handler.reg 로 OpenSSH 등록)가 터미널을 띄운다.
 */
export const SshLinkButton = memo(function SshLinkButton({ host }: { host: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [username, setUsername] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    const handleScroll = () => setOpen(false)
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [open])

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left })
    if (!open) {
      try { setUsername(localStorage.getItem(SSH_USER_KEY) ?? '') } catch { setUsername('') }
    }
    setOpen((v) => !v)
  }

  const connect = (e: React.FormEvent) => {
    e.preventDefault()
    const user = username.trim()
    if (!user) return
    try { localStorage.setItem(SSH_USER_KEY, user) } catch { /* 기억 실패는 무시 */ }
    window.location.href = `ssh://${encodeURIComponent(user)}@${host}`
    setOpen(false)
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        title="SSH 터미널 접속"
        className="shrink-0 text-ds-tertiary/50 hover:text-ds-tertiary transition-colors"
      >
        <SquareTerminal className="w-2.5 h-2.5" />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="w-56 bg-white rounded-lg shadow-lg border border-ds-outline-variant/15 p-3 z-50"
        >
          <form onSubmit={connect} className="flex flex-col gap-2">
            <label className="text-11 font-semibold text-ds-on-surface">
              SSH 접속 계정 <span className="font-mono font-normal text-ds-on-surface-variant">@{host}</span>
            </label>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="장비 로그인 계정"
              className="h-7 w-full rounded border border-ds-outline-variant/30 px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ds-tertiary"
            />
            <button
              type="submit"
              disabled={!username.trim()}
              className="h-7 rounded bg-ds-tertiary text-white text-xs font-semibold disabled:opacity-40"
            >
              접속
            </button>
            <a
              href="/ssh-handler.reg"
              download
              className="text-10 text-ds-on-surface-variant hover:text-ds-tertiary underline"
            >
              터미널이 안 열리면: Windows 최초 1회 설정 파일
            </a>
          </form>
        </div>,
        document.body
      )}
    </>
  )
})
