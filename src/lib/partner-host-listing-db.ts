/**
 * A partner home's listing changes, from the host's ask to the office's
 * answer. The rules are src/lib/partner-host-listing.ts.
 *
 *   hostListing          GET  /api/pms/host/listing: each of the host's homes
 *                        as guests read it, what is waiting, the last answer.
 *   hostProposeListing   POST /api/pms/host/listing: one pending proposal per
 *                        home; a second replaces the first.
 *   hostWithdrawListing  POST /api/pms/host/listing/withdraw.
 *   officeListingProposal  the Partner home panel's read.
 *   approveListingProposal Approve: the changed columns through the listing
 *                        editor's own writer (upsertListingContent), then
 *                        the host is emailed.
 *   declineListingProposal Decline with a reason the host reads.
 *   pendingListingProposals  every home with a change waiting (the home
 *                        feed's queue and /guests/requests).
 *
 * Service role only. Nothing reaches staycapeann.com before Approve.
 */
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { getListingContent, upsertListingContent } from '@/lib/listing-content';
import { sendFromHello } from '@/lib/partner-host-email';
import { SCA_SITE_ORIGIN } from '@/lib/booking-request-email';
import { hostActor } from '@/lib/partner-host';
import type { HostSession } from '@/lib/partner-host-db';
import {
  HOST_LISTING_COLUMNS,
  LISTING_PROPOSAL_COLS,
  approvalPatch,
  changedParts,
  cleanChanges,
  hostColumns,
  hostCopyOf,
  hostListingHome,
  listingApprovedEmail,
  listingDeclinedEmail,
  parseDeclineReason,
  parseHostListingEdit,
  type HostListingColumn,
  type HostListingHome,
  type ListingProposalRow,
} from '@/lib/partner-host-listing';

const TABLE = 'partner_listing_proposals';
const UNIQUE_VIOLATION = '23505';

function shapeProposal(raw: Record<string, unknown>): ListingProposalRow {
  return {
    id: String(raw.id),
    property_id: String(raw.property_id),
    host_email: String(raw.host_email),
    changes: cleanChanges(raw.changes),
    before: cleanChanges(raw.before),
    note: raw.note == null ? null : String(raw.note),
    status: String(raw.status) as ListingProposalRow['status'],
    created_at: String(raw.created_at),
    decided_at: raw.decided_at == null ? null : String(raw.decided_at),
    decided_by: raw.decided_by == null ? null : String(raw.decided_by),
    decline_reason: raw.decline_reason == null ? null : String(raw.decline_reason),
    host_emailed_at: raw.host_emailed_at == null ? null : String(raw.host_emailed_at),
  };
}

// ─── The host ──────────────────────────────────────────────────────────────

export async function hostListing(session: HostSession): Promise<HostListingHome[]> {
  const ids = session.homes.map((h) => h.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(LISTING_PROPOSAL_COLS)
    .in('property_id', ids)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`listing proposals read failed: ${error.message}`);
  const rows = ((data ?? []) as Record<string, unknown>[]).map(shapeProposal);
  return Promise.all(
    session.homes.map(async (h) => {
      const [content, title] = await Promise.all([getListingContent(h.id), homeTitle(h.id)]);
      const mine = rows.filter((r) => r.property_id === h.id);
      const pending = mine.find((r) => r.status === 'pending') ?? null;
      const decided = mine.find((r) => r.status === 'approved' || r.status === 'declined') ?? null;
      return hostListingHome(h, hostCopyOf(content, title), pending, decided);
    }),
  );
}

export type HostListingWriteResult = { ok: true; message: string } | { ok: false; reason: string; notFound?: boolean };

function homeOf(session: HostSession, rawPropertyId: unknown) {
  return typeof rawPropertyId === 'string' ? session.homes.find((h) => h.id === rawPropertyId) : undefined;
}

export async function hostProposeListing(session: HostSession, rawPropertyId: unknown, body: unknown, now: Date = new Date()): Promise<HostListingWriteResult> {
  const home = homeOf(session, rawPropertyId);
  if (!home) return { ok: false, reason: 'That home is not one of yours.', notFound: true };
  const [content, title] = await Promise.all([getListingContent(home.id), homeTitle(home.id)]);
  const live = hostCopyOf(content, title);
  const parsed = parseHostListingEdit(body, live);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const actor = hostActor(session.email);

  const row = {
    property_id: home.id,
    host_email: session.email,
    changes: parsed.value.changes,
    before: parsed.value.before,
    note: parsed.value.note,
    status: 'pending',
  };
  // A second ask replaces the first; the unique index keeps one pending per home.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error: replaceError } = await supabaseAdmin
      .from(TABLE)
      .update({ status: 'replaced', decided_at: now.toISOString(), decided_by: actor })
      .eq('property_id', home.id)
      .eq('status', 'pending');
    if (replaceError) throw new Error(`listing proposal replace failed: ${replaceError.message}`);
    const { error } = await supabaseAdmin.from(TABLE).insert(row);
    if (!error) {
      return { ok: true, message: 'Sent. We read every change before guests see it, and we will email you when it is live.' };
    }
    if (error.code !== UNIQUE_VIOLATION) throw new Error(`listing proposal insert failed: ${error.message}`);
  }
  throw new Error('listing proposal insert kept colliding');
}

export async function hostWithdrawListing(session: HostSession, rawPropertyId: unknown, now: Date = new Date()): Promise<HostListingWriteResult> {
  const home = homeOf(session, rawPropertyId);
  if (!home) return { ok: false, reason: 'That home is not one of yours.', notFound: true };
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'withdrawn', decided_at: now.toISOString(), decided_by: hostActor(session.email) })
    .eq('property_id', home.id)
    .eq('status', 'pending')
    .select('id');
  if (error) throw new Error(`listing proposal withdraw failed: ${error.message}`);
  if (!data || data.length === 0) return { ok: false, reason: 'Nothing is waiting to withdraw.' };
  return { ok: true, message: 'Withdrawn. Your listing reads as it did.' };
}

