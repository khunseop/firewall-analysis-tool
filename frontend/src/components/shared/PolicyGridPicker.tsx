import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import type { ColDef, GridReadyEvent } from '@ag-grid-community/core'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { rowIdFromId } from '@/lib/utils'
import { getPolicies, type Policy } from '@/api/firewall'
import { queryKeys } from '@/api/queryKeys'

const COLUMN_DEFS: ColDef<Policy>[] = [
  { field: 'seq', headerName: '순번', width: 70 },
  { field: 'rule_name', headerName: '정책명', width: 200 },
  { field: 'action', headerName: '액션', width: 80 },
  { field: 'source', headerName: '출발지', width: 220 },
  { field: 'destination', headerName: '목적지', width: 220 },
  { field: 'service', headerName: '서비스', width: 160 },
]

interface PolicyGridPickerMultiProps {
  deviceId: number | null
  mode: 'multi'
  value: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
}
interface PolicyGridPickerSingleProps {
  deviceId: number | null
  mode: 'single'
  value: number | null
  onChange: (id: number | null) => void
  placeholder?: string
}
type PolicyGridPickerProps = PolicyGridPickerMultiProps | PolicyGridPickerSingleProps

export function PolicyGridPicker(props: PolicyGridPickerProps) {
  const { deviceId, mode, placeholder } = props
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pendingMulti, setPendingMulti] = useState<number[]>([])
  const [pendingSingle, setPendingSingle] = useState<number | null>(null)
  const gridRef = useRef<AgGridWrapperHandle>(null)

  const { data: policies = [], isLoading } = useQuery({
    queryKey: queryKeys.policiesRaw(deviceId),
    queryFn: () => getPolicies(deviceId!),
    enabled: !!deviceId && open,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!open) return
    setSearch('')
    if (mode === 'multi') setPendingMulti(props.value)
    else setPendingSingle(props.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleGridReady = (e: GridReadyEvent<Policy>) => {
    if (mode !== 'multi') return
    e.api.forEachNode((node) => {
      if (node.data && pendingMulti.includes(node.data.id)) node.setSelected(true)
    })
  }

  const selectedLabel = useMemo(() => {
    if (mode === 'multi') {
      return props.value.length > 0 ? `${props.value.length}개 정책 선택됨` : (placeholder ?? '정책 선택…')
    }
    const p = policies.find((p) => p.id === props.value)
    return p ? `[${p.seq}] ${p.rule_name}` : (placeholder ?? '기준 정책 선택…')
  }, [mode, props.value, policies, placeholder])

  const handleConfirm = () => {
    if (mode === 'multi') props.onChange(pendingMulti)
    else props.onChange(pendingSingle)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!deviceId}
        className="w-full h-9 px-3 text-sm text-left bg-ds-surface-container-low border border-ds-outline-variant/30 rounded-md hover:border-ds-tertiary/40 disabled:opacity-50 truncate"
      >
        {selectedLabel}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl bg-ds-surface-container-lowest">
          <DialogHeader>
            <DialogTitle className="font-headline text-ds-on-surface">
              {mode === 'multi' ? '이동할 정책 선택' : '기준 정책 선택'}
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-2.5 py-1.5 mb-2">
            <Search className="w-3.5 h-3.5 text-ds-on-surface-variant shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="정책명, 출발지, 목적지 검색…"
              className="flex-1 text-[13px] bg-transparent outline-none text-ds-on-surface placeholder:text-ds-on-surface-variant/50"
            />
          </div>

          <AgGridWrapper<Policy>
            ref={gridRef}
            columnDefs={COLUMN_DEFS}
            rowData={policies}
            getRowId={rowIdFromId}
            quickFilterText={search}
            height={420}
            rowSelection={mode === 'multi' ? { mode: 'multiRow', checkboxes: true, headerCheckbox: true } : undefined}
            onSelectionChanged={mode === 'multi' ? (rows) => setPendingMulti(rows.map((r) => r.id)) : undefined}
            onGridReady={handleGridReady}
            onRowClicked={mode === 'single' ? (e) => setPendingSingle(e.data?.id ?? null) : undefined}
            getRowStyle={mode === 'single' ? (p) => (p.data?.id === pendingSingle ? { backgroundColor: 'rgba(0,150,136,0.08)' } : undefined) : undefined}
            noRowsText={isLoading ? '불러오는 중…' : '정책이 없습니다'}
          />

          <DialogFooter>
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
            <button type="button" onClick={handleConfirm} className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md">
              {mode === 'multi' ? `선택 완료 (${pendingMulti.length})` : '선택 완료'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
