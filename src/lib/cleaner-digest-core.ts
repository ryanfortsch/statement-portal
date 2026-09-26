/**
 * Pure half of the cleaner digest: who a recipient is, which rows of a
 * schedule day they may see, and the SMS text for that day in their
 * language. No I/O and no secrets, so `node --test` can load it (the runner
 * cannot resolve the `@/` alias, which is why this file keeps its imports
 * relative and shallow). The I/O half is src/lib/cleaner-digest.ts, which
 * re-exports everything here.
 *
 * Scope rules (cleaner_schedule_recipients):
 *   property_ids = '{}'   every home in the recipient's `region`
 *   property_ids = [...]  exactly those homes, whatever region they sit in
 *
 * So Rosa ('{}', cape_ann) never sees a Connecticut checkout, and Luana
 * (['65_calderwood']) sees that one house and nothing else. The Cape Ann
 * text for a '{}' cape_ann recipient is byte-identical to what the digest
 * sent before scoping existed: same rows, same Portuguese wording.
 */
import { CAPE_ANN_REGION } from './property-scope.ts';
import type { ScheduleDay, ScheduleRow, ScheduleScope } from './checkout-schedule.ts';

export type DigestLanguage = 'pt' | 'en';

export type ScheduleRecipient = {
  phone: string;
  display_name: string;
  portal_token: string;
  enabled: boolean;
  /** '{}' (empty) = every home in `region`. */
  property_ids: string[];
  region: string;
  language: DigestLanguage;
};

/** The columns the recipient reads select. */
export const RECIPIENT_COLS = 'phone, display_name, portal_token, enabled, property_ids, region, language';

export function normalizeLanguage(raw: string | null | undefined): DigestLanguage {
  return raw === 'en' ? 'en' : 'pt';
}

/** Shape a raw recipients row: older rows (pre-migration reads, or a row
 *  the migration has not touched) get the Cape Ann / Portuguese defaults
 *  the table itself defaults to. */
export function shapeRecipient(r: {
  phone: string;
  display_name: string;
  portal_token: string;
  enabled: boolean;
  property_ids?: string[] | null;
  region?: string | null;
  language?: string | null;
}): ScheduleRecipient {
  return {
    phone: r.phone,
    display_name: r.display_name,
    portal_token: r.portal_token,
    enabled: !!r.enabled,
    property_ids: Array.isArray(r.property_ids) ? r.property_ids.filter((x) => typeof x === 'string' && x.length > 0) : [],
    region: r.region || CAPE_ANN_REGION,
    language: normalizeLanguage(r.language),
  };
}

/** The schedule scope a recipient's row asks for. */
export function recipientScope(recipient: Pick<ScheduleRecipient, 'property_ids' | 'region'>): ScheduleScope {
  const region = recipient.region || CAPE_ANN_REGION;
  if (recipient.property_ids && recipient.property_ids.length > 0) {
    return { region, propertyIds: [...recipient.property_ids] };
  }
  return { region };
}

/**
 * Same predicate as checkout-schedule.ts inScheduleScope, restated here so
 * the pure module has no I/O import. A missing or null region reads as Cape
 * Ann, the fleet-wide rule from property-scope.ts.
 */
export function propertyInScope(p: { id: string; region?: string | null }, scope: ScheduleScope): boolean {
  if (scope.propertyIds && scope.propertyIds.length > 0) return scope.propertyIds.includes(p.id);
  const region = scope.region ?? CAPE_ANN_REGION;
  return (p.region ?? CAPE_ANN_REGION) === region;
}

export type PropertyRegionLookup = ReadonlyMap<string, { id: string; region?: string | null }>;

/** Recount a day after its rows changed; mirrors buildCheckoutSchedule. */
export function recountDay(date: string, rows: ScheduleRow[]): ScheduleDay {
  return {
    date,
    rows,
    counts: {
      checkouts: rows.length,
      sameDay: rows.filter((r) => r.sameDayTurnover).length,
      adjusted: rows.filter((r) => r.adjustment).length,
      proposed: rows.filter((r) => r.proposals.length > 0).length,
    },
  };
}

