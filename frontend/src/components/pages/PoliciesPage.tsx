import { useState, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Download, X } from 'lucide-react'
import type { ColDef } from '@ag-grid-community/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AgGridWrapper, type AgGridWrapperHandle } from '@/components/shared/AgGridWrapper'
import { DeviceSelect } from '@/components/shared/DeviceSelect'
import { listDevices } from '@/api/devices'
import { searchPolicies, getObjectDetails, exportToExcel, type Policy, type PolicySearchRequest } from '@/api/firewall'
import { formatDate } from '@/lib/utils'
import { ObjectDetailModal } from '@/components/shared/ObjectDetailModal'

interface SearchParams {
  device_ids: number[]
  rule_name: string
  action: string
  enable: string
  src_ip: string
  dst_ip: string
  protocol: string
  port: string
  user: string
  application: string
  description: string
}

const DEFAULT_PARAMS: SearchParams = {
  device_ids: [], rule_name: '', action: '', enable: '', src_ip: '', dst_ip: '',
  protocol: '', port: '', user: '', application: '', description: '',
}

export function PoliciesPage() {
  const gridRef = useRef<AgGridWrapperHandle>(null)
  const [params, setParams] = useState<SearchParams>(DEFAULT_PARAMS)
  const [searchModalOpen, setSearchModalOpen] = useState(false)
  const [draftParams, setDraftParams] = useState<SearchParams>(DEFAULT_PARAMS)
  const [policies, setPolicies] = useState<Policy[]>([])
  const [validObjectNames, setValidObjectNames] = useState<Set<string>>(new Set())
  const [objectModal, setObjectModal] = useState<{ deviceId: number; name: string } | null>(null)

  const { data: devices = [] } = useQuery({ queryKey: ['devices'], queryFn: listDevices })

  const searchMutation = useMutation({
    mutationFn: (req: PolicySearchRequest) => searchPolicies(req),
    onSuccess: (data) => {
      setPolicies(data.policies)
      setValidObjectNames(new Set(data.valid_object_names))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSearch = () => {
    setParams(draftParams)
    const req: PolicySearchRequest = {
      device_ids: draftParams.device_ids,
      rule_name: draftParams.rule_name || undefined,
      action: draftParams.action || undefined,
      enable: draftParams.enable === '' ? undefined : draftParams.enable === 'true',
      src_ip: draftParams.src_ip || undefined,
      dst_ip: draftParams.dst_ip || undefined,
      protocol: draftParams.protocol || undefined,
      port: draftParams.port || undefined,
      user: draftParams.user || undefined,
      application: draftParams.application || undefined,
      description: draftParams.description || undefined,
    }
    searchMutation.mutate(req)
    setSearchModalOpen(false)
  }

  const handleExport = async () => {
    if (policies.length === 0) { toast.warning('내보낼 데이터가 없습니다.'); return }
    try {
      await exportToExcel(policies as unknown as Record<string, unknown>[], '방화벽정책')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  }

  // Object name cell renderer using validObjectNames
  const makeCellRenderer = (field: string) => (params: { value: string; data: Policy }) => {
    const names: string[] = (params.value ?? '').split(',').map((s: string) => s.trim()).filter(Boolean)
    const div = document.createElement('div')
    div.className = 'flex flex-wrap gap-0.5 items-center h-full'
    names.forEach((name) => {
      const span = document.createElement('span')
      span.textContent = name
      if (validObjectNames.has(name)) {
        span.style.cssText = 'color:#1d4ed8;text-decoration:underline;cursor:pointer;'
        span.onclick = () => setObjectModal({ deviceId: params.data.device_id, name })
      }
      div.appendChild(span)
      if (name !== names[names.length - 1]) {
        const comma = document.createElement('span')
        comma.textContent = ', '
        div.appendChild(comma)
      }
    })
    return div
  }

  const columnDefs: ColDef<Policy>[] = [
    { field: 'rule_name', headerName: '정책명', filter: 'agTextColumnFilter', width: 160 },
    { field: 'seq', headerName: '순번', filter: 'agNumberColumnFilter', width: 70 },
    { field: 'action', headerName: '액션', filter: 'agTextColumnFilter', width: 80 },
    { field: 'enable', headerName: '활성', width: 70, valueFormatter: (p) => p.value ? '활성' : '비활성' },
    { field: 'source', headerName: '출발지', filter: 'agTextColumnFilter', width: 180, cellRenderer: makeCellRenderer('source') },
    { field: 'destination', headerName: '목적지', filter: 'agTextColumnFilter', width: 180, cellRenderer: makeCellRenderer('destination') },
    { field: 'service', headerName: '서비스', filter: 'agTextColumnFilter', width: 150, cellRenderer: makeCellRenderer('service') },
    { field: 'user', headerName: '사용자', filter: 'agTextColumnFilter', width: 120 },
    { field: 'application', headerName: '애플리케이션', filter: 'agTextColumnFilter', width: 140 },
    { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', width: 150 },
    { field: 'last_hit_date', headerName: '마지막 사용일', filter: 'agTextColumnFilter', width: 150, valueFormatter: (p) => formatDate(p.value) },
    { field: 'vsys', headerName: 'VSYS', filter: 'agTextColumnFilter', width: 80 },
  ]

  const set = (key: keyof SearchParams, val: string | number[]) =>
    setDraftParams((prev) => ({ ...prev, [key]: val }))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">방화벽 정책</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-8 gap-1.5" onClick={() => { setDraftParams(params); setSearchModalOpen(true) }}>
              <Search className="h-3 w-3" /> 검색 조건
            </Button>
            {policies.length > 0 && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleExport}>
                <Download className="h-3 w-3" /> Excel 내보내기
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0 px-4 pb-4">
          {/* Active filters summary */}
          {params.device_ids.length > 0 && (
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs text-muted-foreground">검색 조건:</span>
              {params.device_ids.length > 0 && (
                <span className="text-xs bg-primary/10 text-primary rounded px-2 py-0.5">
                  장비 {params.device_ids.length}개
                </span>
              )}
              {params.rule_name && <span className="text-xs bg-primary/10 text-primary rounded px-2 py-0.5">정책명: {params.rule_name}</span>}
              {params.action && <span className="text-xs bg-primary/10 text-primary rounded px-2 py-0.5">액션: {params.action}</span>}
              {params.src_ip && <span className="text-xs bg-primary/10 text-primary rounded px-2 py-0.5">출발지: {params.src_ip}</span>}
              {params.dst_ip && <span className="text-xs bg-primary/10 text-primary rounded px-2 py-0.5">목적지: {params.dst_ip}</span>}
              <Button variant="ghost" size="sm" className="h-5 px-1" onClick={() => { setParams(DEFAULT_PARAMS); setPolicies([]) }}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mb-2">총 {policies.length.toLocaleString()}건</p>
          <AgGridWrapper<Policy>
            columnDefs={columnDefs}
            rowData={policies}
            getRowId={(p) => String(p.data.id)}
            height="calc(100vh - 260px)"
            noRowsText="검색 조건을 설정하고 검색 버튼을 클릭하세요."
          />
        </CardContent>
      </Card>

      {/* Search modal */}
      <Dialog open={searchModalOpen} onOpenChange={setSearchModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>정책 검색 조건</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>장비 선택 *</Label>
              <DeviceSelect devices={devices} value={draftParams.device_ids} onChange={(ids) => set('device_ids', ids)} isMulti />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>정책명</Label>
                <Input value={draftParams.rule_name} onChange={(e) => set('rule_name', e.target.value)} placeholder="부분 일치" />
              </div>
              <div className="space-y-1">
                <Label>액션</Label>
                <ShadSelect value={draftParams.action} onValueChange={(v) => set('action', v)}>
                  <SelectTrigger><SelectValue placeholder="전체" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">전체</SelectItem>
                    <SelectItem value="allow">allow</SelectItem>
                    <SelectItem value="deny">deny</SelectItem>
                    <SelectItem value="drop">drop</SelectItem>
                  </SelectContent>
                </ShadSelect>
              </div>
              <div className="space-y-1">
                <Label>활성 여부</Label>
                <ShadSelect value={draftParams.enable} onValueChange={(v) => set('enable', v)}>
                  <SelectTrigger><SelectValue placeholder="전체" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">전체</SelectItem>
                    <SelectItem value="true">활성</SelectItem>
                    <SelectItem value="false">비활성</SelectItem>
                  </SelectContent>
                </ShadSelect>
              </div>
              <div className="space-y-1">
                <Label>출발지 IP</Label>
                <Input value={draftParams.src_ip} onChange={(e) => set('src_ip', e.target.value)} placeholder="예: 192.168.1.0/24" />
              </div>
              <div className="space-y-1">
                <Label>목적지 IP</Label>
                <Input value={draftParams.dst_ip} onChange={(e) => set('dst_ip', e.target.value)} placeholder="예: 10.0.0.0/8" />
              </div>
              <div className="space-y-1">
                <Label>프로토콜</Label>
                <Input value={draftParams.protocol} onChange={(e) => set('protocol', e.target.value)} placeholder="tcp, udp" />
              </div>
              <div className="space-y-1">
                <Label>포트</Label>
                <Input value={draftParams.port} onChange={(e) => set('port', e.target.value)} placeholder="예: 80, 443" />
              </div>
              <div className="space-y-1">
                <Label>사용자</Label>
                <Input value={draftParams.user} onChange={(e) => set('user', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>애플리케이션</Label>
                <Input value={draftParams.application} onChange={(e) => set('application', e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>설명</Label>
                <Input value={draftParams.description} onChange={(e) => set('description', e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSearchModalOpen(false)}>취소</Button>
            <Button onClick={handleSearch} disabled={draftParams.device_ids.length === 0 || searchMutation.isPending}>
              {searchMutation.isPending ? '검색 중...' : '검색'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Object detail modal */}
      {objectModal && (
        <ObjectDetailModal
          deviceId={objectModal.deviceId}
          name={objectModal.name}
          onClose={() => setObjectModal(null)}
        />
      )}
    </div>
  )
}
