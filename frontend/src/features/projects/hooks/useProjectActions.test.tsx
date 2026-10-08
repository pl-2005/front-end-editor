import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/client'
import * as teams from '../../../api/teams'
import { useTask } from '../../../hooks/useTask'
import type { TeamProjectSummary } from '../../../types/collaboration'
import { useProjectActions } from './useProjectActions'
const dialogs = vi.hoisted(() => ({ prompt: vi.fn(), confirm: vi.fn(), show: vi.fn() }))
vi.mock('../../../api/teams')
vi.mock('../../../ui/useNotice', () => ({ useNotice: () => dialogs.show }))
vi.mock('../../../ui/useDialogs', () => ({ useDialogs: () => ({ ...dialogs, holder: null }) }))
const project: TeamProjectSummary = {
  id: 17,
  name: 'Original',
  description: null,
  template: 'vanilla',
  entry: '/index.html',
  stateVersion: 1,
  createdAt: '',
  updatedAt: '',
}
afterEach(() => vi.resetAllMocks())
it('retains the reserved initialization id and reports the failure once through the page task', async () => {
  dialogs.prompt.mockResolvedValue('Copy')
  vi.mocked(teams.copyTeamProject).mockRejectedValue(
    new ApiError('failed', 503, 'COLLAB_INITIALIZATION_FAILED', undefined, 18),
  )
  const copied = vi.fn()
  const { result } = renderHook(() => {
    const task = useTask()
    const actions = useProjectActions({
      teamId: 9,
      busy: task.busy,
      execute: task.run,
      onCopied: copied,
      onDeleted: vi.fn(),
      onUpdated: vi.fn(),
      onInitialized: vi.fn(),
    })
    return { task, actions }
  })
  await act(() => result.current.actions.copy(project))
  expect(result.current.actions.initializingId).toBe(18)
  expect(dialogs.show).toHaveBeenCalledTimes(1)
  expect(result.current.task.busy).toBe(false)
  expect(copied).not.toHaveBeenCalled()
})
it('does not execute a canceled prompt or deletion confirmation', async () => {
  dialogs.prompt.mockResolvedValue(null)
  dialogs.confirm.mockResolvedValue(false)
  const execute = vi.fn()
  const { result } = renderHook(() =>
    useProjectActions({
      teamId: 9,
      busy: false,
      execute,
      onCopied: vi.fn(),
      onDeleted: vi.fn(),
      onUpdated: vi.fn(),
      onInitialized: vi.fn(),
    }),
  )
  await act(async () => {
    await result.current.copy(project)
    await result.current.remove(project)
  })
  expect(execute).not.toHaveBeenCalled()
  expect(teams.copyTeamProject).not.toHaveBeenCalled()
  expect(teams.deleteTeamProject).not.toHaveBeenCalled()
})
it('awaits the success callback inside the executor', async () => {
  dialogs.prompt.mockResolvedValue('Copy')
  vi.mocked(teams.copyTeamProject).mockResolvedValue({
    ...project,
    id: 18,
  })
  let finish!: () => void
  const reloaded = new Promise<void>((resolve) => {
    finish = resolve
  })
  const { result } = renderHook(() => {
    const task = useTask()
    const actions = useProjectActions({
      teamId: 9,
      busy: task.busy,
      execute: task.run,
      onCopied: () => reloaded,
      onDeleted: vi.fn(),
      onUpdated: vi.fn(),
      onInitialized: vi.fn(),
    })
    return { task, actions }
  })
  let copying!: Promise<void>
  act(() => {
    copying = result.current.actions.copy(project)
  })
  await waitFor(() => expect(teams.copyTeamProject).toHaveBeenCalledTimes(1))
  expect(result.current.task.busy).toBe(true)
  await act(async () => {
    finish()
    await copying
  })
  expect(result.current.task.busy).toBe(false)
})
