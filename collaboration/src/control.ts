import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import type { Pointer } from './internal.js'

export type Fence = { projectId: number; operationId: string; epoch: number; generation?: number;
  contentHash?: string; durableSequence?: number; fenceToken: string }
export type ControlEvent = { id: string; aggregateId: string; aggregateSequence: number; eventType: string;
  projectId: number | null; userId: number | null; teamId: number | null; epoch: number | null;
  authzVersion: number | null; operationId: string | null }

/** Only control metadata, tokens and watermarks; never source code or user credentials. */
export class ControlStore {
  private db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`CREATE TABLE IF NOT EXISTS collab_gateway_fence(project_id INTEGER PRIMARY KEY, operation_id TEXT, payload TEXT);
      CREATE TABLE IF NOT EXISTS collab_gateway_watermark(aggregate_id TEXT PRIMARY KEY, sequence INTEGER)`)
  }
  fences(): Fence[] {
    return this.db.prepare('SELECT payload FROM collab_gateway_fence').all().map(row => JSON.parse(String(row.payload)))
  }
  prepare(projectId: number, operationId: string, epoch: number): Fence {
    const existing = this.fences().find(f => f.projectId === projectId)
    if (existing?.operationId === operationId) return existing
    const fence = { projectId, operationId, epoch, fenceToken: randomBytes(32).toString('hex') }
    this.save(fence); return fence
  }
  durable(fence: Fence, pointer: Pointer, durableSequence: number): Fence {
    const saved = { ...fence, generation: pointer.generation, contentHash: pointer.contentHash, durableSequence }
    this.save(saved); return saved
  }
  private save(fence: Fence): void {
    this.db.prepare('INSERT OR REPLACE INTO collab_gateway_fence VALUES (?, ?, ?)')
      .run(fence.projectId, fence.operationId, JSON.stringify(fence))
  }
  remove(projectId: number, operationId: string): void {
    this.db.prepare('DELETE FROM collab_gateway_fence WHERE project_id=? AND operation_id=?').run(projectId, operationId)
  }
  seen(e: ControlEvent): boolean {
    const row = this.db.prepare('SELECT sequence FROM collab_gateway_watermark WHERE aggregate_id=?').get(e.aggregateId)
    return !!row && Number(row.sequence) >= e.aggregateSequence
  }
  acknowledge(e: ControlEvent): void {
    this.db.prepare(`INSERT INTO collab_gateway_watermark VALUES (?, ?)
      ON CONFLICT(aggregate_id) DO UPDATE SET sequence=MAX(sequence, excluded.sequence)`).run(e.aggregateId, e.aggregateSequence)
  }
  close(): void { this.db.close() }
}
