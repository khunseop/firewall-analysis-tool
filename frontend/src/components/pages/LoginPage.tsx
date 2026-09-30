import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { login } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const setToken = useAuthStore((s) => s.setToken)
  const navigate = useNavigate()

  const { mutate, isPending } = useMutation({
    mutationFn: () => login(username, password),
    onSuccess: (data) => {
      setToken(data.access_token)
      navigate('/')
    },
    onError: (err: Error) => {
      toast.error(err.message || '로그인에 실패했습니다.')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    mutate()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ds-surface">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <span className="text-lg font-extrabold tracking-tight text-ds-tertiary font-headline">FAT</span>
          <p className="text-[13px] text-ds-on-surface-variant/70 mt-1">Firewall Analysis Tool</p>
        </div>
        <div className="card rounded-2xl px-6 py-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">아이디</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="아이디를 입력하세요"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호를 입력하세요"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? '로그인 중...' : '로그인'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
