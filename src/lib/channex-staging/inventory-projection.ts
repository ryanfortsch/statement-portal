/** Pure projection of an explicitly complete canonical snapshot. No database/provider IO.
 * Callers must resolve provider duplicates/revisions before constructing this snapshot.
 * This result never grants publishing authority or supplies rates/stay restrictions.
 */
import { z } from 'zod';
import { nights } from './core.ts';
import { inventoryDigest, type InventoryDay } from './inventory-outbox.ts';
const id = z.string().trim().min(1).max(160);
const ids = z.array(id).min(1).refine(v => new Set(v).size === v.length, 'Duplicate identity');
const range = { start: z.string(), end: z.string() };
const schema = z.object({
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  resources: ids,
  listings: z.array(z.object({ id, resources: ids }).strict()).min(1),
  requiredSources: ids,
  coverage: z.array(z.object({ source: id, resources: ids, ...range,
    complete: z.boolean(), freshUntil: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict()),
  bookings: z.array(z.object({ id, listing: id, ...range,
    status: z.enum(['confirmed', 'cancelled']),
  }).strict()),
  holds: z.array(z.object({ id, resources: ids, ...range }).strict()),
}).strict();
export type InventorySnapshot = z.input<typeof schema>;
export type ProjectedInventory = {
  version: number; listing: string; days: InventoryDay[]; digest: string;
  complete: boolean; freshUntil: number;
  reasons: Array<{ date: string; blockers: string[] }>;
};
export function projectInventory(input: InventorySnapshot, listingId: string,
  start: string, end: string, now: number): ProjectedInventory {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid projection clock');
  const snapshot = schema.parse(input), dates = nights(start, end);
  const resources = new Set(snapshot.resources);
  const assertResources = (values: string[]) => {
    if (values.some(v => !resources.has(v))) throw new Error('Unmapped physical resource');
  };
  const unique = (values: string[]) => {
    if (new Set(values).size !== values.length) throw new Error('Duplicate canonical identity');
  };
  unique(snapshot.listings.map(l => l.id));
  unique(snapshot.bookings.map(b => b.id));
  unique(snapshot.holds.map(h => h.id));
  for (const l of snapshot.listings) assertResources(l.resources);
  const listings = new Map(snapshot.listings.map(l => [l.id, l]));
  const target = listings.get(listingId);
  if (!target) throw new Error('Unknown listing');
  for (const row of [...snapshot.bookings, ...snapshot.holds, ...snapshot.coverage]) nights(row.start, row.end);
  for (const b of snapshot.bookings) if (!listings.has(b.listing)) throw new Error('Unmapped booking listing');
  for (const h of snapshot.holds) assertResources(h.resources);
  const coverage = new Map<string, typeof snapshot.coverage[number]>();
  for (const c of snapshot.coverage) {
    assertResources(c.resources);
    if (!snapshot.requiredSources.includes(c.source)) throw new Error('Unexpected coverage source');
    for (const r of c.resources) {
      const key = JSON.stringify([c.source, r]);
      if (coverage.has(key)) throw new Error('Ambiguous source coverage');
      coverage.set(key, c);
    }
  }
  const intersects = (values: string[]) => values.some(r => target.resources.includes(r));
  const evidence = snapshot.requiredSources.flatMap(source => target.resources.map(resource =>
    coverage.get(JSON.stringify([source, resource]))));
  const complete = evidence.every(c => c && c.complete && c.freshUntil > now && c.start <= start && c.end >= end);
  const freshUntil = evidence.every(Boolean) ? Math.min(...evidence.map(c => c!.freshUntil)) : 0;
  const reasons = dates.map(date => {
    const blockers: string[] = [];
    // Do not publish a partly open batch from a partly reconciled snapshot.
    if (!complete) blockers.push('incomplete-or-stale-source');
    for (const b of snapshot.bookings) {
      if (b.status === 'confirmed' && b.start <= date && date < b.end && intersects(listings.get(b.listing)!.resources)) blockers.push(`booking:${b.id}`);
    }
    for (const h of snapshot.holds) {
      if (h.start <= date && date < h.end && intersects(h.resources)) blockers.push(`hold:${h.id}`);
    }
    return { date, blockers: blockers.sort() };
  });
  const days: InventoryDay[] = reasons.map(({ date, blockers }) => ({ date, available: blockers.length ? 0 : 1, stopSell: blockers.length > 0 }));
  return { version: snapshot.version, listing: listingId, days, digest: inventoryDigest(days), complete, freshUntil, reasons };
}
