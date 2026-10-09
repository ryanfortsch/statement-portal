/** Offline synthetic rehearsal only. No provider adapters, credentials or publishers. */
export type Source = 'guesty' | 'channex';
export type Event = {
  mode: 'synthetic'; source: Source; id: string; resourceId: string;
  // Synthetic source ordering only; real adapters must establish authoritative revisions.
  revision: number; kind: 'reservation' | 'independent-hold' | 'unknown-block';
  status: 'active' | 'cancelled'; start: string; end: string;
};
export type Coverage = { source: Source; complete: boolean; observedAt: number };
const sources: Source[] = ['guesty', 'channex'];
function day(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Invalid date');
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw Error('Invalid date');
  return ms;
}
function range(start: string, end: string): string[] {
  const from = day(start), to = day(end);
  if (to <= from || to - from > 366 * 86400000) throw Error('Invalid range');
  return Array.from({ length: (to - from) / 86400000 }, (_, i) => new Date(from + i * 86400000).toISOString().slice(0, 10));
}
function validate(e: Event): Event {
  if (e.mode !== 'synthetic' || !sources.includes(e.source)
    || !/^HELMTEST-[A-Za-z0-9_-]{1,100}$/.test(e.id)
    || !/^HELMTEST-[A-Za-z0-9_-]{1,100}$/.test(e.resourceId)
    || !Number.isSafeInteger(e.revision) || e.revision < 1
    || !['reservation', 'independent-hold', 'unknown-block'].includes(e.kind)
    || !['active', 'cancelled'].includes(e.status)) throw Error('Invalid synthetic event');
  range(e.start, e.end);
  // Explicit shape keeps names, messages and other fields out of retained history.
  return { mode: e.mode, source: e.source, id: e.id, resourceId: e.resourceId,
    revision: e.revision, kind: e.kind, status: e.status, start: e.start, end: e.end };
}
function key(e: Event): string { return `${e.source}:${e.resourceId}`; }
function history(events: readonly Event[]): Event[] {
  const ids = new Map<string, Event>(), versions = new Map<string, Event>(), kinds = new Map<string, Event['kind']>();
  for (const raw of events) {
    const e = validate(raw), id = `${e.source}:${e.id}`, version = `${key(e)}:${e.revision}`;
    for (const previous of [ids.get(id), versions.get(version)]) {
      if (previous && JSON.stringify(previous) !== JSON.stringify(e)) throw Error('Conflicting synthetic revision');
    }
    if (kinds.has(key(e)) && kinds.get(key(e)) !== e.kind) throw Error('Resource kind changed');
    ids.set(id, e); versions.set(version, e); kinds.set(key(e), e.kind);
  }
  return [...ids.values()].sort((a, b) => key(a).localeCompare(key(b)) || a.revision - b.revision);
}
/** Append rather than replacing a snapshot, so missing records cannot imply cancellation. */
export function appendEvents(previous: readonly Event[], incoming: readonly Event[]): Event[] {
  return history([...previous, ...incoming]);
}
export function rehearseCoordination(input: {
  events: readonly Event[]; coverage: readonly Coverage[]; start: string; end: string;
  now: number; maxAgeMs: number;
}) {
  const dates = range(input.start, input.end);
  if (!Number.isSafeInteger(input.now) || input.now < 0 || !Number.isSafeInteger(input.maxAgeMs) || input.maxAgeMs <= 0) throw Error('Invalid freshness policy');
  const seen = new Set<Source>();
  for (const c of input.coverage) {
    if (!sources.includes(c.source) || seen.has(c.source) || typeof c.complete !== 'boolean'
      || !Number.isSafeInteger(c.observedAt) || c.observedAt < 0) throw Error('Invalid source coverage');
    seen.add(c.source);
  }
  const incompleteSources = sources.filter(source => {
    const c = input.coverage.find(row => row.source === source);
    return !c || !c.complete || c.observedAt > input.now || input.now - c.observedAt > input.maxAgeMs;
  });
  const latest = new Map<string, Event>();
  for (const e of history(input.events)) latest.set(key(e), e);
  const active = [...latest.values()].filter(e => e.status === 'active');
  return {
    mode: 'synthetic-rehearsal' as const, executable: false as const, incompleteSources,
    nights: dates.map(date => {
      const blockers = active.filter(e => e.start <= date && date < e.end);
      const reservations = blockers.filter(e => e.kind === 'reservation');
      return {
        date, blockers: blockers.map(e => ({ key: key(e), kind: e.kind })),
        // Multiple records may be duplicate imports; flag for identity review, never infer a match.
        possibleReservationConflict: reservations.length > 1,
        decision: incompleteSources.length ? 'withhold' as const : blockers.length ? 'blocked' as const : 'clear-for-review' as const,
      };
    }),
  };
}
