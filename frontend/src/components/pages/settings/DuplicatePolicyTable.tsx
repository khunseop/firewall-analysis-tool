import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { parseYamlToJson } from '@/api/settings'
import { type Device } from '@/api/devices'
import { EX_PAGE_SIZE } from './ExceptionTable'

export interface DuplicatePolicyItem {
  device_id: number
  name: string
  reason: string
  registered_at: string
  expires_at: string
}

const YAML_EXAMPLE = `# device_id: 장비 ID (숫자), name: 정책명, reason: 사유
# registered_at/expires_at: YYYY-MM-DD 형식
- device_id: 1
  name: allow_xxx
  reason: 임시예외
  registered_at: "${new Date().toISOString().slice(0, 10)}"
  expires_at: "2026-12-31"`

// 검색 가능한 장비 선택 드롭다운
export function DeviceSearchSelect({
  value,
  devices,
  onChange,
  placeholder = '장비 선택',
  className = '',
}: {
  value: number | ''
  devices: Device[]
  onChange: (id: number | '') => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = devices.find(d => d.id === value)
  const filtered = devices.filter(d => {
    if (!q) return true
    const lq = q.toLowerCase()
    return d.name.toLowerCase().includes(lq) || d.ip_address.toLowerCase().includes(lq)
  })

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // 닫힐 때 검색어 초기화 (렌더 중 상태 조정 패턴), 포커스는 effect에서 처리
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) setQ('')
  }
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full h-7 px-2 text-[11px] bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary flex items-center justify-between gap-1 text-left"
      >
        <span className={`truncate ${selected ? 'text-ds-on-surface' : 'text-ds-on-surface-variant/50'}`}>
          {selected ? `${selected.name} (${selected.ip_address})` : placeholder}
        </span>
        <ChevronDown className="w-3 h-3 text-ds-on-surface-variant/50 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-0.5 left-0 min-w-full w-max max-w-[280px] bg-white border border-ds-outline-variant/20 rounded-lg shadow-lg">
          <div className="p-1.5 border-b border-ds-outline-variant/10">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ds-on-surface-variant/40 pointer-events-none" />
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="이름, IP 검색"
                className="w-full h-6 pl-6 pr-2 text-[11px] border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary bg-ds-surface-container-low/30"
              />
            </div>
          </div>
          <ul className="max-h-48 overflow-y-auto py-0.5">
            {placeholder && (
              <li>
                <button
                  type="button"
                  onClick={() => { onChange(''); setOpen(false) }}
                  className="w-full px-3 py-1.5 text-left text-[11px] text-ds-on-surface-variant/60 hover:bg-ds-surface-container-low/50 transition-colors"
                >
                  {placeholder}
                </button>
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-[11px] text-ds-on-surface-variant/50">검색 결과 없음</li>
            ) : filtered.map(d => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => { onChange(d.id); setOpen(false) }}
                  className={`w-full px-3 py-1.5 text-left text-[11px] hover:bg-ds-surface-container-low/50 transition-colors ${value === d.id ? 'text-ds-tertiary font-medium bg-ds-tertiary/5' : 'text-ds-on-surface'}`}
                >
                  <span className="font-medium">{d.name}</span>
                  <span className="text-ds-on-surface-variant/60 ml-1">({d.ip_address})</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function DuplicatePolicyTable({
  items, devices, onAdd, onRemove, onUpdate, onBulkAdd
}: {
  items: DuplicatePolicyItem[]
  devices: Device[]
  onAdd: () => void
  onRemove: (idx: number) => void
  onUpdate: (idx: number, patch: Partial<DuplicatePolicyItem>) => void
  onBulkAdd: (newItems: DuplicatePolicyItem[]) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [search, setSearch] = useState('')
  const [filterDeviceId, setFilterDeviceId] = useState<number | ''>('')
  const [hideExpired, setHideExpired] = useState(false)
  const [page, setPage] = useState(0)
  const [yamlOpen, setYamlOpen] = useState(false)
  const [yamlInput, setYamlInput] = useState('')
  const [parsing, setParsing] = useState(false)

  useEffect(() => { setPage(0) }, [search, filterDeviceId, hideExpired])

  const deviceMap = Object.fromEntries(devices.map(d => [d.id, d]))
  const withIdx = items.map((item, i) => ({ item, i }))
  const filtered = withIdx
    .filter(({ item }) => {
      if (filterDeviceId !== '' && item.device_id !== filterDeviceId) return false
      if (hideExpired && item.expires_at && item.expires_at < today) return false
      if (search) {
        const dev = deviceMap[item.device_id]
        return [item.name, item.reason, item.registered_at, item.expires_at, dev?.name, dev?.ip_address]
          .some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase()))
      }
      return true
    })
    .sort((a, b) => (b.item.registered_at ?? '').localeCompare(a.item.registered_at ?? ''))
  const totalPages = Math.max(1, Math.ceil(filtered.length / EX_PAGE_SIZE))
  const paged = filtered.slice(page * EX_PAGE_SIZE, (page + 1) * EX_PAGE_SIZE)

  const handleYamlAdd = async () => {
    setParsing(true)
    try {
      const parsed = await parseYamlToJson(yamlInput)
      if (!Array.isArray(parsed)) throw new Error('리스트(-) 형식이어야 합니다.')
      onBulkAdd(parsed as DuplicatePolicyItem[])
      setYamlInput('')
      setYamlOpen(false)
      toast.success(`${(parsed as unknown[]).length}개 항목이 추가되었습니다.`)
    } catch (e) {
      toast.error('YAML 오류: ' + (e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  return (
    <div className="space-y-2">
      {/* 행1: 제목 + 액션 버튼 */}
      <div className="flex items-center justify-between gap-2">
        <div className="shrink-0">
          <p className="text-[12px] font-semibold text-ds-on-surface">중복정책 예외</p>
          <p className="text-[11px] text-ds-on-surface-variant/70 mt-0.5">Task 17 실행 시 해당 장비의 유효한 예외가 자동 적용됩니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setYamlOpen(v => !v)}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-ds-on-surface-variant bg-ds-surface-container border border-ds-outline-variant/30 rounded-lg hover:bg-ds-surface-container-high transition-colors shrink-0"
          >
            YAML 일괄 추가
            {yamlOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <button
            onClick={onAdd}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-ds-tertiary bg-ds-tertiary/8 border border-ds-tertiary/20 rounded-lg hover:bg-ds-tertiary/12 transition-colors shrink-0"
          >
            <Plus className="w-3 h-3" />
            추가
          </button>
        </div>
      </div>
      {/* 행2: 필터 컨트롤 */}
      <div className="flex items-center gap-2 flex-wrap">
        <DeviceSearchSelect
          value={filterDeviceId}
          devices={devices}
          onChange={setFilterDeviceId}
          placeholder="전체 장비"
          className="w-52"
        />
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ds-on-surface-variant/50 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="정책명, 사유 검색"
            className="h-7 w-full pl-6 pr-2 text-[11px] bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
          />
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-ds-on-surface-variant cursor-pointer select-none shrink-0">
          <input
            type="checkbox"
            checked={hideExpired}
            onChange={(e) => setHideExpired(e.target.checked)}
            className="w-3.5 h-3.5 accent-ds-tertiary"
          />
          만료 숨기기
        </label>
      </div>

      {yamlOpen && (
        <div className="border border-ds-tertiary/20 bg-ds-tertiary/4 rounded-lg p-3 space-y-2">
          <p className="text-[11px] text-ds-on-surface-variant/70">아래 형식으로 입력 후 추가하면 기존 목록에 병합됩니다.</p>
          <textarea
            value={yamlInput}
            onChange={(e) => setYamlInput(e.target.value)}
            placeholder={YAML_EXAMPLE}
            spellCheck={false}
            rows={8}
            className="w-full px-3 py-2 text-[12px] font-mono leading-relaxed bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary resize-y"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleYamlAdd}
              disabled={!yamlInput.trim() || parsing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-ds-on-tertiary btn-primary-gradient rounded-lg shadow-sm disabled:opacity-50 transition-all"
            >
              {parsing ? '파싱 중…' : '추가'}
            </button>
            <button
              onClick={() => { setYamlOpen(false); setYamlInput('') }}
              className="px-3 py-1.5 text-[12px] text-ds-on-surface-variant hover:text-ds-on-surface transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-ds-outline-variant/8">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-ds-outline-variant/8 bg-ds-surface-container-low/30">
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 w-40">장비</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">정책명</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">사유</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 w-28">등록일</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60 w-28">만료일</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ds-outline-variant/8">
            {paged.map(({ item, i }) => {
              const expired = item.expires_at && item.expires_at < today
              return (
                <tr key={i} className={`hover:bg-ds-surface-container-low/20 ${expired ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-1.5">
                    <DeviceSearchSelect
                      value={item.device_id ?? ''}
                      devices={devices}
                      onChange={(id) => onUpdate(i, { device_id: id === '' ? 0 : id })}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      value={item.name ?? ''}
                      onChange={(e) => onUpdate(i, { name: e.target.value })}
                      placeholder="정책명"
                      className="w-full h-7 px-2 text-[12px] font-mono bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      value={item.reason ?? ''}
                      onChange={(e) => onUpdate(i, { reason: e.target.value })}
                      placeholder="예외 사유"
                      className="w-full h-7 px-2 text-[12px] bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="date"
                      value={item.registered_at ?? ''}
                      onChange={(e) => onUpdate(i, { registered_at: e.target.value })}
                      className="w-full h-7 px-2 text-[11px] bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        value={item.expires_at ?? ''}
                        onChange={(e) => onUpdate(i, { expires_at: e.target.value })}
                        className="w-full h-7 px-2 text-[11px] bg-white border border-ds-outline-variant/20 rounded focus:outline-none focus:border-ds-tertiary"
                      />
                      {expired && <span className="text-[10px] text-ds-error shrink-0">만료</span>}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button onClick={() => onRemove(i)} className="p-1 rounded hover:bg-red-50 text-ds-error transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              )
            })}
            {paged.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[12px] text-ds-on-surface-variant italic">
                  {search ? '검색 결과가 없습니다.' : '등록된 항목이 없습니다.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-[11px] text-ds-on-surface-variant">
        <span>
          {filtered.length}개 항목
          {(filterDeviceId !== '' || hideExpired || search) && (
            <span className="text-ds-on-surface-variant/50"> / 전체 {items.length}개</span>
          )}
          {filterDeviceId !== '' && (
            <button
              onClick={() => setFilterDeviceId('')}
              className="ml-2 text-ds-tertiary hover:underline"
            >
              필터 해제
            </button>
          )}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              className="p-0.5 rounded hover:bg-ds-surface-container-high disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="p-0.5 rounded hover:bg-ds-surface-container-high disabled:opacity-30"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
