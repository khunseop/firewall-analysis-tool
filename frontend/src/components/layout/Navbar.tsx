import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/devices', label: 'Devices' },
  { to: '/policies', label: 'Policies' },
  { to: '/objects', label: 'Objects' },
  { to: '/analysis', label: 'Analysis' },
  { to: '/policy-diff', label: 'Policy Diff' },
  { to: '/schedules', label: 'Schedules' },
  { to: '/deletion-workflow', label: 'Deletion Workflow' },
]

export function Navbar() {
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="h-full w-full flex items-center px-4 md:px-6 gap-6 bg-white/80 backdrop-blur-xl shadow-navbar">
      {/* Logo */}
      <span className="text-[15px] font-extrabold tracking-tight text-ds-tertiary font-headline shrink-0">
        FAT
      </span>

      {/* Nav */}
      <nav className="flex items-center flex-1 overflow-x-auto min-w-0 h-full">
        {NAV_ITEMS.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'relative flex items-center h-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors',
                'after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:rounded-full after:transition-all',
                isActive
                  ? 'text-ds-tertiary after:bg-ds-tertiary'
                  : 'text-ds-on-surface-variant hover:text-ds-on-surface after:bg-transparent'
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Right */}
      <div className="flex items-center gap-0.5 shrink-0">
        <div className="w-px h-4 bg-ds-outline-variant/20 mx-2" />

        <NavLink
          to="/notifications"
          className={({ isActive }) =>
            cn(
              'px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors',
              isActive ? 'text-ds-tertiary bg-ds-tertiary/8' : 'text-ds-on-surface-variant hover:bg-black/5 hover:text-ds-on-surface'
            )
          }
        >
          Notifications
        </NavLink>

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors',
              isActive ? 'text-ds-tertiary bg-ds-tertiary/8' : 'text-ds-on-surface-variant hover:bg-black/5 hover:text-ds-on-surface'
            )
          }
        >
          Settings
        </NavLink>

        <div className="w-px h-4 bg-ds-outline-variant/20 mx-2" />

        <button
          onClick={handleLogout}
          className="px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors text-ds-on-surface-variant/60 hover:bg-ds-error/8 hover:text-ds-error"
        >
          Logout
        </button>
      </div>
    </header>
  )
}
