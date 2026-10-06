import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { ControlStore } from '../dist/control.js'

test('fence token, durable ACK and aggregate watermarks survive gateway control-store restart', () => {
  const base = resolve(tmpdir()), directory = mkdtempSync(join(base, 'step09-control-')), path = join(directory, 'control.sqlite')
  let store
  try {
    store = new ControlStore(path)
    const fence = store.prepare(1, 'operation-a', 1)
    const durable = store.durable(fence, { projectId: 1, epoch: 1, generation: 2, contentHash: 'a'.repeat(64), size: 4 }, 5)
    const event = { aggregateId: 'user:7', aggregateSequence: 4 }
    store.acknowledge(event); store.close(); store = new ControlStore(path)
    assert.deepEqual(store.fences(), [durable])
    assert.equal(store.prepare(1, 'operation-a', 1).fenceToken, durable.fenceToken)
    assert.equal(store.seen(event), true); assert.equal(store.seen({ ...event, aggregateSequence: 3 }), true)
    assert.equal(store.seen({ ...event, aggregateSequence: 5 }), false)
    store.remove(1, 'wrong-operation'); assert.equal(store.fences().length, 1)
    store.remove(1, 'operation-a'); assert.deepEqual(store.fences(), [])
  } finally {
    store?.close()
    const child = relative(base, resolve(directory)); assert.ok(child && !child.startsWith('..') && !resolve(directory).includes('..'))
    rmSync(directory, { recursive: true })
  }
})
