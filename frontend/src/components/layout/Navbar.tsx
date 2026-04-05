import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { LogOut } from 'lucide-react'

const NAV_ITEMS = [
  { to: '/', label: '대시보드', end: true },
  { to: '/devices', label: '장비 관리' },
  { to: '/policies', label: '방화벽 정책' },
  { to: '/objects', label: '오브젝트' },
  { to: '/analysis', label: '정책 분석' },
  { to: '/schedules', label: '동기화 스케줄' },
  { to: '/settings', label: '설정' },
]

export function Navbar() {
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between px-8 h-14 bg-ds-surface-container-lowest border-b border-ds-outline-variant/10 shadow-ambient-sm">
      {/* Left: Logo + Nav Links */}
      <div className="flex items-center gap-10">
        <span className="text-lg font-extrabold tracking-tighter text-ds-on-surface font-headline">
          FAT
        </span>
        <div className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'px-3 py-1.5 text-sm font-semibold font-headline tracking-tight transition-colors duration-200 rounded-md whitespace-nowrap',
                  isActive
                    ? 'text-ds-tertiary border-b-2 border-ds-tertiary pb-[5px] rounded-none'
                    : 'text-ds-on-surface-variant hover:text-ds-on-surface hover:bg-ds-surface-container-low'
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Right: Logout */}
      <button
        onClick={handleLogout}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-ds-on-surface-variant hover:text-ds-on-surface hover:bg-ds-surface-container-low rounded-md transition-colors duration-200"
      >
        <LogOut className="w-4 h-4" />
        로그아웃
      </button>
    </nav>
  )
}
