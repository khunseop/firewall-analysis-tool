import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, KeyRound, UserCheck, UserX } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useConfirm } from '@/components/shared/ConfirmDialog'
import { getUsers, createUser, changeUserPassword, toggleUserActive, deleteUser, type User } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'

export function AccountSettings() {
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', password: '', is_admin: false })
  const [pwDialog, setPwDialog] = useState<{ user: User; password: string } | null>(null)

  const { data: users = [], isLoading } = useQuery({ queryKey: queryKeys.users, queryFn: getUsers })

  const createMutation = useMutation({
    mutationFn: () => createUser({ username: newUser.username, password: newUser.password, is_admin: newUser.is_admin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users })
      setCreateOpen(false)
      setNewUser({ username: '', password: '', is_admin: false })
      toast.success('계정이 생성되었습니다.')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const pwMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: number; password: string }) => changeUserPassword(userId, password),
    onSuccess: () => { setPwDialog(null); toast.success('비밀번호가 변경되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ userId, is_active }: { userId: number; is_active: boolean }) => toggleUserActive(userId, is_active),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users }),
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (userId: number) => deleteUser(userId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.users }); toast.success('계정이 삭제되었습니다.') },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleDelete = async (user: User) => {
    const ok = await confirm({ title: '계정 삭제', description: `'${user.username}' 계정을 삭제하시겠습니까?`, variant: 'destructive', confirmLabel: '삭제' })
    if (ok) deleteMutation.mutate(user.id)
  }

  if (isLoading) return <div className="py-8 text-center text-sm text-ds-on-surface-variant">로딩 중…</div>

  return (
    <div className="space-y-4">
      {ConfirmDialogElement}
      <div className="flex justify-between items-center">
        <p className="text-[12px] text-ds-on-surface-variant">시스템 계정을 관리합니다.</p>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold btn-primary-gradient text-ds-on-tertiary rounded-lg shadow-sm hover:opacity-90 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          계정 추가
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-ds-outline-variant/8">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-ds-outline-variant/8 bg-ds-surface-container-low/30">
              <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">사용자명</th>
              <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">권한</th>
              <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">상태</th>
              <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">생성일</th>
              <th className="px-5 py-2.5 text-right text-[10px] font-bold uppercase tracking-widest text-ds-on-surface-variant/60">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ds-outline-variant/10">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-ds-surface-container-low/20 transition-colors">
                <td className="px-5 py-4">
                  <span className="font-mono text-sm font-semibold text-ds-on-surface">{user.username}</span>
                </td>
                <td className="px-5 py-4">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${user.is_admin ? 'bg-amber-100 text-amber-700' : 'bg-ds-surface-container text-ds-on-surface-variant'}`}>
                    {user.is_admin ? '관리자' : '일반'}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {user.is_active ? '활성' : '비활성'}
                  </span>
                </td>
                <td className="px-5 py-4 text-sm text-ds-on-surface-variant">
                  {user.created_at ? new Date(user.created_at).toLocaleDateString('ko-KR') : '-'}
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => setPwDialog({ user, password: '' })}
                      title="비밀번호 변경"
                      className="p-1.5 rounded hover:bg-ds-surface-container-high text-ds-on-surface-variant hover:text-ds-primary transition-colors"
                    >
                      <KeyRound className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => toggleMutation.mutate({ userId: user.id, is_active: !user.is_active })}
                      title={user.is_active ? '비활성화' : '활성화'}
                      className={`p-1.5 rounded transition-colors ${user.is_active ? 'hover:bg-amber-50 text-amber-600' : 'hover:bg-green-50 text-green-600'}`}
                    >
                      {user.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleDelete(user)}
                      title="삭제"
                      className="p-1.5 rounded hover:bg-red-50 text-ds-error transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-ds-on-surface-variant italic">등록된 계정이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm bg-ds-surface-container-lowest">
          <DialogHeader>
            <DialogTitle className="font-headline">계정 추가</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate() }} className="space-y-3 pt-1">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">사용자명 *</Label>
              <Input value={newUser.username} onChange={(e) => setNewUser(p => ({ ...p, username: e.target.value }))} required className="bg-white border-ds-outline-variant/30 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">비밀번호 *</Label>
              <Input type="password" value={newUser.password} onChange={(e) => setNewUser(p => ({ ...p, password: e.target.value }))} required className="bg-white border-ds-outline-variant/30 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer text-ds-on-surface-variant">
              <input type="checkbox" checked={newUser.is_admin} onChange={(e) => setNewUser(p => ({ ...p, is_admin: e.target.checked }))} className="rounded border-ds-outline-variant/40" />
              관리자 권한 부여
            </label>
            <DialogFooter>
              <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
              <button type="submit" disabled={createMutation.isPending} className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50">
                {createMutation.isPending ? '생성 중…' : '생성'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Change password dialog */}
      {pwDialog && (
        <Dialog open onOpenChange={() => setPwDialog(null)}>
          <DialogContent className="max-w-sm bg-ds-surface-container-lowest">
            <DialogHeader>
              <DialogTitle className="font-headline">비밀번호 변경 — {pwDialog.user.username}</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); pwMutation.mutate({ userId: pwDialog.user.id, password: pwDialog.password }) }} className="space-y-3 pt-1">
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase tracking-widest text-ds-primary">새 비밀번호 *</Label>
                <Input
                  type="password"
                  value={pwDialog.password}
                  onChange={(e) => setPwDialog(p => p ? { ...p, password: e.target.value } : null)}
                  required
                  className="bg-white border-ds-outline-variant/30 text-sm"
                />
              </div>
              <DialogFooter>
                <button type="button" onClick={() => setPwDialog(null)} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
                <button type="submit" disabled={pwMutation.isPending} className="px-5 py-2 text-sm font-bold text-ds-on-tertiary btn-primary-gradient rounded-md disabled:opacity-50">
                  {pwMutation.isPending ? '변경 중…' : '변경'}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// 로그 설정
// ──────────────────────────────────────────────────────────────────
