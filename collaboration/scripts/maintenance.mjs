import { readFileSync, mkdirSync, writeFileSync, createWriteStream, createReadStream } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { randomUUID, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { maintenanceClient } from './maintenance-client.mjs'
import { loadDocument } from '../dist/document.js'
import { hash } from '../dist/hmac.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
async function run() {
  const config = { ...parseEnv(readFileSync(root + '/.env', 'utf8')), ...process.env }
  const call = maintenanceClient(config.COLLAB_MAINTENANCE_URL ?? 'http://127.0.0.1:8080', config.COLLAB_MAINTENANCE_SECRET)
  const [command, ...args] = process.argv.slice(2)
  if (command === 'metrics') {
    console.log(JSON.stringify(await call('/internal/collaboration/metrics'), null, 2)); return
  }
  if (command === 'recover') {
    const [rawId, rawEpoch, rawGeneration, operationId] = args
    const [id, epoch, generation] = [rawId, rawEpoch, rawGeneration].map(Number)
    if (![id, epoch, generation].every(n => Number.isSafeInteger(n) && n > 0) || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(operationId ?? '')) throw new Error('MAINTENANCE_INVALID_ARGUMENTS')
    const result = await call(`/internal/collaboration/maintenance/projects/${id}/recover`, 'POST', { operationId, epoch, generation })
    console.log(JSON.stringify({ projectId: id, operationId, epoch: result.epoch, generation: result.generation })); return
  }
  if (command === 'recover-all' && args.length === 1) {
    const manifest = JSON.parse(readFileSync(resolve(args[0], 'manifest.json'), 'utf8'))
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.projects)) throw new Error('MAINTENANCE_INVALID_MANIFEST')
    const active = manifest.projects.filter(p => p.active), current = []
    let after = 0
    for (;;) {
      const page = await call(`/internal/collaboration/maintenance/projects/after/${after}`)
      if (!page.length) break
      current.push(...page); after = page.at(-1)
    }
    const expected = active.map(p => p.projectId).sort((a, b) => a - b)
    if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('MAINTENANCE_PROJECT_SET_MISMATCH')
    for (const item of active) {
      const state = await call(`/internal/collaboration/maintenance/projects/${item.projectId}/status`)
      if (state.state === 'COMMITTED' && state.operationId === item.recoveryOperationId) continue
      const pointer = await call(`/internal/collaboration/maintenance/projects/${item.projectId}/pointer`)
      if (pointer.epoch !== item.epoch || pointer.generation !== item.generation || pointer.contentHash !== item.contentHash || pointer.objectKey !== item.objectKey)
        throw new Error('MAINTENANCE_POINTER_MISMATCH')
    }
    // Restore MySQL and the matching MinIO objects first. This command never selects historical content.
    let failures = 0, restored = 0
    for (const item of active) {
      if (![item.projectId, item.epoch, item.generation].every(n => Number.isSafeInteger(n) && n > 0)
        || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(item.recoveryOperationId ?? '')) throw new Error('MAINTENANCE_INVALID_MANIFEST')
      try {
        await call(`/internal/collaboration/maintenance/projects/${item.projectId}/recover`, 'POST',
          { operationId: item.recoveryOperationId, epoch: item.epoch, generation: item.generation })
        restored++
      } catch { failures++ }
    }
    console.log(JSON.stringify({ restored, failures }))
    if (failures) throw new Error('MAINTENANCE_RECOVERY_INCOMPLETE')
    return
  }
  if (command !== 'backup' || args.length !== 2 || !/^[A-Za-z0-9_-]{1,100}$/.test(args[1])) throw new Error('MAINTENANCE_INVALID_ARGUMENTS')
  const [directory, backupId] = args, output = resolve(directory)
  const readiness = await call('/internal/collaboration/metrics')
  if (readiness.preparedOperations > 0 || readiness.recoveryBlocked > 0) throw new Error('MAINTENANCE_OPERATIONS_UNRESOLVED')
  mkdirSync(output, { recursive: false }) // Existing directories are never overwritten.
  const retainDays = Number(config.COLLAB_BACKUP_RETAIN_DAYS ?? 30)
  if (!Number.isSafeInteger(retainDays) || retainDays < 1 || retainDays > 3650) throw new Error('MAINTENANCE_INVALID_RETENTION')
  const retainUntil = new Date(Date.now() + retainDays * 86400000).toISOString()
  const manifest = { schemaVersion: 1, backupId, createdAt: new Date().toISOString(), retainUntil, projects: [] }
  let after = 0
  for (;;) {
    const page = await call(`/internal/collaboration/maintenance/documents/after/${after}`)
    if (!page.length) break
    for (const item of page) {
      const pointer = await call(`/internal/collaboration/maintenance/projects/${item.projectId}/backups/${backupId}`, 'POST', { retainUntil })
      const bytes = await call(`/internal/collaboration/maintenance/projects/${item.projectId}/backups/${backupId}/object`, 'GET', undefined, true)
      if (bytes.length !== pointer.size || hash(bytes) !== pointer.contentHash) throw new Error('MAINTENANCE_BACKUP_CORRUPT')
      const doc = loadDocument(bytes, pointer); doc.destroy()
      const filename = `${pointer.projectId}-${pointer.epoch}-${pointer.generation}.yjs`
      writeFileSync(resolve(output, filename), bytes, { flag: 'wx' })
      manifest.projects.push({ ...pointer, active: item.active, filename, recoveryOperationId: randomUUID() })
      after = item.projectId
    }
  }
  // The pointer/object set stays stable in maintenance; dump MySQL after all protection references exist.
  const db = new URL((config.DB_URL ?? '').replace(/^jdbc:/, ''))
  const database = db.pathname.slice(1)
  if (db.protocol !== 'mysql:' || !['localhost', '127.0.0.1'].includes(db.hostname) || !/^[A-Za-z0-9_]+$/.test(database)) throw new Error('MAINTENANCE_LOCAL_MYSQL_REQUIRED')
  const env = { MYSQL_PWD: config.DB_PASSWORD ?? '' }
  for (const name of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name]
  const dump = spawn(config.MYSQLDUMP_PATH ?? 'mysqldump', ['--single-transaction', '--skip-lock-tables', '--no-tablespaces',
    '--set-gtid-purged=OFF', '--column-statistics=0', '--host=' + db.hostname, '--port=' + (db.port || '3306'),
    '--user=' + config.DB_USERNAME, database], { env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  const exited = new Promise((resolveExit, reject) => {
    dump.once('error', () => reject(new Error('MAINTENANCE_MYSQL_DUMP_FAILED')))
    dump.once('exit', code => code === 0 ? resolveExit() : reject(new Error('MAINTENANCE_MYSQL_DUMP_FAILED')))
  })
  await Promise.all([pipeline(dump.stdout, createWriteStream(resolve(output, 'database.sql'), { flags: 'wx' })), exited])
  // A concurrently invoked maintenance recovery must not produce a completed mismatched backup.
  for (const item of manifest.projects) {
    const current = await call(`/internal/collaboration/maintenance/projects/${item.projectId}/pointer`)
    if (current.objectKey !== item.objectKey || current.contentHash !== item.contentHash || current.size !== item.size)
      throw new Error('MAINTENANCE_POINTER_CHANGED_DURING_BACKUP')
  }
  const completed = await call('/internal/collaboration/metrics')
  if (completed.preparedOperations > 0 || completed.recoveryBlocked > 0) throw new Error('MAINTENANCE_OPERATIONS_UNRESOLVED')
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(resolve(output, 'database.sql'))) digest.update(chunk)
  manifest.databaseHash = digest.digest('hex')
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ backupId, objects: manifest.projects.length, complete: true }))
}
run().catch(() => { console.error('MAINTENANCE_FAILED: inspect state using the signed status endpoint; keep writes closed.'); process.exitCode = 1 })
