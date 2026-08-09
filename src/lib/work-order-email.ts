/**
 * Work-order emails: send a run's (or any slip set's) organized job list
 * to a roster recipient — "email Anthony the punch list for 84 Thatcher."
 *
 * Mirrors the statement workflow's envelope: FROM Dotti, CC Allie + Ryan
 * (ALWAYS_CC), one clearly labeled document per email. Transport is
 * Resend, not a Gmail draft: prod has no Gmail token for Dotti's mailbox,
 * so a draft would land in ALLIE's Drafts where Dotti can't review it —
 * instead the rail shows a compose/confirm step in Helm and this module
 * does a true send from dotti@risingtidestr.com (the domain is already
 * verified in Resend for the contract/agreement senders).
 *
 * The body groups jobs by property, numbers them, and the slip photos are
 * attached with filenames that match the job numbers ("02-side-door-lock-1
 * .jpg"), so the vendor never has to guess which photo belongs to which
 * job. Photo bytes are fetched server-side from the public Blob store with
 * bounded concurrency and a total-size budget; anything over budget is
 * skipped and listed in the body instead (the URLs still work).
 *
 * Audit trail: a work_slip_comment lands on every included slip, and a
 * contact_touches row is logged when the recipient is a CRM contact, so
 * the CRM timeline shows the outreach.
 */

import 'server-only';
import { fieldDb } from '@/lib/field-db';
import { sendTransactionalViaResend } from '@/lib/resend';
import { ALWAYS_CC } from '@/lib/properties';
import type { RosterPerson } from '@/lib/work-types';

/** The work-order envelope. From Dotti (the operator sending vendor work),
 *  CC the same pair the statement workflow always copies. */
const FROM_NAME = 'Dotti Maguire';
const FROM_EMAIL = 'dotti@risingtidestr.com';

/** Raw photo budget per email. Resend caps the encoded message around
 *  40MB; 15MB of raw bytes leaves comfortable base64 + body headroom. */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_PHOTOS_PER_SLIP = 4;
const FETCH_CONCURRENCY = 4;

/** Everyone emailable from the rail: CRM contacts (vendors first) plus
 *  active field contractors. */
export async function loadWorkOrderRoster(): Promise<RosterPerson[]> {
  const [{ data: contacts }, { data: contractors }] = await Promise.all([
    fieldDb().from('contacts').select('name, type, emails, organization').order('name'),
    fieldDb()
      .from('contractors')
      .select('full_name, company, email, status')
      .eq('status', 'active')
      .order('full_name'),
  ]);

  const out: RosterPerson[] = [];
  const seen = new Set<string>();
  for (const c of (contacts ?? []) as Array<{
    name: string;
    type: string;
    emails: string[] | null;
    organization: string | null;
  }>) {
    const email = (c.emails ?? []).find((e) => !!e?.trim())?.trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push({
      name: c.name,
      email,
      kind: c.type === 'vendor' ? 'vendor' : c.type === 'owner' ? 'owner' : 'other',
      organization: c.organization,
    });
  }
  for (const c of (contractors ?? []) as Array<{
    full_name: string;
    company: string | null;
    email: string;
  }>) {
    const email = c.email?.trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push({ name: c.full_name, email, kind: 'contractor', organization: c.company });
  }
  // Vendors first (they're who work orders usually go to), then
  // contractors, then everyone else.
  const rank: Record<RosterPerson['kind'], number> = { vendor: 0, contractor: 1, other: 2, owner: 3 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name));
}

// ─── sending ──────────────────────────────────────────────────────────

type SlipForOrder = {
  id: string;
  property_id: string;
  title: string;
  description: string | null;
  action_summary: string | null;
  location: string | null;
  priority: string;
  effort_minutes: number | null;
  run_scope_note: string | null;
  photo_urls: string[];
};

export type WorkOrderResult =
  | { ok: true; jobCount: number; photoCount: number; warnings: string[] }
  | { ok: false; error: string };

