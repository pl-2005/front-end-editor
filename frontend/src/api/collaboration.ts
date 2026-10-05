import { request } from './client'
export interface CollabTicket { ticket: string; expiresAt: string; projectId: number; epoch: number }
export const issueTicket = (projectId: number, signal?: AbortSignal) => request<CollabTicket>(`/api/projects/${projectId}/collab-ticket`, { method: 'POST', signal })
