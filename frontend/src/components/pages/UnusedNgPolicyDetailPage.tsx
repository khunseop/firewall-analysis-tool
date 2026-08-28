import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, AlertCircle, Loader2, Database, FileText, Upload, Sparkles, Download, CheckCircle2 } from 'lucide-react'
import {
  getAnalysisProject, getProjectPipelineTaskResult, waitForPipelineTask,
  type AnalysisProjectDetail, type ProjectFileState,
} from '@/api/analysisProjects'
import { runProjectExtract, runProjectTask, uploadUsageFile, downloadTaskFile } from '@/api/unusedNgPolicy'
import { saveBlob } from '@/api/client'
import { queryKeys } from '@/api/queryKeys'

const hasOutput = (files: ProjectFileState[], taskId: number) =>
  files.some((f) => f.task_id === taskId && f.slot.startsWith('output_'))

const findFile = (files: ProjectFileState[], taskId: number, slot: string) =>
  files.find((f) => f.task_id === taskId && f.slot === slot)

export default function UnusedNgPolicyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const projectId = Number(id)

  const [running, setRunning] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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
  const task0done = hasOutput(files, 0)
  const task1done = hasOutput(files, 1)
  const task2file = findFile(files, 2, 'external_0')
  const task3done = hasOutput(files, 3)
  const task3file = findFile(files, 3, 'output_0')

  const handleExtract = async () => {
    setRunning(0)
    try {
      const resp = await runProjectExtract(projectId)
      const task = await waitForPipelineTask(resp.analysis_task_id)
      if (task.task_status === 'failure') throw new Error(task.error_message || '정책 추출 실패')
      const res = await getProjectPipelineTaskResult(projectId, resp.analysis_task_id)
      toast.success(`추출 완료: ${res.outputs[0]?.filename ?? ''}`)
      refresh()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const handleRunTask = async (taskId: 1 | 3, successMessage: string) => {
    setRunning(taskId)
    try {
      const resp = await runProjectTask(projectId, taskId)
      const task = await waitForPipelineTask(resp.analysis_task_id)
      if (task.task_status === 'failure') throw new Error(task.error_message || '실행 실패')
      const res = await getProjectPipelineTaskResult(projectId, resp.analysis_task_id)
      toast.success(`${successMessage}: ${res.outputs[0]?.filename ?? ''}`)
      refresh()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      await uploadUsageFile(projectId, file)
      toast.success('사용이력 파일 업로드 완료')
      refresh()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const handleDownload = async (taskId: number, slot = 'output_0') => {
    try {
      const { blob, filename } = await downloadTaskFile(projectId, taskId, slot)
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
      <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-3xl">
        {/* ① 정책 추출 */}
        <div className="rounded-xl border border-ds-outline-variant/30 bg-white p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                {task0done
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : <Database className="w-4 h-4 text-ds-on-surface-variant" />
                }
                <span className="text-sm font-medium text-ds-on-surface">① 정책 추출</span>
              </div>
              <p className="text-xs text-ds-on-surface-variant mt-0.5 ml-6">
                FAT DB에서 전체 정책을 필터 없이 추출합니다.
              </p>
              {task0done && (
                <p className="text-xs text-emerald-600 mt-1 ml-6">✓ {findFile(files, 0, 'output_0')?.filename}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {task0done && (
                <button
                  onClick={() => handleDownload(0)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-ds-outline-variant/50 hover:bg-black/5"
                >
                  <Download className="w-3 h-3" /> 다운로드
                </button>
              )}
              <button
                onClick={handleExtract}
                disabled={running !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90 disabled:opacity-50"
              >
                {running === 0 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                {running === 0 ? '추출 중...' : task0done ? '재추출' : '추출 실행'}
              </button>
            </div>
          </div>
        </div>

        {/* ② 신청번호 파싱 */}
        <div className="rounded-xl border border-ds-outline-variant/30 bg-white p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                {task1done
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : <FileText className="w-4 h-4 text-ds-on-surface-variant" />
                }
                <span className="text-sm font-medium text-ds-on-surface">② 신청번호 파싱</span>
              </div>
              <p className="text-xs text-ds-on-surface-variant mt-0.5 ml-6">
                ①의 결과에서 신청정보(신청번호, 신청유형, Start/End Date 등)를 파싱합니다.
              </p>
              {task1done && (
                <p className="text-xs text-emerald-600 mt-1 ml-6">✓ {findFile(files, 1, 'output_0')?.filename}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {task1done && (
                <button
                  onClick={() => handleDownload(1)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-ds-outline-variant/50 hover:bg-black/5"
                >
                  <Download className="w-3 h-3" /> 다운로드
                </button>
              )}
              <button
                onClick={() => handleRunTask(1, '신청번호 파싱 완료')}
                disabled={running !== null || !task0done}
                title={!task0done ? '먼저 ①정책 추출을 실행하세요' : ''}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90 disabled:opacity-50"
              >
                {running === 1 ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                {running === 1 ? '실행 중...' : task1done ? '재실행' : '실행'}
              </button>
            </div>
          </div>
        </div>

        {/* ③ 사용이력 업로드 */}
        <div className="rounded-xl border border-ds-outline-variant/30 bg-white p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                {task2file
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : <Upload className="w-4 h-4 text-ds-on-surface-variant" />
                }
                <span className="text-sm font-medium text-ds-on-surface">③ 사용이력 업로드</span>
              </div>
              <p className="text-xs text-ds-on-surface-variant mt-0.5 ml-6">
                Devices 페이지의 "직접 추출"(사용이력) 결과 Excel 파일을 업로드합니다.
              </p>
              {task2file && (
                <p className="text-xs text-emerald-600 mt-1 ml-6">✓ {task2file.filename}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? '업로드 중...' : task2file ? '재업로드' : '업로드'}
              </button>
              <input ref={fileRef} type="file" className="hidden"
                onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
            </div>
          </div>
        </div>

        {/* ④ 통합 가공 */}
        <div className="rounded-xl border border-ds-outline-variant/30 bg-white p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                {task3done
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  : <Sparkles className="w-4 h-4 text-ds-on-surface-variant" />
                }
                <span className="text-sm font-medium text-ds-on-surface">④ 통합 가공</span>
              </div>
              <p className="text-xs text-ds-on-surface-variant mt-0.5 ml-6">
                사용이력 병합 + 시작일/경과일 + AD·NG 정책 여부 컬럼을 추가한 최종 리포트를 생성합니다.
              </p>
              {task3done && (
                <p className="text-xs text-emerald-600 mt-1 ml-6">✓ {task3file?.filename}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {task3done && (
                <button
                  onClick={() => handleDownload(3)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-ds-outline-variant/50 hover:bg-black/5"
                >
                  <Download className="w-3 h-3" /> 다운로드
                </button>
              )}
              <button
                onClick={() => handleRunTask(3, '통합 가공 완료')}
                disabled={running !== null || !task1done || !task2file}
                title={!task1done ? '먼저 ②신청번호 파싱을 실행하세요' : !task2file ? '먼저 ③사용이력 파일을 업로드하세요' : ''}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90 disabled:opacity-50"
              >
                {running === 3 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {running === 3 ? '가공 중...' : task3done ? '재가공' : '가공 실행'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
