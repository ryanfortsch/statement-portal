import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { renderOperatorNote } from '@/lib/cleaner-note';
import { listScheduleRecipients } from '@/lib/cleaner-digest';
import type { ScheduleRecipient } from '@/lib/cleaner-digest-core';
import { CAPE_ANN_REGION } from '@/lib/property-scope';
import { quoFromNumber } from '@/lib/quo-lines';
import { sendMessage } from '@/lib/quo';
import {
  composeCleaningNotice,
  needsCleaningNotice,
  parseStars,
  STUCK_CLAIM_MS,
  type CleaningReviewCardData,
  type CleaningReviewRow,
} from '@/lib/cleaning-reviews-core';

/**
 * Cleaning reviews, the writer and the reads (docs/cleaning-reviews.md,
 * 2026-11-07).
 *
 *   - `saveCleaningReview` is called once, by completeInspection, with what the
 *     inspector answered on the review screen. It stores the stars and, at
 *     CLEANING_FLAG_MAX or below, renders the crew note and files it PENDING.
 *     It never texts.
 *   - `approveCleaningReview` is the ONE sender: a signed-in operator's tap on
 *     the Team inbox card. It claims the row, reads the cleaner schedule's
 *     enabled recipients for the home's region, and sends each their own
 *     language on the Rising Tide line. cleaning-review-guard.test.ts reads
 *     this file to keep sendMessage out of every other path.
 *
 * Every read tolerates the table not existing yet (NOT_MIGRATED), so the
 * deploy and the migration can land in either order.
 */

const NOT_MIGRATED = new Set(['42P01', '42703', 'PGRST205']);

function notMigrated(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && NOT_MIGRATED.has(error.code);
}

export type SaveCleaningReviewInput = {
  inspectionId: string;
  propertyId: string;
  inspectorEmail: string;
  inspectorName: string;
  /** Eastern calendar day of the walk, YYYY-MM-DD. */
  walkDate: string;
  stars: number;
  reason?: string | null;
  photoUrls?: string[] | null;
};

/**
 * Store the inspector's answer. Idempotent per walk: a Complete that retries
 * rewrites the same row. Returns the row, or null when the table is not there
 * yet (the walk still completes; the rating is the one thing lost, and the
 * log says so).
 */
export async function saveCleaningReview(input: SaveCleaningReviewInput): Promise<CleaningReviewRow | null> {
  const stars = parseStars(input.stars);
  if (!stars) throw new Error('Pick 1 to 5 stars for the clean.');
  const reason = (input.reason ?? '').trim().slice(0, 600);
  const photoUrls = (input.photoUrls ?? []).filter((u) => typeof u === 'string' && u.length > 0).slice(0, 10);

  let notice: { pt: string | null; en: string | null; translated: boolean; status: 'none' | 'pending' } = {
    pt: null,
    en: null,
    translated: false,
    status: 'none',
  };
  if (needsCleaningNotice(stars)) {
    const home = await propertyName(input.propertyId);
    const rendered = reason ? await renderOperatorNote(reason) : { pt: '', en: '', translated: true, raw: '' };
    const text = composeCleaningNotice({
      home,
      walkDate: input.walkDate,
      stars,
      reasonPt: rendered.pt,
      reasonEn: rendered.en,
      photoUrls,
    });
    notice = { pt: text.pt, en: text.en, translated: rendered.translated, status: 'pending' };
  }

  const { data, error } = await supabaseAdmin
    .from('cleaning_reviews')
    .upsert(
      {
        inspection_id: input.inspectionId,
        property_id: input.propertyId,
        inspector_email: input.inspectorEmail,
        inspector_name: input.inspectorName,
        walk_date: input.walkDate,
        stars,
        reason: reason || null,
        photo_urls: photoUrls,
        notice_status: notice.status,
        notice_pt: notice.pt,
        notice_en: notice.en,
        notice_translated: notice.translated,
      },
      { onConflict: 'inspection_id' },
    )
    .select('*')
    .maybeSingle();
  if (error) {
    if (notMigrated(error)) {
      console.warn('[cleaning-reviews] table missing; rating dropped', input.inspectionId);
      return null;
    }
    throw new Error(`cleaning_reviews: ${error.message}`);
  }
  return (data as CleaningReviewRow | null) ?? null;
}

async function propertyName(propertyId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('properties').select('name').eq('id', propertyId).maybeSingle();
  return (data as { name: string } | null)?.name ?? propertyId;
}

async function propertyRegion(propertyId: string): Promise<string> {
  const { data } = await supabaseAdmin.from('properties').select('region').eq('id', propertyId).maybeSingle();
  return (data as { region: string | null } | null)?.region || CAPE_ANN_REGION;
}

/** The schedule recipients a note for this home would reach: enabled, in the
 *  home's region, and either fleet-wide ('{}') or mapped to the home. */
async function recipientsFor(propertyId: string): Promise<ScheduleRecipient[]> {
  const region = await propertyRegion(propertyId);
  const all = await listScheduleRecipients(supabaseAdmin, region);
  return all.filter((r) => r.enabled && (r.property_ids.length === 0 || r.property_ids.includes(propertyId)));
}

