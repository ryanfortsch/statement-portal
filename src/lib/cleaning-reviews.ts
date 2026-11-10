import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { renderOperatorNote } from '@/lib/cleaner-note';
import { listScheduleRecipients } from '@/lib/cleaner-digest';
import type { ScheduleRecipient } from '@/lib/cleaner-digest-core';
import { CAPE_ANN_REGION } from '@/lib/property-scope';
import { sendTransactionalViaResend } from '@/lib/resend';
import { cleaningReviewCopy, cleaningReviewReplyTo, cleaningReviewSender, todayET } from '@/lib/team-recipients';
import { getTeamMember } from '@/lib/team';
import {
  composeWeeklyEmail,
  needsCleaningNotice,
  parseStars,
  reportWeekEnd,
  STUCK_CLAIM_MS,
  weeklyAverage,
  weeklyEmailHtml,
  type CleaningReviewCardData,
  type CleaningReviewRow,
  type ReportStatus,
} from '@/lib/cleaning-reviews-core';

/**
 * Cleaning reviews, the writer and the reads (docs/cleaning-reviews.md;
 * per-walk 2026-11-07, weekly email 2026-11-10).
 *
 *   - `saveCleaningReview` is called once, by completeInspection, with what the
 *     inspector answered on the review screen. It stores the stars, the reason
 *     and the photos. It never sends anything and files nothing for the crew.
 *   - `draftWeeklyCleaningReport` is the Friday cron's one step: every rating
 *     not yet in a report, through Thursday, becomes ONE email, filed PENDING
 *     on the Team inbox. It never sends.
 *   - `approveCleaningReview` is the ONE sender: a signed-in operator's tap on
 *     that card. It claims the report and emails each enabled schedule
 *     recipient with an email on file, in their own language.
 *     cleaning-review-guard.test.ts reads this file to keep the send out of
 *     every other path.
 *
 * Every read tolerates the tables and columns not existing yet (NOT_MIGRATED),
 * so the deploy and the migration can land in either order.
 */

const NOT_MIGRATED = new Set(['42P01', '42703', 'PGRST205', 'PGRST200']);

function notMigrated(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && NOT_MIGRATED.has(error.code);
}

/** How far back a Friday draft reaches for ratings no report has carried:
 *  two weeks, so a skipped Friday is caught up rather than lost. */
const LOOKBACK_DAYS = 13;

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
 * rewrites the same row, and leaves the report it rode in (if any) alone.
 * Returns the row, or null when the table is not there yet (the walk still
 * completes; the rating is the one thing lost, and the log says so).
 */
export async function saveCleaningReview(input: SaveCleaningReviewInput): Promise<CleaningReviewRow | null> {
  const stars = parseStars(input.stars);
  if (!stars) throw new Error('Pick 1 to 5 stars for the clean.');
  const reason = (input.reason ?? '').trim().slice(0, 600);
  const photoUrls = (input.photoUrls ?? []).filter((u) => typeof u === 'string' && u.length > 0).slice(0, 10);

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

type Home = { id: string; name: string; region: string | null };

async function loadHomes(ids: string[]): Promise<Map<string, Home>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabaseAdmin.from('properties').select('id, name, region').in('id', ids);
  if (error) throw new Error('The homes for these reviews could not be read. Try again.');
  return new Map(((data ?? []) as Home[]).map((p) => [p.id, p]));
}

/** Each schedule recipient's email, by phone. Empty before the migration
 *  adds the column, which reads as "no email on file". */
async function recipientEmails(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin.from('cleaner_schedule_recipients').select('phone, email');
  if (error) {
    if (notMigrated(error)) return new Map();
    throw new Error('The crew list could not be read. Try again.');
  }
  const out = new Map<string, string>();
  for (const r of (data ?? []) as Array<{ phone: string; email: string | null }>) {
    const email = (r.email ?? '').trim();
    if (email.includes('@')) out.set(r.phone, email);
  }
  return out;
}

type Audience = {
  /** Enabled crew covering these homes, with an email on file. */
  to: Array<ScheduleRecipient & { email: string }>;
  /** Enabled crew covering these homes, with none. */
  missingEmail: string[];
  /** The first reader's language: what the card shows and Edit rewrites. */
  language: 'pt' | 'en';
};

