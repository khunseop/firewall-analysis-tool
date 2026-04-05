import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faGaugeHigh,
  faServer,
  faShieldHalved,
  faCubes,
  faMagnifyingGlassChart,
  faCalendarCheck,
  faGear,
  faRightFromBracket,
} from '@fortawesome/free-solid-svg-icons'

const NAV_ITEMS = [
  { to: '/', label: '대시보드', icon: faGaugeHigh, end: true },
  { to: '/devices', label: '장비 관리', icon: faServer },
  { to: '/policies', label: '방화벽 정책', icon: faShieldHalved },
  { to: '/objects', label: '오브젝트', icon: faCubes },
  { to: '/analysis', label: '정책 분석', icon: faMagnifyingGlassChart },
  { to: '/schedules', label: '동기화 스케줄', icon: faCalendarCheck },
  { to: '/settings', label: '설정', icon: faGear },
]

export function Navbar() {
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <nav className="bg-white border-b border-border sticky top-0 z-50">
      <div className="flex items-center h-14 px-4 gap-1">
        <span className="font-bold text-primary text-lg mr-4 whitespace-nowrap">FAT</span>
        <div className="flex items-center gap-0.5 flex-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )
              }
            >
              <FontAwesomeIcon icon={item.icon} className="text-xs" />
              {item.label}
            </NavLink>
          ))}
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors ml-2 whitespace-nowrap"
        >
          <FontAwesomeIcon icon={faRightFromBracket} className="text-xs" />
          로그아웃
        </button>
      </div>
    </nav>
  )
}
