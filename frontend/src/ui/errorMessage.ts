import { ApiError } from '../api/client'

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.responseMessage) return error.responseMessage
    if (error.code === 'USER_NOT_FOUND')
      return '未找到该用户，请先确认用户名或邮箱，并请对方注册账号。'
    if (error.code === 'COLLAB_CREATION_DISABLED') return '项目创建暂未开放。'
    if (
      error.code === 'COLLAB_INITIALIZATION_FAILED' ||
      error.code === 'COLLAB_INITIALIZER_UNAVAILABLE' ||
      error.code === 'STORAGE_UNAVAILABLE'
    )
      return '项目文件初始化未完成，请稍后重试。'
    if (error.status === 409) return '内容已变化，请重新加载后再试。'
    if (error.status === 429) return `操作过于频繁，请在 ${error.retryAfter ?? '稍后'} 秒后重试。`
    if (error.status === 403) return '没有执行此操作的权限。'
    if (error.status === 410) return '邀请已失效，请联系团队所有者重新邀请。'
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试。'
}
