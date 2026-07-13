import { useState, useRef, useEffect, memo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search, ListFilter, Boxes, BarChart3 } from 'lucide-react'
import { type Device } from '@/api/devices'
import { useDeviceStore } from '@/store/deviceStore'
import { usePolicySearchStore } from '@/store/policySearchStore'
import { buildRequestFromFilterTree } from '@/components/shared/queryBuilderModel'
import type { PolicySearchRequest } from '@/api/firewall'
import { capacityLevel } from '@/lib/deviceCapacity'

export const DeviceNameCell = memo(function DeviceNameCell({ data, onShowDetail }: { data: Device; onShowDetail: (device: Device) => void }) {
  const navigate = useNavigate()
  const setSelectedIds = useDeviceStore((s) => s.setSelectedIds)
  const setSearchRequest = usePolicySearchStore((s) => s.setSearchRequest)
  const setFilterTree = usePolicySearchStore((s) => s.setFilterTree)
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
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

  if (!data) return null

  const goToPolicies = () => {
    setSelectedIds([data.id])
    setFilterTree([])
    setSearchRequest(buildRequestFromFilterTree([], [data.id]) as unknown as PolicySearchRequest)
    setOpen(false)
    navigate('/policies')
  }
  const goToObjects = () => { setSelectedIds([data.id]); setOpen(false); navigate('/objects') }
  const goToAnalysis = () => { setOpen(false); navigate('/analysis', { state: { openCreateWithDeviceId: data.id } }) }
  const showDetail = () => { setOpen(false); onShowDetail(data) }

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setMenuPos({ top: rect.bottom + 4, left: rect.left })
    setOpen((v) => !v)
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        className="text-[12px] font-semibold text-ds-on-surface hover:text-ds-tertiary transition-colors truncate max-w-full text-left"
        title={data.name}
      >
        {data.name}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
          className="w-40 bg-white rounded-lg shadow-lg border border-ds-outline-variant/15 py-1 z-50"
        >
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
        </div>,
        document.body
      )}
    </div>
  )
})

export const ResourceWarningBadge = memo(function ResourceWarningBadge({ data }: { data: Device }) {
  if (!data) return null
  const levels = [
    capacityLevel(data.cached_policies, data.policy_threshold),
    capacityLevel(data.cached_network_objects, data.network_object_threshold),
    capacityLevel(data.cached_network_groups, data.network_group_threshold),
    capacityLevel(data.cached_services, data.service_threshold),
    capacityLevel(data.cached_service_groups, data.service_group_threshold),
  ]
  const hasAnyThreshold = data.policy_threshold != null || data.network_object_threshold != null
    || data.network_group_threshold != null || data.service_threshold != null || data.service_group_threshold != null
  if (!hasAnyThreshold) return <span className="text-[12px] text-ds-on-surface-variant/40">—</span>
  if (levels.includes('danger')) {
    return <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-50 text-ds-error border border-red-100">위험</span>
  }
  if (levels.includes('warning')) {
    return <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-100">경고</span>
  }
  return <span className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">정상</span>
})
