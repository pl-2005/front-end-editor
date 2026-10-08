import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { clearAuth, setCredentials } from '../../../api/auth'
import type { TeamProjectDetails } from '../../../types/collaboration'
import { AppTheme } from '../../../ui/AppTheme'
import { ProjectPage } from './ProjectPage'
const observed = vi.hoisted(() => ({
  project: null as TeamProjectDetails | null,
  mounts: [] as number[],
  unmounts: [] as number[],
  next: 0,
  props: [] as {
    project: TeamProjectDetails
    userId: number
    teamId: number
    exportTarget: HTMLSpanElement | null
  }[],
}))
vi.mock('../hooks/useProjectDetails', () => ({
  useProjectDetails: () => ({ project: observed.project, clear: vi.fn(), update: vi.fn() }),
}))
vi.mock('../../../editor/v2/ProjectWorkspace', () => ({
  default: function Workspace(props: (typeof observed.props)[number]) {
    const [id] = useState(() => ++observed.next)
    observed.props.push(props)
    useEffect(() => {
      observed.mounts.push(id)
      return () => {
        observed.unmounts.push(id)
      }
    }, [id])
    return (
      <section aria-label="工作区" data-instance={id}>
        {props.exportTarget
          ? createPortal(
              <button aria-label="导出当前实例" data-instance={id}>
                导出
              </button>,
              props.exportTarget,
            )
          : null}
      </section>
    )
  },
}))
const user = { id: 4, username: 'member', email: null, displayName: 'Member', avatarColor: '#000' }
const project: TeamProjectDetails = {
  id: 17,
  name: 'Original',
  description: null,
  template: 'vanilla',
  entry: '/index.html',
  stateVersion: 1,
  createdAt: '',
  updatedAt: '',
  collaboration: {
    collaborationMode: 'YJS',
    epoch: 1,
    generation: 1,
    contentHash: 'hash',
    size: 500,
    contentType: 'application/octet-stream',
  },
}
afterEach(() => {
  act(() => clearAuth())
  observed.mounts.length = 0
  observed.unmounts.length = 0
  observed.props.length = 0
})
it('preserves the workspace and portal for metadata changes, replaces them for epoch, project and identity changes', async () => {
  setCredentials({ user, accessToken: 'test', expiresIn: 600 })
  observed.project = project
  const ui = (
    <StrictMode>
      <AppTheme>
        <MemoryRouter initialEntries={['/teams/9/projects/17']}>
          <Routes>
            <Route path="/teams/:teamId/projects/:projectId" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </AppTheme>
    </StrictMode>
  )
  const view = render(ui)
  await screen.findByRole('button', { name: '导出当前实例' })
  const original = screen.getByRole('button', { name: '导出当前实例' })
  const initialMounts = [...observed.mounts],
    initialUnmounts = [...observed.unmounts]
  observed.project = { ...project, name: 'Renamed', stateVersion: 2 }
  view.rerender(
    <StrictMode>
      <AppTheme>
        <MemoryRouter initialEntries={['/teams/9/projects/17']}>
          <Routes>
            <Route path="/teams/:teamId/projects/:projectId" element={<ProjectPage />} />
          </Routes>
        </MemoryRouter>
      </AppTheme>
    </StrictMode>,
  )
  expect(observed.mounts).toEqual(initialMounts)
  expect(observed.unmounts).toEqual(initialUnmounts)
  expect(screen.getByRole('button', { name: '导出当前实例' })).toBe(original)
  expect(observed.props.at(-1)).toMatchObject({
    userId: 4,
    teamId: 9,
    project: { name: 'Renamed', stateVersion: 2, collaboration: project.collaboration },
  })
  expect(observed.props.at(-1)?.exportTarget?.isConnected).toBe(true)
  async function expectReplacement(change: () => void) {
    const before = screen.getByRole('button', { name: '导出当前实例' })
    const oldId = Number(before.dataset.instance)
    act(change)
    view.rerender(
      <StrictMode>
        <AppTheme>
          <MemoryRouter initialEntries={['/teams/9/projects/17']}>
            <Routes>
              <Route path="/teams/:teamId/projects/:projectId" element={<ProjectPage />} />
            </Routes>
          </MemoryRouter>
        </AppTheme>
      </StrictMode>,
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '导出当前实例' }).dataset.instance).not.toBe(
        String(oldId),
      ),
    )
    expect(observed.unmounts).toContain(oldId)
    expect(before.isConnected).toBe(false)
    expect(screen.getAllByRole('button', { name: '导出当前实例' })).toHaveLength(1)
  }
  await expectReplacement(() => {
    observed.project = {
      ...observed.project!,
      collaboration: { ...project.collaboration, epoch: 2 },
    }
  })
  await expectReplacement(() => {
    observed.project = { ...observed.project!, id: 18 }
  })
  await expectReplacement(() => {
    setCredentials({
      user: { ...user, id: 5 },
      accessToken: 'new',
      expiresIn: 600,
    })
  })
  expect(observed.props.at(-1)?.userId).toBe(5)
})
