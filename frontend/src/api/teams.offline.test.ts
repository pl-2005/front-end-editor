import { afterEach, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { ApiError } from './client'
import { leaveTeam, deleteTeamProject } from './teams'
import { cacheName, OfflineLog, purgeUserCaches } from '../collaboration/offline'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./auth', () => ({ getAuthUser: () => ({ id: 111 }) }))
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  request: mocks.request,
}))
afterEach(async () => {
  await purgeUserCaches(111)
  mocks.request.mockReset()
})
async function cache(projectId: number) {
  const identity = { projectId, epoch: 1 },
    log = new OfflineLog(cacheName(111, identity), identity, () => {}),
    doc = new Y.Doc()
  await log.load(doc)
  await log.close()
  doc.destroy()
}

it('deletes using metadata If-Match and clears only the committed project cache', async () => {
  await cache(71)
  await cache(72)
  mocks.request.mockResolvedValue(undefined)
  await deleteTeamProject(9, { id: 71, stateVersion: 4 } as Parameters<typeof deleteTeamProject>[1])
  expect(mocks.request).toHaveBeenCalledWith('/api/teams/9/projects/71', {
    method: 'DELETE',
    headers: { 'If-Match': '"project-71-4"' },
  })
  const names = (await indexedDB.databases()).map((db) => db.name)
  expect(names).not.toContain(cacheName(111, { projectId: 71, epoch: 1 }))
  expect(names).toContain(cacheName(111, { projectId: 72, epoch: 1 }))
})

it('keeps offline content when coordinated deletion fails', async () => {
  await cache(71)
  mocks.request.mockRejectedValue(new ApiError('flush failed', 503))
  await expect(
    deleteTeamProject(9, { id: 71, stateVersion: 4 } as Parameters<typeof deleteTeamProject>[1]),
  ).rejects.toThrow('flush failed')
  expect((await indexedDB.databases()).map((db) => db.name)).toContain(
    cacheName(111, { projectId: 71, epoch: 1 }),
  )
})
it('clears closed workspaces in the exited team while preserving other-team caches', async () => {
  await cache(71)
  await cache(72)
  mocks.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/projects/71')) return { id: 71 }
    if (path.endsWith('/projects/72')) throw new ApiError('other team', 404)
  })
  await leaveTeam(9)
  const names = (await indexedDB.databases()).map((db) => db.name)
  expect(names).not.toContain(cacheName(111, { projectId: 71, epoch: 1 }))
  expect(names).toContain(cacheName(111, { projectId: 72, epoch: 1 }))
  expect(mocks.request).toHaveBeenCalledWith('/api/teams/9/members/me', { method: 'DELETE' })
})
it('retains the local log when leaving the team fails', async () => {
  await cache(71)
  mocks.request.mockImplementation(async (path: string) => {
    if (path.endsWith('/projects/71')) return { id: 71 }
    throw new ApiError('unavailable', 503)
  })
  await expect(leaveTeam(9)).rejects.toThrow('unavailable')
  expect((await indexedDB.databases()).map((db) => db.name)).toContain(
    cacheName(111, { projectId: 71, epoch: 1 }),
  )
})
