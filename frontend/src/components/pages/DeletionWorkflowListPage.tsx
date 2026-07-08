import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, ArrowRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { DeviceSelectorSingle } from '@/components/shared/DeviceSelectorSingle'
import {
  listProjects,
  createProject,
  deleteProject,
  type DeletionWorkflowProject,
} from '@/api/deletionWorkflow'
import { queryKeys } from '@/api/queryKeys'

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  draft:     { label: '초안',   cls: 'bg-gray-100 text-gray-600' },
  running:   { label: '진행중', cls: 'bg-blue-50 text-blue-600' },
  completed: { label: '완료',   cls: 'bg-emerald-50 text-emerald-600' },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [memo, setMemo] = useState('')
  const [referenceDate, setReferenceDate] = useState('')

  const mutation = useMutation({
    mutationFn: () => createProject(deviceId!, name.trim(), memo.trim() || undefined, referenceDate || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.deletionWorkflowProjects })
      toast.success('프로젝트가 생성되었습니다.')
      setDeviceId(null); setName(''); setMemo(''); setReferenceDate('')
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!deviceId) { toast.error('장비를 선택하세요.'); return; }
    if (!name.trim()) { toast.error('프로젝트명을 입력하세요.'); return }
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>새 삭제 워크플로우 프로젝트</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div>
            <Label>장비</Label>
            <div className="mt-1">
              <DeviceSelectorSingle value={deviceId} onChange={setDeviceId} />
            </div>
          </div>
          <div>
            <Label>프로젝트명</Label>
            <Input
              className="mt-1"
              placeholder="예: 2026-06 정책 삭제"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label>메모 (선택)</Label>
            <Input
              className="mt-1"
              placeholder="작업 메모..."
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>
          <div>
            <Label>
              기준일 (선택)
              <span className="ml-1.5 text-xs font-normal text-ds-on-surface-variant">
                — 만료·미사용 판단 기준일. 미설정 시 작업 당일 기준
              </span>
            </Label>
            <Input
              type="date"
              className="mt-1"
              value={referenceDate}
              onChange={(e) => setReferenceDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-ds-outline-variant hover:bg-black/5"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 text-sm rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90 disabled:opacity-50"
            >
              {mutation.isPending ? '생성 중...' : '생성'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function DeletionWorkflowListPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)

  const { data: projects = [], isLoading } = useQuery({
    queryKey: queryKeys.deletionWorkflowProjects,
    queryFn: () => listProjects(),
    staleTime: 10_000,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.deletionWorkflowProjects })
      toast.success('프로젝트가 삭제되었습니다.')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleDelete = async (p: DeletionWorkflowProject) => {
    const ok = await confirm({
      title: '프로젝트 삭제',
      description: `"${p.name}" 프로젝트와 모든 저장 파일이 삭제됩니다.`,
      confirmLabel: '삭제',
      variant: 'destructive',
    })
    if (ok) deleteMutation.mutate(p.id)
  }

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-ds-outline-variant/30 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-ds-on-surface">삭제 워크플로우</h1>
          <p className="text-xs text-ds-on-surface-variant mt-0.5">
            방화벽별 정책 삭제 작업을 프로젝트로 관리합니다.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90"
        >
          <Plus className="w-4 h-4" />
          새 프로젝트
        </button>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-ds-on-surface-variant text-sm">
            로딩 중...
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-ds-on-surface-variant">
            <p className="text-sm">아직 프로젝트가 없습니다.</p>
            <button
              onClick={() => setCreateOpen(true)}
              className="text-sm text-ds-tertiary hover:underline"
            >
              첫 프로젝트 만들기 →
            </button>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-ds-outline-variant/30">
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant w-12">#</th>
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant">장비</th>
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant">프로젝트명</th>
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant w-24">상태</th>
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant w-28">기준일</th>
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant w-28">생성일</th>
                <th className="text-left py-2 px-3 font-medium text-ds-on-surface-variant w-16"></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/deletion-workflow/${p.id}`)}
                  className="border-b border-ds-outline-variant/20 hover:bg-black/[0.02] cursor-pointer group"
                >
                  <td className="py-3 px-3 text-ds-on-surface-variant">{p.id}</td>
                  <td className="py-3 px-3">
                    <div className="font-medium text-ds-on-surface">{p.device_name}</div>
                    <div className="text-xs text-ds-on-surface-variant">{p.device_ip}</div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-medium text-ds-on-surface">{p.name}</div>
                    {p.memo && <div className="text-xs text-ds-on-surface-variant truncate max-w-xs">{p.memo}</div>}
                  </td>
                  <td className="py-3 px-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="py-3 px-3 text-xs">
                    {p.reference_date
                      ? <span className="text-amber-700 font-medium">{p.reference_date}</span>
                      : <span className="text-ds-on-surface-variant/50">당일</span>
                    }
                  </td>
                  <td className="py-3 px-3 text-ds-on-surface-variant text-xs">
                    {new Date(p.created_at).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(p) }}
                        className="p-1 rounded hover:bg-ds-error/10 text-ds-on-surface-variant hover:text-ds-error"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ArrowRight className="w-3.5 h-3.5 text-ds-on-surface-variant" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {ConfirmDialogElement}
    </div>
  )
}
