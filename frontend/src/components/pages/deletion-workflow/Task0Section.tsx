import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Database, Play, Download, Upload, CheckCircle2, Loader2 } from 'lucide-react'
import { runProjectExtract, runProjectTask, uploadExternalFile, downloadTaskFile, type ProjectFileState } from '@/api/deletionWorkflow'
import { triggerDownload, hasOutput, getExternalFile } from './taskMeta'

export function Task0Section({
  projectId, files, hasPeerIp, autoRunCurrentTaskId, onRefresh, onBeforeExtract,
}: {
  projectId: number; files: ProjectFileState[]
  hasPeerIp: boolean; autoRunCurrentTaskId: number | null; onRefresh: () => void
  onBeforeExtract?: () => Promise<boolean>
}) {
  const [extracting, setExtracting] = useState(false)
  const isAutoExtracting = autoRunCurrentTaskId === 0
  const [merging, setMerging] = useState(false)
  const task0done = hasOutput(files, 0)
  const task1done = hasOutput(files, 1)
  const task0file = files.find((f) => f.task_id === 0 && f.slot === 'output_0')
  const task1file = files.find((f) => f.task_id === 1 && f.slot === 'output_0')
  const haSecFile = getExternalFile(files, 1, 'external_1')
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleExtract = async () => {
    if (onBeforeExtract) {
      const canProceed = await onBeforeExtract()
      if (!canProceed) return
    }

    setExtracting(true)
    try {
      const res = await runProjectExtract(projectId)
      toast.success(`추출 완료: ${res.filename}`)
      onRefresh()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setExtracting(false)
    }
  }

  const handleMerge = async () => {
    setMerging(true)
    try {
      const res = await runProjectTask(projectId, 1)
      toast.success(`히트카운트 병합 완료 (출력 ${res.outputs.length}개)`)
      onRefresh()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setMerging(false)
    }
  }

  const handleHaFile = async (file: File) => {
    setUploading(true)
    try {
      await uploadExternalFile(projectId, 1, 'external_1', file)
      toast.success('HA Secondary 파일 업로드 완료')
      onRefresh()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-xl border border-ds-outline-variant/30 bg-white p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            {task0done
              ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              : <Database className="w-4 h-4 text-ds-on-surface-variant" />
            }
            <span className="text-sm font-medium text-ds-on-surface">
              데이터 추출 및 사용이력 병합
            </span>
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-ds-surface-container text-ds-on-surface-variant font-mono">
              P0
            </span>
          </div>
          <p className="text-xs text-ds-on-surface-variant mt-0.5 ml-6">
            FAT DB에서 정책·객체 데이터와 사용이력(last_hit_date)을 추출합니다.
          </p>
          {task0done && (
            <p className="text-xs text-emerald-600 mt-1 ml-6">✓ {task0file?.filename}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {task0done && (
            <button
              onClick={async () => {
                try {
                  const { blob, filename } = await downloadTaskFile(projectId, 0, 'output_0')
                  triggerDownload(blob, filename)
                } catch (e: unknown) { toast.error((e as Error).message) }
              }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-ds-outline-variant/50 hover:bg-black/5"
            >
              <Download className="w-3 h-3" /> 다운로드
            </button>
          )}
          <button
            onClick={handleExtract}
            disabled={extracting || isAutoExtracting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-ds-tertiary text-white hover:bg-ds-tertiary/90 disabled:opacity-50"
          >
            {(extracting || isAutoExtracting) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            {(extracting || isAutoExtracting) ? '추출 중...' : task0done ? '재추출' : '추출 실행'}
          </button>
        </div>
      </div>

      {hasPeerIp && (
        <div className="ml-6 pt-3 border-t border-ds-outline-variant/20 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                {task1done
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  : <div className="w-3.5 h-3.5 rounded-full border-2 border-ds-outline-variant/40" />
                }
                <span className="text-xs font-medium text-ds-on-surface">
                  HA Secondary 히트카운트 병합
                </span>
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-ds-surface-container text-ds-on-surface-variant font-mono">
                  선택
                </span>
              </div>
              <p className="text-[11px] text-ds-on-surface-variant mt-0.5 ml-5">
                HA Secondary 장비의 히트카운트를 병합합니다.
              </p>
              {task1done && (
                <p className="text-[11px] text-emerald-600 mt-0.5 ml-5">✓ {task1file?.filename}</p>
              )}
            </div>
            <button
              onClick={handleMerge}
              disabled={merging || !haSecFile}
              title={!haSecFile ? 'HA Secondary 파일을 먼저 업로드하세요' : ''}
              className="flex items-center gap-1 ml-3 px-2.5 py-1 text-xs rounded-lg bg-ds-tertiary/10 text-ds-tertiary hover:bg-ds-tertiary/20 disabled:opacity-40 shrink-0"
            >
              {merging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {merging ? '병합 중...' : '병합'}
            </button>
          </div>
          <div className="ml-5 flex items-center gap-2 text-xs">
            <span className="text-ds-on-surface-variant">📋 HA Secondary 히트카운트 Excel:</span>
            {haSecFile ? (
              <span className="text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> {haSecFile.filename}
              </span>
            ) : (
              <span className="text-ds-on-surface-variant/60">(선택)</span>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-ds-outline-variant/50 hover:bg-black/5 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {haSecFile ? '교체' : '업로드'}
            </button>
            <input ref={fileRef} type="file" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleHaFile(e.target.files[0])} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────────