export async function sendWorkOrderEmail(args: {
  slipIds: string[];
  toName: string;
  toEmail: string;
  /** Operator note rendered under the job list. */
  note?: string;
  /** "Tue, Aug 11" style target-day line for run emails. */
  visitDate?: string | null;
  sentByEmail: string;
}): Promise<WorkOrderResult> {
  // Transactional sends need only the API key (the lib's exported
  // isResendConfigured also demands the campaign audience id).
  if (!process.env.RESEND_API_KEY) return { ok: false, error: 'Resend is not configured' };
  const toEmail = args.toEmail.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) {
    return { ok: false, error: 'That email address does not look valid' };
  }
  if (args.slipIds.length === 0) return { ok: false, error: 'No work slips selected' };

  const { data: slipData } = await fieldDb()
    .from('work_slips')
    .select(
      'id, property_id, title, description, action_summary, location, priority, effort_minutes, run_scope_note, photo_urls',
    )
    .in('id', args.slipIds);
  const slips = (slipData ?? []) as SlipForOrder[];
  if (slips.length === 0) return { ok: false, error: 'Those work slips no longer exist' };

  const propertyIds = [...new Set(slips.map((s) => s.property_id))];
  const { data: propData } = await fieldDb()
    .from('properties')
    .select('id, name, address, city')
    .in('id', propertyIds);
  const props = new Map(
    ((propData ?? []) as Array<{ id: string; name: string; address: string | null; city: string | null }>).map(
      (p) => [p.id, p],
    ),
  );

  // Stable job order: property name, then high first, then title.
  const prioRank: Record<string, number> = { high: 0, normal: 1, low: 2 };
  const ordered = slips.slice().sort((a, b) => {
    const pa = props.get(a.property_id)?.name ?? a.property_id;
    const pb = props.get(b.property_id)?.name ?? b.property_id;
    return (
      pa.localeCompare(pb) ||
      (prioRank[a.priority] ?? 1) - (prioRank[b.priority] ?? 1) ||
      a.title.localeCompare(b.title)
    );
  });

  // Attachment plan first (filenames appear in the body), fetch after.
  const warnings: string[] = [];
  const plan: { url: string; filename: string; jobNo: number }[] = [];
  ordered.forEach((s, i) => {
    const jobNo = i + 1;
    const photos = (s.photo_urls ?? []).filter(Boolean);
    if (photos.length > MAX_PHOTOS_PER_SLIP) {
      warnings.push(`Job ${pad(jobNo)}: only the first ${MAX_PHOTOS_PER_SLIP} photos attached`);
    }
    photos.slice(0, MAX_PHOTOS_PER_SLIP).forEach((url, k) => {
      plan.push({ url, filename: `${pad(jobNo)}-${slugify(jobTitle(s))}-${k + 1}${extOf(url)}`, jobNo });
    });
  });

  const fetched = await mapPool(plan, FETCH_CONCURRENCY, async (p) => {
    try {
      const res = await fetch(p.url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return { ...p, buf };
    } catch {
      return null;
    }
  });

  let budget = MAX_ATTACHMENT_BYTES;
  const attachments: { filename: string; content: string }[] = [];
  const unattached: { filename: string; url: string }[] = [];
  for (let i = 0; i < plan.length; i += 1) {
    const f = fetched[i];
    if (!f) {
      unattached.push({ filename: plan[i].filename, url: plan[i].url });
      warnings.push(`Could not fetch ${plan[i].filename}; linked in the body instead`);
      continue;
    }
    if (f.buf.length > budget) {
      unattached.push({ filename: f.filename, url: f.url });
      continue;
    }
    budget -= f.buf.length;
    attachments.push({ filename: f.filename, content: f.buf.toString('base64') });
  }
  if (unattached.length > 0 && !warnings.some((w) => w.includes('linked in the body'))) {
    warnings.push(`${unattached.length} photo(s) over the attachment budget; linked in the body instead`);
  }

  const attachedByJob = new Map<number, string[]>();
  {
    // Job numbers ride the plan, never re-parsed from filenames (a 3-digit
    // job would truncate under a slice-based parse).
    const attachedNames = new Set(attachments.map((a) => a.filename));
    for (const p of plan) {
      if (!attachedNames.has(p.filename)) continue;
      if (!attachedByJob.has(p.jobNo)) attachedByJob.set(p.jobNo, []);
      attachedByJob.get(p.jobNo)!.push(p.filename);
    }
  }

  const { subject, text } = composeBody({
    toName: args.toName,
    slips: ordered,
    props,
    attachedByJob,
    unattached,
    note: args.note,
    visitDate: args.visitDate ?? null,
  });

  let sent = false;
  try {
    sent = await sendTransactionalViaResend({
      to: toEmail,
      subject,
      fromName: FROM_NAME,
      fromEmail: FROM_EMAIL,
      html: textToHtml(text),
      text,
      cc: ALWAYS_CC,
      attachments,
      // Sized for the payload: ~20MB of base64 photos has to finish
      // uploading, not just get an API ack.
      timeoutMs: 60_000,
    });
  } catch (err) {
    // A timeout mid-upload is genuinely ambiguous -- say so instead of
    // letting the throw reach the composer as a generic error page.
    const msg = err instanceof Error && err.name === 'TimeoutError'
      ? 'The send timed out mid-upload — check with the recipient (or Resend logs) before retrying'
      : err instanceof Error
        ? err.message
        : String(err);
    return { ok: false, error: msg };
  }
  if (!sent) return { ok: false, error: 'Resend rejected the send — check RESEND_API_KEY / logs' };

  // Audit: a comment on every slip, and a CRM touch when the recipient is
  // a contact. Both best-effort — the email already went out.
  try {
    await fieldDb()
      .from('work_slip_comments')
      .insert(
        ordered.map((s) => ({
          work_slip_id: s.id,
          author_email: args.sentByEmail,
          body: `Work order emailed to ${args.toName} (${toEmail}), cc ${ALWAYS_CC.join(', ')}.`,
        })),
      );
  } catch {
    /* non-fatal */
  }
  try {
    const { data: contact } = await fieldDb()
      .from('contacts')
      .select('id')
      .contains('emails', [toEmail])
      .limit(1)
      .maybeSingle();
    if (contact) {
      await fieldDb().from('contact_touches').insert({
        contact_id: (contact as { id: string }).id,
        touched_at: new Date().toISOString(),
        channel: 'email',
        direction: 'outbound',
        summary: subject,
        by_email: args.sentByEmail,
      });
    }
  } catch {
    /* non-fatal */
  }

  return { ok: true, jobCount: ordered.length, photoCount: attachments.length, warnings };
}

