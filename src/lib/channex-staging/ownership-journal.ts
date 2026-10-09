/** Local rehearsal storage. Not suitable for serverless/shared production writers. */
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseLedger, emptyLedger, type Ledger, type Hold } from './core.ts';
import { planOwnership, type OwnershipPlan } from './ownership.ts';
import { withJournalLock } from './journal.ts';
export type OwnershipEvent =
  | { id: string; kind: 'snapshot'; ledger: Ledger; holds: Hold[]; complete: boolean }
  | { id: string; kind: 'receipt'; snapshotId: string; claimId: string; providerBlockId: string; evidence: 'synthetic' };
export type OwnershipJournal = { version: 1; mode: 'local-rehearsal'; events: OwnershipEvent[] };
export const emptyOwnershipJournal = (): OwnershipJournal => ({ version: 1, mode: 'local-rehearsal', events: [] });
const identifier = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(s);
/** Replay is the authority; cached plans and receipt flags are never trusted from disk. */
export function replayOwnership(value: unknown): { journal: OwnershipJournal; plan: OwnershipPlan; receipts: { event: Extract<OwnershipEvent, {kind: 'receipt'}>; verified: false }[] } {
  const raw = value as OwnershipJournal;
  if (!raw || raw.version !== 1 || raw.mode !== 'local-rehearsal' || !Array.isArray(raw.events)) throw new Error('Invalid ownership journal');
  const journal = emptyOwnershipJournal();
  let latest = emptyLedger(), anchor = emptyLedger();
  let retainedHolds: Hold[] = [];
  let plan = planOwnership(anchor, latest, [], false);
  const snapshots = new Map<string, OwnershipPlan>();
  const receipts: { event: Extract<OwnershipEvent, {kind: 'receipt'}>; verified: false }[] = [];
  const seen = new Map<string, string>();
  for (const event of raw.events) {
    if (!event || !identifier(event.id)) throw new Error('Invalid ownership event');
    let normalized: OwnershipEvent;
    if (event.kind === 'snapshot') {
      if (typeof event.complete !== 'boolean' || !Array.isArray(event.holds)) throw new Error('Invalid ownership snapshot');
      const ledger = parseLedger(event.ledger);
      planOwnership(emptyLedger(), ledger, event.holds, event.complete);
      normalized = { id: event.id, kind: 'snapshot', ledger, holds: event.holds.map((h) => ({ id: h.id, member: h.member, checkIn: h.checkIn, checkOut: h.checkOut })), complete: event.complete };
    } else if (event.kind === 'receipt') {
      if (!identifier(event.snapshotId) || !identifier(event.providerBlockId) || typeof event.claimId !== 'string' || event.evidence !== 'synthetic') throw new Error('Unsupported receipt evidence');
      normalized = { id: event.id, kind: 'receipt', snapshotId: event.snapshotId, claimId: event.claimId, providerBlockId: event.providerBlockId, evidence: 'synthetic' };
    } else throw new Error('Unknown ownership event');
    const encoded = JSON.stringify(normalized);
    if (seen.has(event.id)) {
      if (seen.get(event.id) !== encoded) throw new Error('Ownership event ID reused');
      continue;
    }
    seen.set(event.id, encoded);
    if (normalized.kind === 'snapshot') {
      planOwnership(latest, normalized.ledger, normalized.holds, normalized.complete);
      // During outages keep a union of independent holds, including changed date ranges.
      const holds = normalized.complete ? normalized.holds : [...retainedHolds, ...normalized.holds];
      const unique = [...new Map(holds.map((h) => [JSON.stringify(h), h])).values()];
      // Different ranges for the same hold are deliberately distinct until reconciliation.
      const effectiveHolds = unique.map((h, i) => ({ ...h, id: `retained-${i}` }));
      const nextPlan = planOwnership(anchor, normalized.ledger, effectiveHolds, normalized.complete);
      for (const night of nextPlan.nights) night.independentHolds = night.independentHolds.map((key) => {
        const index = Number(key.split('retained-')[1]);
        return `${unique[index].member}:${unique[index].id}`;
      });
      if (!normalized.complete) {
        const union = new Map(plan.claims.map((c) => [c.id, c]));
        for (const c of nextPlan.claims) union.set(c.id, c);
        nextPlan.claims = [...union.values()];
        for (const night of nextPlan.nights) night.claims = nextPlan.claims.filter((c) => c.target === night.target && c.date === night.date).map((c) => c.id);
      }
      if (normalized.complete) {
        const prior = new Map([...plan.claims, ...nextPlan.releasedClaims].map((c) => [c.id, c]));
        const activeIds = new Set(nextPlan.claims.map((c) => c.id));
        nextPlan.releasedClaims = [...prior.values()].filter((c) => !activeIds.has(c.id));
      }
      plan = nextPlan;
      retainedHolds = unique;
      latest = normalized.ledger;
      if (normalized.complete) anchor = latest;
      snapshots.set(normalized.id, plan);
    } else {
      if (!snapshots.get(normalized.snapshotId)?.claims.some((c) => c.id === normalized.claimId)) throw new Error('Receipt references an unknown claim');
      // A synthetic receipt is test evidence only; never upgrades provider ownership.
      receipts.push({ event: normalized, verified: false });
    }
    journal.events.push(normalized);
  }
  return { journal, plan, receipts };
}
export async function readOwnershipJournal(path: string) {
  // Missing/corrupt storage must be explicit; never silently recreate lost ownership.
  return replayOwnership(JSON.parse(await readFile(path, 'utf8')));
}
async function atomicSave(path: string, journal: OwnershipJournal) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const file = await open(tmp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(journal) + '\n'); await file.sync(); } finally { await file.close(); }
  await rename(tmp, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
export async function initializeOwnershipJournal(path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  return withJournalLock(path, async () => {
    // Exclusive create refuses to overwrite any existing journal, including corrupt files.
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(emptyOwnershipJournal()) + '\n'); await file.sync(); } finally { await file.close(); }
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  });
}
export async function appendOwnershipEvent(path: string, event: OwnershipEvent) {
  return withJournalLock(path, async () => {
    const current = await readOwnershipJournal(path);
    const result = replayOwnership({ ...current.journal, events: [...current.journal.events, event] });
    await atomicSave(path, result.journal);
    return result;
  });
}