/** Who a week's email reaches: the enabled schedule recipients in the homes'
 *  regions who serve every home ('{}') or at least one of them. */
async function audienceFor(homes: Home[]): Promise<Audience> {
  const regions = new Set(homes.map((h) => h.region || CAPE_ANN_REGION));
  const ids = new Set(homes.map((h) => h.id));
  const [all, emails] = await Promise.all([listScheduleRecipients(supabaseAdmin), recipientEmails()]);
  const covering = all.filter(
    (r) => r.enabled && regions.has(r.region || CAPE_ANN_REGION) && (r.property_ids.length === 0 || r.property_ids.some((p) => ids.has(p))),
  );
  const to = covering.flatMap((r) => {
    const email = emails.get(r.phone);
    return email ? [{ ...r, email }] : [];
  });
  return {
    to,
    missingEmail: covering.filter((r) => !emails.has(r.phone)).map((r) => r.display_name),
    language: to[0]?.language === 'en' ? 'en' : 'pt',
  };
}

export type CleaningReportRow = {
  id: string;
  week_end: string;
  first_walk: string | null;
  review_count: number;
  status: ReportStatus;
  subject_pt: string;
  subject_en: string;
  body_pt: string;
  body_en: string;
  edited: boolean;
  claimed_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  handled_reason: string | null;
  sent_at: string | null;
  sent_to: string[];
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type DraftReportResult =
  | { status: 'drafted'; id: string; weekEnd: string; count: number }
  | { status: 'exists' | 'empty' | 'not_migrated'; weekEnd: string };

/**
 * Friday's draft. Every rating no report has carried, walked through the day
 * before `today`, becomes one email filed pending on the Team inbox.
 * Idempotent per week: a second run that day finds the row and stops. It
 * never sends; only Approve does.
 */
export async function draftWeeklyCleaningReport(today: string = todayET()): Promise<DraftReportResult> {
  const weekEnd = reportWeekEnd(today);
  const existing = await supabaseAdmin.from('cleaning_review_reports').select('id').eq('week_end', weekEnd).maybeSingle();
  if (existing.error) {
    if (notMigrated(existing.error)) return { status: 'not_migrated', weekEnd };
    throw new Error(`cleaning_review_reports: ${existing.error.message}`);
  }
  if (existing.data) return { status: 'exists', weekEnd };

  const since = addDays(weekEnd, -LOOKBACK_DAYS);
  const rows = await selectAllPaged<CleaningReviewRow>(
    async (from, to) =>
      supabaseAdmin
        .from('cleaning_reviews')
        .select('*')
        .is('report_id', null)
        .gte('walk_date', since)
        .lte('walk_date', weekEnd)
        .order('walk_date')
        .order('id')
        .range(from, to),
    { label: 'Cleaning reviews for the weekly email' },
  );
  if (rows.length === 0) return { status: 'empty', weekEnd };

  const homes = await loadHomes([...new Set(rows.map((r) => r.property_id))]);
  // Each reason through the same pass the schedule's note line gets. It
  // falls back to the words as typed, so a model outage never drops one.
  const cleans = await Promise.all(
    rows.map(async (r) => {
      const flagged = needsCleaningNotice(r.stars);
      const rendered = flagged && r.reason ? await renderOperatorNote(r.reason) : { pt: '', en: '' };
      return {
        home: homes.get(r.property_id)?.name ?? r.property_id,
        walkDate: r.walk_date,
        stars: r.stars,
        reasonPt: rendered.pt,
        reasonEn: rendered.en,
        photoUrls: flagged ? (r.photo_urls ?? []) : [],
      };
    }),
  );
  const firstWalk = rows[0].walk_date;
  const email = composeWeeklyEmail({ firstWalk, weekEnd, cleans });

  const inserted = await supabaseAdmin
    .from('cleaning_review_reports')
    .insert({
      week_end: weekEnd,
      first_walk: firstWalk,
      review_count: rows.length,
      status: 'pending',
      subject_pt: email.subjectPt,
      subject_en: email.subjectEn,
      body_pt: email.pt,
      body_en: email.en,
    })
    .select('id')
    .single();
  if (inserted.error) {
    // A second Friday run that raced this one.
    if (inserted.error.code === '23505') return { status: 'exists', weekEnd };
    throw new Error(`cleaning_review_reports: ${inserted.error.message}`);
  }
  const id = (inserted.data as { id: string }).id;
  const stamped = await supabaseAdmin
    .from('cleaning_reviews')
    .update({ report_id: id })
    .in('id', rows.map((r) => r.id))
    .is('report_id', null);
  if (stamped.error) throw new Error(`The email was drafted but its ratings were not marked: ${stamped.error.message}`);
  return { status: 'drafted', id, weekEnd, count: rows.length };
}

async function readReport(id: string): Promise<CleaningReportRow | null> {
  const { data, error } = await supabaseAdmin.from('cleaning_review_reports').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`cleaning_review_reports: ${error.message}`);
  return (data as CleaningReportRow | null) ?? null;
}

