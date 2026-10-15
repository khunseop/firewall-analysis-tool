import { useState, useMemo } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { VENDOR_OPTIONS, DEFAULT_FORM, type DeviceFormData } from './constants'

/** IPv4(옥텟 0~255), IPv6, 호스트명을 허용한다 — 공백·특수문자가 섞인 값은 저장 전에 걸러낸다. */
function isValidHost(value: string): boolean {
  const v = value.trim()
  if (/^[\d.]+$/.test(v)) return /^(\d{1,3})(\.\d{1,3}){3}$/.test(v) && v.split('.').every((o) => Number(o) <= 255)
  if (v.includes(':')) return /^[0-9a-fA-F:]+$/.test(v) && v.split(':').length >= 3
  return /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(v)
}

export function DeviceFormDialog({ open, onClose, initial, onSubmit, isPending }: {
  open: boolean; onClose: () => void; initial?: DeviceFormData
  onSubmit: (data: DeviceFormData) => void; isPending: boolean
}) {
  const [form, setForm] = useState<DeviceFormData>(initial ?? DEFAULT_FORM)
  const [baseline] = useState(() => JSON.stringify(initial ?? DEFAULT_FORM))
  const [tab, setTab] = useState('basic')
  const [showPassword, setShowPassword] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitted, setSubmitted] = useState(false)
  const { confirm, ConfirmDialogElement } = useConfirm()
  const isNew = !initial?.name
  const dirty = useMemo(() => JSON.stringify(form) !== baseline, [form, baseline])
  const set = (key: keyof DeviceFormData, val: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: val }))
  const touch = (key: string) => setTouched((prev) => ({ ...prev, [key]: true }))

  // noValidate로 브라우저 기본 검사를 끄고 인라인 오류로 대신하므로, 필수 입력 검사도 여기서 직접 한다.
  const REQUIRED = '필수 입력입니다.'
  const BAD_HOST = 'IP 주소 또는 호스트명 형식이 올바르지 않습니다.'
  const errors = {
    name: form.name.trim() ? '' : REQUIRED,
    ip_address: !form.ip_address.trim() ? REQUIRED : !isValidHost(form.ip_address) ? BAD_HOST : '',
    username: form.username.trim() ? '' : REQUIRED,
    ha_peer_ip: form.ha_peer_ip && !isValidHost(form.ha_peer_ip) ? BAD_HOST : '',
    password: isNew && !form.password ? REQUIRED : '',
    password_confirm: isNew && !form.password_confirm ? REQUIRED
      : (form.password || form.password_confirm) && form.password !== form.password_confirm ? '비밀번호가 일치하지 않습니다.' : '',
  }
  const errorFor = (key: keyof typeof errors) => ((submitted || touched[key]) ? errors[key] : '')
  const hasErrors = Object.values(errors).some(Boolean)

  // 입력 중인 내용이 있으면 바깥 클릭으로는 닫히지 않고, Esc·취소는 확인을 거친다.
  const requestClose = async () => {
    if (!dirty) { onClose(); return }
    const ok = await confirm({
      title: '입력한 내용을 버릴까요?',
      description: '저장하지 않은 변경 내용이 사라집니다.',
      confirmLabel: '버리기', variant: 'destructive',
    })
    if (ok) onClose()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (hasErrors) { setSubmitted(true); setTab('basic'); return }
    onSubmit(form)
  }

  return (
    <>
    {ConfirmDialogElement}
    <Dialog open={open} onOpenChange={(o) => { if (!o) void requestClose() }}>
      <DialogContent
        className="max-w-2xl bg-ds-surface-container-lowest"
        onInteractOutside={(e) => { if (dirty) e.preventDefault() }}
      >
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">
            {initial?.name ? '장비 수정' : '장비 추가'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          <Tabs value={tab} onValueChange={setTab}>
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
                  { label: '사용자명 *', key: 'username' as const, required: true },
                  { label: 'HA Peer IP', key: 'ha_peer_ip' as const },
                  { label: '그룹', key: 'group' as const },
                ].map(({ label, key, required }) => {
                  const err = key in errors ? errorFor(key as keyof typeof errors) : ''
                  return (
                    <div key={key} className="space-y-1">
                      <Label htmlFor={`device-form-${key}`} className="text-10 font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                      <Input
                        id={`device-form-${key}`}
                        value={form[key] as string}
                        onChange={(e) => set(key, e.target.value)}
                        onBlur={() => touch(key)}
                        required={required}
                        aria-required={required}
                        aria-invalid={!!err}
                        aria-describedby={err ? `device-form-${key}-error` : undefined}
                        className="bg-white border-ds-outline-variant/30 text-sm"
                      />
                      {err && <p id={`device-form-${key}-error`} role="alert" className="text-11 text-ds-error">{err}</p>}
                    </div>
                  )
                })}
                <div className="space-y-1">
                  <Label htmlFor="device-form-vendor" className="text-10 font-bold uppercase tracking-widest text-ds-primary">벤더 *</Label>
                  <ShadSelect value={form.vendor} onValueChange={(v) => set('vendor', v)}>
                    <SelectTrigger id="device-form-vendor" className="bg-white border-ds-outline-variant/30 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VENDOR_OPTIONS.map((o) => <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </ShadSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="device-form-password" className="text-10 font-bold uppercase tracking-widest text-ds-primary">
                    비밀번호 {isNew && '*'}
                  </Label>
                  <div className="relative">
                    <Input
                      id="device-form-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                      onBlur={() => touch('password')}
                      required={isNew}
                      aria-required={isNew}
                      aria-invalid={!!errorFor('password')}
                      aria-describedby={errorFor('password') ? 'device-form-password-error' : undefined}
                      placeholder={isNew ? undefined : '변경할 때만 입력'}
                      className="bg-white border-ds-outline-variant/30 text-sm pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                      aria-pressed={showPassword}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-ds-on-surface-variant hover:text-ds-on-surface rounded"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {errorFor('password')
                    ? <p id="device-form-password-error" role="alert" className="text-11 text-ds-error">{errorFor('password')}</p>
                    : <p className="text-11 text-ds-on-surface-variant">비밀번호는 암호화되어 저장됩니다.</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="device-form-password_confirm" className="text-10 font-bold uppercase tracking-widest text-ds-primary">
                    비밀번호 확인 {isNew && '*'}
                  </Label>
                  <Input
                    id="device-form-password_confirm"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={form.password_confirm}
                    onChange={(e) => set('password_confirm', e.target.value)}
                    onBlur={() => touch('password_confirm')}
                    required={isNew}
                    aria-required={isNew}
                    aria-invalid={!!errorFor('password_confirm')}
                    aria-describedby={errorFor('password_confirm') ? 'device-form-password_confirm-error' : undefined}
                    className="bg-white border-ds-outline-variant/30 text-sm"
                  />
                  {errorFor('password_confirm') && <p id="device-form-password_confirm-error" role="alert" className="text-11 text-ds-error">{errorFor('password_confirm')}</p>}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-10 font-bold uppercase tracking-widest text-ds-primary">설명</Label>
                <Input value={form.description} onChange={(e) => set('description', e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
              </div>
              {isNew && (
                <p className="text-11 text-ds-on-surface-variant rounded-lg bg-ds-surface-container-low px-3 py-2 leading-relaxed">
                  필수 입력은 <strong className="font-semibold text-ds-on-surface">*</strong> 표시 항목뿐이며, 상세정보·설치정보·임계치는 비워 둬도 됩니다.
                  저장해도 동기화는 자동으로 시작되지 않습니다. 저장한 뒤 목록에서 장비를 선택해 <strong className="font-semibold text-ds-on-surface">연결 테스트</strong>로 접속을 확인하고 <strong className="font-semibold text-ds-on-surface">동기화</strong>를 실행하세요.
                </p>
              )}
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
              <p className="text-11 text-ds-on-surface-variant">
                "수동등록"을 체크하면 값을 직접 입력할 수 있습니다. 체크하지 않으면 Palo Alto 동기화 시 장비에서 조회한 값(show system info)이 자동으로 채워집니다.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Hostname', key: 'hostname' as const, manualKey: 'hostname_manual' as const },
                  { label: '모델', key: 'model' as const, manualKey: 'model_manual' as const },
                  { label: '시리얼 번호', key: 'serial_number' as const, manualKey: 'serial_number_manual' as const },
                  { label: 'OS버전', key: 'os_version' as const, manualKey: 'os_version_manual' as const },
                  { label: 'Multi-vsys', key: 'multi_vsys' as const, manualKey: 'multi_vsys_manual' as const },
                ].map(({ label, key, manualKey }) => (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-10 font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                      <label className="flex items-center gap-1.5 text-11 cursor-pointer text-ds-on-surface-variant">
                        <Checkbox checked={form[manualKey]} onCheckedChange={(v) => set(manualKey, !!v)} />
                        수동등록
                      </label>
                    </div>
                    <Input
                      value={form[key] as string}
                      onChange={(e) => set(key, e.target.value)}
                      disabled={!form[manualKey]}
                      className="bg-white border-ds-outline-variant/30 text-sm disabled:bg-ds-surface-container disabled:text-ds-on-surface-variant"
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-10 font-bold uppercase tracking-widest text-ds-primary">Uptime</Label>
                  <Input value={form.uptime} disabled className="bg-white border-ds-outline-variant/30 text-sm disabled:bg-ds-surface-container disabled:text-ds-on-surface-variant" />
                </div>
                <div className="space-y-1">
                  <Label className="text-10 font-bold uppercase tracking-widest text-ds-primary">OS명</Label>
                  <Input value={form.os_name} onChange={(e) => set('os_name', e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-10 font-bold uppercase tracking-widest text-ds-primary">도입일</Label>
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
                    <Label className="text-10 font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
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
                    <Label className="text-10 font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                    <Input value={form[key] as string} onChange={(e) => set(key, e.target.value)} className="bg-white border-ds-outline-variant/30 text-sm" />
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="resource" className="space-y-3">
              <p className="text-11 text-ds-on-surface-variant">
                "수동등록"을 체크하면 값을 직접 입력할 수 있습니다. 체크하지 않으면 Palo Alto 동기화 시 장비의 실제 한도 값이 자동으로 채워집니다.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: '정책 수 임계치', key: 'policy_threshold' as const, manualKey: 'policy_threshold_manual' as const },
                  { label: '네트워크 객체 수 임계치', key: 'network_object_threshold' as const, manualKey: 'network_object_threshold_manual' as const },
                  { label: '네트워크 그룹 수 임계치', key: 'network_group_threshold' as const, manualKey: 'network_group_threshold_manual' as const },
                  { label: '서비스 객체 수 임계치', key: 'service_threshold' as const, manualKey: 'service_threshold_manual' as const },
                  { label: '서비스 그룹 수 임계치', key: 'service_group_threshold' as const, manualKey: 'service_group_threshold_manual' as const },
                ].map(({ label, key, manualKey }) => (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-10 font-bold uppercase tracking-widest text-ds-primary">{label}</Label>
                      <label className="flex items-center gap-1.5 text-11 cursor-pointer text-ds-on-surface-variant">
                        <Checkbox checked={form[manualKey]} onCheckedChange={(v) => set(manualKey, !!v)} />
                        수동등록
                      </label>
                    </div>
                    <Input
                      type="number" min={0}
                      value={form[key] as string}
                      onChange={(e) => set(key, e.target.value)}
                      disabled={!form[manualKey]}
                      className="bg-white border-ds-outline-variant/30 text-sm disabled:bg-ds-surface-container disabled:text-ds-on-surface-variant"
                    />
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <button type="button" onClick={() => void requestClose()} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
            <Button type="submit" variant="gradient" size="auto" disabled={isPending} className="px-5 py-2 text-sm font-bold rounded-md">
              {isPending ? '저장 중…' : isNew ? '장비 저장' : '변경 저장'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  )
}
