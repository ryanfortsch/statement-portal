import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ALWAYS_CC, SEND_FROM, getActivePropertyForStatements } from '@/lib/properties';
import {
  renderEmail,
  resolveOwnerRequests,
  ownerRequestsHaveContent,
  type EmailTemplate,
  type OwnerRequestSelections,
  type ResolvedOwnerRequests,
} from '@/lib/email-templates';
import { loadOwnerRequestCandidates } from '@/lib/statement-owner-requests';
import { verifyStatementIntegrity, FINALITY_FROM_MONTH } from '@/lib/statement-finality';
import { renderStatementPdf, statementPdfFilename } from '@/lib/pdf';

// Puppeteer + Chromium cold start can take 3-5s; give the handler plenty of
// headroom. Vercel Pro supports up to 300s.
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/draft-email
 * Body: { property_id, month, template?, funds_sent_date? }
 *
 * Creates a Gmail draft in the mailbox the Gmail OAuth token is authenticated
 * against (currently allie@risingtidestr.com). Caller passes the statement
 * month + template; this route renders the body from the shared template
 * module, constructs an RFC 2822 MIME message, and POSTs to Gmail's /drafts
 * endpoint. On success it also stamps `close_tasks.email_drafted_at` so the
 * checkbox on the dashboard updates in-place.
 */

const GMAIL_CLIENT_ID = () => process.env.GMAIL_CLIENT_ID || '';
const GMAIL_CLIENT_SECRET = () => process.env.GMAIL_CLIENT_SECRET || '';
const GMAIL_REFRESH_TOKEN = () => process.env.GMAIL_REFRESH_TOKEN || '';

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase not configured');
  _sb = createClient(url, key);
  return _sb;
}