/** Every weekly email waiting on approval, newest week first. Empty before
 *  the migration. */
async function loadWaiting(): Promise<CleaningReportRow[]> {
  const { data, error } = await supabaseAdmin
    .from('cleaning_review_reports')
    .select('*')
    .in('status', ['pending', 'approving'])
    .order('week_end', { ascending: false })
    .limit(20);
  if (error) {
    if (notMigrated(error)) return [];
    throw new Error(`cleaning_review_reports: ${error.message}`);
  }
  return (data ?? []) as CleaningReportRow[];
}

/** Waiting weekly emails, for the Team pill and the kinds line. Null when
 *  unreadable, never a zero that was not read. */
export async function countPendingCleaningReviews(): Promise<number | null> {
  try {
    return (await loadWaiting()).length;
  } catch {
    return null;
  }
}

async function reviewsInReports(ids: string[]): Promise<CleaningReviewRow[]> {
  if (ids.length === 0) return [];
  return selectAllPaged<CleaningReviewRow>(
    async (from, to) =>
      supabaseAdmin.from('cleaning_reviews').select('*').in('report_id', ids).order('walk_date').order('id').range(from, to),
    { label: 'Cleaning reviews in the weekly email' },
  );
}

/** The waiting weekly emails, ready for the card. */
export async function loadCleaningReviewCards(now: Date = new Date()): Promise<CleaningReviewCardData[]> {
  const reports = await loadWaiting();
  if (reports.length === 0) return [];
  const reviews = await reviewsInReports(reports.map((r) => r.id));
  const homes = await loadHomes([...new Set(reviews.map((r) => r.property_id))]);
  const staleBefore = now.getTime() - STUCK_CLAIM_MS;
  const copy = cleaningReviewCopy().map((e) => getTeamMember(e)?.short ?? e);
  const cards: CleaningReviewCardData[] = [];
  for (const rep of reports) {
    const mine = reviews.filter((r) => r.report_id === rep.id);
    const myHomes = [...new Set(mine.map((r) => r.property_id))].flatMap((id) => {
      const h = homes.get(id);
      return h ? [h] : [];
    });
    const audience = await audienceFor(myHomes);
    const en = audience.language === 'en';
    cards.push({
      id: rep.id,
      status: rep.status === 'approving' ? 'approving' : 'pending',
      stuck: rep.status === 'approving' && !!rep.claimed_at && Date.parse(rep.claimed_at) < staleBefore,
      firstWalk: rep.first_walk ?? rep.week_end,
      weekEnd: rep.week_end,
      average: weeklyAverage(mine),
      cleans: mine.map((r) => ({
        id: r.id,
        propertyName: homes.get(r.property_id)?.name ?? r.property_id,
        inspectorName: r.inspector_name,
        walkDate: r.walk_date,
        stars: r.stars,
        reason: r.reason ?? '',
        photoUrls: needsCleaningNotice(r.stars) ? (r.photo_urls ?? []) : [],
      })),
      language: audience.language,
      subject: en ? rep.subject_en : rep.subject_pt,
      text: en ? rep.body_en : rep.body_pt,
      english: rep.body_en,
      edited: rep.edited,
      createdAt: rep.created_at,
      ageMinutes: Math.max(0, Math.round((now.getTime() - Date.parse(rep.created_at)) / 60_000)),
      lastError: rep.last_error,
      recipients: audience.to.map((r) => `${r.display_name} <${r.email}>`),
      missingEmail: audience.missingEmail,
      copy,
    });
  }
  return cards;
}

