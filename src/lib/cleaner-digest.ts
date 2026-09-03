/**
 * The daily cleaner schedule digest: draft, approve, send.
 *
 * Flow: /api/cron/cleaner-schedule drafts tomorrow's digest every
 * afternoon (one cleaner_schedule_digests row per service_date). The
 * card on /cleaner-messaging shows the draft with the live schedule,
 * lets the operator edit the text, and Approve sends it through HELM'S
 * OWN Quo credentials (src/lib/quo.ts sendMessage - the same path the
 * field contractor texts use, NOT the stay-concierge send path, so the
 * digest works even when the Mac Mini is asleep).
 *
 * Every send is operator-approved on the card, so this deliberately has
 * no quiet-hours gate and no cooldown: a human pressing Send at 9pm is
 * the authorization. The atomic pending->sending claim is what prevents
 * two tabs from double-texting Rosa.
 *
 * Recipients live in cleaner_schedule_recipients (service-role only -
 * NOT cleaner_phones, which still carries permissive anon RLS; the
 * portal token must never be anon-readable). Each enabled recipient
 * gets the digest body plus their own tokenized link to the live
 * mobile schedule page (/c/<token>), so a text sent at 4pm is
 * never stale by 7am: the page re-merges bookings + adjustments on
 * every load.
 *
 * The SMS reads Portuguese-first: the cleaner channel sends Portuguese
 * by house convention (stay-concierge translates cleaner drafts), and
 * times/addresses are language-neutral anyway. The operator sees and
 * can edit the exact text before it goes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { listPhoneNumbers, sendMessage } from '@/lib/quo';
import {
  buildCheckoutSchedule,
  ScheduleUnavailableError,
  todayET,
  addDays,
  type ScheduleDay,
} from '@/lib/checkout-schedule';
import { loadVendorAppointments } from '@/lib/vendor-schedule';

export type ScheduleRecipient = {
  phone: string;
  display_name: string;
  portal_token: string;
  enabled: boolean;
};

export type DigestRow = {
  id: string;
  service_date: string;
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
    results: Array<{ phone: string; name: string; ok: boolean; id?: string; error?: string }>;
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

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const pt = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
  const en = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
  return `${pt} / ${en}`;
}

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
 */
export function composeDigestBody(day: ScheduleDay, vendorTimes?: Map<string, string>): string {
  const lines: string[] = [];
  lines.push(`Rising Tide - limpezas`);
  lines.push(dayLabel(day.date));
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
    lines.push(`${i + 1}) ${clean ?? r.time} - ${r.propertyName}${tags.length ? ` (${tags.join('; ')})` : ''}`);
  });
  if (anyVendor) {
    lines.push('');
    lines.push('Horario = limpeza agendada. "saida" = hora que o hospede sai.');
  }
  return lines.join('\n');
}

/** composeDigestBody with the vendor's times loaded for that day. */
export async function composeDigestBodyLive(
  supabase: SupabaseClient,
  day: ScheduleDay,
): Promise<string> {
  return composeDigestBody(day, await loadVendorTimes(supabase, day.date));
}

// ─── draft upsert (cron + refresh) ────────────────────────────────────

/** Build the live schedule for a service date and create/refresh its
 *  pending digest row. Never touches a row that is sending or sent.
 *  Returns the fresh row. */
export async function upsertDigestDraft(
  supabase: SupabaseClient,
  serviceDate: string,
): Promise<{ digest: DigestRow; day: ScheduleDay }> {
  const [day] = await buildCheckoutSchedule(supabase, { startDate: serviceDate, days: 1 });
  const body = await composeDigestBodyLive(supabase, day);
  const stats = day.counts;

  const { data: existing } = await supabase
    .from('cleaner_schedule_digests')
    .select('*')
    .eq('service_date', serviceDate)
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
    .insert({ service_date: serviceDate, body, stats })
    .select('*')
    .single();
  if (error) {
    // Unique service_date race with a parallel run: read theirs.
    if (error.code === '23505') {
      const { data: raced } = await supabase
        .from('cleaner_schedule_digests')
        .select('*')
        .eq('service_date', serviceDate)
        .single();
      return { digest: raced as DigestRow, day };
    }
    throw new Error(`digest insert failed: ${error.message}`);
  }
  return { digest: data as DigestRow, day };
}

/** Pending digests whose day has passed were never approved; mark them
 *  skipped so the card stops offering to text yesterday's schedule. */
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

export async function getOpenDigest(supabase: SupabaseClient): Promise<DigestRow | null> {
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
): Promise<DigestRow | null> {
  const { data } = await supabase
    .from('cleaner_schedule_digests')
    .select('*')
    .eq('service_date', serviceDate)
    .maybeSingle();
  return (data as DigestRow | null) ?? null;
}

