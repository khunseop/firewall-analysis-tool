import { useState, useMemo } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { useDeviceStore } from '@/store/deviceStore'
import { listDevices } from '@/api/devices'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Monitor, Shield, Package, SearchCode,
  CalendarClock, Bell, Settings, LogOut, ShieldCheck,
  ChevronDown, ChevronRight, Search, X,
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

const VENDOR_DOT: Record<string, string> = {
  paloalto: 'bg-orange-400',
  ngf:      'bg-blue-400',
  mf2:      'bg-cyan-400',
  mock:     'bg-ds-outline',
}

function DevicePanel() {
  const [open, setOpen] = useState(true)
  const [search, setSearch] = useState('')

  const { selectedIds, toggleId, clearSelection, selectAll } = useDeviceStore()

  const { data: devices = [] } = useQuery({
    queryKey: ['devices'],
    queryFn: listDevices,
    staleTime: 5 * 60_000,
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? devices.filter((d) => d.name.toLowerCase().includes(q) || d.ip_address.toLowerCase().includes(q))
      : devices
    // 선택된 장비 상단 정렬 (검색 없을 때)
    if (!q) {
      return [...list].sort((a, b) => {
        const aS = selectedIds.includes(a.id) ? 0 : 1
        const bS = selectedIds.includes(b.id) ? 0 : 1
        return aS - bS
      })
    }
    return list
  }, [devices, search, selectedIds])

  const allIds = devices.map((d) => d.id)
  const isAllSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id))

  return (
    <div className="mx-3 mb-1 rounded-xl border border-ds-outline-variant/10 bg-ds-surface-container-lowest/50 overflow-hidden">
      {/* 헤더 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-ds-surface-container-low/40 transition-colors"
      >
        <span className="text-[9px] font-bold uppercase tracking-widest text-ds-on-surface-variant">
          장비 선택
        </span>
        <div className="flex items-center gap-1.5">
          {selectedIds.length > 0 && (
            <span className="text-[9px] font-bold bg-ds-tertiary text-white rounded-full px-1.5 py-0.5 leading-none">
              {selectedIds.length}
            </span>
          )}
          {open
            ? <ChevronDown className="w-3 h-3 text-ds-on-surface-variant" />
            : <ChevronRight className="w-3 h-3 text-ds-on-surface-variant" />}
        </div>
      </button>

      {open && (
        <>
          {/* 검색 */}
          <div className="px-2 pb-1.5">
            <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-2 py-1.5 border border-ds-outline-variant/15">
              <Search className="w-3 h-3 text-ds-on-surface-variant shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="장비 검색…"
                className="flex-1 text-[11px] bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/50 min-w-0"
              />
              {search && (
                <button onClick={() => setSearch('')} className="shrink-0">
                  <X className="w-3 h-3 text-ds-on-surface-variant hover:text-ds-on-surface" />
                </button>
              )}
            </div>
          </div>

          {/* 장비 목록 */}
          <div className="max-h-[180px] overflow-y-auto px-2 pb-1 space-y-0.5">
            {filtered.length === 0 ? (
              <p className="text-[10px] text-ds-on-surface-variant text-center py-3 italic">
                {search ? '검색 결과 없음' : '장비가 없습니다'}
              </p>
            ) : (
              filtered.map((d) => {
                const selected = selectedIds.includes(d.id)
                return (
                  <button
                    key={d.id}
                    onClick={() => toggleId(d.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors text-[11px]',
                      selected
                        ? 'bg-ds-tertiary/8 text-ds-tertiary'
                        : 'text-ds-on-surface-variant hover:bg-ds-surface-container-low hover:text-ds-on-surface'
                    )}
                  >
                    {/* 체크박스 */}
                    <span className={cn(
                      'w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center',
                      selected ? 'bg-ds-tertiary border-ds-tertiary' : 'border-ds-outline-variant/40'
                    )}>
                      {selected && <span className="w-1.5 h-1.5 bg-white rounded-sm" />}
                    </span>
                    {/* 벤더 점 */}
                    <span className={cn(
                      'w-1.5 h-1.5 rounded-full shrink-0',
                      VENDOR_DOT[d.vendor?.toLowerCase()] ?? 'bg-ds-outline'
                    )} />
                    <span className="truncate font-mono leading-tight">{d.name}</span>
                  </button>
                )
              })
            )}
          </div>

          {/* 액션 버튼 */}
          <div className="flex items-center gap-1 px-2 pb-2 pt-1 border-t border-ds-outline-variant/10">
            <button
              onClick={() => (isAllSelected ? clearSelection() : selectAll(allIds))}
              className="flex-1 text-[10px] font-semibold text-ds-on-surface-variant hover:text-ds-tertiary transition-colors py-1 rounded hover:bg-ds-tertiary/5"
            >
              {isAllSelected ? '전체 해제' : '전체 선택'}
            </button>
            <span className="text-ds-outline-variant/30">|</span>
            <button
              onClick={clearSelection}
              disabled={selectedIds.length === 0}
              className="flex-1 text-[10px] font-semibold text-ds-on-surface-variant hover:text-ds-error transition-colors py-1 rounded hover:bg-ds-error/5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              초기화
            </button>
          </div>
        </>
      )}
    </div>
  )
}

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
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="w-9 h-9 rounded-xl bg-ds-tertiary flex items-center justify-center shrink-0 shadow-lg shadow-ds-tertiary/20">
          <ShieldCheck className="w-5 h-5 text-white" strokeWidth={2.5} />
        </div>
        <div>
          <span className="text-lg font-extrabold tracking-tighter text-ds-on-surface font-headline leading-none block">FAT</span>
          <span className="text-[10px] text-ds-on-surface-variant font-medium mt-1.5 block leading-tight">Firewall Analysis Tool</span>
        </div>
      </div>

      {/* Device Panel */}
      <DevicePanel />

      {/* Main Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-1 pt-1">
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
                      <Icon
                        className={cn(
                          'w-4.5 h-4.5 shrink-0 transition-colors',
                          isActive ? 'text-ds-tertiary' : 'text-ds-on-surface-variant group-hover:text-ds-on-surface'
                        )}
                        strokeWidth={isActive ? 2.5 : 2}
                      />
                      <span className="tracking-tight">{label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        ))}
      </nav>

      {/* Bottom Actions */}
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
