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
]

export function Navbar() {
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-50 w-56 flex flex-col bg-ds-surface-container-low border-r border-ds-outline-variant/5">
      {/* Logo Area */}
      <div className="flex items-center gap-3 px-6 py-8">
        <div className="w-9 h-9 rounded-xl bg-ds-tertiary flex items-center justify-center shrink-0 shadow-lg shadow-ds-tertiary/20">
          <ShieldCheck className="w-5 h-5 text-white" strokeWidth={2.5} />
        </div>
        <div>
          <span className="text-lg font-extrabold tracking-tighter text-ds-on-surface font-headline leading-none block">FAT</span>
          <span className="text-[10px] text-ds-on-surface-variant font-medium mt-1.5 block leading-tight">Firewall Analysis Tool</span>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-1">
        {NAV_GROUPS.map((group, gi) => (
          <ul key={gi} className="space-y-1">
            {group.items.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all duration-200',
                      isActive
                        ? 'bg-white text-ds-tertiary font-bold shadow-sm'
                        : 'text-ds-on-surface-variant hover:text-ds-on-surface hover:bg-white/50'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={cn('w-4.5 h-4.5 shrink-0 transition-colors', isActive ? 'text-ds-tertiary' : 'text-ds-on-surface-variant group-hover:text-ds-on-surface')} strokeWidth={isActive ? 2.5 : 2} />
                      <span className="tracking-tight">{label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        ))}
      </nav>

      {/* Bottom Actions: Icons Only */}
      <div className="p-3 border-t border-ds-outline-variant/10 flex items-center justify-between bg-ds-surface-container-low/30">
        <NavLink
          to="/notifications"
          title="활동 로그"
          className={({ isActive }) =>
            cn(
              'p-2.5 rounded-xl transition-all duration-200 flex items-center justify-center flex-1',
              isActive ? 'bg-white text-ds-tertiary shadow-sm' : 'text-ds-on-surface-variant hover:bg-white/50 hover:text-ds-on-surface'
            )
          }
        >
          <Bell className="w-5 h-5" strokeWidth={2} />
        </NavLink>
        
        <NavLink
          to="/settings"
          title="설정"
          className={({ isActive }) =>
            cn(
              'p-2.5 rounded-xl transition-all duration-200 flex items-center justify-center flex-1',
              isActive ? 'bg-white text-ds-tertiary shadow-sm' : 'text-ds-on-surface-variant hover:bg-white/50 hover:text-ds-on-surface'
            )
          }
        >
          <Settings className="w-5 h-5" strokeWidth={2} />
        </NavLink>

        <button
          onClick={handleLogout}
          title="로그아웃"
          className="p-2.5 rounded-xl transition-all duration-200 flex items-center justify-center flex-1 text-ds-on-surface-variant hover:bg-ds-error/5 hover:text-ds-error"
        >
          <LogOut className="w-5 h-5" strokeWidth={2} />
        </button>
      </div>
    </aside>
  )
}
