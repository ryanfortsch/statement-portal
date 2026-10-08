/** Pure reconciliation boundary. Inputs are normalized, explicitly mapped source scans.
 * Completeness requires a stable scan token and an unbroken pagination chain.
 * No provider reads, database writes, identity guessing or publishing authority.
 */
import { projectInventory, type InventorySnapshot } from './inventory-projection.ts';
import { nights } from './core.ts';
type Booking = InventorySnapshot['bookings'][number];
export type InventorySourceScan = {
  source: string; resources: string[]; start: string; end: string;
  observedAt: number; freshUntil: number;
  pages: Array<{ scan: string; cursor: string | null; next: string | null; bookings: Booking[] }>;
};
export type SnapshotConfiguration = Pick<InventorySnapshot, 'version' | 'resources' | 'listings' | 'requiredSources' | 'holds'>;
export function assembleInventorySnapshot(configuration: SnapshotConfiguration, scans: InventorySourceScan[],
  start: string, end: string, now: number): InventorySnapshot {
  nights(start, end);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid snapshot clock');
  const snapshot: InventorySnapshot = {...structuredClone(configuration),coverage:[],bookings:[]};
  const bookings = new Map<string, Booking>();
  const seen = new Set<string>();
  for (const scan of scans) {
    if (!configuration.requiredSources.includes(scan.source) || seen.has(scan.source)) throw new Error('Unexpected or duplicate source scan');
    seen.add(scan.source);
    nights(scan.start, scan.end);
    if (!Number.isSafeInteger(scan.observedAt) || !Number.isSafeInteger(scan.freshUntil) ||
        scan.observedAt < 0 || scan.observedAt > now || scan.freshUntil <= scan.observedAt) throw new Error('Invalid source freshness');
    let complete = scan.pages.length > 0;
    let expected: string | null = null;
    const cursors = new Set<string | null>();
    const token = scan.pages[0]?.scan;
    for (const [index, page] of scan.pages.entries()) {
      if (!page.scan || page.scan !== token || page.cursor !== expected || cursors.has(page.cursor) ||
          (index > 0 && expected === null)) complete = false;
      cursors.add(page.cursor);
      if (page.next !== null && (!page.next || cursors.has(page.next))) complete = false;
      expected = page.next;
      for (const booking of page.bookings) {
        const listing = configuration.listings.find(l => l.id === booking.listing);
        if (!listing || listing.resources.some(r => !scan.resources.includes(r))) throw new Error('Booking outside source resource scope');
        // Explicit canonical IDs only. Conflicting copies block the entire snapshot;
        // a cancellation from one feed must not erase a confirmed copy from another.
        const normalized = {id:booking.id,listing:booking.listing,start:booking.start,end:booking.end,status:booking.status};
        const prior = bookings.get(booking.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(normalized)) throw new Error('Conflicting canonical booking copies');
        bookings.set(booking.id,normalized);
      }
    }
    complete &&= expected === null;
    snapshot.coverage.push({source:scan.source,resources:[...scan.resources],start:scan.start,end:scan.end,complete,freshUntil:scan.freshUntil});
  }
  snapshot.bookings = [...bookings.values()].sort((a,b)=>a.id.localeCompare(b.id));
  // Reuse strict projection validation for identities, dates, resources and coverage.
  // Missing/expired/partial sources remain incomplete, never inferred to be empty.
  if (!snapshot.listings.length) throw new Error('No mapped listings');
  for (const listing of snapshot.listings) projectInventory(snapshot,listing.id,start,end,now);
  return snapshot;
}