async function readRow(id: string): Promise<CleaningReviewRow | null> {
  const { data, error } = await supabaseAdmin.from('cleaning_reviews').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`cleaning_reviews: ${error.message}`);
  return (data as CleaningReviewRow | null) ?? null;
}

/** Every row whose note is waiting, newest first. Empty before the migration. */
async function loadWaiting(): Promise<CleaningReviewRow[]> {
  return selectAllPaged<CleaningReviewRow>(
    async (from, to) => {
      const result = await supabaseAdmin
        .from('cleaning_reviews')
        .select('*')
        .in('notice_status', ['pending', 'approving'])
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to);
      if (result.error && notMigrated(result.error)) return { data: [], error: null };
      return result;
    },
    { label: 'Cleaning reviews' },
  );
}

/** Pending notes, for the Team pill and the kinds line. Null when unreadable. */
export async function countPendingCleaningReviews(): Promise<number | null> {
  try {
    return (await loadWaiting()).length;
  } catch {
    return null;
  }
}

/** The waiting notes, ready for the card. */
export async function loadCleaningReviewCards(now: Date = new Date()): Promise<CleaningReviewCardData[]> {
  const rows = await loadWaiting();
  if (rows.length === 0) return [];
  const propertyIds = [...new Set(rows.map((r) => r.property_id))];
  const { data: props, error } = await supabaseAdmin.from('properties').select('id, name, region').in('id', propertyIds);
  if (error) throw new Error('The homes for these reviews could not be read. Try again.');
  const homes = new Map(((props ?? []) as { id: string; name: string; region: string | null }[]).map((p) => [p.id, p]));
  const regions = [...new Set([...homes.values()].map((p) => p.region || CAPE_ANN_REGION))];
  const recipientsByRegion = new Map<string, ScheduleRecipient[]>();
  for (const region of regions) {
    recipientsByRegion.set(region, (await listScheduleRecipients(supabaseAdmin, region)).filter((r) => r.enabled));
  }
  const staleBefore = now.getTime() - STUCK_CLAIM_MS;
  return rows.map((r) => {
    const home = homes.get(r.property_id);
    const region = home?.region || CAPE_ANN_REGION;
    const recipients = (recipientsByRegion.get(region) ?? []).filter(
      (x) => x.property_ids.length === 0 || x.property_ids.includes(r.property_id),
    );
    return {
      id: r.id,
      status: r.notice_status === 'approving' ? 'approving' : 'pending',
      stuck: r.notice_status === 'approving' && !!r.claimed_at && Date.parse(r.claimed_at) < staleBefore,
      inspectorName: r.inspector_name,
      propertyId: r.property_id,
      propertyName: home?.name ?? r.property_id,
      walkDate: r.walk_date,
      stars: r.stars,
      reason: r.reason ?? '',
      photoUrls: r.photo_urls ?? [],
      pt: r.notice_pt ?? '',
      en: r.notice_en ?? '',
      translated: r.notice_translated,
      createdAt: r.created_at,
      ageMinutes: Math.max(0, Math.round((now.getTime() - Date.parse(r.created_at)) / 60_000)),
      lastError: r.last_error,
      recipients: recipients.map((x) => x.display_name),
    };
  });
}

export type ReviewActionResult = { ok: true; message?: string } | { ok: false; error: string; stale?: boolean };

/** The pending row, claimed for this approve, or null when someone else got
 *  there first. A claim older than five minutes may be taken over. */
async function claim(id: string): Promise<CleaningReviewRow | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STUCK_CLAIM_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('cleaning_reviews')
    .update({ notice_status: 'approving', claimed_at: now.toISOString(), last_error: null })
    .eq('id', id)
    .or(`notice_status.eq.pending,and(notice_status.eq.approving,claimed_at.lt.${staleBefore})`)
    .select('*');
  if (error) throw new Error(`claim: ${error.message}`);
  return ((data ?? []) as CleaningReviewRow[])[0] ?? null;
}

async function release(id: string, lastError: string | null): Promise<void> {
  await supabaseAdmin
    .from('cleaning_reviews')
    .update({ notice_status: 'pending', claimed_at: null, last_error: lastError })
    .eq('id', id)
    .eq('notice_status', 'approving');
}

/**
 * Approve: send the note. The one place a cleaning review reaches a phone.
 * Each recipient gets the text in their own language, from the Rising Tide
 * line. A send that reaches nobody releases the claim and says why.
 */