async function audienceForReport(id: string): Promise<Audience> {
  const reviews = await reviewsInReports([id]);
  const homes = await loadHomes([...new Set(reviews.map((r) => r.property_id))]);
  return audienceFor([...homes.values()]);
}

export type ReviewActionResult = { ok: true; message?: string } | { ok: false; error: string; stale?: boolean };

/** The pending report, claimed for this approve, or null when someone else
 *  got there first. A claim older than five minutes may be taken over. */
async function claim(id: string): Promise<CleaningReportRow | null> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STUCK_CLAIM_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('cleaning_review_reports')
    .update({ status: 'approving', claimed_at: now.toISOString(), last_error: null })
    .eq('id', id)
    .or(`status.eq.pending,and(status.eq.approving,claimed_at.lt.${staleBefore})`)
    .select('*');
  if (error) throw new Error(`claim: ${error.message}`);
  return ((data ?? []) as CleaningReportRow[])[0] ?? null;
}

async function release(id: string, lastError: string | null): Promise<void> {
  await supabaseAdmin
    .from('cleaning_review_reports')
    .update({ status: 'pending', claimed_at: null, last_error: lastError })
    .eq('id', id)
    .eq('status', 'approving');
}

/**
 * Approve: send the week's email. The one place a cleaning review reaches
 * the crew. Each recipient gets it in their own language, from the cleaning
 * role address (cleaningReviewSender), with the cleaning_review duty on copy (team.ts) and replies to the
 * office. A send that
 * reaches nobody releases the claim and says why.
 */
export async function approveCleaningReview(id: string, operatorEmail: string): Promise<ReviewActionResult> {
  const row = await claim(id);
  if (!row) {
    const current = await readReport(id);
    if (!current) return { ok: false, error: 'This email is gone.', stale: true };
    if (current.status === 'sent') return { ok: false, error: 'Already sent.', stale: true };
    if (current.status === 'handled') return { ok: false, error: 'Already handled.', stale: true };
    return { ok: false, error: 'Someone else is sending this one.', stale: true };
  }
  if (!row.body_pt.trim() && !row.body_en.trim()) {
    await release(id, 'No text to send.');
    return { ok: false, error: 'There is no text to send. Edit the email first.' };
  }
  if (!process.env.RESEND_API_KEY) {
    await release(id, 'Email is not set up.');
    return { ok: false, error: 'Email is not set up. Ask Ryan: Resend key.' };
  }
  const audience = await audienceForReport(id);
  if (audience.to.length === 0) {
    await release(id, 'No cleaner email on file.');
    return { ok: false, error: 'No cleaner email on file. Add one under Cleaner settings.' };
  }
  const cc = cleaningReviewCopy();
  const replyTo = cleaningReviewReplyTo();
  const log: Array<{ email: string; name: string; ok: boolean; error?: string }> = [];
  for (const r of audience.to) {
    const en = r.language === 'en';
    const text = (en ? row.body_en : row.body_pt) || row.body_pt || row.body_en;
    try {
      const ok = await sendTransactionalViaResend({
        to: r.email,
        subject: en ? row.subject_en : row.subject_pt,
        text,
        html: weeklyEmailHtml(text),
        cc: cc.filter((e) => e.toLowerCase() !== r.email.toLowerCase()),
        replyTo,
        fromName: 'Rising Tide',
        fromEmail: cleaningReviewSender(),
        idempotencyKey: `cleaning-report-${id}-${r.email.toLowerCase()}`,
      });
      log.push(ok ? { email: r.email, name: r.display_name, ok } : { email: r.email, name: r.display_name, ok, error: 'Resend refused the send.' });
    } catch (err) {
      log.push({ email: r.email, name: r.display_name, ok: false, error: err instanceof Error ? err.message.slice(0, 300) : String(err) });
    }
  }
  const sent = log.filter((l) => l.ok);
  if (sent.length === 0) {
    await release(id, log[0]?.error ?? 'Every send failed.');
    return { ok: false, error: `The email did not go out: ${log[0]?.error ?? 'send failed'}` };
  }
  const now = new Date().toISOString();
  await supabaseAdmin
    .from('cleaning_review_reports')
    .update({ status: 'sent', sent_at: now, sent_to: sent.map((l) => l.email), decided_by: operatorEmail, decided_at: now, last_error: null })
    .eq('id', id)
    .eq('status', 'approving');
  const failed = log.filter((l) => !l.ok);
  const names = sent.map((l) => l.name).join(', ');
  return {
    ok: true,
    message: failed.length ? `Emailed ${names}. ${failed.map((l) => l.name).join(', ')} did not get it.` : `Emailed ${names}.`,
  };
}