/**
 * The rows of a schedule day this recipient may see, with the counts
 * recomputed. `propertiesById` supplies each row's region; a row whose
 * property is not in the map is treated as region-less (Cape Ann by the
 * fleet rule), so a stale map can never leak an out-of-region home into a
 * region-scoped text, only a Cape Ann one into Rosa's, which is where it
 * already went.
 */
export function filterScheduleForRecipient(
  day: ScheduleDay,
  recipient: Pick<ScheduleRecipient, 'property_ids' | 'region'>,
  propertiesById: PropertyRegionLookup,
): ScheduleDay {
  const scope = recipientScope(recipient);
  const rows = day.rows.filter((r) =>
    propertyInScope(propertiesById.get(r.propertyId) ?? { id: r.propertyId, region: null }, scope),
  );
  return recountDay(day.date, rows);
}

// ─── composition ──────────────────────────────────────────────────────

function dayLabel(date: string, language: DigestLanguage): string {
  const d = new Date(`${date}T12:00:00Z`);
  const en = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
  if (language === 'en') return en;
  const pt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
  return `${pt} / ${en}`;
}

/**
 * The SMS body for one schedule day, WITHOUT the per-recipient link (that
 * is appended at send time, since each cleaner has their own token).
 *
 * Ordered and led by the VENDOR's committed cleaning time wherever they
 * have announced one, because that is the order the crew actually works
 * (Dotti, 2026-08-24). Checkout times are frequently identical across the
 * fleet -- four 11:00s on a Monday -- so sorting by them told the cleaners
 * nothing about their route, while A-1's own times do. The checkout still
 * rides along as `saida`, since that is when the house actually frees up,
 * and a cleaning slotted BEFORE it is called out: that is a cleaner sent
 * into an occupied house.
 *
 * `language` defaults to Portuguese, the house convention for the Cape Ann
 * crew, and that rendering is byte-for-byte what the digest has always
 * sent. English is the same message for a recipient whose row says so.
 */
export function composeDigestBody(
  day: ScheduleDay,
  vendorTimes?: Map<string, string>,
  /** Operator-approved turnover notes per property, already in the crew's
   *  language. Only notes a human tapped Add on ever get here; see
   *  turnover-notes.ts. */
  notesByProperty?: Map<string, string[]>,
  language: DigestLanguage = 'pt',
): string {
  if (language === 'en') return composeDigestBodyEn(day, vendorTimes, notesByProperty);
  const lines: string[] = [];
  lines.push(`Rising Tide - limpezas`);
  lines.push(dayLabel(day.date, 'pt'));
  lines.push('');
  if (day.rows.length === 0) {
    lines.push('Nenhum check-out neste dia.');
    return lines.join('\n');
  }
  const cleanTime = (propertyId: string) => vendorTimes?.get(propertyId);
  const ordered = [...day.rows].sort((a, b) => {
    const ta = cleanTime(a.propertyId) ?? a.time;
    const tb = cleanTime(b.propertyId) ?? b.time;
    return ta.localeCompare(tb) || a.propertyName.localeCompare(b.propertyName);
  });
  const anyVendor = ordered.some((r) => cleanTime(r.propertyId));

  const sameDay = day.counts.sameDay;
  lines.push(`${day.rows.length} check-out${day.rows.length === 1 ? '' : 's'}${sameDay ? `, ${sameDay} mesmo dia` : ''}:`);
  ordered.forEach((r, i) => {
    const clean = cleanTime(r.propertyId);
    const tags: string[] = [];
    if (clean) {
      tags.push(clean < r.time ? `ATENCAO: saida so as ${r.time}` : `saida ${r.time}`);
    }
    if (r.sameDayTurnover) tags.push(`MESMO DIA, prox. entrada ${r.nextCheckinTime}`);
    if (r.adjustment?.adjustedTime) tags.push(`mudou de ${r.defaultTime}`);
    if (r.adjustment?.adjustedDate && r.adjustment.adjustedDate !== r.baseCheckOut) tags.push('estadia estendida');
    // Guesty moved this stay to a third date after the adjustment was
    // written, so neither side of the overlay matches it any more. The
    // operator card has shown this since day one; the message never did,
    // which is how a confidently wrong line reaches a phone.
    if (r.adjustment?.drifted) tags.push('ATENCAO: Guesty mudou, confirmar');
    lines.push(`${i + 1}) ${clean ?? r.time} - ${r.propertyName}${tags.length ? ` (${tags.join('; ')})` : ''}`);
    // Notes hang under the house they belong to rather than in a block at
    // the end, so the crew reads them in context on the right stop.
    for (const note of notesByProperty?.get(r.propertyId) ?? []) {
      lines.push(`   - ${note}`);
    }
  });
  if (anyVendor) {
    lines.push('');
    lines.push('Horario = limpeza agendada. "saida" = hora que o hospede sai.');
  }
  return lines.join('\n');
}

