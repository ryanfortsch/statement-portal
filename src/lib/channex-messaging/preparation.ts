import 'server-only';
import { requireProductionInspectionEnvironment } from '../channex-production-runtime.ts';
import { fingerprint, parseCanonicalSnapshot } from '../channex-bookings/reconciliation.ts';
import { resolveMessageStayIdentities, type GuestyHandoffStay } from '../channex-bookings/message-identity.ts';
import { todayInEastern, shiftIsoDay } from '../sca-quotes-types.ts';
import { parsePreparationRules, reviewPreparationRules } from './preparation-rules.ts';
import { confirmationInstant, reviewCalderwoodTiming, type SourceClocks } from './preparation-timing.ts';
import { parsePreparationRenderInputs, rehearsePreparedMessages, reviewPreparationInputs } from './preparation-render.ts';

export class MessagePreparationError extends Error {
  readonly code: 'PREPARATION_READ_FAILED' | 'SOURCE_READ_FAILED' | 'SOURCES_CHANGED' | 'READ_LIMIT_REACHED';
  constructor(code: MessagePreparationError['code']) { super(code); this.code = code; }
}
export type PreparationContext = { canonical: unknown; mirror: unknown; rules: unknown; automationsEnabled: boolean; renderInputs: unknown };
type Deps = { context: () => Promise<PreparationContext>; verifyDormant: () => Promise<void>;
  token: () => Promise<string>; fetcher?: typeof fetch; clock?: () => number };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MessagePreparationError('SOURCE_READ_FAILED');
  return value as Record<string, unknown>;
}
// Temporary migration observation only. The deprecated projected endpoint exposes
// the explicit local overrides, whose timezone semantics the V3 search feed did not prove.
// https://open-api-docs.guesty.com/reference/reservationsv2get
const fields = '_id accountId listingId confirmationCode checkInDateLocalized checkOutDateLocalized status integration.platform plannedArrival plannedDeparture listing.defaultCheckInTime listing.defaultCheckOutTime listing.timezone';
type Read = (path: string, maxBytes: number) => Promise<unknown>;
async function readTiming(stays: GuestyHandoffStay[], read: Read, now: number) {
  const out: { canonicalId: string; clocks: SourceClocks }[] = [];
  for (const s of stays) {
    const d = record(await read(`/reservations/${s.id}?${new URLSearchParams({ fields })}`, 100_000));
    if (d._id !== s.id || d.accountId !== s.accountId || d.listingId !== s.listingId || d.confirmationCode !== s.code
      || d.status !== 'confirmed' || record(d.integration).platform !== 'airbnb2'
      || d.checkInDateLocalized !== s.start || d.checkOutDateLocalized !== s.end)
      throw new MessagePreparationError('SOURCE_READ_FAILED');
    const listing = record(d.listing);
    out.push({ canonicalId: s.canonicalId, clocks: { start: s.start, end: s.end, timezone: listing.timezone,
      plannedArrival: d.plannedArrival, plannedDeparture: d.plannedDeparture,
      defaultArrival: listing.defaultCheckInTime, defaultDeparture: listing.defaultCheckOutTime, confirmedAt: null } });
  }
  // V3 detail is the source for confirmedAt. It has no field projection; discard all
  // unrelated guest/financial data inside this reader. Never use creation/import time.
  // https://open-api-docs.guesty.com/reference/reservationsopenapicontroller_getreservationsbyids
  const seen = new Set<string>();
  for (let i = 0; i < stays.length; i += 10) {
    const batch = stays.slice(i, i + 10), q = new URLSearchParams();
    for (const s of batch) q.append('reservationIds[]', s.id);
    const data = await read(`/reservations-v3?${q}`, 2_000_000);
    if (!Array.isArray(data) || data.length !== batch.length) throw new MessagePreparationError('SOURCE_READ_FAILED');
    for (const value of data) {
      const d = record(value), s = batch.find(s => s.id === d._id);
      if (!s || seen.has(s.id) || d.status !== 'confirmed' || !Array.isArray(d.stay) || d.stay.length !== 1)
        throw new MessagePreparationError('SOURCE_READ_FAILED');
      const stay = record(d.stay[0]);
      if (stay.unitId !== s.listingId || stay.unitTypeId !== s.listingId
        || stay.checkInDateLocalized !== s.start || stay.checkOutDateLocalized !== s.end)
        throw new MessagePreparationError('SOURCE_READ_FAILED');
      seen.add(s.id);
      out.find(r => r.canonicalId === s.canonicalId)!.clocks.confirmedAt = confirmationInstant(d.confirmedAt, now);
    }
  }
  return out;
}
/** Owner observation. No planner, queue registration, history import, hold change or send. */
export async function reviewMessagePreparation(env: Record<string, string | undefined>, deps: Deps) {
  requireProductionInspectionEnvironment(env);
  const clock = deps.clock ?? Date.now, fetcher = deps.fetcher ?? fetch;
  const started = clock(), start = todayInEastern(new Date(started)), end = shiftIsoDay(start, 500);
  const remaining = () => {
    const now = clock(), left = 80_000 - (now - started);
    if (!Number.isSafeInteger(now) || now < started || left <= 0 || todayInEastern(new Date(now)) !== start)
      throw new MessagePreparationError('READ_LIMIT_REACHED');
    return left;
  };
  const context = async () => {
    const c = await deps.context();
    if (c.automationsEnabled !== false) throw new MessagePreparationError('PREPARATION_READ_FAILED');
    const canonical = parseCanonicalSnapshot(c.canonical), rules = parsePreparationRules(c.rules);
    const stays = resolveMessageStayIdentities(canonical, c.mirror, start, end);
    const renderInputs = parsePreparationRenderInputs(c.renderInputs, stays);
    return { revision: fingerprint({ canonical, mirror: c.mirror, rules }), stays, rules, renderInputs,
      // This private digest must never be returned: access codes can have low entropy.
      privateRenderRevision: fingerprint(renderInputs) };
  };
  await deps.verifyDormant();
  const before = await context(); remaining();
  let requests = 0;
  let first: Awaited<ReturnType<typeof readTiming>> = [];
  if (before.stays.length) {
    const token = await deps.token();
    if (!token || token.length > 4096 || /[\x00-\x20\x7f]/.test(token)) throw new MessagePreparationError('SOURCE_READ_FAILED');
    const read: Read = async (path, maxBytes) => {
      if (++requests > 28) throw new MessagePreparationError('READ_LIMIT_REACHED');
      try {
        const res = await fetcher(`https://open-api.guesty.com/v1${path}`, { method: 'GET', redirect: 'error', cache: 'no-store',
          signal: AbortSignal.timeout(Math.min(8000, remaining())), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        if (res.status !== 200 || res.redirected || !res.body) throw Error();
        const reader = res.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
        try { while (true) { const r = await reader.read(); if (r.done) break;
          length += r.value.byteLength; if (length > maxBytes) throw Error(); chunks.push(r.value); remaining(); } }
        finally { await reader.cancel(); }
        remaining();
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (e) {
        if (e instanceof MessagePreparationError) throw e;
        throw new MessagePreparationError('SOURCE_READ_FAILED');
      }
    };
    first = await readTiming(before.stays, read, started);
    const second = await readTiming(before.stays, read, started);
    if (fingerprint(first) !== fingerprint(second)) throw new MessagePreparationError('SOURCES_CHANGED');
  }
  const after = await context(); await deps.verifyDormant(); remaining();
  if (before.revision !== after.revision || before.privateRenderRevision !== after.privateRenderRevision)
    throw new MessagePreparationError('SOURCES_CHANGED');
  const observedAt = clock();
  return { ok: true as const, format: 3 as const, propertyId: '65_calderwood' as const,
    checkedAt: new Date(observedAt).toISOString(), contextRevision: before.revision,
    currentAndUpcomingStays: first.length, ...reviewPreparationRules(before.rules),
    inputs: reviewPreparationInputs(before.renderInputs),
    stays: first.sort((a, b) => a.clocks.start.localeCompare(b.clocks.start) || a.canonicalId.localeCompare(b.canonicalId)).map(r => ({ canonicalId: r.canonicalId, checkIn: r.clocks.start, checkOut: r.clocks.end,
      timings: reviewCalderwoodTiming(r.clocks, observedAt),
      messages: rehearsePreparedMessages(before.rules, before.renderInputs, before.stays.find(s => s.canonicalId === r.canonicalId)!, r.clocks) })),
    sourceReads: requests, readyForAutomaticMessaging: false as const,
    guestyQueueVerified: false as const, templateParityVerified: false as const,
    jobsCreated: 0 as const, messagesSent: 0 as const };
}
export type MessagePreparationReview = Awaited<ReturnType<typeof reviewMessagePreparation>>;
