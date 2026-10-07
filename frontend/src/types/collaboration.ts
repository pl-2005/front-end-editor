import type { ProjectSummary } from './project'
export type TeamProjectSummary = Omit<ProjectSummary, 'version'>
export interface TeamProjectDetails extends TeamProjectSummary {
  collaboration: {
    collaborationMode: 'YJS'
    epoch: number
    generation: number
    contentHash: string
    size: number
    contentType: string
  }
}
