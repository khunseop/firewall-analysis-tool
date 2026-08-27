import { FileX2 } from 'lucide-react'
import type { ProjectAnalysisModule } from './types'

export const deletionWorkflowModule: ProjectAnalysisModule = {
  kind: 'project',
  type: 'deletion_workflow',
  label: '삭제 워크플로우',
  icon: FileX2,
  description: '만료되거나 미사용된 정책을 분류·정리해 삭제 대상을 산출하는 다단계 프로젝트입니다.',
}
