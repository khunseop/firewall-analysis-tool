import { FileSearch2 } from 'lucide-react'
import type { ProjectAnalysisModule } from './types'

export const unusedNgPolicyModule: ProjectAnalysisModule = {
  kind: 'project',
  type: 'unused_ng_policy',
  label: '미사용 NG 정책',
  icon: FileSearch2,
  description: '전체 정책에 신청정보·사용이력·AD/NG 여부 등을 부가한 검토용 리포트를 단일 실행으로 산출합니다.',
}
