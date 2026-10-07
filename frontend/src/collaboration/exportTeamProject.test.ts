import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportTeamProject } from './exportTeamProject'

const fixture = vi.hoisted(() => ({
  state: { connection: 'connecting', synced: false, error: '' },
  changed: () => {},
  unsubscribe: vi.fn(),
  destroy: vi.fn(),
  exportFiles: vi.fn(),
}))
vi.mock('../api/teams', () => ({
  getTeamProject: vi.fn(async () => ({ collaboration: { epoch: 2 } })),
}))
vi.mock('./session', () => ({
  CollaborationSession: class {
    snapshot = () => fixture.state
    subscribe = (changed: () => void) => {
      fixture.changed = changed
      return fixture.unsubscribe
    }
    connect = async () => {}
    exportFiles = fixture.exportFiles
    destroy = fixture.destroy
  },
}))

describe('table project export', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
    fixture.state = { connection: 'connecting', synced: false, error: '' }
  })

  it('waits for synchronization before downloading and releases its temporary session', async () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => 'blob:project')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const downloads: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download)
    })
    fixture.exportFiles.mockResolvedValue({ filename: 'Project.zip', bytes: new Uint8Array([1]) })
    const exporting = exportTeamProject(9, 17, 4)
    await Promise.resolve()
    expect(fixture.exportFiles).not.toHaveBeenCalled()
    fixture.state = { connection: 'online', synced: true, error: '' }
    fixture.changed()
    await exporting
    expect(fixture.exportFiles).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(downloads).toEqual(['Project.zip'])
    expect(fixture.destroy).toHaveBeenCalledOnce()
    expect(fixture.unsubscribe).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:project')
  })

  it('does not export when permission is revoked and still releases the session', async () => {
    const exporting = exportTeamProject(9, 17, 4)
    const rejected = expect(exporting).rejects.toThrow('无权限')
    await Promise.resolve()
    fixture.state = { connection: 'forbidden', synced: false, error: '无权限' }
    fixture.changed()
    await rejected
    expect(fixture.exportFiles).not.toHaveBeenCalled()
    expect(fixture.destroy).toHaveBeenCalledOnce()
    expect(fixture.unsubscribe).toHaveBeenCalledOnce()
  })
})
