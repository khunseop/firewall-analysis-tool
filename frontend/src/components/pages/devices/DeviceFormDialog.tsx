import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { VENDOR_OPTIONS, DEFAULT_FORM, type DeviceFormData } from './constants'

export function DeviceFormDialog({ open, onClose, initial, onSubmit, isPending }: {
  open: boolean; onClose: () => void; initial?: DeviceFormData
  onSubmit: (data: DeviceFormData) => void; isPending: boolean
}) {
  const [form, setForm] = useState<DeviceFormData>(initial ?? DEFAULT_FORM)
  const set = (key: keyof DeviceFormData, val: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">
            {initial?.name ? '장비 수정' : '장비 추가'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(form) }} className="space-y-3">
          <Tabs defaultValue="basic">
            <TabsList>
              <TabsTrigger value="basic">기본정보</TabsTrigger>
              <TabsTrigger value="detail">상세정보</TabsTrigger>
              <TabsTrigger value="location">설치정보</TabsTrigger>
              <TabsTrigger value="resource">임계치</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '장비명 *', key: 'name' as const, required: true },
                  { label: 'IP 주소 *', key: 'ip_address' as const, required: true },
                  { label: '모델', key: 'model' as const },
                  { label: '사용자명 *', key: 'username' as const, required: true },
                  { label: 'HA Peer IP', key: 'ha_peer_ip' as const },
                  { label: '그룹', key: 'group' as const },
                ].map(({ label, key, required }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                    <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} required={required} className="bg-white border-ds-outline-variant/30 text-sm" />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">벤더 *</Label>
                  <ShadSelect value={form.vendor} onValueChange={(v) => set('vendor', v)}>
                    <SelectTrigger className="bg-white border-ds-outline-variant/30 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VENDOR_OPTIONS.map((o) => <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </ShadSelect>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">
                    비밀번호 {!initial?.name && '*'}
                  </Label>
                  <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} required={!initial?.name} className="bg-white border-ds-outline-variant/30 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">
                    비밀번호 확인 {!initial?.name && '*'}
                  </Label>
                  <Input type="password" value={form.password_confirm} onChange={(e) => set('password_confirm', e.target.value)} required={!initial?.name} className="bg-white border-ds-outline-variant/30 text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">설명</Label>
                <Input value={form.description} onChange={(e) => set('description', e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
              </div>
              <div className="flex gap-4 pt-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer text-ds-on-surface-variant">
                  <Checkbox checked={form.collect_last_hit_date} onCheckedChange={(v) => set('collect_last_hit_date', !!v)} />
                  최근 사용일 수집
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer text-ds-on-surface-variant">
                  <Checkbox checked={form.use_ssh_for_last_hit_date} onCheckedChange={(v) => set('use_ssh_for_last_hit_date', !!v)} />
                  SSH로 최근 사용일 수집
                </label>
              </div>
            </TabsContent>

            <TabsContent value="detail" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '시리얼 번호', key: 'serial_number' as const },
                  { label: 'OS명', key: 'os_name' as const },
                  { label: 'OS버전', key: 'os_version' as const },
                ].map(({ label, key }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                    <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">도입일</Label>
                  <Input type="date" value={form.install_date} onChange={(e) => set('install_date', e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="location" className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '지역', key: 'location_region' as const },
                  { label: '설치동', key: 'location_building' as const },
                  { label: '층', key: 'location_floor' as const },
                  { label: 'Room', key: 'location_room' as const },
                ].map(({ label, key }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                    <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '좌표 X', key: 'location_x' as const },
                  { label: '좌표 Y', key: 'location_y' as const },
                  { label: '좌표 Z', key: 'location_z' as const },
                ].map(({ label, key }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                    <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="resource" className="space-y-3">
              <p className="text-[11px] text-ds-on-surface-variant">임계치는 관리자가 직접 입력하며, 사용량은 동기화된 정책·객체 수와 자동으로 비교됩니다.</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '정책 수 임계치', key: 'policy_threshold' as const },
                  { label: '네트워크 객체 수 임계치', key: 'network_object_threshold' as const },
                  { label: '서비스 객체 수 임계치', key: 'service_threshold' as const },
                ].map(({ label, key }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                    <Input type="number" min={0} value={form[key] as string} onChange={(e) => set(key, e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
            <button type="submit" disabled={isPending} className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50">
              {isPending ? '처리중…' : '저장'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
