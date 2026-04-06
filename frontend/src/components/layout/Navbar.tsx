import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Monitor, Shield, Package, SearchCode,
  CalendarClock, Bell, Settings, LogOut, ShieldCheck,
} from 'lucide-react'

const NAV_GROUPS = [
  {
    items: [
      { to: '/', label: '대시보드', icon: LayoutDashboard, end: true },
      { to: '/devices', label: '장비 관리', icon: Monitor },
      { to: '/policies', label: '방화벽 정책', icon: Shield },
      { to: '/objects', label: '오브젝트', icon: Package },
      { to: '/analysis', label: '정책 분석', icon: SearchCode },
      { to: '/schedules', label: '스케줄', icon: CalendarClock },
    ],
  },
  {
    items: [
      { to: '/notifications', label: '활동 로그', icon: Bell },
      { to: '/settings', label: '설정', icon: Settings },
    ],
  },
]

export function Navbar() {
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-50 w-56 flex flex-col bg-ds-surface-container-lowest border-r border-ds-outline-variant/10 shadow-[1px_0_0_rgba(0,0,0,0.04)]">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-ds-outline-variant/10">
        <div className="w-8 h-8 rounded-lg bg-ds-tertiary flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
        </div>
        <div>
          <span className="text-sm font-extrabold tracking-tight text-ds-on-surface font-headline">FAT</span>
          <p className="text-[10px] text-ds-on-surface-variant leading-none mt-0.5">Firewall Analysis</p>
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-4">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <div className="mx-3 my-2 border-t border-ds-outline-variant/10" />}
            <ul className="space-y-0.5">
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150',
                        isActive
                          ? 'bg-ds-tertiary/10 text-ds-tertiary font-semibold'
                          : 'text-ds-on-surface-variant hover:bg-ds-surface-container-low hover:text-ds-on-surface'
                      )
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Logout */}
      <div className="px-2 py-3 border-t border-ds-outline-variant/10">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-ds-on-surface-variant hover:bg-ds-surface-container-low hover:text-ds-error transition-colors duration-150"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          로그아웃
        </button>
      </div>
    </aside>
  )
}
