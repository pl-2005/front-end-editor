/** Fixed counters only; never arbitrary labels, document data or credentials. */
export type Metric = 'handshake_success' | 'handshake_failure' | 'upgrade_rejected' | 'update_rejected' |
  'persist_success' | 'persist_failure' | 'persist_milliseconds' | 'cas_conflict' | 'authorization_failure' | 'control_failure'
export class Metrics {
  private counters: Record<Metric, number> = { handshake_success: 0, handshake_failure: 0, upgrade_rejected: 0,
    update_rejected: 0, persist_success: 0, persist_failure: 0, persist_milliseconds: 0, cas_conflict: 0,
    authorization_failure: 0, control_failure: 0 }
  add(name: Metric, amount = 1): void { this.counters[name] += amount }
  snapshot(): Readonly<Record<Metric, number>> { return { ...this.counters } }
}
