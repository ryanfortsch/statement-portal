/**
 * The daily cleaner schedule digest: draft, approve, send.
 *
 * Flow: /api/cron/cleaner-schedule drafts tomorrow's digest every
 * afternoon (one cleaner_schedule_digests row per service_date PER REGION).
 * The card on /cleaner-messaging shows the Cape Ann draft with the live
 * schedule, lets the operator edit the text, and Approve sends it through
 * HELM'S OWN Quo credentials (src/lib/quo.ts sendMessage - the same path
 * the field contractor texts use, NOT the stay-concierge send path, so the
 * digest works even when the Mac Mini is asleep). /turnovers/schedule
 * carries one card per region.
 *
 * Every send is operator-approved on the card, so this deliberately has
 * no quiet-hours gate and no cooldown: a human pressing Send at 9pm is
 * the authorization. The atomic pending->sending claim is what prevents
 * two tabs from double-texting Rosa.
 *
 * Recipients live in cleaner_schedule_recipients (service-role only -
 * NOT cleaner_phones, which still carries permissive anon RLS; the
 * portal token must never be anon-readable). Each enabled recipient of a
 * digest's region gets a body composed from THEIR scope (property_ids, or
 * every home in their region) in THEIR language, plus their own tokenized
 * link to the live mobile schedule page (/c/<token>), so a text sent at
 * 4pm is never stale by 7am: the page re-merges bookings + adjustments on
 * every load.
 *
 * The SMS reads Portuguese-first by default: the cleaner channel sends
 * Portuguese by house convention (stay-concierge translates cleaner
 * drafts), and times/addresses are language-neutral anyway. A recipient
 * row marked language 'en' gets the same message in English. The operator
 * sees and can edit the exact text before it goes.
 *
 * Pure logic (scope, composition) lives in cleaner-digest-core.ts so
 * node:test can load it; everything there is re-exported here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { quoFromNumber, sendMessage } from '@/lib/quo';
import {
  buildCheckoutSchedule,
  ScheduleUnavailableError,
  todayET,
  addDays,
  type ScheduleDay,
} from '@/lib/checkout-schedule';
import { CAPE_ANN_REGION } from '@/lib/property-scope';
import { loadVendorAppointments } from '@/lib/vendor-schedule';
import { loadAddedNotesByProperty } from '@/lib/turnover-notes';
import { detectExtensionHolds } from '@/lib/extension-holds';
import {
  RECIPIENT_COLS,
  assembleSms,
  composeDigestBody,
  filterScheduleForRecipient,
  shapeRecipient,
  updateMarker,
  withOperatorNote,
  type DigestLanguage,
  type PropertyRegionLookup,
  type ScheduleRecipient,
} from '@/lib/cleaner-digest-core';

export {
  RECIPIENT_COLS,
  assembleSms,
  composeDigestBody,
  describeRecipientScope,
  filterScheduleForRecipient,
  liveLinkLabel,
  normalizeLanguage,
  propertyInScope,
  recipientScope,
  recountDay,
  shapeRecipient,
  updateMarker,
  withOperatorNote,
  type DigestLanguage,
  type PropertyRegionLookup,
  type ScheduleRecipient,
} from '@/lib/cleaner-digest-core';

export type DigestRow = {
  id: string;
  service_date: string;
  region: string;
  status: 'pending' | 'sending' | 'sent' | 'skipped';
  body: string;
  stats: { checkouts?: number; sameDay?: number; adjusted?: number; proposed?: number };
  built_at: string;
  sent_at: string | null;
  sent_by: string | null;
  operator_note: string;
  sent_log: Array<{
    at: string;
    by: string;
    kind: 'initial' | 'update';
    results: Array<{
      phone: string;
      name: string;
      ok: boolean;
      id?: string;
      error?: string;
      /** Which rendering this recipient got (absent on pre-scope sends). */
      language?: DigestLanguage;
      /** How many checkouts their scoped body listed. */
      checkouts?: number;
    }>;
  }>;
};

