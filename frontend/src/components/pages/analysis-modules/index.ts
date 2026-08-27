import type { AnalysisModule, QuickAnalysisModule, ProjectAnalysisModule } from './types'
import { redundancyModule } from './redundancy'
import { unusedModule } from './unused'
import { impactModule } from './impact'
import { unreferencedObjectsModule } from './unreferencedObjects'
import { riskyPortsModule } from './riskyPorts'
import { overPermissiveModule } from './overPermissive'

export const ANALYSIS_MODULES: AnalysisModule[] = [
  redundancyModule,
  unusedModule,
  impactModule,
  unreferencedObjectsModule,
  riskyPortsModule,
  overPermissiveModule,
]

export const QUICK_MODULES: QuickAnalysisModule[] = ANALYSIS_MODULES.filter(
  (m): m is QuickAnalysisModule => m.kind === 'quick'
)

export const PROJECT_MODULES: ProjectAnalysisModule[] = ANALYSIS_MODULES.filter(
  (m): m is ProjectAnalysisModule => m.kind === 'project'
)

export function getModule(type: string): AnalysisModule | undefined {
  return ANALYSIS_MODULES.find((m) => m.type === type)
}

export function getQuickModule(type: string): QuickAnalysisModule | undefined {
  const m = getModule(type)
  return m?.kind === 'quick' ? m : undefined
}