export async function listScheduleRecipients(
  supabase: SupabaseClient,
): Promise<ScheduleRecipient[]> {
  const { data } = await supabase
    .from('cleaner_schedule_recipients')
    .select('phone, display_name, portal_token, enabled')
    .order('display_name');
  return (data ?? []) as ScheduleRecipient[];
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
/** The operator's note rides AFTER the schedule and BEFORE the live link,
 *  so the schedule can keep recomposing while the instruction survives. */
export function withOperatorNote(body: string, note: string | null | undefined): string {
  const n = (note ?? '').trim();
  return n ? `${body}\n\n${n}` : body;
}

export function portalLink(token: string, serviceDate?: string): string {
  return `${digestBaseUrl()}/c/${token}${serviceDate ? `?d=${serviceDate}` : ''}`;
}

// ─── send ─────────────────────────────────────────────────────────────

async function resolveQuoFrom(): Promise<string | null> {
  if (!process.env.QUO_API_KEY) return null;
  let from = process.env.QUO_FROM_NUMBER;
  if (!from) {
    try {
      from = (await listPhoneNumbers())[0]?.number;
    } catch {
      return null;
    }
  }
  if (!from) return null;
  return from.startsWith('+') ? from : `+1${from.replace(/\D/g, '').slice(-10)}`;
}

export type SendDigestResult =
  | { ok: true; sentCount: number; failed: Array<{ name: string; error: string }> }
  | { ok: false; error: 'raced' | 'no_recipients' | 'quo_unconfigured' | 'all_failed' | 'not_found' };

/** Send the digest body (as approved/edited by the operator) to every
 *  enabled recipient, each with their own live-schedule link. `initial`
 *  claims pending -> sending atomically; `update` re-sends from sent
 *  (schedule changed after the first text). */
export async function sendDigest(
  supabase: SupabaseClient,
  opts: { digestId: string; body: string; operatorEmail: string; kind: 'initial' | 'update' },
): Promise<SendDigestResult> {
  const { data: row } = await supabase
    .from('cleaner_schedule_digests')
    .select('*')
    .eq('id', opts.digestId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'not_found' };
  const digest = row as DigestRow;

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

  const recipients = (await listScheduleRecipients(supabase)).filter((r) => r.enabled);
  if (recipients.length === 0) {
    await revert();
    return { ok: false, error: 'no_recipients' };
  }
  const from = await resolveQuoFrom();
  if (!from) {
    await revert();
    return { ok: false, error: 'quo_unconfigured' };
  }

  const body = opts.body.trim();
  const results: DigestRow['sent_log'][number]['results'] = [];
  for (const r of recipients) {
    const content = `${body}\n\nAgenda ao vivo / live schedule:\n${portalLink(r.portal_token, digest.service_date)}`;
    try {
      const msg = await sendMessage({ from, to: r.phone, content });
      results.push({ phone: r.phone, name: r.display_name, ok: true, id: msg.id });
    } catch (err) {
      results.push({
        phone: r.phone,
        name: r.display_name,
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
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
      body,
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

/** Fails CLOSED: an unreadable settings row means no automatic texting. */
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
function hourET(): number {
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
    | 'send_failed';
  serviceDate: string;
  hourET: number;
  sentCount?: number;
  detail?: string;
};

/**
 * Send tomorrow's digest unattended, if the operator has left autosend on
 * and the local hour matches. Called by /api/cron/cleaner-digest-send.
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
 * The body is composed LIVE here, exactly as an unedited manual approval
 * does, so a change logged at 5:59pm still reaches the cleaners.
 */
export async function autoSendTomorrowDigest(
  supabase: SupabaseClient,
  opts?: { force?: boolean },
): Promise<AutoSendResult> {
  const settings = await getScheduleSettings(supabase);
  const hour = hourET();
  const serviceDate = tomorrowET();
  const base = { serviceDate, hourET: hour };

  if (!settings.autosend_enabled) return { sent: false, reason: 'disabled', ...base };
  if (!opts?.force && hour !== settings.send_hour_et) {
    return { sent: false, reason: 'wrong_hour', ...base };
  }

  const { data: existing } = await supabase
    .from('cleaner_schedule_digests')
    .select('*')
    .eq('service_date', serviceDate)
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
  let digest: DigestRow;
  let day: ScheduleDay;
  let body: string;
  try {
    ({ digest, day } = row
      ? { digest: row, day: (await buildCheckoutSchedule(supabase, { startDate: serviceDate, days: 1 }))[0] }
      : await upsertDigestDraft(supabase, serviceDate));
    body = withOperatorNote(await composeDigestBodyLive(supabase, day), digest.operator_note);
  } catch (err) {
    if (err instanceof ScheduleUnavailableError) {
      return { sent: false, reason: 'schedule_unavailable', ...base, detail: err.message };
    }
    throw err;
  }

  const enabled = (await listScheduleRecipients(supabase)).filter((r) => r.enabled);
  if (enabled.length === 0) return { sent: false, reason: 'no_recipients', ...base };

  const res = await sendDigest(supabase, {
    digestId: digest.id,
    body,
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