export function digestBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.AUTH_URL ||
    'https://helm.risingtidestr.com'
  ).replace(/\/$/, '');
}

// ─── composition ──────────────────────────────────────────────────────

/** propertyId -> the cleaning time the vendor has committed to for this
 *  day, when they have announced one. */
export async function loadVendorTimes(
  supabase: SupabaseClient,
  date: string,
): Promise<Map<string, string>> {
  try {
    const { rows } = await loadVendorAppointments(supabase, date, date);
    return new Map(rows.filter((r) => r.service_date === date).map((r) => [r.property_id, r.service_time]));
  } catch {
    // The cross-check is an enhancement; a digest still has to compose
    // without it.
    return new Map();
  }
}

/** composeDigestBody with the vendor's times loaded for that day. */
export async function composeDigestBodyLive(
  supabase: SupabaseClient,
  day: ScheduleDay,
  language: DigestLanguage = 'pt',
): Promise<string> {
  const [vendorTimes, notes] = await Promise.all([
    loadVendorTimes(supabase, day.date),
    loadAddedNotesByProperty(supabase, day.date),
  ]);
  return composeDigestBody(day, vendorTimes, notes, language);
}

/** id -> region for every registry home, the lookup filterScheduleForRecipient
 *  needs. Fails soft to an empty map: a row missing from it reads as Cape
 *  Ann, which is where it already went. */
export async function loadPropertyRegions(supabase: SupabaseClient): Promise<PropertyRegionLookup> {
  try {
    const { data } = await supabase.from('properties').select('id, region');
    return new Map(((data ?? []) as Array<{ id: string; region: string | null }>).map((p) => [p.id, p]));
  } catch {
    return new Map();
  }
}

export type RecipientBody = {
  recipient: ScheduleRecipient;
  /** The scoped day this recipient sees. */
  day: ScheduleDay;
  /** Schedule text in their language, before note and link. */
  body: string;
};

/**
 * One body per recipient from the REGION's schedule day: each recipient's
 * rows are filtered to their scope, then composed in their language with
 * the same vendor times and turnover notes. A '{}' cape_ann recipient's
 * body is byte-identical to the region-wide Portuguese text.
 */
export async function composeRecipientBodies(
  supabase: SupabaseClient,
  regionDay: ScheduleDay,
  recipients: ScheduleRecipient[],
  propertiesById?: PropertyRegionLookup,
): Promise<RecipientBody[]> {
  if (recipients.length === 0) return [];
  const [vendorTimes, notes, lookup] = await Promise.all([
    loadVendorTimes(supabase, regionDay.date),
    loadAddedNotesByProperty(supabase, regionDay.date),
    propertiesById ? Promise.resolve(propertiesById) : loadPropertyRegions(supabase),
  ]);
  return recipients.map((recipient) => {
    const day = filterScheduleForRecipient(regionDay, recipient, lookup);
    return { recipient, day, body: composeDigestBody(day, vendorTimes, notes, recipient.language) };
  });
}

/** The operator preview: what each enabled recipient of a region would be
 *  texted for a service date, composed live. */
export async function previewRecipientBodies(
  supabase: SupabaseClient,
  serviceDate: string,
  region: string = CAPE_ANN_REGION,
): Promise<{ day: ScheduleDay; bodies: RecipientBody[] }> {
  const [day] = await buildCheckoutSchedule(supabase, { startDate: serviceDate, days: 1, scope: { region } });
  const recipients = (await listScheduleRecipients(supabase, region)).filter((r) => r.enabled);
  const bodies = await composeRecipientBodies(supabase, day, recipients);
  return { day, bodies };
}

// ─── draft upsert (cron + refresh) ────────────────────────────────────

/** Build the live schedule for a service date and region and create or
 *  refresh its pending digest row. Never touches a row that is sending or
 *  sent. Returns the fresh row. The stored body is the region-wide
 *  Portuguese text (the operator's editable draft); per-recipient bodies
 *  are composed at send time. */
