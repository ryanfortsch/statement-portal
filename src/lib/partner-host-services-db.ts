/**
 * A partner home's service asks, from the host's question to an owner's
 * answer. The rules are src/lib/partner-host-services.ts.
 *
 *   hostServices        GET  /api/pms/host/services: each of the host's homes
 *                       with every service and the host's live ask on it.
 *   hostAskService      POST /api/pms/host/services: one live ask per home
 *                       and service; asking again is the same ask.
 *   hostWithdrawService POST /api/pms/host/services/withdraw.
 *   officeServiceAsks   the Partner home panel's read (owners only).
 *   answerServiceAsk    an owner's answer: the price and a date, emailed to
 *                       the host from hello@.
 *   closeServiceAsk     settled (booked, or not going ahead); nothing is sent.
 *   waitingServiceAsks  every ask nobody has answered (the home feed's queue
 *                       and /guests/requests).
 *
 * Service role only. Nothing here books, schedules or charges anything.
 */
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { sendFromHello } from '@/lib/partner-host-email';
import { SCA_SITE_ORIGIN } from '@/lib/booking-request-email';
import { hostActor } from '@/lib/partner-host';
import type { HostSession } from '@/lib/partner-host-db';
import {
  LIVE_ASK_STATUSES,
  SERVICE_ASK_COLS,
  hostServicesHome,
  isPartnerService,
  parseServiceAsk,
  parseServiceReply,
  serviceOf,
  serviceReplyEmail,
  type HostServicesHome,
  type ServiceAskRow,
} from '@/lib/partner-host-services';

const TABLE = 'partner_service_asks';
const UNIQUE_VIOLATION = '23505';

function shapeAsk(raw: Record<string, unknown>): ServiceAskRow | null {
  if (!isPartnerService(raw.service)) return null;
  const s = (v: unknown) => (v == null ? null : String(v));
  return {
    id: String(raw.id),
    property_id: String(raw.property_id),
    host_email: String(raw.host_email),
    service: raw.service,
    note: s(raw.note),
    status: String(raw.status) as ServiceAskRow['status'],
    created_at: String(raw.created_at),
    reply: s(raw.reply),
    answered_at: s(raw.answered_at),
    answered_by: s(raw.answered_by),
    host_emailed_at: s(raw.host_emailed_at),
    closed_at: s(raw.closed_at),
    closed_by: s(raw.closed_by),
  };
}

function shapeAll(data: unknown): ServiceAskRow[] {
  return ((data ?? []) as Record<string, unknown>[]).map(shapeAsk).filter((r): r is ServiceAskRow => r != null);
}

// ─── The host ──────────────────────────────────────────────────────────────

export async function hostServices(session: HostSession): Promise<HostServicesHome[]> {
  const ids = session.homes.map((h) => h.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(SERVICE_ASK_COLS)
    .in('property_id', ids)
    .in('status', [...LIVE_ASK_STATUSES])
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`service asks read failed: ${error.message}`);
  const rows = shapeAll(data);
  return session.homes.map((h) => hostServicesHome(h, rows));
}

export type HostServiceWriteResult = { ok: true; message: string } | { ok: false; reason: string; notFound?: boolean };

function homeOf(session: HostSession, rawPropertyId: unknown) {
  return typeof rawPropertyId === 'string' ? session.homes.find((h) => h.id === rawPropertyId) : undefined;
}

const ALREADY_ASKED = 'You asked about that already. We will write back with the price and when we can do it.';

export async function hostAskService(session: HostSession, rawPropertyId: unknown, body: unknown): Promise<HostServiceWriteResult> {
  const home = homeOf(session, rawPropertyId);
  if (!home) return { ok: false, reason: 'That home is not one of yours.', notFound: true };
  const parsed = parseServiceAsk(body);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  // The unique index keeps one live ask per home and service; asking twice is the same ask.
  const { error } = await supabaseAdmin.from(TABLE).insert({
    property_id: home.id,
    host_email: session.email,
    service: parsed.value.service,
    note: parsed.value.note,
    status: 'open',
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: ALREADY_ASKED };
    throw new Error(`service ask insert failed: ${error.message}`);
  }
  return { ok: true, message: `Asked about ${serviceOf(parsed.value.service).phrase}. We will email you the price and when we can do it.` };
}