/**
 * Edit: the operator's own words become the email the card shows, verbatim,
 * in that reader's language. The English check stays as drafted, and the
 * card says so once the email is edited.
 */
export async function editCleaningNotice(id: string, text: string): Promise<ReviewActionResult> {
  const body = text.trim().slice(0, 6000);
  if (!body) return { ok: false, error: 'Write the email first.' };
  const audience = await audienceForReport(id);
  const patch = audience.language === 'en' ? { body_en: body, edited: true } : { body_pt: body, edited: true };
  const { data, error } = await supabaseAdmin
    .from('cleaning_review_reports')
    .update(patch)
    .eq('id', id)
    .in('status', ['pending', 'approving'])
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'This email already moved on.', stale: true };
  return { ok: true };
}

export async function markCleaningReviewHandled(id: string, reason: string | undefined, operatorEmail: string): Promise<ReviewActionResult> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('cleaning_review_reports')
    .update({ status: 'handled', handled_reason: reason?.trim() || null, decided_by: operatorEmail, decided_at: now, claimed_at: null })
    .eq('id', id)
    .in('status', ['pending', 'approving'])
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'This email already moved on.', stale: true };
  return { ok: true };
}

/** Undo a Mark handled: the email waits again. A sent email cannot be unsent. */
export async function undoCleaningReviewHandled(id: string): Promise<ReviewActionResult> {
  const { data, error } = await supabaseAdmin
    .from('cleaning_review_reports')
    .update({ status: 'pending', handled_reason: null, decided_by: null, decided_at: null })
    .eq('id', id)
    .eq('status', 'handled')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'Nothing to undo.', stale: true };
  return { ok: true };
}

type RowWithReport = CleaningReviewRow & { cleaning_review_reports?: { status: ReportStatus } | null };

function withReportStatus(rows: RowWithReport[]): CleaningReviewRow[] {
  return rows.map(({ cleaning_review_reports: rep, ...r }) => ({ ...r, report_status: rep?.status ?? null }));
}

/** An inspector's rated walks, newest first, by any address they have
 *  walked under, each with where its weekly email stands. Before the
 *  migration the report status is simply absent. */
export async function loadInspectorCleaningReviews(emails: string[], sinceYmd?: string): Promise<CleaningReviewRow[]> {
  const list = emails.map((e) => e.toLowerCase().trim()).filter(Boolean);
  if (list.length === 0) return [];
  const read = (columns: string, tolerateMissing: boolean) =>
    selectAllPaged<RowWithReport>(
      async (from, to) => {
        let q = supabaseAdmin.from('cleaning_reviews').select(columns).in('inspector_email', list);
        if (sinceYmd) q = q.gte('walk_date', sinceYmd);
        const result = (await q.order('walk_date', { ascending: false }).order('id').range(from, to)) as unknown as {
          data: RowWithReport[] | null;
          error: { code?: string; message: string } | null;
        };
        if (tolerateMissing && result.error && notMigrated(result.error)) return { data: [], error: null };
        return result;
      },
      { label: 'Inspector cleaning reviews' },
    );
  try {
    return withReportStatus(await read('*, cleaning_review_reports(status)', false));
  } catch {
    // Before the migration there is no report to embed; the ratings still read.
    return withReportStatus(await read('*', true));
  }
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