export async function upsertDigestDraft(
  supabase: SupabaseClient,
  serviceDate: string,
  region: string = CAPE_ANN_REGION,
): Promise<{ digest: DigestRow; day: ScheduleDay }> {
  const [day] = await buildCheckoutSchedule(supabase, { startDate: serviceDate, days: 1, scope: { region } });
  const body = await composeDigestBodyLive(supabase, day);
  const stats = day.counts;

  const { data: existing } = await supabase
    .from('cleaner_schedule_digests')
    .select('*')
    .eq('service_date', serviceDate)
    .eq('region', region)
    .maybeSingle();

  // A skipped day is revived by an explicit draft request: "Skip this day"
  // has to be undoable, and this function is only ever called for tomorrow
  // or for a date the operator named, never speculatively.
  if (existing && (existing as DigestRow).status === 'skipped') {
    const { data } = await supabase
      .from('cleaner_schedule_digests')
      .update({ status: 'pending', body, stats, built_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', (existing as DigestRow).id)
      .eq('status', 'skipped')
      .select('*')
      .single();
    return { digest: (data ?? existing) as DigestRow, day };
  }

  if (existing && (existing as DigestRow).status !== 'pending') {
    return { digest: existing as DigestRow, day };
  }

  if (existing) {
    const { data } = await supabase
      .from('cleaner_schedule_digests')
      .update({ body, stats, built_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', (existing as DigestRow).id)
      .eq('status', 'pending')
      .select('*')
      .single();
    return { digest: (data ?? existing) as DigestRow, day };
  }

  const { data, error } = await supabase
    .from('cleaner_schedule_digests')
    .insert({ service_date: serviceDate, region, body, stats })
    .select('*')
    .single();
  if (error) {
    // Unique (service_date, region) race with a parallel run: read theirs.
    if (error.code === '23505') {
      const { data: raced } = await supabase
        .from('cleaner_schedule_digests')
        .select('*')
        .eq('service_date', serviceDate)
        .eq('region', region)
        .single();
      return { digest: raced as DigestRow, day };
    }
    throw new Error(`digest insert failed: ${error.message}`);
  }
  return { digest: data as DigestRow, day };
}

/** Pending digests whose day has passed were never approved; mark them
 *  skipped so the card stops offering to text yesterday's schedule. Every
 *  region at once: a stale draft is stale wherever it is. */
export async function expireStaleDigests(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase
    .from('cleaner_schedule_digests')
    .update({ status: 'skipped', updated_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('service_date', todayET())
    .select('id');
  return (data ?? []).length;
}

// ─── reads for the card / pages ───────────────────────────────────────

export async function getOpenDigest(
  supabase: SupabaseClient,
  region: string = CAPE_ANN_REGION,
): Promise<DigestRow | null> {
  const today = todayET();
  // The card is the approval gate, so a digest WAITING on the operator
  // always wins, soonest first.
  //
  // This used to take the soonest row dated today-or-later regardless of
  // status, on the assumption there would be "normally exactly one -
  // tomorrow's". That only held on day one. From the second day on,
  // TODAY's already-sent digest still sorts first and keeps winning, so
  // tomorrow's pending one never surfaces and cannot be approved. Found
  // live 2026-08-25: the card showed Monday's sent digest while Tuesday's
  // sat unapproved behind it, and the schedule read as if it had gone
  // backwards to "today" instead of a day forward.
  const { data: pending } = await supabase
    .from('cleaner_schedule_digests')
    .select('*')
    .eq('region', region)
    .eq('status', 'pending')
    .gte('service_date', today)
    .order('service_date', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pending) return pending as DigestRow;

  // Nothing waiting on approval: fall back to the soonest upcoming day so a
  // digest already sent stays reachable for "Send an update" when the
  // schedule moves after it went out.
  //
  // Skipped days are excluded, or "skip this day" would not actually clear
  // the card -- the skipped row would just win this query instead.
  const { data } = await supabase
    .from('cleaner_schedule_digests')
    .select('*')
    .eq('region', region)
    .neq('status', 'skipped')
    .gte('service_date', today)
    .order('service_date', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as DigestRow | null) ?? null;
}

export async function getDigestByDate(
  supabase: SupabaseClient,
  serviceDate: string,
  region: string = CAPE_ANN_REGION,
): Promise<DigestRow | null> {
  const { data } = await supabase
    .from('cleaner_schedule_digests')
    .select('*')
    .eq('service_date', serviceDate)
    .eq('region', region)
    .maybeSingle();
  return (data as DigestRow | null) ?? null;
}

/** Every recipient, or only those whose row belongs to `region`. */
export async function listScheduleRecipients(
  supabase: SupabaseClient,
  region?: string,
): Promise<ScheduleRecipient[]> {
  let q = supabase.from('cleaner_schedule_recipients').select(RECIPIENT_COLS).order('display_name');
  if (region) q = q.eq('region', region);
  const { data } = await q;
  return ((data ?? []) as Array<Parameters<typeof shapeRecipient>[0]>).map(shapeRecipient);
}

/** The distinct regions that have at least one ENABLED recipient. Cape Ann
 *  is not implied here; see regionsForDigests. */
export async function regionsWithEnabledRecipients(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from('cleaner_schedule_recipients')
    .select('region')
    .eq('enabled', true);
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{ region: string | null }>) set.add(r.region || CAPE_ANN_REGION);
  return sortRegions([...set]);
}

/**
 * The regions the crons and the schedule page iterate: Cape Ann ALWAYS,
 * then every other region with an enabled recipient. Cape Ann is pinned
 * because the digest drafted there before scoping existed regardless of
 * who was enabled (the card shows it, and "no recipients" is a send-time
 * refusal, not a draft-time one). Dropping it when Rosa is toggled off
 * would have changed that path.
 */
export async function regionsForDigests(supabase: SupabaseClient): Promise<string[]> {
  const enabled = await regionsWithEnabledRecipients(supabase);
  return sortRegions([CAPE_ANN_REGION, ...enabled]);
}

function sortRegions(regions: string[]): string[] {
  const uniq = [...new Set(regions)];
  return uniq.sort((a, b) => (a === CAPE_ANN_REGION ? -1 : b === CAPE_ANN_REGION ? 1 : a.localeCompare(b)));
}

/**
 * The cleaner's live-schedule link, kept deliberately short because it
 * rides at the end of every SMS: `/c/<16 hex>`, no query string. It was
 * `/clean/<32 hex>?d=YYYY-MM-DD` (85 characters, most of it token), which
 * ate an SMS segment and read as noise on a phone.
 *
 * The date parameter is gone rather than shortened: the page now defaults
 * to the day of the digest that was actually sent, so the link lands on
 * the right day without carrying it. `serviceDate` is still accepted for
 * an explicit operator preview of some other day.
 */
export function portalLink(token: string, serviceDate?: string): string {
  return `${digestBaseUrl()}/c/${token}${serviceDate ? `?d=${serviceDate}` : ''}`;
}

// ─── send ─────────────────────────────────────────────────────────────

// Cleaners are back office: the digest goes out on the RISING TIDE 24/7
// line, so Rosa's reply lands where the team works, not in a guest inbox.
async function resolveQuoFrom(): Promise<string | null> {
  if (!process.env.QUO_API_KEY) return null;
  return quoFromNumber('ops');
}

export type SendDigestResult =
  | { ok: true; sentCount: number; failed: Array<{ name: string; error: string }> }
  | { ok: false; error: 'raced' | 'no_recipients' | 'quo_unconfigured' | 'all_failed' | 'not_found' | 'schedule_unavailable' };

/**
 * Send a digest to every enabled recipient of ITS region, each with their
 * own live-schedule link. `initial` claims pending -> sending atomically;
 * `update` re-sends from sent (schedule changed after the first text).
 *
 * Two bodies are possible:
 *   - `body` given: the operator edited the text on the card. Her words go
 *     verbatim to every recipient of the region (there is no way to scope a
 *     hand-edited paragraph), each with their own link.
 *   - `body` absent: composed here, per recipient, from the region's LIVE
 *     schedule filtered to that recipient's scope and rendered in their
 *     language, then the operator note from the row, then the link. This
 *     is the path the unedited approval, the update send and the evening
 *     autosend take, so a change logged at 5:59pm still reaches the crew
 *     and Luana never reads a Gloucester line.
 * The row's stored `body` becomes the region-wide text that went out (or
 * the operator's verbatim one), as before.
 */
export async function sendDigest(
  supabase: SupabaseClient,
  opts: { digestId: string; body?: string; operatorEmail: string; kind: 'initial' | 'update' },
): Promise<SendDigestResult> {
  const { data: row } = await supabase
    .from('cleaner_schedule_digests')
    .select('*')
    .eq('id', opts.digestId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'not_found' };
  const digest = row as DigestRow;
  const region = digest.region || CAPE_ANN_REGION;

  const fromStatus = opts.kind === 'initial' ? 'pending' : 'sent';
  const { data: claimed } = await supabase
    .from('cleaner_schedule_digests')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('id', opts.digestId)
    .eq('status', fromStatus)
    .select('id');
  if (!claimed || claimed.length === 0) return { ok: false, error: 'raced' };

  const revert = async () => {
    await supabase
      .from('cleaner_schedule_digests')
      .update({ status: fromStatus, updated_at: new Date().toISOString() })
      .eq('id', opts.digestId)
      .eq('status', 'sending');
  };

  const recipients = (await listScheduleRecipients(supabase, region)).filter((r) => r.enabled);
  if (recipients.length === 0) {
    await revert();
    return { ok: false, error: 'no_recipients' };
  }
  const from = await resolveQuoFrom();
  if (!from) {
    await revert();
    return { ok: false, error: 'quo_unconfigured' };
  }

  // Resolve every recipient's text before the first send so a failure to
  // read the schedule reverts the claim with nothing sent.
  const verbatim = opts.body?.trim() || null;
  let perRecipient: Array<{ recipient: ScheduleRecipient; text: string; checkouts?: number }>;
  let storedBody: string;
  if (verbatim) {
    storedBody = verbatim;
    perRecipient = recipients.map((r) => ({ recipient: r, text: verbatim }));
  } else {
    let regionDay: ScheduleDay;
    try {
      [regionDay] = await buildCheckoutSchedule(supabase, { startDate: digest.service_date, days: 1, scope: { region } });
    } catch (err) {
      await revert();
      if (err instanceof ScheduleUnavailableError) return { ok: false, error: 'schedule_unavailable' };
      throw err;
    }
    const bodies = await composeRecipientBodies(supabase, regionDay, recipients);
    const finish = (text: string, language: DigestLanguage) =>
      withOperatorNote(opts.kind === 'update' ? `${text}\n\n${updateMarker(language)}` : text, digest.operator_note);
    perRecipient = bodies.map((b) => ({
      recipient: b.recipient,
      text: finish(b.body, b.recipient.language),
      checkouts: b.day.counts.checkouts,
    }));
    storedBody = finish(await composeDigestBodyLive(supabase, regionDay), 'pt');
  }

  const results: DigestRow['sent_log'][number]['results'] = [];
  for (const { recipient: r, text, checkouts } of perRecipient) {
    const content = assembleSms(text, portalLink(r.portal_token, digest.service_date), r.language);
    try {
      const msg = await sendMessage({ from, to: r.phone, content });
      results.push({ phone: r.phone, name: r.display_name, ok: true, id: msg.id, language: r.language, checkouts });
    } catch (err) {
      results.push({
        phone: r.phone,
        name: r.display_name,
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
        language: r.language,
        checkouts,
      });
    }
  }

  const anyOk = results.some((r) => r.ok);
  const batch = {
    at: new Date().toISOString(),
    by: opts.operatorEmail,
    kind: opts.kind,
    results,
  };
  const nextLog = [...(digest.sent_log ?? []), batch];

  if (!anyOk) {
    await supabase
      .from('cleaner_schedule_digests')
      .update({ status: fromStatus, sent_log: nextLog, updated_at: new Date().toISOString() })
      .eq('id', opts.digestId);
    return { ok: false, error: 'all_failed' };
  }

  await supabase
    .from('cleaner_schedule_digests')
    .update({
      status: 'sent',
      body: storedBody,
      sent_at: batch.at,
      sent_by: opts.operatorEmail,
      sent_log: nextLog,
      updated_at: batch.at,
    })
    .eq('id', opts.digestId);
  return { ok: true, sentCount: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).map((r) => ({ name: r.name, error: r.error ?? '' })) };
}

/** Tomorrow in ET - the digest's standard service date. */
export function tomorrowET(): string {
  return addDays(todayET(), 1);
}

// ─── automatic evening send ───────────────────────────────────────────

export type ScheduleSettings = {
  autosend_enabled: boolean;
  send_hour_et: number;
  last_autosend_at: string | null;
  last_autosend_date: string | null;
  updated_by: string;
};

const DEFAULT_SETTINGS: ScheduleSettings = {
  autosend_enabled: false,
  send_hour_et: 18,
  last_autosend_at: null,
  last_autosend_date: null,
  updated_by: '',
};

/** Fails CLOSED: an unreadable settings row means no automatic texting.
 *  One switch for every region: the operator's on/off is fleet-wide. */
export async function getScheduleSettings(supabase: SupabaseClient): Promise<ScheduleSettings> {
  try {
    const { data } = await supabase
      .from('cleaner_schedule_settings')
      .select('autosend_enabled, send_hour_et, last_autosend_at, last_autosend_date, updated_by')
      .eq('id', true)
      .maybeSingle();
    return (data as ScheduleSettings | null) ?? DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function setAutosend(
  supabase: SupabaseClient,
  enabled: boolean,
  byEmail: string,
): Promise<void> {
  await supabase
    .from('cleaner_schedule_settings')
    .upsert(
      { id: true, autosend_enabled: enabled, updated_at: new Date().toISOString(), updated_by: byEmail },
      { onConflict: 'id' },
    );
}

/** The current hour in Gloucester, 0-23. */
export function hourET(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date()),
  );
}

export type AutoSendResult = {
  sent: boolean;
  reason:
    | 'sent'
    | 'disabled'
    | 'wrong_hour'
    | 'skipped_by_operator'
    | 'already_handled'
    | 'no_recipients'
    | 'schedule_unavailable'
    | 'drift_needs_review'
    | 'send_failed';
  region: string;
  serviceDate: string;
  hourET: number;
  sentCount?: number;
  detail?: string;
};

/**
 * Send tomorrow's digest for one region unattended, if the operator has
 * left autosend on and the local hour matches. Called by
 * /api/cron/cleaner-digest-send once per region.
 *
 * Deliberate refusals, in order:
 *   - autosend off -> nothing, ever. The switch is the operator's.
 *   - wrong local hour -> nothing. The cron fires at two UTC hours so one
 *     of them lands on the right ET hour year-round; the other must no-op.
 *   - the day was SKIPPED -> nothing, and the skip is NOT revived. This is
 *     why the draft is read directly instead of calling upsertDigestDraft,
 *     which revives a skipped row on purpose for the manual "draft it
 *     anyway" button. Automation must never overturn a human's skip.
 *   - already sent / sending -> nothing. The atomic pending->sending claim
 *     inside sendDigest is what actually makes a double-send impossible,
 *     including against a manual click landing at the same moment.
 *
 * The bodies are composed LIVE inside sendDigest, per recipient, exactly as
 * an unedited manual approval does, so a change logged at 5:59pm still
 * reaches the cleaners.
 */
export async function autoSendTomorrowDigest(
  supabase: SupabaseClient,
  opts?: { region?: string; force?: boolean },
): Promise<AutoSendResult> {
  const region = opts?.region ?? CAPE_ANN_REGION;
  const settings = await getScheduleSettings(supabase);
  const hour = hourET();
  const serviceDate = tomorrowET();
  const base = { region, serviceDate, hourET: hour };

  if (!settings.autosend_enabled) return { sent: false, reason: 'disabled', ...base };
  if (!opts?.force && hour !== settings.send_hour_et) {
    return { sent: false, reason: 'wrong_hour', ...base };
  }

  const { data: existing } = await supabase
    .from('cleaner_schedule_digests')
    .select('*')
    .eq('service_date', serviceDate)
    .eq('region', region)
    .maybeSingle();
  const row = existing as DigestRow | null;

  if (row && row.status === 'skipped') {
    return { sent: false, reason: 'skipped_by_operator', ...base };
  }
  if (row && row.status !== 'pending') {
    return { sent: false, reason: 'already_handled', ...base, detail: row.status };
  }

  // No draft yet (the afternoon cron failed, or this is the first run):
  // build one now rather than skipping the night entirely.
  //
  // If the schedule cannot be BUILT, refuse outright. The claim below has
  // not happened yet, so the row stays pending and the operator sees it
  // still waiting instead of a text that says nobody checks out.
  // Same freshness rule as a manual approval: pick up any hold placed
  // since the afternoon draft before composing. Fail-soft.
  try { await detectExtensionHolds(supabase); } catch { /* never blocks the send */ }

  let digest: DigestRow;
  let day: ScheduleDay;
  try {
    ({ digest, day } = row
      ? { digest: row, day: (await buildCheckoutSchedule(supabase, { startDate: serviceDate, days: 1, scope: { region } }))[0] }
      : await upsertDigestDraft(supabase, serviceDate, region));
  } catch (err) {
    if (err instanceof ScheduleUnavailableError) {
      return { sent: false, reason: 'schedule_unavailable', ...base, detail: err.message };
    }
    throw err;
  }

  const enabled = (await listScheduleRecipients(supabase, region)).filter((r) => r.enabled);
  // A drifted row means Guesty moved the stay somewhere neither side of the
  // adjustment expects, and the overlay still wins. With a human on the
  // card that is a visible "re-check" chip they can act on. Unattended,
  // nobody looks, so this is exactly the confidently-wrong-line case that
  // put two bad texts on the cleaners' phones. Hold it for a person.
  const drifted = day.rows.filter((r) => r.adjustment?.drifted);
  if (drifted.length > 0) {
    return {
      sent: false,
      reason: 'drift_needs_review',
      ...base,
      detail: drifted.map((r) => r.propertyName).join(', '),
    };
  }

  if (enabled.length === 0) return { sent: false, reason: 'no_recipients', ...base };

  const res = await sendDigest(supabase, {
    digestId: digest.id,
    operatorEmail: AUTOSEND_ACTOR,
    kind: 'initial',
  });
  if (!res.ok) return { sent: false, reason: 'send_failed', ...base, detail: res.error };

  await supabase
    .from('cleaner_schedule_settings')
    .update({ last_autosend_at: new Date().toISOString(), last_autosend_date: serviceDate })
    .eq('id', true);
  return { sent: true, reason: 'sent', ...base, sentCount: res.sentCount };
}

/** Stamped as sent_by so an unattended send is never mistaken for a human
 *  one in the digest's own audit log. */
export const AUTOSEND_ACTOR = 'autosend@helm.system';
