import { ApiError, request } from './client'
import { getAuthUser } from './auth'
import { cachedProjectIds, purgeProjectCaches } from '../collaboration/offline'
import type {
  Team,
  TeamPage,
  Member,
  JoinRequest,
  Invitation,
  MyInvitation,
  Invitee,
} from '../types/team'
import type { PageResult } from '../types/project'
import type { TeamProjectDetails, TeamProjectSummary } from '../types/collaboration'

/**
 * 构造指定团队的 API 基础路径。
 *
 * @param teamId 团队 ID
 */
const base = (teamId: number) => `/api/teams/${teamId}`
/**
 * 构造指定团队的项目集合路径。
 *
 * @param teamId 团队 ID
 */
const projects = (teamId: number) => `${base(teamId)}/projects`
/**
 * 读取当前用户的团队列表，最多返回 100 项。
 *
 * @param signal 用于取消请求的信号
 */
export const listMyTeams = (signal?: AbortSignal) =>
  request<TeamPage>('/api/teams?size=100', { signal })
/**
 * 编码搜索词后分页查询允许申请加入的团队，默认每页返回 10 项。
 *
 * @param query 名称搜索词
 * @param page 从 0 开始的页码
 * @param size 每页记录数
 * @param signal 用于取消请求的信号
 */
export const discoverTeams = (query: string, page = 0, size = 10, signal?: AbortSignal) =>
  request<TeamPage>(
    `/api/teams/discover?query=${encodeURIComponent(query)}&page=${page}&size=${size}`,
    { signal },
  )
/**
 * 提交名称和描述创建团队，创建者成为所有者。
 *
 * @param name 名称
 * @param description 描述，允许为空
 */
export const createTeam = (name: string, description: string) =>
  request<Team>('/api/teams', { method: 'POST', body: JSON.stringify({ name, description }) })
/**
 * 读取具有成员访问权限的团队详情。
 *
 * @param teamId 团队 ID
 *
 * @param signal 用于取消请求的信号
 */
export const getTeam = (teamId: number, signal?: AbortSignal) =>
  request<Team>(base(teamId), { signal })
/**
 * 读取团队有效成员及公开用户资料。
 *
 * @param teamId 团队 ID
 * @param signal 用于取消请求的信号
 */
export const listMembers = (teamId: number, signal?: AbortSignal) =>
  request<Member[]>(`${base(teamId)}/members`, { signal })
/**
 * 由所有者更新团队加入策略，返回更新后的团队。
 *
 * @param teamId 团队 ID
 * @param joinPolicy 加入策略
 */
export const setJoinPolicy = (teamId: number, joinPolicy: Team['joinPolicy']) =>
  request<Team>(`${base(teamId)}/join-policy`, {
    method: 'PUT',
    body: JSON.stringify({ joinPolicy }),
  })
/**
 * 为当前用户提交加入申请。
 *
 * @param teamId 团队 ID
 */
export const requestJoin = (teamId: number) =>
  request<JoinRequest>(`${base(teamId)}/join-requests`, { method: 'POST' })
/**
 * 读取当前用户待处理的加入申请。
 *
 * @param signal 用于取消请求的信号
 */
export const listMyJoinRequests = (signal?: AbortSignal) =>
  request<{ id: number; teamId: number; status: string; createdAt: string }[]>(
    '/api/teams/join-requests/me',
    { signal },
  )
/**
 * 撤回当前用户在指定团队的待处理申请。
 *
 * @param teamId 团队 ID
 */
export const withdrawJoin = (teamId: number) =>
  request<void>(`${base(teamId)}/join-requests/me`, { method: 'DELETE' })
/**
 * 由所有者读取团队待审批申请。
 *
 * @param teamId 团队 ID
 * @param signal 用于取消请求的信号
 */
export const listJoinRequests = (teamId: number, signal?: AbortSignal) =>
  request<JoinRequest[]>(`${base(teamId)}/join-requests`, { signal })
/**
 * 由所有者按 approve 或 reject 处理指定加入申请。
 *
 * @param teamId 团队 ID
 * @param requestId 加入申请 ID
 * @param decision 批准或拒绝操作
 */
export const decideJoin = (teamId: number, requestId: number, decision: 'approve' | 'reject') =>
  request<void>(`${base(teamId)}/join-requests/${requestId}/${decision}`, { method: 'POST' })
/**
 * 编码用户名或邮箱后查找可邀请的已注册用户。
 *
 * @param teamId 团队 ID
 * @param identifier 用户名或邮箱
 */
export const lookupInvitee = (teamId: number, identifier: string) =>
  request<Invitee>(`${base(teamId)}/invitees/lookup?identifier=${encodeURIComponent(identifier)}`)
/** 按用户名或邮箱关键词模糊搜索可邀请用户，最多返回 20 条。 */
export const searchInvitees = (teamId: number, query: string, signal?: AbortSignal) =>
  request<Invitee[]>(`${base(teamId)}/invitees/search?query=${encodeURIComponent(query)}`, {
    signal,
  })
/**
 * 由所有者向指定用户 ID 发送站内邀请。
 *
 * @param teamId 团队 ID
 * @param userId 用户 ID
 */
