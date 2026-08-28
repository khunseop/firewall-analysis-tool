import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, AlertCircle, Loader2, Sparkles, Download, CheckCircle2 } from 'lucide-react'
import {
  getAnalysisProject, getProjectPipelineTaskResult, waitForPipelineTask,
  type AnalysisProjectDetail, type ProjectFileState,
} from '@/api/analysisProjects'
import { runProject, downloadTaskFile } from '@/api/unusedNgPolicy'
import { saveBlob } from '@/api/client'
import { queryKeys } from '@/api/queryKeys'

const findFile = (files: ProjectFileState[], taskId: number, slot: string) =>
  files.find((f) => f.task_id === taskId && f.slot === slot)

export default function UnusedNgPolicyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const projectId = Number(id)

  const [running, setRunning] = useState(false)

  const { data: project, isLoading, error } = useQuery<AnalysisProjectDetail>({
    queryKey: queryKeys.analysisProject(projectId),
    queryFn: () => getAnalysisProject(projectId),
    staleTime: 5_000,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.analysisProject(projectId) })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-ds-on-surface-variant">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 로딩 중...
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-sm text-ds-error">
        <AlertCircle className="w-4 h-4" /> 프로젝트를 불러올 수 없습니다.
      </div>
    )
  }

  const files = project.files ?? []
  const resultFile = findFile(files, 0, 'output_0')
  const done = Boolean(resultFile)

  const handleRun = async () => {
    setRunning(true)
    try {
      const resp = await runProject(projectId)
      const task = await waitForPipelineTask(resp.analysis_task_id)
      if (task.task_status === 'failure') throw new Error(task.error_message || '실행 실패')
      const res = await getProjectPipelineTaskResult(projectId, resp.analysis_task_id)
      toast.success(`실행 완료: ${res.outputs[0]?.filename ?? ''}`)
      refresh()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const handleDownload = async () => {
    try {
      const { blob, filename } = await downloadTaskFile(projectId, 0, 'output_0')
      saveBlob(blob, filename)
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-ds-outline-variant/30 shrink-0">
        <button
          onClick={() => navigate('/analysis')}
          className="flex items-center gap-1 text-sm text-ds-on-surface-variant hover:text-ds-on-surface"
        >
          <ArrowLeft className="w-4 h-4" /> 목록으로
        </button>
        <div className="w-px h-4 bg-ds-outline-variant/30" />
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-ds-on-surface truncate">
            {project.device_name} / {project.name}
          </h1>
          <p className="text-xs text-ds-on-surface-variant">
            {project.device_ip} · {project.device_vendor} · 생성 {new Date(project.created_at).toLocaleDateString('ko-KR')}
          </p>
        </div>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl">
        <div className="rounded-xl border border-ds-outline-variant/30 bg-white p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                {done
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : <Sparkles className="w-4 h-4 text-ds-on-surface-variant" />
                }
                <span className="text-sm font-medium text-ds-on-surface">미사용 NG 정책 리포트</span>
              </div>
              <p className="text-xs text-ds-on-surface-variant mt-0.5 ml-6">
                정책 추출 → 신청번호 파싱 → 사용이력 라이브 수집 → 통합가공까지 한 번에 실행합니다.
                (사용이력을 못 채우는 벤더/정책은 결과에 "-"로 표시됩니다.)
              </p>
              {done && (
                <p className="text-xs text-emerald-600 mt-1 ml-6">✓ {resultFile?.filename}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {done && (
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-ds-outline-variant/50 hover:bg-black/5"
                >
                  <Download className="w-3 h-3" /> 다운로드
                </button>
              )}
              <button
                onClick={handleRun}
                disabled={running}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90 disabled:opacity-50"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {running ? '실행 중...' : done ? '재실행' : '실행'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
