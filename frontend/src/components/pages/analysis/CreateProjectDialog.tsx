import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { DeviceSelectorSingle } from '@/components/shared/DeviceSelector'
import { createAnalysisProject, type AnalysisProject } from '@/api/analysisProjects'
import { queryKeys } from '@/api/queryKeys'
import { PROJECT_MODULES } from '../analysis-modules'

/** 프로젝트형 모듈(삭제 워크플로우 등) 시작 — 분석 실행과는 입력 항목이 완전히 달라 별도 다이얼로그로 분리했다. */
export function CreateProjectDialog({ open, onClose, moduleType }: { open: boolean; onClose: () => void; moduleType: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const module = PROJECT_MODULES.find((m) => m.type === moduleType) ?? PROJECT_MODULES[0]
  const [deviceId, setDeviceId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [memo, setMemo] = useState('')
  const [referenceDate, setReferenceDate] = useState('')

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) { setDeviceId(null); setName(''); setMemo(''); setReferenceDate('') }
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!deviceId) throw new Error('장비를 선택하세요.')
      if (!name.trim()) throw new Error('프로젝트명을 입력하세요.')
      return createAnalysisProject(module.type, deviceId, name.trim(), memo.trim() || undefined, referenceDate || undefined)
    },
    onSuccess: (project: AnalysisProject) => {
      toast.success('프로젝트가 생성되었습니다.')
      queryClient.invalidateQueries({ queryKey: queryKeys.analysisProjects(project.module_type) })
      queryClient.invalidateQueries({ queryKey: queryKeys.analysisProjects('all') })
      onClose()
      navigate(`/analysis/projects/${project.module_type}/${project.id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg bg-ds-surface-container-lowest">
        <DialogHeader>
          <DialogTitle className="font-headline text-ds-on-surface">{module.label} 프로젝트 만들기</DialogTitle>
          <DialogDescription className="text-13 text-ds-on-surface-variant">{module.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <p id="project-device-label" className="text-11 font-semibold text-ds-on-surface-variant">장비 <span aria-hidden="true">*</span></p>
            <div aria-labelledby="project-device-label"><DeviceSelectorSingle value={deviceId} onChange={setDeviceId} /></div>
          </div>
          <div>
            <Label htmlFor="project-name">프로젝트명 *</Label>
            <Input id="project-name" className="mt-1" placeholder="예: 2026-06 정책 삭제" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="project-memo">메모 (선택)</Label>
            <Input id="project-memo" className="mt-1" placeholder="작업 메모…" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="project-ref-date">
              기준일 (선택)
              <span className="ml-1.5 text-xs font-normal text-ds-on-surface-variant">— 만료·미사용 판단 기준일. 미설정 시 작업 당일 기준</span>
            </Label>
            <Input id="project-ref-date" type="date" className="mt-1" value={referenceDate} onChange={(e) => setReferenceDate(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-ds-outline-variant/10">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-ds-on-surface-variant hover:text-ds-on-surface transition-colors">취소</button>
          <Button type="button" variant="gradient" size="auto" onClick={() => mutation.mutate()} disabled={mutation.isPending} className="px-5 py-2 text-sm font-bold rounded-md">
            {mutation.isPending ? '생성 중…' : '만들기'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
