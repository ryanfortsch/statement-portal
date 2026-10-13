/** Pure synthetic rehearsal only. No provider IO or persistent storage.
 * A durable adapter must transact each transition and persist `submitting`
 * before network IO. A memory instance cannot provide crash durability.
 */
import { createHash } from 'node:crypto';

export type InventoryDay = { date: string; available: 0 | 1; stopSell: boolean };
export type InventoryIntent = {
  id: string; environment: 'staging'; connection: string; property: string;
  generation: number; version: number; days: InventoryDay[];
};
export type InventoryStatus = 'pending' | 'leased' | 'submitting' | 'submitted'
  | 'uncertain' | 'verified' | 'needs-review' | 'superseded';
export type InventoryJob = InventoryIntent & {
  digest: string; status: InventoryStatus; attempts: number; nextAttemptAt: number;
  token?: string; leaseUntil?: number; task?: string;
};
export type DispatchContext = {
  environment: 'staging'; connection: string; property: string; generation: number;
  version: number; digest: string; authority: 'helm' | 'guesty'; enabled: boolean;
  complete: boolean; freshUntil: number;
};
const MAX_ATTEMPTS = 5;
const terminal = new Set<InventoryStatus>(['verified', 'superseded']);
const lane = (j: InventoryIntent) => JSON.stringify([j.environment, j.connection, j.property]);
const dateSet = (j: InventoryIntent) => j.days.map(d => d.date).join(',');
const copy = <T>(value: T): T => structuredClone(value);
function integer(n: number, min = 0): void {
  if (!Number.isSafeInteger(n) || n < min) throw new Error('Invalid integer');
}
function keys(value: object, allowed: string[]): void {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error('Unexpected inventory field');
}
function normalize(input: InventoryIntent): InventoryIntent {
  keys(input, ['id', 'environment', 'connection', 'property', 'generation', 'version', 'days']);
  if (input.environment !== 'staging') throw new Error('Staging only');
  for (const value of [input.id, input.connection, input.property]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Missing identity');
  }
  integer(input.generation, 1); integer(input.version, 1);
  if (!Array.isArray(input.days) || !input.days.length) throw new Error('Missing inventory');
  const days = input.days.map(day => {
    keys(day, ['date', 'available', 'stopSell']);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)
      || !Number.isFinite(Date.parse(day.date))
      || new Date(day.date).toISOString().slice(0, 10) !== day.date
      || ![0, 1].includes(day.available) || typeof day.stopSell !== 'boolean') {
      throw new Error('Invalid inventory day');
    }
    return { date: day.date, available: day.available, stopSell: day.stopSell };
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (new Set(days.map(d => d.date)).size !== days.length) throw new Error('Duplicate date');
  return { id: input.id, environment: input.environment, connection: input.connection,
    property: input.property, generation: input.generation, version: input.version, days };
}
export function inventoryDigest(days: InventoryDay[]): string {
  return createHash('sha256').update(JSON.stringify(days)).digest('hex');
}

export class MemoryInventoryOutbox {
  private jobs = new Map<string, InventoryJob>();
  private sequence = 0;

