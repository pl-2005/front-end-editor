export type ProjectFile = { code: string }
export type ProjectFiles = Record<string, ProjectFile>

export interface ProjectSummary {
  id: number
  name: string
  description: string | null
  template: string
  entry: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface ProjectDetails extends ProjectSummary { files: ProjectFiles }
export interface PageResult<T> { items: T[]; page: number; size: number; totalElements: number; totalPages: number }
export interface SnapshotSaved { version: number; contentHash: string; savedAt: string }
export interface ProjectRevision { version: number; contentHash: string; sizeBytes: number; createdAt: string; current: boolean }
export interface ApiEnvelope<T> { data: T; message: string; status: number }
export interface ApiErrorBody { code?: string; message?: string }
