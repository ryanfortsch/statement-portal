/**
 * Host applications to list on staycapeann.com, from the form to an owner's
 * Add or Decline. The rules are src/lib/partner-applications.ts.
 *
 *   submitPartnerApplication  POST /api/pms/apply: one new application per
 *                             email and address; applying again is the same.
 *   newApplications           /guests/requests' read (owners only).
 *   addFromApplication        an owner adds the home: the application is
 *                             claimed first, then the home is made by
 *                             createPartnerHome, so two clicks make one home.
 *   declineApplication        an owner declines; the reason is the office's.
 *   waitingApplications       the home feed's queue line.
 *
 * Service role only. Nothing here sends anything: the office writes to the
 * host itself.
 */
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { createPartnerHome } from '@/lib/partner-listing-db';
import {
  APPLICATION_COLS,
  APPLICATION_RECEIVED,
  homeFromApplication,
  isListedOn,
  isRunBy,
  parseDeclineReason,
  parsePartnerApplication,
  type ApplicationRow,
} from '@/lib/partner-applications';

const TABLE = 'partner_applications';
const UNIQUE_VIOLATION = '23505';

function shapeApplication(raw: Record<string, unknown>): ApplicationRow | null {
  if (!isRunBy(raw.run_by)) return null;
  const s = (v: unknown) => (v == null ? null : String(v));
  const status = String(raw.status);
  if (status !== 'new' && status !== 'added' && status !== 'declined') return null;
  return {
    id: String(raw.id),
    created_at: String(raw.created_at),
    name: String(raw.name),
    email: String(raw.email),
    phone: s(raw.phone),
    address: String(raw.address),
    city: String(raw.city),
    bedrooms: typeof raw.bedrooms === 'number' ? raw.bedrooms : null,
    listed_on: Array.isArray(raw.listed_on) ? raw.listed_on.filter(isListedOn) : [],
    run_by: raw.run_by,
    note: s(raw.note),
    status,
    property_id: s(raw.property_id),
    decided_at: s(raw.decided_at),
    decided_by: s(raw.decided_by),
    decline_reason: s(raw.decline_reason),
  };
}

export type SubmitResult = { ok: true; message: string } | { ok: false; reason: string; invalid?: boolean };

/** The site's form. A second application for the same home and email answers as the first did. */
export async function submitPartnerApplication(body: unknown): Promise<SubmitResult> {
  const parsed = parsePartnerApplication(body);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, invalid: true };
  if (!isServiceConfigured) return { ok: false, reason: 'unavailable' };
  const { error } = await supabaseAdmin.from(TABLE).insert({ ...parsed.value, status: 'new' });
  if (error && error.code !== UNIQUE_VIOLATION) throw new Error(`partner application insert failed: ${error.message}`);
  return { ok: true, message: APPLICATION_RECEIVED };
}

/** Every application nobody has decided, oldest first. */
export async function newApplications(): Promise<ApplicationRow[]> {
  if (!isServiceConfigured) return [];
  const { data, error } = await supabaseAdmin.from(TABLE).select(APPLICATION_COLS).eq('status', 'new').order('created_at', { ascending: true }).limit(100);
  if (error) throw new Error(`partner applications read failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(shapeApplication).filter((r): r is ApplicationRow => r != null);
}

export type ApplicationDecision = { ok: true; id?: string; note: string } | { ok: false; error: string };

async function applicationById(id: string): Promise<ApplicationRow | null> {
  const { data, error } = await supabaseAdmin.from(TABLE).select(APPLICATION_COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(`partner application read failed: ${error.message}`);
  return data ? shapeApplication(data as Record<string, unknown>) : null;
}

/** Make the home. The application is claimed before the home is made, and handed back if the home is not. */
export async function addFromApplication(id: string, by: string, now: Date = new Date()): Promise<ApplicationDecision> {
  const app = await applicationById(id);
  if (!app) return { ok: false, error: 'That application is gone.' };
  if (app.status !== 'new') return { ok: false, error: 'That application was already decided.' };
  const home = homeFromApplication(app);
  if (!home.ok) return { ok: false, error: `${home.error} Add the home by hand instead.` };

  const claimed = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'added', decided_at: now.toISOString(), decided_by: by })
    .eq('id', id)
    .eq('status', 'new')
    .select('id');
  if (claimed.error) throw new Error(`partner application claim failed: ${claimed.error.message}`);
  if (!claimed.data || claimed.data.length === 0) return { ok: false, error: 'That application was already decided.' };

  const made = await createPartnerHome(home.home, by);
  if (!made.ok) {
    await supabaseAdmin.from(TABLE).update({ status: 'new', decided_at: null, decided_by: null }).eq('id', id).eq('status', 'added').is('property_id', null);
    return { ok: false, error: made.reason };
  }
  const linked = await supabaseAdmin.from(TABLE).update({ property_id: made.id }).eq('id', id);
  if (linked.error) console.error('[partner applications] link failed', id, made.id, linked.error.message);
  return { ok: true, id: made.id, note: 'Added. Build the listing on its page, then write to the host.' };
}

/** Not for us. The reason stays in Helm; nothing is sent. */
export async function declineApplication(id: string, by: string, rawReason: unknown, now: Date = new Date()): Promise<ApplicationDecision> {
  const reason = parseDeclineReason(rawReason);
  if (!reason.ok) return { ok: false, error: reason.reason };
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'declined', decided_at: now.toISOString(), decided_by: by, decline_reason: reason.value })
    .eq('id', id)
    .eq('status', 'new')
    .select('id');
  if (error) throw new Error(`partner application decline failed: ${error.message}`);
  if (!data || data.length === 0) return { ok: false, error: 'That application was already decided.' };
  return { ok: true, note: 'Declined. Nothing was sent; write to them if you want to.' };
}

/** The towns of every application nobody has decided. A failed read is an empty list: the queue line simply does not show. */
export async function waitingApplications(): Promise<Array<{ city: string }>> {
  if (!isServiceConfigured) return [];
  const { data, error } = await supabaseAdmin.from(TABLE).select('city').eq('status', 'new').order('created_at', { ascending: true }).limit(100);
  if (error) {
    console.warn('[partner applications] waiting read failed:', error.message);
    return [];
  }
  return (data ?? []) as Array<{ city: string }>;
}
