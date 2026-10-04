import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import { loadDocument, encodeDocument } from '../dist/document.js'
import { signature, hash } from '../dist/hmac.js'
const config = { ...parseEnv(readFileSync(new URL('../../.env', import.meta.url), 'utf8')), ...process.env }
const base = config.STEP05_API_URL ?? 'http://127.0.0.1:18085'
const secret = config.COLLAB_STORAGE_SECRET ?? ''
const statePath = new URL('../../.codex-build/step05-acceptance-state.json', import.meta.url)
/**
 * 为本地内部协作请求生成 HMAC 认证头，返回原始 HTTP 响应以断言状态。
 *
 * @param path 目标路径
 * @param method HTTP 请求方法
 * @param body 请求体
 */
async function internal(path, method = 'GET', body = new Uint8Array()) {
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomUUID()
  const headers = { 'X-Collab-Timestamp': timestamp, 'X-Collab-Nonce': nonce,
    'X-Collab-Signature': signature(secret, method, path, 'storage', timestamp, nonce, body) }
  if (method !== 'GET') headers['Content-Type'] = 'application/octet-stream'
  return fetch(base + path, { method, headers, ...(method === 'GET' ? {} : { body }) })
}
/**
 * 读取项目当前文档指针并断言内部接口返回 200。
 *
 * @param id 项目 ID
 */
async function pointer(id) {
  const response = await internal(`/internal/collaboration/projects/${id}/describe`)
  assert.equal(response.status, 200)
  return response.json()
}
/**
 * 加载指针对应的二进制并校验响应、内容摘要及长度。
 *
 * @param p 协作文档指针
 */
async function load(p) {
  const response = await internal(`/internal/collaboration/projects/${p.projectId}/epochs/${p.epoch}/generations/${p.generation}/load`)
  assert.equal(response.status, 200)
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.equal(hash(bytes), p.contentHash); assert.equal(bytes.length, p.size)
  return bytes
}
/**
 * 向指定 epoch 和 generation 的内部保存接口提交文档及幂等键。
 *
 * @param id 项目 ID
 * @param epoch 文档生命周期编号
 * @param generation 调用方预期的当前持久化代次
 * @param key 本次保存的幂等键
 * @param bytes 文档二进制内容
 */
async function persist(id, epoch, generation, key, bytes) {
  return internal(`/internal/collaboration/projects/${id}/epochs/${epoch}/generations/${generation}/persist/${key}`, 'POST', bytes)
}
if (process.argv.includes('--recover')) {
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  for (const expected of state.projects) {
    const current = await pointer(expected.projectId)
    assert.deepEqual(current, expected)
    const doc = loadDocument(await load(current), { projectId: current.projectId, epoch: current.epoch }); doc.destroy()
  }
  console.log('PASS: backend restart recovered both current Y.Doc pointers and verified binary hashes')
} else {
  let token
  /**
   * 使用当前测试令牌调用业务 API，断言预期状态后返回业务 data。
   *
   * @param path 目标路径
   * @param method HTTP 请求方法
   * @param input 请求输入
   * @param expectedStatus 预期 HTTP 状态码
   */
  async function api(path, method = 'GET', input, expectedStatus = 200) {
    const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) })
    assert.equal(response.status, expectedStatus, `Unexpected status for ${method} ${path}`)
    if (response.status === 204) return
    return (await response.json()).data
  }
  const username = 'step05_' + randomBytes(6).toString('hex'), password = randomBytes(20).toString('hex')
  await api('/api/auth/register', 'POST', { username, password }, 201)
  const credentials = await api('/api/auth/login', 'POST', { login: username, password })
  token = credentials.accessToken
  const team = await api('/api/teams', 'POST', { name: 'Step05 acceptance', description: 'Local Y.Doc storage verification' }, 201)
  const project = await api(`/api/teams/${team.id}/projects`, 'POST', { name: 'Step05 current document', template: 'vanilla', entry: '/index.html' }, 201)
  assert.equal(project.version, undefined)
  let p = await pointer(project.id)
  assert.equal(p.epoch, 1); assert.equal(p.generation, 1)
  const bytes = await load(p)
  const doc = loadDocument(bytes, { projectId: project.id, epoch: 1 })
  assert.equal(doc.getMap('files').size, 3)
  const entry = doc.getMap('files').get(doc.getMap('meta').get('entryFileId'))
  entry.get('content').insert(0, '<!-- persisted acceptance edit -->\n')
  const update = encodeDocument(doc, { projectId: project.id, epoch: 1 }); doc.destroy()
  const first = await persist(project.id, 1, 1, 'first', update); assert.equal(first.status, 200)
  const saved = await first.json()
  assert.equal(saved.generation, 2)
  const replay = await persist(project.id, 1, 1, 'first', update); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), saved)
  const outcomes = await Promise.all([persist(project.id, 1, 2, 'race-a', update), persist(project.id, 1, 2, 'race-b', bytes)])
  assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409])
  const conflict = outcomes.find(r => r.status === 409)
  assert.equal((await conflict.json()).code, 'COLLAB_GENERATION_CONFLICT')
  p = await pointer(project.id); assert.equal(p.generation, 3)
  const oldEpoch = await persist(project.id, 2, 3, 'wrong-epoch', update)
  assert.equal(oldEpoch.status, 409); assert.equal((await oldEpoch.json()).code, 'COLLAB_EPOCH_CONFLICT')
  const copy = await api(`/api/teams/${team.id}/projects/${project.id}/copy`, 'POST', { name: 'Step05 copied document' }, 201)
  const cp = await pointer(copy.id); assert.equal(cp.generation, 1)
  const copiedDoc = loadDocument(await load(cp), { projectId: copy.id, epoch: 1 })
  const sourceDoc = loadDocument(await load(p), { projectId: project.id, epoch: 1 })
  /**
   * 提取文档文件路径及文本并排序，供复制内容一致性断言使用。
   *
   * @param d 待比较内容的 Yjs 文档
   */
  const content = d => [...d.getMap('files').values()].map(f => [f.get('path'), f.get('content').toString()]).sort()
  assert.deepEqual(content(copiedDoc), content(sourceDoc)); copiedDoc.destroy(); sourceDoc.destroy()
  const deleteResponse = await fetch(base + `/api/teams/${team.id}/projects/${project.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  assert.equal(deleteResponse.status, 409)
  const legacy = await fetch(base + `/api/projects/${project.id}/revisions`, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(legacy.status, 403)
  const unauthenticated = await fetch(base + `/internal/collaboration/projects/${project.id}/describe`); assert.equal(unauthenticated.status, 401)
  const details = await api(`/api/teams/${team.id}/projects/${project.id}`)
  assert.equal(details.version, undefined); assert.equal(details.files, undefined); assert.equal(details.collaboration.generation, 3)
  writeFileSync(statePath, JSON.stringify({ projects: [p, cp] }, null, 2) + '\n')
  await api('/api/auth/logout', 'POST', undefined, 204)
  console.log('PASS: local MySQL/MinIO initialization, binary reload, CAS race, idempotency, epoch rejection, current-state copy and V1 isolation')
  console.log(`Retained acceptance project IDs: ${project.id}, ${copy.id}; team ID: ${team.id}. No credentials recorded.`)
}
