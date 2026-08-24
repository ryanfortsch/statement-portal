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
 * mobile schedule page (/clean/<token>), so a text sent at 4pm is
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
  todayET,
  addDays,
  type ScheduleDay,
} from '@/lib/checkout-schedule';

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

/** The SMS body for one schedule day, WITHOUT the per-recipient link
 *  (appended at send time, each recipient has their own token). */
export function composeDigestBody(day: ScheduleDay): string {
  const lines: string[] = [];
  lines.push(`Rising Tide - limpezas`);
  lines.push(dayLabel(day.date));
  lines.push('');
  if (day.rows.length === 0) {
    lines.push('Nenhum check-out neste dia.');
    return lines.join('\n');
  }
  const sameDay = day.counts.sameDay;
  lines.push(`${day.rows.length} check-out${day.rows.length === 1 ? '' : 's'}${sameDay ? `, ${sameDay} mesmo dia` : ''}:`);
  day.rows.forEach((r, i) => {
    const tags: string[] = [];
    if (r.sameDayTurnover) tags.push(`MESMO DIA, prox. entrada ${r.nextCheckinTime}`);
    if (r.adjustment?.adjustedTime) tags.push(`mudou de ${r.defaultTime}`);
    if (r.adjustment?.adjustedDate && r.adjustment.adjustedDate !== r.baseCheckOut) tags.push('estadia estendida');
    lines.push(`${i + 1}) ${r.time} - ${r.propertyName}${tags.length ? ` (${tags.join('; ')})` : ''}`);
  });
  return lines.join('\n');
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
  const body = composeDigestBody(day);
  const stats = day.counts;

  const { data: existing } = await supabase
    .from('cleaner_schedule_digests')
    .select('*')
    .eq('service_date', serviceDate)
    .maybeSingle();

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
  // The digest the operator should see: today's or a future one, newest
  // relevant first (normally exactly one - tomorrow's).
  const { data } = await supabase
    .from('cleaner_schedule_digests')
    .select('*')
    .gte('service_date', todayET())
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

export function portalLink(token: string, serviceDate?: string): string {
  return `${digestBaseUrl()}/clean/${token}${serviceDate ? `?d=${serviceDate}` : ''}`;
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
