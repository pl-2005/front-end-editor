export interface Team { id: number; name: string; description: string | null; joinPolicy: 'REQUEST' | 'INVITE_ONLY' }
export interface Member { userId: number; username: string; displayName: string; role: 'OWNER' | 'MEMBER' }
export interface JoinRequest { id: number; userId: number; username: string; status: string; createdAt: string }
export interface Invitee { userId: number; username: string; displayName: string }
export interface Invitation { id: number; inviteeUserId: number | null; username: string | null; email: string | null; status: string; expiresAt: string }
export interface MyInvitation { id: number; teamId: number; teamName: string; expiresAt: string }
export interface TeamPage { content: Team[]; number: number; size: number; totalElements: number; totalPages: number }
