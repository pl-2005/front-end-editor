import type { ApiEnvelope, ApiErrorBody, PageResult, ProjectDetails, ProjectFiles, ProjectRevision, ProjectSummary, SnapshotSaved } from '../types/project'

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message) }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody
    throw new ApiError(body.message ?? `请求失败（${response.status}）`, response.status, body.code)
  }
  if (response.status === 204) return undefined as T
  return ((await response.json()) as ApiEnvelope<T>).data
}

export const listProjects = () => request<PageResult<ProjectSummary>>('/api/projects?size=100')
export const getProject = (id: number) => request<ProjectDetails>(`/api/projects/${id}`)
export const createProject = (name: string, entry = '/index.html') => request<ProjectSummary>('/api/projects', {
  method: 'POST', body: JSON.stringify({ name, template: 'vanilla', entry }),
})
export const updateProject = (project: ProjectSummary, name: string) => request<ProjectSummary>(`/api/projects/${project.id}`, {
  method: 'PUT',
  headers: { 'If-Match': `"project-${project.id}-${project.stateVersion}"` },
  body: JSON.stringify({ name, description: project.description, template: project.template }),
})
export const deleteProject = (project: Pick<ProjectSummary, 'id' | 'stateVersion'>) => request<void>(`/api/projects/${project.id}`, {
  method: 'DELETE', headers: { 'If-Match': `"project-${project.id}-${project.stateVersion}"` },
})
export const saveSnapshot = (id: number, expectedVersion: number, entry: string, files: ProjectFiles) =>
  request<SnapshotSaved>(`/api/projects/${id}/snapshot`, {
    method: 'PUT', body: JSON.stringify({ expectedVersion, entry, files }),
  })
export const listRevisions = (id: number) => request<ProjectRevision[]>(`/api/projects/${id}/revisions`)
export const restoreRevision = (id: number, version: number, expectedVersion: number) =>
  request<SnapshotSaved>(`/api/projects/${id}/revisions/${version}/restore`, {
    method: 'POST', body: JSON.stringify({ expectedVersion }),
  })
