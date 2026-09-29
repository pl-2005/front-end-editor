export interface User { id: number; username: string; email: string | null; displayName: string; avatarColor: string }
export interface Credentials { user: User; accessToken: string; refreshToken: string; expiresIn: number }
