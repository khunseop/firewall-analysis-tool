import { FileSearch2 } from 'lucide-react'
import type { ProjectAnalysisModule } from './types'

export const unusedNgPolicyModule: ProjectAnalysisModule = {
  kind: 'project',
  type: 'unused_ng_policy',
  label: '미사용 NG 정책',
  icon: FileSearch2,
  description: '전체 정책에 신청정보·사용이력·AD/NG 여부 등을 부가해 검토용 리포트를 산출하는 4단계 프로젝트입니다.',
}
