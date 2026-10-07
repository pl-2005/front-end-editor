import { getTeamProject } from '../api/teams'
import { CollaborationSession } from './session'

/** Export the synchronized document, including local recoveries, then release the temporary session. */
export async function exportTeamProject(teamId: number, projectId: number, userId: number) {
  const project = await getTeamProject(teamId, projectId)
  const session = new CollaborationSession(
    { projectId, epoch: project.collaboration.epoch },
    userId,
    teamId,
  )
  let unsubscribe = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        const state = session.snapshot()
        if (state.connection === 'online' && state.synced) resolve()
        else if (['forbidden', 'failed', 'offline'].includes(state.connection))
          reject(new Error(state.error || '请恢复网络并验证项目权限后导出'))
      }
      unsubscribe = session.subscribe(check)
      timer = setTimeout(() => reject(new Error('项目同步超时，请稍后重试导出')), 30_000)
      void session.connect().catch(reject)
      check()
    })
    const archive = await session.exportFiles()
    const url = URL.createObjectURL(new Blob([archive.bytes], { type: 'application/zip' }))
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = archive.filename
      link.click()
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  } finally {
    clearTimeout(timer)
    unsubscribe()
    session.destroy()
  }
}
