import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Upload, CheckCircle2, Loader2 } from 'lucide-react'
import { uploadExternalFile, type ProjectFileState } from '@/api/deletionWorkflow'

export function ExternalFileUpload({
  projectId, taskId, slot, label, required, existingFile, onUploaded,
}: {
  projectId: number; taskId: number; slot: string; label: string
  required: boolean; existingFile?: ProjectFileState; onUploaded: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFile = async (file: File) => {
    setUploading(true)
    try {
      await uploadExternalFile(projectId, taskId, slot, file)
      toast.success(`${label} 업로드 완료`)
      onUploaded()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs flex-wrap">
      <span className="text-ds-on-surface-variant">
        {required ? '📎' : '📋'} {label}{required ? ' (필수)' : ' (선택)'}:
      </span>
      {existingFile ? (
        <span className="text-emerald-600 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> {existingFile.filename}
        </span>
      ) : (
        <span className="text-ds-on-surface-variant/60">미업로드</span>
      )}
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1 px-2 py-0.5 rounded border border-ds-outline-variant/50 hover:bg-black/5 disabled:opacity-50"
      >
        {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
        {existingFile ? '교체' : '업로드'}
      </button>
      <input ref={fileRef} type="file" className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
    </div>
  )
}

// ── 컴포넌트: 태스크 카드 ────────────────────────────────────────────────────