// ─── The office ────────────────────────────────────────────────────────────

export type OfficeListingProposal = {
  proposal: ListingProposalRow;
  /** Each changed column as the listing reads now, and whether it moved since the host sent it. */
  fields: Array<{ column: HostListingColumn; now: string | null; proposed: string | null; movedSince: boolean }>;
};

export async function officeListingProposal(propertyId: string): Promise<OfficeListingProposal | null> {
  if (!isServiceConfigured) return null;
  const { data, error } = await supabaseAdmin.from(TABLE).select(LISTING_PROPOSAL_COLS).eq('property_id', propertyId).eq('status', 'pending').maybeSingle();
  if (error) throw new Error(`listing proposal read failed: ${error.message}`);
  if (!data) return null;
  const proposal = shapeProposal(data as Record<string, unknown>);
  const [content, title] = await Promise.all([getListingContent(propertyId), homeTitle(propertyId)]);
  const current: Record<HostListingColumn, string | null> = {
    title: content?.title ?? null,
    summary: content?.summary ?? null,
    space: content?.space ?? null,
    neighborhood: content?.neighborhood ?? null,
  };
  // Compared the way the host's form wrote them, so a bullet style or a trailing space is not a change.
  const live = hostColumns(hostCopyOf(content, title));
  const fields = HOST_LISTING_COLUMNS.filter((c) => c in proposal.changes).map((column) => ({
    column,
    now: current[column],
    proposed: proposal.changes[column] ?? null,
    movedSince: column in proposal.before && (proposal.before[column] ?? '') !== (live[column] ?? ''),
  }));
  return { proposal, fields };
}

export type OfficeDecision = { ok: true; note: string } | { ok: false; error: string };

async function pendingById(id: string): Promise<ListingProposalRow | null> {
  const { data, error } = await supabaseAdmin.from(TABLE).select(LISTING_PROPOSAL_COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(`listing proposal read failed: ${error.message}`);
  return data ? shapeProposal(data as Record<string, unknown>) : null;
}

async function homeTitle(propertyId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('properties').select('title, name').eq('id', propertyId).maybeSingle();
  const h = data as { title: string | null; name: string | null } | null;
  return h?.title ?? h?.name ?? null;
}

async function tellHost(row: ListingProposalRow, decision: 'approved' | 'declined', reason: string | null): Promise<boolean> {
  try {
    const title = await homeTitle(row.property_id);
    const parts = changedParts(row.changes);
    const email = decision === 'approved' ? listingApprovedEmail(title, parts, SCA_SITE_ORIGIN) : listingDeclinedEmail(title, parts, reason ?? '', SCA_SITE_ORIGIN);
    const sent = await sendFromHello(row.host_email, email, `listing-proposal:${row.id}:${decision}`);
    if (sent) await supabaseAdmin.from(TABLE).update({ host_emailed_at: new Date().toISOString() }).eq('id', row.id).is('host_emailed_at', null);
    return sent;
  } catch (err) {
    console.warn('[partner listing] host email failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** The changed columns go live through the listing editor's own writer, then the host hears. */
export async function approveListingProposal(id: string, propertyId: string, by: string, now: Date = new Date()): Promise<OfficeDecision> {
  const row = await pendingById(id);
  if (!row || row.property_id !== propertyId) return { ok: false, error: 'That change is not on this home.' };
  if (row.status !== 'pending') return { ok: false, error: 'That change was already answered.' };
  const patch = approvalPatch(row.property_id, row.changes);
  if (Object.keys(patch).length <= 1) return { ok: false, error: 'That change has nothing in it.' };
  await upsertListingContent(patch, by);
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'approved', decided_at: now.toISOString(), decided_by: by })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) throw new Error(`listing proposal approve failed: ${error.message}`);
  if (!data || data.length === 0) return { ok: true, note: 'Live on staycapeann.com. It had already been answered, so the host was not emailed again.' };
  const told = await tellHost(row, 'approved', null);
  return { ok: true, note: told ? 'Live on staycapeann.com, and the host was emailed.' : 'Live on staycapeann.com. The email to the host did not go; let them know.' };
}

export async function declineListingProposal(id: string, propertyId: string, by: string, rawReason: unknown, now: Date = new Date()): Promise<OfficeDecision> {
  const reason = parseDeclineReason(rawReason);
  if (!reason.ok) return { ok: false, error: reason.reason };
  const row = await pendingById(id);
  if (!row || row.property_id !== propertyId) return { ok: false, error: 'That change is not on this home.' };
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'declined', decided_at: now.toISOString(), decided_by: by, decline_reason: reason.value })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (error) throw new Error(`listing proposal decline failed: ${error.message}`);
  if (!data || data.length === 0) return { ok: false, error: 'That change was already answered.' };
  const told = await tellHost(row, 'declined', reason.value);
  return { ok: true, note: told ? 'Declined, and the host was emailed why.' : 'Declined. The email to the host did not go; let them know.' };
}

/** Every home with a change waiting, oldest first. A failed read is an empty list: the queue card simply does not show. */
export async function pendingListingProposals(): Promise<Array<{ property_id: string; created_at: string }>> {
  if (!isServiceConfigured) return [];
  const { data, error } = await supabaseAdmin.from(TABLE).select('property_id, created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(100);
  if (error) {
    console.warn('[partner listing] pending read failed:', error.message);
    return [];
  }
  return (data ?? []) as Array<{ property_id: string; created_at: string }>;
}