// ─── composition ──────────────────────────────────────────────────────

function composeBody(args: {
  toName: string;
  slips: SlipForOrder[];
  props: Map<string, { id: string; name: string; address: string | null; city: string | null }>;
  attachedByJob: Map<number, string[]>;
  unattached: { filename: string; url: string }[];
  note?: string;
  visitDate: string | null;
}): { subject: string; text: string } {
  const propertyIds = [...new Set(args.slips.map((s) => s.property_id))];
  const firstProp = args.props.get(propertyIds[0]);
  const subject =
    propertyIds.length === 1
      ? `Work order — ${firstProp?.name ?? propertyIds[0]} (${args.slips.length} ${args.slips.length === 1 ? 'job' : 'jobs'})`
      : `Work order — ${args.slips.length} jobs across ${propertyIds.length} properties`;

  const lines: string[] = [];
  lines.push(`Hi ${args.toName.split(' ')[0] || 'there'},`);
  lines.push('');
  if (propertyIds.length === 1 && firstProp) {
    const where = [firstProp.address, firstProp.city].filter(Boolean).join(', ');
    lines.push(`Work order for ${firstProp.name}${where ? ` (${where})` : ''}.`);
  } else {
    lines.push(`Work order across ${propertyIds.length} properties, grouped below.`);
  }
  if (args.visitDate) {
    lines.push(`Target day: ${fmtDay(args.visitDate)} — the house is empty that day.`);
  }
  lines.push('');

  let jobNo = 0;
  let currentProp = '';
  for (const s of args.slips) {
    jobNo += 1;
    const p = args.props.get(s.property_id);
    const propName = p?.name ?? s.property_id;
    if (propertyIds.length > 1 && propName !== currentProp) {
      currentProp = propName;
      const where = [p?.address, p?.city].filter(Boolean).join(', ');
      lines.push(`— ${propName}${where ? ` (${where})` : ''} —`);
      lines.push('');
    }
    const flags = [s.priority === 'high' ? 'HIGH PRIORITY' : null, s.effort_minutes ? `~${s.effort_minutes} min` : null]
      .filter(Boolean)
      .join(' · ');
    lines.push(`${pad(jobNo)}. ${jobTitle(s)}${flags ? ` (${flags})` : ''}`);
    const detail = (s.description || s.action_summary || '').trim();
    if (detail) for (const dl of detail.split('\n')) lines.push(`    ${dl}`.trimEnd());
    if (s.location) lines.push(`    Where: ${s.location}`);
    if (s.run_scope_note) lines.push(`    Note: ${s.run_scope_note}`);
    const photos = args.attachedByJob.get(jobNo) ?? [];
    if (photos.length > 0) lines.push(`    Photos attached: ${photos.join(', ')}`);
    lines.push('');
  }

  if (args.unattached.length > 0) {
    lines.push('Photos too large to attach (links):');
    for (const u of args.unattached) lines.push(`  ${u.filename}: ${u.url}`);
    lines.push('');
  }
  if (args.note?.trim()) {
    lines.push(args.note.trim());
    lines.push('');
  }
  lines.push('Attached photos are numbered to match the jobs. Reply here with any questions or to confirm scheduling.');
  lines.push('');
  lines.push('Thanks,');
  lines.push('Dotti');
  lines.push('Rising Tide STR');
  return { subject, text: lines.join('\n') };
}

// ─── helpers ──────────────────────────────────────────────────────────

/** Slip titles carry a "Property: " prefix on the board; the work order
 *  groups by property already, so strip it. */
function jobTitle(s: SlipForOrder): string {
  const idx = s.title.indexOf(': ');
  return idx > 0 && idx < 24 ? s.title.slice(idx + 2) : s.title;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function slugify(t: string): string {
  return (
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'job'
  );
}

function extOf(url: string): string {
  const m = url.split('?')[0].match(/\.(jpe?g|png|webp|heic|heif|gif)$/i);
  return m ? `.${m[1].toLowerCase()}` : '.jpg';
}

function fmtDay(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Plain text → minimal HTML that mail clients won't reflow. */
function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family: -apple-system, Segoe UI, sans-serif; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${esc}</div>`;
}

/** Bounded-concurrency, order-preserving map (photo fetches). */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
