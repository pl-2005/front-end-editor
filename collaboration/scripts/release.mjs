import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync, cpSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../../', import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const compatibility = {
  authentication: 'mandatory-bearer', anonymousProjects: false, legacySnapshotWrites: false, historyApi: false,
  flyway: 13, yDocSchema: 1, internalHmac: 'six-lines-audience-nonce-v1',
  refresh: 'redis-digest-rotating-family-v1', websocketPath: '/collaboration', gatewayInstances: 1,
  featureFlags: ['COLLAB_CREATION_ENABLED', 'COLLAB_TICKET_ENABLED', 'COLLAB_GATEWAY_ENABLED'],
}
function files(directory) {
  return readdirSync(directory).sort().flatMap(name => {
    const path = resolve(directory, name), info = lstatSync(path)
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('RELEASE_LINK_INVALID')
    return info.isDirectory() ? files(path) : [path]
  })
}
export function verifyRelease(directory) {
  const output = resolve(directory), manifest = JSON.parse(readFileSync(resolve(output, 'release.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || JSON.stringify(manifest.compatibility) !== JSON.stringify(compatibility)) throw new Error('RELEASE_INCOMPATIBLE')
  const actual = files(output).filter(path => path !== resolve(output, 'release.json'))
  if (actual.length !== Object.keys(manifest.files).length) throw new Error('RELEASE_FILE_SET_CHANGED')
  for (const path of actual) {
    const name = relative(output, path).split(sep).join('/')
    if (/(^|\/)\.env(?:\.|$)|\.sql$|\.yjs$|nonces|\.sqlite$/.test(name) || manifest.files[name] !== sha(readFileSync(path))) throw new Error('RELEASE_FILE_INVALID')
  }
  for (const required of ['backend/backend.jar', 'frontend/dist/index.html', 'collaboration/dist/gateway-main.js', 'collaboration/dist/server.js', 'deploy/nginx-v2.conf']) {
    if (!manifest.files[required]) throw new Error('RELEASE_COMPONENT_MISSING')
  }
  return manifest
}
function pack(directory, jar, frontend) {
  const output = resolve(directory)
  // No overwrite, environment files, credentials, database dumps or node_modules.
  mkdirSync(output)
  const copy = (source, target) => {
    const destination = resolve(output, target)
    mkdirSync(resolve(destination, '..'), { recursive: true })
    cpSync(resolve(root, source), destination, { recursive: true, errorOnExist: true, force: false })
  }
  copy(jar, 'backend/backend.jar')
  copy(frontend, 'frontend/dist')
  copy('collaboration/dist', 'collaboration/dist')
  for (const name of ['package.json', 'package-lock.json']) copy('collaboration/' + name, 'collaboration/' + name)
  for (const name of ['start.mjs', 'start-gateway.mjs', 'maintenance.mjs', 'maintenance-client.mjs', 'release.mjs']) copy('collaboration/scripts/' + name, 'collaboration/scripts/' + name)
  copy('deploy/nginx-v2.conf', 'deploy/nginx-v2.conf')
  copy('docs/V__2/step11-release.md', 'docs/V__2/step11-release.md')
  copy('docs/V__2/step10-operations.md', 'docs/V__2/step10-operations.md')
  const migrations = files(resolve(root, 'backend/src/main/resources/db/migration')).map(path => ({ name: relative(resolve(root, 'backend/src/main/resources/db/migration'), path), sha256: sha(readFileSync(path)) }))
  const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), compatibility, migrations,
    dependencies: JSON.parse(readFileSync(resolve(root, 'collaboration/package-lock.json'), 'utf8')).packages[''].dependencies,
    files: Object.fromEntries(files(output).map(path => [relative(output, path).split(sep).join('/'), sha(readFileSync(path))])) }
  writeFileSync(resolve(output, 'release.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  return verifyRelease(output)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, directory, jar = '.codex-build/step11-backend/backend-0.1.0-SNAPSHOT.jar', frontend = 'frontend/dist'] = process.argv.slice(2)
    if (!directory || !['pack', 'verify'].includes(command)) throw new Error('RELEASE_INVALID_ARGUMENTS')
    const manifest = command === 'pack' ? pack(directory, jar, frontend) : verifyRelease(directory)
    console.log(JSON.stringify({ release: command === 'pack' ? 'packed' : 'verified', files: Object.keys(manifest.files).length, flyway: manifest.compatibility.flyway }))
  } catch { console.error('RELEASE_FAILED'); process.exitCode = 1 }
}