export async function hostWithdrawService(session: HostSession, rawPropertyId: unknown, rawService: unknown, now: Date = new Date()): Promise<HostServiceWriteResult> {
  const home = homeOf(session, rawPropertyId);
  if (!home) return { ok: false, reason: 'That home is not one of yours.', notFound: true };
  if (!isPartnerService(rawService)) return { ok: false, reason: 'Pick a service to withdraw.' };
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'withdrawn', closed_at: now.toISOString(), closed_by: hostActor(session.email) })
    .eq('property_id', home.id)
    .eq('service', rawService)
    .in('status', [...LIVE_ASK_STATUSES])
    .select('id');
  if (error) throw new Error(`service ask withdraw failed: ${error.message}`);
  if (!data || data.length === 0) return { ok: false, reason: 'Nothing is open to withdraw.' };
  return { ok: true, message: 'Withdrawn.' };
}

// ─── The office ────────────────────────────────────────────────────────────

/** The home's live asks, oldest first: the ones still waiting for an answer lead. */
export async function officeServiceAsks(propertyId: string): Promise<ServiceAskRow[]> {
  if (!isServiceConfigured) return [];
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(SERVICE_ASK_COLS)
    .eq('property_id', propertyId)
    .in('status', [...LIVE_ASK_STATUSES])
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) throw new Error(`service asks read failed: ${error.message}`);
  const rows = shapeAll(data);
  return [...rows.filter((r) => r.status === 'open'), ...rows.filter((r) => r.status === 'answered')];
}

export type OfficeAnswer = { ok: true; note: string } | { ok: false; error: string };

async function askById(id: string): Promise<ServiceAskRow | null> {
  const { data, error } = await supabaseAdmin.from(TABLE).select(SERVICE_ASK_COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(`service ask read failed: ${error.message}`);
  return data ? shapeAsk(data as Record<string, unknown>) : null;
}

async function homeTitle(propertyId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('properties').select('title, name').eq('id', propertyId).maybeSingle();
  const h = data as { title: string | null; name: string | null } | null;
  return h?.title ?? h?.name ?? null;
}

async function tellHost(row: ServiceAskRow, reply: string): Promise<boolean> {
  try {
    const email = serviceReplyEmail(await homeTitle(row.property_id), row.service, reply, SCA_SITE_ORIGIN);
    const sent = await sendFromHello(row.host_email, email, `service-ask:${row.id}:answer`);
    if (sent) await supabaseAdmin.from(TABLE).update({ host_emailed_at: new Date().toISOString() }).eq('id', row.id).is('host_emailed_at', null);
    return sent;
  } catch (err) {
    console.warn('[partner services] host email failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** An owner's answer: stored, then emailed to the host word for word. Once per ask; more goes by email. */
export async function answerServiceAsk(id: string, propertyId: string, by: string, rawReply: unknown, now: Date = new Date()): Promise<OfficeAnswer> {
  const reply = parseServiceReply(rawReply);
  if (!reply.ok) return { ok: false, error: reply.reason };
  const row = await askById(id);
  if (!row || row.property_id !== propertyId) return { ok: false, error: 'That ask is not on this home.' };
  if (row.status !== 'open') return { ok: false, error: 'That ask was already answered. Write to the host by email from here on.' };
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'answered', reply: reply.value, answered_at: now.toISOString(), answered_by: by })
    .eq('id', id)
    .eq('status', 'open')
    .select('id');
  if (error) throw new Error(`service ask answer failed: ${error.message}`);
  if (!data || data.length === 0) return { ok: false, error: 'That ask was already answered or withdrawn.' };
  const told = await tellHost(row, reply.value);
  return { ok: true, note: told ? 'Sent to the host from hello@. Their reply comes to that inbox.' : 'Saved, but the email to the host did not go. Write to them.' };
}

/** Settled, one way or the other. Nothing is sent; the host can ask again later. */
export async function closeServiceAsk(id: string, propertyId: string, by: string, now: Date = new Date()): Promise<OfficeAnswer> {
  const row = await askById(id);
  if (!row || row.property_id !== propertyId) return { ok: false, error: 'That ask is not on this home.' };
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'closed', closed_at: now.toISOString(), closed_by: by })
    .eq('id', id)
    .in('status', [...LIVE_ASK_STATUSES])
    .select('id');
  if (error) throw new Error(`service ask close failed: ${error.message}`);
  if (!data || data.length === 0) return { ok: false, error: 'That ask was already closed or withdrawn.' };
  return { ok: true, note: 'Closed.' };
}

/** Every ask nobody has answered, oldest first. A failed read is an empty list: the queue card simply does not show. */
export async function waitingServiceAsks(): Promise<Array<{ property_id: string; created_at: string }>> {
  if (!isServiceConfigured) return [];
  const { data, error } = await supabaseAdmin.from(TABLE).select('property_id, created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(100);
  if (error) {
    console.warn('[partner services] waiting read failed:', error.message);
    return [];
  }
  return (data ?? []) as Array<{ property_id: string; created_at: string }>;
}
