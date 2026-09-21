import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, saveSnapshot } from '../api/projects'
import { deleteDraft, putDraft } from '../persistence/drafts'
import type { ProjectFiles } from '../types/project'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'failed' | 'conflict'

interface Options {
  projectId: number
  initialVersion: number
  entry: string
  files: ProjectFiles
  onVersionChange: (projectId: number, version: number) => void
  initiallyDirty?: boolean
}

const fingerprint = (entry: string, files: ProjectFiles) => JSON.stringify({ entry, files })

export function useProjectSave({ projectId, initialVersion, entry, files, onVersionChange, initiallyDirty = false }: Options) {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [message, setMessage] = useState('所有更改均已保存')
  const versionRef = useRef(initialVersion)
  const lastSavedRef = useRef(initiallyDirty ? '' : fingerprint(entry, files))
  const latestRef = useRef({ entry, files })
  const savingRef = useRef(false)
  const pendingSaveRef = useRef(false)
  const conflictRef = useRef(false)

  useEffect(() => {
    latestRef.current = { entry, files }
    if (fingerprint(entry, files) === lastSavedRef.current) return
    if (!conflictRef.current) {
      setStatus('dirty')
      setMessage('有未保存的更改')
    }
    void putDraft({ projectId, baseVersion: versionRef.current, entry, files, updatedAt: Date.now() })
  }, [entry, files, projectId])

  const save = useCallback(async () => {
    if (savingRef.current) {
      pendingSaveRef.current = true
      return
    }
    savingRef.current = true
    try {
      do {
        pendingSaveRef.current = false
        const latest = latestRef.current
        const nextFingerprint = fingerprint(latest.entry, latest.files)
        if (nextFingerprint === lastSavedRef.current || conflictRef.current) break

        setStatus('saving')
        setMessage('正在保存…')
        try {
          const result = await saveSnapshot(projectId, versionRef.current, latest.entry, latest.files)
          versionRef.current = result.version
          lastSavedRef.current = nextFingerprint
          onVersionChange(projectId, result.version)
          if (fingerprint(latestRef.current.entry, latestRef.current.files) === nextFingerprint) {
            await deleteDraft(projectId)
            setStatus('saved')
            setMessage(`已保存 · 版本 ${result.version}`)
          } else {
            const next = latestRef.current
            await putDraft({ projectId, baseVersion: result.version, entry: next.entry, files: next.files, updatedAt: Date.now() })
            pendingSaveRef.current = true
            setStatus('dirty')
            setMessage('有未保存的更改')
          }
        } catch (error) {
          await putDraft({ projectId, baseVersion: versionRef.current, entry: latest.entry, files: latest.files, updatedAt: Date.now() }).catch(() => undefined)
          if (error instanceof ApiError && error.status === 409) {
            conflictRef.current = true
            setStatus('conflict')
            setMessage('检测到版本冲突，请重新加载项目或另存副本')
          } else {
            setStatus('failed')
            setMessage(error instanceof Error ? error.message : '保存失败，草稿已保留')
          }
          break
        }
      } while (pendingSaveRef.current)
    } finally { savingRef.current = false }
  }, [onVersionChange, projectId])

  useEffect(() => {
    if (status !== 'dirty') return
    const timer = window.setTimeout(() => void save(), 1500)
    return () => window.clearTimeout(timer)
  }, [files, save, status])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
    }
    const handleOnline = () => void save()
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('online', handleOnline)
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('online', handleOnline) }
  }, [save])

  return { status, message, save }
}
