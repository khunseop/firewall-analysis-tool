import { useState, useRef, useEffect, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ListFilter, Boxes, BarChart3 } from 'lucide-react'
import { type Device } from '@/api/devices'
import { useDeviceStore } from '@/store/deviceStore'
import { capacityLevel } from '@/lib/deviceCapacity'

export const DeviceNameCell = memo(function DeviceNameCell({ data, onShowDetail }: { data: Device; onShowDetail: (device: Device) => void }) {
  const navigate = useNavigate()
  const setSelectedIds = useDeviceStore((s) => s.setSelectedIds)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  if (!data) return null

  const goToPolicies = () => { setSelectedIds([data.id]); setOpen(false); navigate('/policies') }
  const goToObjects = () => { setSelectedIds([data.id]); setOpen(false); navigate('/objects') }
  const goToAnalysis = () => { setOpen(false); navigate('/analysis', { state: { openCreateWithDeviceId: data.id } }) }
  const showDetail = () => { setOpen(false); onShowDetail(data) }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className="text-[12px] font-semibold text-ds-on-surface hover:text-ds-tertiary transition-colors truncate max-w-full text-left"
        title={data.name}
      >
        {data.name}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-ds-outline-variant/15 py-1 z-50">
          <button onClick={showDetail} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] font-medium text-ds-on-surface hover:bg-ds-surface-container-low transition-colors">
            <Search className="w-3.5 h-3.5 text-ds-on-surface-variant" />
            상세보기
          </button>
          <button onClick={goToPolicies} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] font-medium text-ds-on-surface hover:bg-ds-surface-container-low transition-colors">
            <ListFilter className="w-3.5 h-3.5 text-ds-on-surface-variant" />
            정책 조회
          </button>
          <button onClick={goToObjects} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] font-medium text-ds-on-surface hover:bg-ds-surface-container-low transition-colors">
            <Boxes className="w-3.5 h-3.5 text-ds-on-surface-variant" />
            객체 조회
          </button>
          <button onClick={goToAnalysis} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] font-medium text-ds-on-surface hover:bg-ds-surface-container-low transition-colors">
            <BarChart3 className="w-3.5 h-3.5 text-ds-on-surface-variant" />
            분석 실행
          </button>
        </div>
      )}
    </div>
  )
})

export const ResourceWarningBadge = memo(function ResourceWarningBadge({ data }: { data: Device }) {
  if (!data) return null
  const networkObjectUsage = (data.cached_network_objects ?? 0) + (data.cached_network_groups ?? 0)
  const serviceUsage = (data.cached_services ?? 0) + (data.cached_service_groups ?? 0)
  const levels = [
    capacityLevel(data.cached_policies, data.policy_threshold),
    capacityLevel(networkObjectUsage, data.network_object_threshold),
    capacityLevel(serviceUsage, data.service_threshold),
  ]
  const hasAnyThreshold = data.policy_threshold != null || data.network_object_threshold != null || data.service_threshold != null
  if (!hasAnyThreshold) return <span className="text-[12px] text-ds-on-surface-variant/40">—</span>
  if (levels.includes('danger')) {
    return <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-50 text-ds-error border border-red-100">위험</span>
  }
  if (levels.includes('warning')) {
    return <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-100">경고</span>
  }
  return <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">정상</span>
})
