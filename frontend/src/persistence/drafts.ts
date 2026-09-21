import type { ProjectFiles } from '../types/project'

const DATABASE_NAME = 'web-editor'
const STORE_NAME = 'drafts'

export interface ProjectDraft {
  projectId: number
  baseVersion: number
  entry: string
  files: ProjectFiles
  updatedAt: number
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'projectId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function runTransaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally { database.close() }
}

export const getDraft = (projectId: number) => runTransaction<ProjectDraft | undefined>('readonly', (store) => store.get(projectId))
export const putDraft = (draft: ProjectDraft) => runTransaction<IDBValidKey>('readwrite', (store) => store.put(draft))
export const deleteDraft = (projectId: number) => runTransaction<undefined>('readwrite', (store) => store.delete(projectId))