  list(): InventoryJob[] { return copy([...this.jobs.values()]); }
  enqueue(input: InventoryIntent, now: number): InventoryJob {
    integer(now);
    const intent = normalize(input);
    const digest = inventoryDigest(intent.days);
    const existing = this.jobs.get(intent.id);
    if (existing) {
      if (lane(existing) !== lane(intent) || existing.generation !== intent.generation
        || existing.version !== intent.version || existing.digest !== digest) {
        throw new Error('Command identity conflict');
      }
      return copy(existing);
    }
    const peers = [...this.jobs.values()].filter(j => lane(j) === lane(intent));
    if (peers.some(j => j.generation > intent.generation ||
      (j.generation === intent.generation && j.version >= intent.version))) {
      throw new Error('Non-increasing desired version');
    }
    // Only identical date coverage can replace an undispatched intent.
    for (const j of peers) {
      if (j.status === 'pending' && dateSet(j) === dateSet(intent)) j.status = 'superseded';
    }
    const job: InventoryJob = { ...intent, digest, status: 'pending', attempts: 0, nextAttemptAt: now };
    this.jobs.set(job.id, job);
    return copy(job);
  }
  claim(id: string, now: number, leaseMs: number): InventoryJob | null {
    integer(now); integer(leaseMs, 1); integer(now + leaseMs);
    const j = this.get(id);
    if (j.status !== 'pending' || now < j.nextAttemptAt) return null;
    if ([...this.jobs.values()].some(other => other.id !== id && lane(other) === lane(j)
      && !terminal.has(other.status) && other.status !== 'pending')) return null;
    j.status = 'leased'; j.token = `${id}:${++this.sequence}`; j.leaseUntil = now + leaseMs;
    return copy(j);
  }
  beginDispatch(id: string, token: string, context: DispatchContext, now: number): InventoryJob {
    integer(now);
    const j = this.owned(id, token, ['leased']);
    if (now >= j.leaseUntil!) throw new Error('Lease expired');
    if (context.environment !== j.environment || context.connection !== j.connection
      || context.property !== j.property || context.generation !== j.generation
      || context.version !== j.version || context.digest !== j.digest
      || context.authority !== 'helm' || !context.enabled || !context.complete
      || !Number.isSafeInteger(context.freshUntil) || now >= context.freshUntil) {
      j.status = 'needs-review';
      throw new Error('Dispatch context not safe');
    }
    j.status = 'submitting'; j.attempts++;
    return copy(j);
  }
  accepted(id: string, token: string, task: string): void {
    if (!task.trim()) throw new Error('Missing task reference');
    const j = this.owned(id, token, ['submitting']);
    j.status = 'submitted'; j.task = task;
  }
  ambiguous(id: string, token: string): void {
    this.owned(id, token, ['submitting', 'submitted']).status = 'uncertain';
  }
  /** Caller must have evidence of non-acceptance. A timeout is NOT such evidence. */
  rejected(id: string, token: string, kind: 'retryable' | 'permanent', now: number,
    retryAfterMs = 0, jitter = 0): void {
    integer(now); integer(retryAfterMs);
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw new Error('Invalid jitter');
    const j = this.owned(id, token, ['submitting']);
    if (kind !== 'retryable' || j.attempts >= MAX_ATTEMPTS) { j.status = 'needs-review'; return; }
    const delay = Math.max(retryAfterMs, Math.ceil(Math.min(60_000, 1000 * 2 ** (j.attempts - 1)) * (1 + jitter)));
    integer(now + delay);
    j.status = 'pending'; j.nextAttemptAt = now + delay; j.token = undefined; j.leaseUntil = undefined;
  }
  expire(now: number): void {
    integer(now);
    for (const j of this.jobs.values()) {
      if (j.leaseUntil === undefined || now < j.leaseUntil) continue;
      if (j.status === 'leased') { j.status = 'pending'; j.token = undefined; }
      else if (j.status === 'submitting' || j.status === 'submitted') j.status = 'uncertain';
    }
  }
  /** Evidence must cover this entire payload AFTER the attempt is terminal.
   * This verifies provider read-back only, not downstream OTA delivery.
   * Unknown/partial evidence deliberately leaves the lane blocked.
   */
  reconcile(id: string, token: string, evidence: {
    settled: boolean; complete: boolean; digest: string; generation: number;
  }): boolean {
    const j = this.owned(id, token, ['submitted', 'uncertain']);
    if (!evidence.settled || !evidence.complete || evidence.generation !== j.generation) return false;
    j.status = evidence.digest === j.digest ? 'verified' : 'needs-review';
    return j.status === 'verified';
  }
  private get(id: string): InventoryJob {
    const j = this.jobs.get(id);
    if (!j) throw new Error('Unknown command');
    return j;
  }
  private owned(id: string, token: string, statuses: InventoryStatus[]): InventoryJob {
    const j = this.get(id);
    if (j.token !== token || !statuses.includes(j.status)) throw new Error('Stale attempt or invalid transition');
    return j;
  }
}