/** The English rendering, line for line the same shape as the Portuguese. */
function composeDigestBodyEn(
  day: ScheduleDay,
  vendorTimes?: Map<string, string>,
  notesByProperty?: Map<string, string[]>,
): string {
  const lines: string[] = [];
  lines.push(`Rising Tide - cleanings`);
  lines.push(dayLabel(day.date, 'en'));
  lines.push('');
  if (day.rows.length === 0) {
    lines.push('No checkouts this day.');
    return lines.join('\n');
  }
  const cleanTime = (propertyId: string) => vendorTimes?.get(propertyId);
  const ordered = [...day.rows].sort((a, b) => {
    const ta = cleanTime(a.propertyId) ?? a.time;
    const tb = cleanTime(b.propertyId) ?? b.time;
    return ta.localeCompare(tb) || a.propertyName.localeCompare(b.propertyName);
  });
  const anyVendor = ordered.some((r) => cleanTime(r.propertyId));

  const sameDay = day.counts.sameDay;
  lines.push(`${day.rows.length} checkout${day.rows.length === 1 ? '' : 's'}${sameDay ? `, ${sameDay} same day` : ''}:`);
  ordered.forEach((r, i) => {
    const clean = cleanTime(r.propertyId);
    const tags: string[] = [];
    if (clean) {
      tags.push(clean < r.time ? `WARNING: guest leaves at ${r.time}` : `checkout ${r.time}`);
    }
    if (r.sameDayTurnover) tags.push(`SAME DAY, next check-in ${r.nextCheckinTime}`);
    if (r.adjustment?.adjustedTime) tags.push(`moved from ${r.defaultTime}`);
    if (r.adjustment?.adjustedDate && r.adjustment.adjustedDate !== r.baseCheckOut) tags.push('extended stay');
    if (r.adjustment?.drifted) tags.push('WARNING: Guesty moved this, confirm');
    lines.push(`${i + 1}) ${clean ?? r.time} - ${r.propertyName}${tags.length ? ` (${tags.join('; ')})` : ''}`);
    for (const note of notesByProperty?.get(r.propertyId) ?? []) {
      lines.push(`   - ${note}`);
    }
  });
  if (anyVendor) {
    lines.push('');
    lines.push('Time = scheduled cleaning. "checkout" = when the guest leaves.');
  }
  return lines.join('\n');
}

/** The operator's note rides AFTER the schedule and BEFORE the live link,
 *  so the schedule can keep recomposing while the instruction survives. */
export function withOperatorNote(body: string, note: string | null | undefined): string {
  const n = (note ?? '').trim();
  return n ? `${body}\n\n${n}` : body;
}

/** The "schedule changed" marker an update send carries. */
export function updateMarker(language: DigestLanguage): string {
  return language === 'en' ? '(updated schedule)' : '(atualizacao / updated schedule)';
}

/** The label above the live link at the foot of every text. */
export function liveLinkLabel(language: DigestLanguage): string {
  return language === 'en' ? 'Live schedule:' : 'Agenda ao vivo / live schedule:';
}

/** Body + link, exactly as one recipient receives it. */
export function assembleSms(body: string, link: string, language: DigestLanguage): string {
  return `${body}\n\n${liveLinkLabel(language)}\n${link}`;
}

/** Human wording of a recipient's scope for the operator pages. */
export function describeRecipientScope(
  recipient: Pick<ScheduleRecipient, 'property_ids' | 'region'>,
  regionLabelFn: (region: string) => string,
  propertyName: (id: string) => string,
): string {
  if (recipient.property_ids.length > 0) return recipient.property_ids.map(propertyName).join(', ');
  return `every home in ${regionLabelFn(recipient.region || CAPE_ANN_REGION)}`;
}
