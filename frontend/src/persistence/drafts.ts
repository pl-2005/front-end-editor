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

/**
 * 打开本地 IndexedDB，首次升级时创建以项目 ID 为键的草稿对象仓库。
 * @returns 已打开的数据库连接，调用方负责关闭
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME, { keyPath: 'projectId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * 打开指定模式的草稿事务，等待对象请求成功或失败，并始终关闭数据库连接。
 *
 * @param mode IndexedDB 事务读写模式
 * @param action 接收对象仓库并创建 IndexedDB 请求的回调
 * @returns 对象请求的结果；请求失败时 Promise 拒绝
 */
async function runTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

/**
 * 按项目 ID 读取本地草稿，不存在时返回 undefined。
 *
 * @param projectId 项目 ID
 * @returns 项目草稿，不存在时为 undefined
 */
export const getDraft = (projectId: number) =>
  runTransaction<ProjectDraft | undefined>('readonly', (store) => store.get(projectId))
/**
 * 以项目 ID 写入或替换本地草稿，保留基准版本供恢复判断。
 *
 * @param draft 含基准版本的本地草稿
 * @returns 已写入草稿的 IndexedDB 主键
 */
export const putDraft = (draft: ProjectDraft) =>
  runTransaction<IDBValidKey>('readwrite', (store) => store.put(draft))
/**
 * 删除指定项目的本地草稿。
 *
 * @param projectId 项目 ID
 */
export const deleteDraft = (projectId: number) =>
  runTransaction<undefined>('readwrite', (store) => store.delete(projectId))