export async function approveCleaningReview(id: string, operatorEmail: string): Promise<ReviewActionResult> {
  const row = await claim(id);
  if (!row) {
    const current = await readRow(id);
    if (!current) return { ok: false, error: 'This review is gone.', stale: true };
    if (current.notice_status === 'sent') return { ok: false, error: 'Already sent.', stale: true };
    if (current.notice_status === 'handled') return { ok: false, error: 'Already handled.', stale: true };
    return { ok: false, error: 'Someone else is sending this one.', stale: true };
  }
  if (!row.notice_pt && !row.notice_en) {
    await release(id, 'No text to send.');
    return { ok: false, error: 'There is no text to send. Edit the note first.' };
  }
  if (!process.env.QUO_API_KEY) {
    await release(id, 'Texting is not set up.');
    return { ok: false, error: 'Texting is not set up. Ask Ryan: Quo API key.' };
  }
  const recipients = await recipientsFor(row.property_id);
  if (recipients.length === 0) {
    await release(id, 'No schedule recipient for this home.');
    return { ok: false, error: 'No cleaner on the schedule list for this home. Add one under Cleaner settings.' };
  }
  const from = quoFromNumber('ops');
  const log: Array<{ phone: string; name: string; language: string; ok: boolean; id?: string; error?: string }> = [];
  for (const r of recipients) {
    const content = (r.language === 'en' ? row.notice_en : row.notice_pt) || row.notice_pt || row.notice_en || '';
    try {
      const msg = await sendMessage({ from, to: r.phone, content });
      log.push({ phone: r.phone, name: r.display_name, language: r.language, ok: true, id: msg.id });
    } catch (err) {
      log.push({
        phone: r.phone,
        name: r.display_name,
        language: r.language,
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
      });
    }
  }
  const sent = log.filter((l) => l.ok);
  if (sent.length === 0) {
    await release(id, log[0]?.error ?? 'Every send failed.');
    return { ok: false, error: `The text did not go out: ${log[0]?.error ?? 'send failed'}` };
  }
  const now = new Date().toISOString();
  await supabaseAdmin
    .from('cleaning_reviews')
    .update({ notice_status: 'sent', sent_at: now, sent_log: log, decided_by: operatorEmail, decided_at: now, last_error: null })
    .eq('id', id)
    .eq('notice_status', 'approving');
  const failed = log.filter((l) => !l.ok);
  const names = sent.map((l) => l.name).join(', ');
  return {
    ok: true,
    message: failed.length ? `Texted ${names}. ${failed.map((l) => l.name).join(', ')} did not get it.` : `Texted ${names}.`,
  };
}

/**
 * Edit: the operator's own words become the Portuguese that sends, verbatim.
 * The English beside it is remade from the edited text so the check still
 * reads true; a model failure leaves the edit standing with the same words
 * on both sides.
 */
export async function editCleaningNotice(id: string, text: string): Promise<ReviewActionResult> {
  const pt = text.trim().slice(0, 1200);
  if (!pt) return { ok: false, error: 'Write the note first.' };
  const rendered = await renderOperatorNote(pt);
  const { data, error } = await supabaseAdmin
    .from('cleaning_reviews')
    .update({ notice_pt: pt, notice_en: rendered.translated ? rendered.en : pt, notice_translated: rendered.translated })
    .eq('id', id)
    .in('notice_status', ['pending', 'approving'])
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'This review already moved on.', stale: true };
  return { ok: true };
}

export async function markCleaningReviewHandled(id: string, reason: string | undefined, operatorEmail: string): Promise<ReviewActionResult> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('cleaning_reviews')
    .update({ notice_status: 'handled', handled_reason: reason?.trim() || null, decided_by: operatorEmail, decided_at: now, claimed_at: null })
    .eq('id', id)
    .in('notice_status', ['pending', 'approving'])
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'This review already moved on.', stale: true };
  return { ok: true };
}

/** Undo a Mark handled: the note waits again. A sent text cannot be unsent. */
export async function undoCleaningReviewHandled(id: string): Promise<ReviewActionResult> {
  const { data, error } = await supabaseAdmin
    .from('cleaning_reviews')
    .update({ notice_status: 'pending', handled_reason: null, decided_by: null, decided_at: null })
    .eq('id', id)
    .eq('notice_status', 'handled')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'Nothing to undo.', stale: true };
  return { ok: true };
}

/** An inspector's rated walks, newest first, by any address they have
 *  walked under. Empty before the migration. */
export async function loadInspectorCleaningReviews(emails: string[], sinceYmd?: string): Promise<CleaningReviewRow[]> {
  const list = emails.map((e) => e.toLowerCase().trim()).filter(Boolean);
  if (list.length === 0) return [];
  return selectAllPaged<CleaningReviewRow>(
    async (from, to) => {
      let q = supabaseAdmin.from('cleaning_reviews').select('*').in('inspector_email', list);
      if (sinceYmd) q = q.gte('walk_date', sinceYmd);
      const result = await q.order('walk_date', { ascending: false }).order('id').range(from, to);
      if (result.error && notMigrated(result.error)) return { data: [], error: null };
      return result;
    },
    { label: 'Inspector cleaning reviews' },
  );
}

/** The rating stored for one walk, if any. */
export async function loadCleaningReviewForInspection(inspectionId: string): Promise<CleaningReviewRow | null> {
  const { data, error } = await supabaseAdmin.from('cleaning_reviews').select('*').eq('inspection_id', inspectionId).maybeSingle();
  if (error) {
    if (notMigrated(error)) return null;
    throw new Error(`cleaning_reviews: ${error.message}`);
  }
  return (data as CleaningReviewRow | null) ?? null;
}
