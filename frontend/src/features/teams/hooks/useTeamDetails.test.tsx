import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearAuth, setCredentials } from '../../../api/auth'
import * as teams from '../../../api/teams'
import type { Invitation, JoinRequest, Member, Team } from '../../../types/team'
import { useFeedback } from '../../../ui/useNotice'
import { useTeamDetails } from './useTeamDetails'

vi.mock('../../../api/teams')
vi.mock('../../../ui/useNotice', () => ({ useFeedback: vi.fn() }))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const team: Team = {
  id: 9,
  name: 'Current',
  description: null,
  joinPolicy: 'REQUEST',
  role: 'OWNER',
}
const project = {
  id: 17,
  name: 'Current project',
  description: null,
  template: 'vanilla',
  entry: '/index.html',
  stateVersion: 2,
  createdAt: '',
  updatedAt: '',
}
const owner: Member = { userId: 4, username: 'owner', displayName: 'Owner', role: 'OWNER' }
function setup() {
  setCredentials({
    user: { id: 4, username: 'owner', displayName: 'Owner', email: null, avatarColor: '#000' },
    accessToken: 'test',
    expiresIn: 600,
  })
  vi.mocked(teams.getTeam).mockResolvedValue(team)
  vi.mocked(teams.listMembers).mockResolvedValue([owner])
  vi.mocked(teams.listTeamProjects).mockResolvedValue({
    items: [project],
    totalElements: 0,
    page: 0,
    size: 100,
    totalPages: 0,
  })
  vi.mocked(teams.listJoinRequests).mockResolvedValue([])
  vi.mocked(teams.listInvitations).mockResolvedValue([])
}
afterEach(() => {
  clearAuth()
  vi.resetAllMocks()
})
describe('team reload ordering', () => {
  it('keeps the latest base snapshot when the initial request finishes after an operation reload', async () => {
    setup()
    const oldTeam = deferred<Team>()
    const oldMembers = deferred<Member[]>()
    const oldProjects = deferred<Awaited<ReturnType<typeof teams.listTeamProjects>>>()
    vi.mocked(teams.getTeam).mockReturnValueOnce(oldTeam.promise)
    vi.mocked(teams.listMembers).mockReturnValueOnce(oldMembers.promise)
    vi.mocked(teams.listTeamProjects).mockReturnValueOnce(oldProjects.promise)
    const { result } = renderHook(() => useTeamDetails(9, 4))
    await waitFor(() => expect(teams.getTeam).toHaveBeenCalledTimes(1))
    await act(() => result.current.reload())
    expect(result.current.team?.name).toBe('Current')
    const initialSignal = vi.mocked(teams.getTeam).mock.calls[0][1]
    expect(initialSignal?.aborted).toBe(true)
    await act(async () => {
      oldTeam.resolve({ ...team, name: 'Stale' })
      oldMembers.resolve([{ ...owner, username: 'stale' }])
      oldProjects.resolve({
        items: [{ ...project, name: 'Stale project', stateVersion: 1 }],
        totalElements: 0,
        page: 0,
        size: 100,
        totalPages: 0,
      })
    })
    expect(result.current.team?.name).toBe('Current')
    expect(result.current.members[0].username).toBe('owner')
    expect(result.current.projects[0]).toMatchObject({ name: 'Current project', stateVersion: 2 })
    expect(teams.listJoinRequests).toHaveBeenCalledTimes(1)
  })
  it('does not restore late owner data after ownership is lost', async () => {
    setup()
    const oldRequests = deferred<JoinRequest[]>()
    const oldInvitations = deferred<Invitation[]>()
    vi.mocked(teams.listJoinRequests).mockReturnValueOnce(oldRequests.promise)
    vi.mocked(teams.listInvitations).mockReturnValueOnce(oldInvitations.promise)
    const { result } = renderHook(() => useTeamDetails(9, 4))
    await waitFor(() => expect(teams.listInvitations).toHaveBeenCalledTimes(1))
    vi.mocked(teams.listMembers).mockResolvedValue([{ ...owner, role: 'MEMBER' }])
    await act(() => result.current.reload())
    expect(result.current.isOwner).toBe(false)
    await act(async () => {
      oldRequests.resolve([
        { id: 1, userId: 8, username: 'old', status: 'PENDING', createdAt: '2026-10-08' },
      ])
      oldInvitations.resolve([
        {
          id: 2,
          inviteeUserId: 8,
          username: 'old',
          email: null,
          status: 'PENDING',
          expiresAt: '2026-10-09',
        },
      ])
    })
    expect(result.current.requests).toEqual([])
    expect(result.current.invitations).toEqual([])
    expect(teams.listJoinRequests).toHaveBeenCalledTimes(1)
  })
  it('ignores an old failure after a newer reload succeeds', async () => {
    setup()
    const oldTeam = deferred<Team>()
    vi.mocked(teams.getTeam).mockReturnValueOnce(oldTeam.promise)
    const { result } = renderHook(() => useTeamDetails(9, 4))
    await waitFor(() => expect(teams.getTeam).toHaveBeenCalledTimes(1))
    await act(() => result.current.reload())
    await act(async () => {
      oldTeam.reject(new Error('obsolete failure'))
    })
    expect(result.current.team?.name).toBe('Current')
    expect(
      vi.mocked(useFeedback).mock.calls.some(([feedback]) => feedback.error === 'obsolete failure'),
    ).toBe(false)
  })
  it.each(['complete', 'fail'])('ignores a request that %s after unmount', async (outcome) => {
    setup()
    const oldTeam = deferred<Team>()
    vi.mocked(teams.getTeam).mockReturnValueOnce(oldTeam.promise)
    const { unmount } = renderHook(() => useTeamDetails(9, 4))
    await waitFor(() => expect(teams.getTeam).toHaveBeenCalledTimes(1))
    unmount()
    const feedbackCount = vi.mocked(useFeedback).mock.calls.length
    await act(async () => {
      if (outcome === 'fail') oldTeam.reject(new Error('unmounted failure'))
      else oldTeam.resolve(team)
    })
    expect(vi.mocked(useFeedback).mock.calls.length).toBe(feedbackCount)
    expect(teams.listJoinRequests).not.toHaveBeenCalled()
  })
  it('hides the previous identity snapshot and ignores its pending owner response', async () => {
    setup()
    const oldRequests = deferred<JoinRequest[]>()
    vi.mocked(teams.listJoinRequests).mockReturnValueOnce(oldRequests.promise)
    const { result, rerender } = renderHook(({ userId }) => useTeamDetails(9, userId), {
      initialProps: { userId: 4 },
    })
    await waitFor(() => expect(result.current.team?.id).toBe(9))
    const newTeam = deferred<Team>()
    vi.mocked(teams.getTeam).mockReturnValueOnce(newTeam.promise)
    vi.mocked(teams.listMembers).mockResolvedValue([{ ...owner, userId: 5, role: 'MEMBER' }])
    act(() => {
      setCredentials({
        user: { id: 5, username: 'new', displayName: 'New', email: null, avatarColor: '#000' },
        accessToken: 'new',
        expiresIn: 600,
      })
    })
    rerender({ userId: 5 })
    expect(result.current.team).toBeNull()
    expect(result.current.members).toEqual([])
    expect(result.current.requests).toEqual([])
    await act(async () => {
      newTeam.resolve(team)
      oldRequests.resolve([{ id: 1, userId: 8, username: 'old', status: 'PENDING', createdAt: '' }])
    })
    expect(result.current.isOwner).toBe(false)
    expect(result.current.members[0].userId).toBe(5)
    expect(result.current.requests).toEqual([])
  })
})
