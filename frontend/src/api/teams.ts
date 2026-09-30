import { request } from './client'
import type { Team, TeamPage, Member, JoinRequest, Invitation, MyInvitation, Invitee } from '../types/team'
import type { PageResult, ProjectDetails, ProjectSummary } from '../types/project'

const base = (teamId: number) => `/api/teams/${teamId}`
const projects = (teamId: number) => `${base(teamId)}/projects`
export const listMyTeams = (signal?: AbortSignal) => request<TeamPage>('/api/teams?size=100', { signal })
export const discoverTeams = (query: string, signal?: AbortSignal) => request<TeamPage>(`/api/teams/discover?query=${encodeURIComponent(query)}&size=20`, { signal })
export const createTeam = (name: string, description: string) => request<Team>('/api/teams', { method: 'POST', body: JSON.stringify({ name, description }) })
export const getTeam = (teamId: number, signal?: AbortSignal) => request<Team>(base(teamId), { signal })
export const listMembers = (teamId: number, signal?: AbortSignal) => request<Member[]>(`${base(teamId)}/members`, { signal })
export const setJoinPolicy = (teamId: number, joinPolicy: Team['joinPolicy']) => request<Team>(`${base(teamId)}/join-policy`, { method: 'PUT', body: JSON.stringify({ joinPolicy }) })
export const requestJoin = (teamId: number) => request<JoinRequest>(`${base(teamId)}/join-requests`, { method: 'POST' })
export const listMyJoinRequests = (signal?: AbortSignal) => request<{ id: number; teamId: number; status: string; createdAt: string }[]>('/api/teams/join-requests/me', { signal })
export const withdrawJoin = (teamId: number) => request<void>(`${base(teamId)}/join-requests/me`, { method: 'DELETE' })
export const listJoinRequests = (teamId: number, signal?: AbortSignal) => request<JoinRequest[]>(`${base(teamId)}/join-requests`, { signal })
export const decideJoin = (teamId: number, requestId: number, decision: 'approve' | 'reject') => request<void>(`${base(teamId)}/join-requests/${requestId}/${decision}`, { method: 'POST' })
export const lookupInvitee = (teamId: number, identifier: string) => request<Invitee>(`${base(teamId)}/invitees/lookup?identifier=${encodeURIComponent(identifier)}`)
export const issueInvitation = (teamId: number, userId: number) => request<Invitation>(`${base(teamId)}/invitations`, { method: 'POST', body: JSON.stringify({ userId }) })
export const listInvitations = (teamId: number, signal?: AbortSignal) => request<Invitation[]>(`${base(teamId)}/invitations`, { signal })
export const revokeInvitation = (teamId: number, invitationId: number) => request<void>(`${base(teamId)}/invitations/${invitationId}`, { method: 'DELETE' })
export const listMyInvitations = (signal?: AbortSignal) => request<MyInvitation[]>('/api/teams/invitations/me', { signal })
export const acceptInvitation = (invitationId: number) => request<Team>(`/api/teams/invitations/${invitationId}/accept`, { method: 'POST' })
export const rejectInvitation = (invitationId: number) => request<void>(`/api/teams/invitations/${invitationId}/reject`, { method: 'POST' })
export const leaveTeam = (teamId: number) => request<void>(`${base(teamId)}/members/me`, { method: 'DELETE' })
export const removeMember = (teamId: number, userId: number) => request<void>(`${base(teamId)}/members/${userId}`, { method: 'DELETE' })
export const transferOwner = (teamId: number, userId: number) => request<void>(`${base(teamId)}/owner`, { method: 'PUT', body: JSON.stringify({ userId }) })
export const listTeamProjects = (teamId: number, signal?: AbortSignal) => request<PageResult<ProjectSummary>>(`${projects(teamId)}?size=100`, { signal })
export const getTeamProject = (teamId: number, projectId: number, signal?: AbortSignal) => request<ProjectDetails>(`${projects(teamId)}/${projectId}`, { signal })
export const updateTeamProject = (teamId: number, project: ProjectSummary, name: string) => request<ProjectSummary>(`${projects(teamId)}/${project.id}`, {
  method: 'PUT', headers: { 'If-Match': `"project-${project.id}-${project.stateVersion}"` },
  body: JSON.stringify({ name, description: project.description, template: project.template }),
})
export const deleteTeamProject = (teamId: number, project: ProjectSummary) => request<void>(`${projects(teamId)}/${project.id}`, {
  method: 'DELETE', headers: { 'If-Match': `"project-${project.id}-${project.stateVersion}"` },
})