async function getGmailAccessToken(): Promise<string> {
  if (!GMAIL_CLIENT_ID() || !GMAIL_CLIENT_SECRET() || !GMAIL_REFRESH_TOKEN()) {
    throw new Error('Gmail OAuth env vars not configured (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN)');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID(),
      client_secret: GMAIL_CLIENT_SECRET(),
      refresh_token: GMAIL_REFRESH_TOKEN(),
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

function monthLabel(iso: string): string {
  const d = new Date(iso + '-01T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Base64-URL encoding (RFC 4648 §5). Gmail's drafts endpoint requires this. */
function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Encode a header value so non-ASCII characters survive transit. */
function encodeHeader(value: string): string {
  // If value is pure ASCII, leave it alone. Otherwise use RFC 2047 B-encoding.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

/** Chunk a base64 string into 76-char lines per RFC 2045. */
function wrapBase64(s: string, width = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += width) lines.push(s.slice(i, i + width));
  return lines.join('\r\n');
}

/**
 * Convert the plain-text body into an HTML version preserving paragraph
 * layout. Why HTML at all: mobile Gmail (and a few other mobile clients)
 * reflows text/plain emails -- any line over ~70 chars gets wrapped on
 * whatever word boundary the renderer picks, which made our owner-
 * statement emails look "screwy" on phones even though the desktop draft
 * looked right. Sending a parallel text/html part lets HTML-capable
 * clients (every modern Gmail/Apple Mail/Outlook) render deterministic
 * paragraphs at any screen width.
 *
 * Blank-line-separated chunks become <p>; single \n inside a paragraph
 * (e.g. signature "Thanks!\nAllie & Ryan") becomes <br>. Inline content
 * is HTML-escaped first so an owner name with "&" doesn't break the markup.
 */
function plainToHtml(body: string): string {
  // Keep the markup minimal so Gmail's compose editor renders the draft at
  // its native "Normal" size and font. Forcing font-family / font-size /
  // line-height here was producing visibly-larger-than-normal text when
  // the operator opened the draft to edit it. Paragraphs get just enough
  // bottom margin to separate them; everything else inherits.
  //
  // Dollar amounts ($X,XXX or $X,XXX.XX) get wrapped in <strong> so the
  // owner payout line in the body reads as bolded in mobile Gmail (the
  // only meaningful $ figure in the template is the payout, now rounded to
  // whole dollars). Plain-text fallback stays clean -- no asterisks or
  // markdown clutter.
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const boldMoney = (html: string) => html.replace(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/g, m => `<strong>${m}</strong>`);
  const paragraphs = body.split(/\n\n+/).map(p => p.replace(/^\n+|\n+$/g, ''));
  const htmlParas = paragraphs
    .filter(p => p.length > 0)
    .map(p => {
      // "• " lines inside a paragraph (the work-notes groups: an intro
      // line with its bullets right under it) become a real list in the
      // HTML part, so the section reads as typeset rather than pasted.
      // The plain-text alternative keeps the literal bullets.
      const lines = p.split('\n');
      if (!lines.some(l => l.startsWith('• '))) {
        return `<p style="margin:0 0 1em 0;">${boldMoney(escape(p).replace(/\n/g, '<br>'))}</p>`;
      }
      const runs: { bullet: boolean; lines: string[] }[] = [];
      for (const line of lines) {
        const bullet = line.startsWith('• ');
        const prev = runs[runs.length - 1];
        if (prev && prev.bullet === bullet) prev.lines.push(line);
        else runs.push({ bullet, lines: [line] });
      }
      return runs.map((run, i) => {
        // Tight spacing inside the group, full paragraph gap after it.
        const gap = i === runs.length - 1 ? '1em' : '.35em';
        if (run.bullet) {
          const items = run.lines
            .map(l => `<li style="margin:0 0 4px 0;">${boldMoney(escape(l.slice(2)))}</li>`)
            .join('');
          return `<ul style="margin:0 0 ${gap} 0;padding-left:22px;">${items}</ul>`;
        }
        return `<p style="margin:0 0 ${gap} 0;">${boldMoney(escape(run.lines.join('\n')).replace(/\n/g, '<br>'))}</p>`;
      }).join('');
    });
  return `<!DOCTYPE html><html><body>${htmlParas.join('')}</body></html>`;
}

function buildMimeMessage(args: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  attachments?: { filename: string; contentType: string; content: Buffer }[];
}): string {
  const { from, to, cc, subject, body } = args;
  const attachments = args.attachments ?? [];
  const headers = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
  ];
  if (cc && cc.length > 0) headers.push(`Cc: ${cc.join(', ')}`);
  headers.push(`Subject: ${encodeHeader(subject)}`);
  headers.push('MIME-Version: 1.0');

  // Always send a multipart/alternative body so plain + html ride together.
  // Clients render whichever they prefer (mobile Gmail picks html, which
  // preserves paragraph breaks even when the line is > 70 chars).
  const altBoundary = `rt_alt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const html = plainToHtml(body);
  const bodyCrlf = body.replace(/\r?\n/g, '\r\n');
  const altPart = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    bodyCrlf,
    `--${altBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    `--${altBoundary}--`,
  ].join('\r\n');

  if (attachments.length === 0) {
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    return headers.join('\r\n') + '\r\n\r\n' + altPart + '\r\n';
  }

  // With attachments: multipart/mixed wrapping the alternative + each PDF.
  // Multi-property owners get one email with every statement attached.
  const mixedBoundary = `rt_boundary_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);

  const bodyPart = [
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    altPart,
  ].join('\r\n');

  const attachmentParts = attachments.map(attachment => [
    `--${mixedBoundary}`,
    `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    '',
    wrapBase64(attachment.content.toString('base64')),
  ].join('\r\n'));

  return [
    headers.join('\r\n'),
    '',
    bodyPart,
    ...attachmentParts,
    `--${mixedBoundary}--`,
    '',
  ].join('\r\n');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const propertyId: string = body.property_id || '';
    const month: string = body.month || '';
    const template: EmailTemplate = body.template || 'monthly';
    const fundsSentIso: string = body.funds_sent_date || '';
    const periodId: string | undefined = body.period_id;
    // Draft All passes bulk:true. It precomputes its candidate list, so
    // when a combined owner draft stamps a sibling property mid-loop the
    // sibling's own call still fires -- the bulk flag lets us no-op it
    // instead of drafting the same owner twice. Manual per-property
    // drafting (no flag) always creates a fresh draft.
    const bulk: boolean = body.bulk === true;
    // Opt-in owner-request section. The dashboard always passes the flag
    // (from close_tasks.email_include_work_slips); a caller that omits it
    // falls back to the stored preference so the toggle is authoritative.
    // Which items ride along is NEVER passed in -- the per-item picks are
    // read from close_tasks below, so a draft can only ever contain what
    // the operator curated in the preview.
    let includeWorkSlips: boolean = body.include_work_slips === true;

    if (!propertyId || !month) {
      return NextResponse.json({ error: 'property_id and month are required' }, { status: 400 });
    }

    // DB-first: read owner name / email / greeting from the live properties
    // table (getActivePropertyForStatements falls back to the static map
    // only when the DB row is missing). An owner-profile edit on the
    // property page therefore flows straight into the drafted email.
    const prop = await getActivePropertyForStatements(propertyId);
    if (!prop) {
      return NextResponse.json({ error: `Unknown property: ${propertyId}` }, { status: 400 });
    }

    const sbForStmt = getSupabase();

    if (body.include_work_slips === undefined && periodId) {
      const { data: storedTask } = await sbForStmt
        .from('close_tasks')
        .select('email_include_work_slips')
        .eq('period_id', periodId)
        .eq('property_id', propertyId)
        .maybeSingle();
      includeWorkSlips = storedTask?.email_include_work_slips === true;
    }

    if (bulk && periodId) {
      const { data: existingTask } = await sbForStmt
        .from('close_tasks')
        .select('email_drafted_at')
        .eq('period_id', periodId)
        .eq('property_id', propertyId)
        .maybeSingle();
      if (existingTask?.email_drafted_at) {
        return NextResponse.json({
          success: true,
          already_drafted: true,
          covered_property_ids: [propertyId],
        });
      }
    }

    // Owner grouping: an owner with 2+ active properties (Prudenzi's 53
    // Rocky Neck + Downstairs) gets ONE email covering every property of
    // theirs that has a statement this period, each PDF attached. Keyed
    // on properties.owner_id -- properties without one never group.
    type GroupMember = { property_id: string; name: string; owner_emails: string[]; statement_id: string; owner_payout: number };
    const members: GroupMember[] = [];
    {
      const { data: ownRow } = await sbForStmt
        .from('properties')
        .select('owner_id')
        .eq('id', propertyId)
        .maybeSingle();
      const ownerId = ownRow?.owner_id || null;

      let siblingRows: { id: string; name: string; owner_emails: string[] | null }[] =
        [{ id: propertyId, name: prop.name, owner_emails: prop.owner_emails }];
      if (ownerId) {
        const { data: sibs } = await sbForStmt
          .from('properties')
          .select('id, name, owner_emails')
          .eq('owner_id', ownerId)
          .eq('is_active', true);
        if (sibs && sibs.length > 0) {
          // Requested property first, then siblings by name, so the
          // subject and attachment order are stable.
          siblingRows = [...sibs].sort((a, b) =>
            a.id === propertyId ? -1 : b.id === propertyId ? 1 : a.name.localeCompare(b.name));
        }
      }

      const { data: stmtRows } = await sbForStmt
        .from('property_statements')
        .select('id, property_id, owner_payout')
        .eq('period_id', periodId)
        .in('property_id', siblingRows.map(s => s.id));
      const stmtByProp = new Map((stmtRows || []).map(s => [s.property_id, s]));

      for (const sib of siblingRows) {
        const stmt = stmtByProp.get(sib.id);
        // Siblings only join the email when their statement exists this
        // period; the requested property joins regardless (its missing-
        // statement case is handled below, same as before grouping).
        if (stmt) {
          members.push({
            property_id: sib.id, name: sib.name,
            owner_emails: sib.owner_emails || [],
            statement_id: stmt.id, owner_payout: Number(stmt.owner_payout) || 0,
          });
        }
      }
    }

    const stmtRow = members.find(m => m.property_id === propertyId) || null;
    const grouped = members.length >= 2;

    // ── Sent-redraft gate ──────────────────────────────────────────────
    // Creating a draft deliberately clears email_sent_at (see the stamp
    // below: a redraft supersedes a scheduled send). That un-freezing must
    // never happen silently: if any covered property is currently marked
    // sent, require an explicit force and record the override on the
    // statement. The response carries cleared_sent_property_ids so the
    // dashboard unticks its checkbox instead of showing "sent" over an
    // unfrozen statement.
    const clearedSentIds: string[] = [];
    if (periodId) {
      const coveredForGate = members.length > 0
        ? members.map(m => ({ property_id: m.property_id, statement_id: m.statement_id as string | null }))
        : [{ property_id: propertyId, statement_id: null }];
      const { data: sentTasks, error: sentErr } = await sbForStmt
        .from('close_tasks')
        .select('property_id, email_sent_at')
        .eq('period_id', periodId)
        .in('property_id', coveredForGate.map(c => c.property_id));
      if (sentErr) {
        return NextResponse.json({ error: `close_tasks read failed: ${sentErr.message}` }, { status: 500 });
      }
      const sent = (sentTasks || []).filter(t => t.email_sent_at);
      if (sent.length > 0 && month >= FINALITY_FROM_MONTH) {
        if (body.force !== true) {
          return NextResponse.json({
            error: `Already marked sent (${sent.map(t => t.property_id).join(', ')}). Redrafting clears the sent stamp and unfreezes the statement's numbers until the new draft is sent.`,
            frozen: true,
            reason: 'email_sent',
            email_sent_at: sent[0].email_sent_at,
            month,
          }, { status: 409 });
        }
        // Record the property ids now; the audit gaps are written AFTER
        // the Gmail draft actually exists (a gap asserting "the sent stamp
        // was cleared" must not outlive a draft attempt that 502s).
        for (const t of sent) clearedSentIds.push(t.property_id);
      }
    }

    // ── Deliverable integrity ──────────────────────────────────────────
    // A statement whose stored lines do not sum to its stored payout is
    // internally inconsistent (some writer moved one column without the
    // others). It must not become an attachment in an owner's inbox. No
    // force for this one: the fix is recomputing the statement, not
    // sending it anyway.
    for (const m of members) {
      const integrity = await verifyStatementIntegrity(sbForStmt, m.statement_id);
      if (integrity.checked && !integrity.ok) {
        return NextResponse.json({
          error: `${m.name}: the statement's lines sum to $${integrity.expected.toFixed(2)} but its payout says $${integrity.actual.toFixed(2)} (off by $${integrity.delta.toFixed(2)}). Re-run Sync Stripe or re-ingest to reconcile it before drafting.`,
          integrity_failure: true,
        }, { status: 422 });
      }
    }

    // Recipients: union across the group -- the sub-unit row may carry no
    // email of its own (Prudenzi's downstairs), the main house's covers it.
    const recipientSet = new Set<string>(prop.owner_emails);
    for (const m of members) m.owner_emails.forEach(e => recipientSet.add(e));
    const recipients = Array.from(recipientSet);
    if (recipients.length === 0) {
      return NextResponse.json({
        error: `No owner email on file for ${prop.name}. Add it on the property's page in Helm.`,
      }, { status: 400 });
    }

    // Owner requests ride the same grouping as the PDFs: one entry per
    // covered property, houses with nothing to say dropped. All-empty -> no
    // section, body identical to the flag being off.
    //
    // Each house's picks live on its OWN close_tasks row, which is what lets
    // a combined owner (Prudenzi, Moynahan) carry a curated list per house
    // inside one email.
    let ownerRequests: ResolvedOwnerRequests[] | undefined;
    let askedSlipIds: string[] = [];
    if (includeWorkSlips) {
      const covered = members.length > 0
        ? members.map(m => ({ property_id: m.property_id, name: m.name }))
        : [{ property_id: propertyId, name: prop.name }];

      const picksByProperty = new Map<string, { selections: OwnerRequestSelections | null; includeHandled: boolean }>();
      if (periodId) {
        const { data: taskRows } = await sbForStmt
          .from('close_tasks')
          .select('property_id, owner_request_items, email_include_handled')
          .eq('period_id', periodId)
          .in('property_id', covered.map(c => c.property_id));
        for (const row of (taskRows || []) as { property_id: string; owner_request_items: OwnerRequestSelections | null; email_include_handled: boolean | null }[]) {
          picksByProperty.set(row.property_id, {
            selections: row.owner_request_items ?? null,
            includeHandled: row.email_include_handled === true,
          });
        }
      }

      const loaded = await Promise.all(covered.map(c =>
        loadOwnerRequestCandidates({ propertyId: c.property_id, propertyName: c.name, month })));
      const resolved = loaded.map(l => {
        const picks = picksByProperty.get(l.propertyId);
        return resolveOwnerRequests(l, picks?.selections, { includeHandled: picks?.includeHandled === true });
      });
      const withContent = resolved.filter(ownerRequestsHaveContent);
      if (withContent.length > 0) {
        ownerRequests = withContent;
        askedSlipIds = withContent.flatMap(r => r.askedSlipIds);
      }
    }

    const { subject, body: emailBody } = renderEmail({
      greeting: prop.owner_greeting,
      monthName: monthLabel(month),
      propertyShort: prop.name,
      fundsSentIso,
      ownerPayout: stmtRow ? stmtRow.owner_payout || undefined : undefined,
      template,
      properties: grouped ? members.map(m => ({ name: m.name, payout: m.owner_payout || undefined })) : undefined,
      ownerRequests,
    });

    // Render each statement PDF via headless Chromium so the draft lands in
    // Gmail with every owner statement already attached. If a PDF render
    // fails we still create the draft (without that attachment) -- operator
    // can attach manually -- and report the failure in `warnings`.
    const warnings: string[] = [];
    const pdfAttachments: { filename: string; contentType: string; content: Buffer }[] = [];

    if (members.length === 0) {
      warnings.push('No property_statement found for this month; draft created without PDF attachment.');
    }
    for (const m of members) {
      try {
        const origin = request.nextUrl.origin;
        const pdf = await renderStatementPdf({ statementId: m.statement_id, month, origin });
        pdfAttachments.push({
          filename: statementPdfFilename(m.name, month),
          contentType: 'application/pdf',
          content: pdf,
        });
      } catch (pdfErr) {
        warnings.push(`PDF render failed for ${m.name}: ${pdfErr instanceof Error ? pdfErr.message : String(pdfErr)}. Draft created without that attachment.`);
      }
    }

    const mime = buildMimeMessage({
      from: `${SEND_FROM.name} <${SEND_FROM.email}>`,
      to: recipients,
      cc: ALWAYS_CC,
      subject,
      body: emailBody,
      attachments: pdfAttachments,
    });

    const accessToken = await getGmailAccessToken();

    const draftRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: { raw: base64url(mime) },
      }),
    });

    if (!draftRes.ok) {
      const errText = await draftRes.text();
      // 403 with insufficient scope is the most likely failure mode.
      const hint = draftRes.status === 403 && /insufficient/i.test(errText)
        ? ' The Gmail OAuth token probably lacks gmail.compose scope. Re-authorize the Gmail OAuth app adding that scope and regenerate GMAIL_REFRESH_TOKEN.'
        : '';
      return NextResponse.json({
        error: `Gmail draft creation failed (${draftRes.status}): ${errText}${hint}`,
      }, { status: 502 });
    }

    const draft = await draftRes.json();
    // Gmail's API doesn't return a direct web URL for the draft. Constructing
    // a mailbox URL by draft ID works in the browser: opens the drafts folder
    // and focuses the one we just made.
    const draftUrl = `https://mail.google.com/mail/u/0/#drafts/${draft.id}`;

    // The draft exists; now make the forced sent-clear a matter of record.
    // An insert failure cannot undo the redraft, so it lands in `warnings`
    // where the operator sees it instead of vanishing into a log.
    for (const pid of clearedSentIds) {
      const member = members.find(m => m.property_id === pid);
      if (!member?.statement_id) continue;
      const { error: gapErr } = await sbForStmt.from('data_gaps').insert({
        property_statement_id: member.statement_id,
        gap_type: 'post_send_write',
        severity: 'warning',
        description: `Owner email redrafted after the statement was marked sent. The sent stamp was cleared; numbers are revisable until the new draft is sent.`,
        expected_data: `forced ${new Date().toISOString()}`,
        resolved: false,
      });
      if (gapErr) warnings.push(`Audit flag for the ${member.name} sent-stamp clear could not be written (${gapErr.message}); note it manually.`);
    }

    // Stamp close_tasks for EVERY property covered by this draft (a
    // combined owner email drafts all of them at once). Failure here
    // shouldn't fail the whole request; the draft itself is created.
    const coveredIds = members.length > 0 ? members.map(m => m.property_id) : [propertyId];
    if (periodId) {
      try {
        const sb = getSupabase();
        const nowIso = new Date().toISOString();
        for (const pid of coveredIds) {
          const { data: existing } = await sb
            .from('close_tasks')
            .select('*')
            .eq('period_id', periodId)
            .eq('property_id', pid)
            .maybeSingle();

          const row = {
            period_id: periodId,
            property_id: pid,
            email_template: template,
            email_include_work_slips: includeWorkSlips,
            email_drafted_at: nowIso,
            // A deliberate redraft supersedes any scheduled send: clear the
            // sent stamp so the statement is revisable again (and the
            // stripe-sync sent-gate reopens) until the new draft is sent.
            // Learned 2026-08-02: July's emails were stamped sent at
            // SCHEDULE time while delivery was set for the next morning,
            // which cemented statements Dotti still needed to revise.
            email_sent_at: null,
            owner_transfer_done_at: existing?.owner_transfer_done_at || null,
            mgmt_sweep_done_at: existing?.mgmt_sweep_done_at || null,
            notes: existing?.notes || null,
          };
          await sb.from('close_tasks').upsert(row, { onConflict: 'period_id,property_id' });
        }
      } catch (persistErr) {
        console.error('draft-email: close_tasks upsert failed', persistErr);
      }
    }

    // Close the loop on the work board: a slip whose ask just went out to
    // the owner is now "sent", with the contact stamped. Without this the
    // daily brief keeps nagging about an item the owner is already sitting
    // on, and next month's draft re-asks as if it were new instead of
    // saying "we first raised this on <date>".
    //
    // Stamped at DRAFT time, matching /api/work/draft-owner-email. Helm
    // never sends for you, so draft is the last moment we control; a draft
    // that never goes out leaves a slip reading "sent" -- the answer chips
    // on the slip page are how that gets corrected.
    if (askedSlipIds.length > 0) {
      const { error: stampErr } = await sbForStmt
        .from('work_slips')
        .update({ owner_status: 'sent', owner_last_contacted_at: new Date().toISOString() })
        .in('id', askedSlipIds);
      if (stampErr) {
        warnings.push(`The email is drafted, but ${askedSlipIds.length} work slip${askedSlipIds.length === 1 ? '' : 's'} could not be marked as sent to the owner (${stampErr.message}). Mark them on the slip page so the brief stops nagging.`);
      }
    }

    return NextResponse.json({
      success: true,
      draft_id: draft.id,
      draft_url: draftUrl,
      subject,
      recipients,
      attached_pdf: pdfAttachments.length > 0,
      attached_pdf_count: pdfAttachments.length,
      work_notes_included: !!ownerRequests,
      owner_requests_sent: askedSlipIds.length,
      covered_property_ids: coveredIds,
      cleared_sent_property_ids: clearedSentIds,
      warnings,
    });
  } catch (err) {
    console.error('draft-email error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