export const issueInvitation = (teamId: number, userId: number) =>
  request<Invitation>(`${base(teamId)}/invitations`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
/**
 * 由所有者读取团队邀请记录。
 *
 * @param teamId 团队 ID
 * @param signal 用于取消请求的信号
 */
export const listInvitations = (teamId: number, signal?: AbortSignal) =>
  request<Invitation[]>(`${base(teamId)}/invitations`, { signal })
/**
 * 由所有者撤销指定团队邀请。
 *
 * @param teamId 团队 ID
 * @param invitationId 邀请 ID
 */
export const revokeInvitation = (teamId: number, invitationId: number) =>
  request<void>(`${base(teamId)}/invitations/${invitationId}`, { method: 'DELETE' })
/**
 * 读取发给当前用户且尚未过期的邀请。
 *
 * @param signal 用于取消请求的信号
 */
export const listMyInvitations = (signal?: AbortSignal) =>
  request<MyInvitation[]>('/api/teams/invitations/me', { signal })
/**
 * 接受邀请并返回新加入的团队。
 *
 * @param invitationId 邀请 ID
 */
export const acceptInvitation = (invitationId: number) =>
  request<Team>(`/api/teams/invitations/${invitationId}/accept`, { method: 'POST' })
/**
 * 拒绝发给当前用户的邀请。
 *
 * @param invitationId 邀请 ID
 */
export const rejectInvitation = (invitationId: number) =>
  request<void>(`/api/teams/invitations/${invitationId}/reject`, { method: 'POST' })
/**
 * 使当前普通成员退出团队；所有者需先转移所有权。
 *
 * @param teamId 团队 ID
 */
export async function leaveTeam(teamId: number) {
  const userId = getAuthUser()?.id
  // Identify cached projects while membership is still valid. Never persist
  // team membership or credentials alongside the offline content log.
  const ids: number[] = []
  if (userId)
    await Promise.all(
      (await cachedProjectIds(userId)).map(async (id) => {
        try {
          await getTeamProject(teamId, id)
          ids.push(id)
        } catch (error) {
          if (!(error instanceof ApiError && [403, 404, 410].includes(error.status))) throw error
        }
      }),
    )
  await request<void>(`${base(teamId)}/members/me`, { method: 'DELETE' })
  if (userId) await Promise.all(ids.map((id) => purgeProjectCaches(userId, id)))
}
/**
 * 由所有者移除指定普通成员。
 *
 * @param teamId 团队 ID
 * @param userId 用户 ID
 */
export const removeMember = (teamId: number, userId: number) =>
  request<void>(`${base(teamId)}/members/${userId}`, { method: 'DELETE' })
/**
 * 由当前所有者将团队所有权转交给指定有效成员。
 *
 * @param teamId 团队 ID
 * @param userId 用户 ID
 */
export const transferOwner = (teamId: number, userId: number) =>
  request<void>(`${base(teamId)}/owner`, { method: 'PUT', body: JSON.stringify({ userId }) })
/**
 * 使用 vanilla 初始文件创建团队协作项目，返回不含旧快照版本的摘要。
 *
 * @param teamId 团队 ID
 * @param name 名称
 * @param description 可选描述
 */
export const createTeamProject = (
  teamId: number,
  name: string,
  description: string | null = null,
) =>
  request<TeamProjectSummary>(projects(teamId), {
    method: 'POST',
    body: JSON.stringify({ name, description, template: 'vanilla', entry: '/index.html' }),
  })
/**
 * 重试已预留项目的文档初始化，避免创建重复项目。
 *
 * @param teamId 团队 ID
 * @param projectId 项目 ID
 */
export const retryTeamProjectInitialization = (teamId: number, projectId: number) =>
  request<TeamProjectSummary>(`${projects(teamId)}/${projectId}/initialize`, { method: 'POST' })
/**
 * 复制指定项目当前协作文档，生成具有独立身份的项目。
 *
 * @param teamId 团队 ID
 * @param projectId 项目 ID
 * @param name 名称
 */
export const copyTeamProject = (teamId: number, projectId: number, name: string) =>
  request<TeamProjectSummary>(`${projects(teamId)}/${projectId}/copy`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
/**
 * 读取成员可见的团队项目列表，最多返回 100 项。
 *
 * @param teamId 团队 ID
 * @param signal 用于取消请求的信号
 */
export const listTeamProjects = (teamId: number, signal?: AbortSignal) =>
  request<PageResult<TeamProjectSummary>>(`${projects(teamId)}?size=100`, { signal })
/**
 * 读取团队项目元数据及当前协作文档指针，不加载旧快照文件。
 *
 * @param teamId 团队 ID
 *
 * @param projectId 项目 ID
 *
 * @param signal 用于取消请求的信号
 */
export const getTeamProject = (teamId: number, projectId: number, signal?: AbortSignal) =>
  request<TeamProjectDetails>(`${projects(teamId)}/${projectId}`, { signal })
/**
 * 以元数据 stateVersion 构造 If-Match，提交项目名称、描述及既有模板。
 *
 * @param teamId 团队 ID
 * @param project 项目实体或摘要
 * @param name 名称
 * @param description 描述，默认保留既有值，null 表示清空
 */
export const updateTeamProject = (
  teamId: number,
  project: TeamProjectSummary,
  name: string,
  description: string | null = project.description,
) =>
  request<TeamProjectSummary>(`${projects(teamId)}/${project.id}`, {
    method: 'PUT',
    headers: { 'If-Match': `"project-${project.id}-${project.stateVersion}"` },
    body: JSON.stringify({ name, description, template: project.template }),
  })
/**
 * 携带元数据 If-Match 协调软删除；提交成功后清理该项目本地缓存。
 *
 * @param teamId 团队 ID
 * @param project 项目实体或摘要
 */
export async function deleteTeamProject(teamId: number, project: TeamProjectSummary) {
  const userId = getAuthUser()?.id
  await request<void>(`${projects(teamId)}/${project.id}`, {
    method: 'DELETE',
    headers: { 'If-Match': `"project-${project.id}-${project.stateVersion}"` },
  })
  if (userId) await purgeProjectCaches(userId, project.id)
}
