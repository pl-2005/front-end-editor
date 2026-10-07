import type {
  PageResult,
  ProjectDetails,
  ProjectFiles,
  ProjectRevision,
  ProjectSummary,
  SnapshotSaved,
} from '../types/project'
import { request } from './client'
export { ApiError } from './client'

/**
 * 请求旧快照项目列表，最多读取 100 个项目；旧 API 当前由后端安全配置禁用。
 */
export const listProjects = () => request<PageResult<ProjectSummary>>('/api/projects?size=100')
/**
 * 读取旧项目详情及当前快照文件。
 *
 * @param id 项目 ID
 */
export const getProject = (id: number) => request<ProjectDetails>(`/api/projects/${id}`)
/**
 * 按 vanilla 模板和指定入口创建旧快照项目。
 *
 * @param name 名称
 * @param entry 入口文件绝对路径
 */
export const createProject = (name: string, entry = '/index.html') =>
  request<ProjectSummary>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, template: 'vanilla', entry }),
  })
/**
 * 使用元数据状态版本构造 If-Match，提交旧项目名称及既有描述、模板。
 *
 * @param project 项目实体或摘要
 * @param name 名称
 */
export const updateProject = (project: ProjectSummary, name: string) =>
  request<ProjectSummary>(`/api/projects/${project.id}`, {
    method: 'PUT',
    headers: { 'If-Match': `"project-${project.id}-${project.stateVersion}"` },
    body: JSON.stringify({ name, description: project.description, template: project.template }),
  })
/**
 * 携带元数据 If-Match 删除旧项目，成功时无返回数据。
 *
 * @param project 项目实体或摘要
 */
export const deleteProject = (project: Pick<ProjectSummary, 'id' | 'stateVersion'>) =>
  request<void>(`/api/projects/${project.id}`, {
    method: 'DELETE',
    headers: { 'If-Match': `"project-${project.id}-${project.stateVersion}"` },
  })
/**
 * 提交旧项目入口和文件集合，以 expectedVersion 防止覆盖其他编辑会话。
 *
 * @param id 项目 ID
 * @param expectedVersion 预期当前快照版本
 * @param entry 入口文件绝对路径
 * @param files 文件集合
 */
export const saveSnapshot = (
  id: number,
  expectedVersion: number,
  entry: string,
  files: ProjectFiles,
) =>
  request<SnapshotSaved>(`/api/projects/${id}/snapshot`, {
    method: 'PUT',
    body: JSON.stringify({ expectedVersion, entry, files }),
  })
/**
 * 读取旧项目的快照历史版本。
 *
 * @param id 项目 ID
 */
export const listRevisions = (id: number) =>
  request<ProjectRevision[]>(`/api/projects/${id}/revisions`)
/**
 * 携带预期当前版本，将历史快照恢复为一个新版本。
 *
 * @param id 项目 ID
 * @param version 版本号
 * @param expectedVersion 预期当前快照版本
 */
export const restoreRevision = (id: number, version: number, expectedVersion: number) =>
  request<SnapshotSaved>(`/api/projects/${id}/revisions/${version}/restore`, {
    method: 'POST',
    body: JSON.stringify({ expectedVersion }),
  })
