import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ALWAYS_CC, SEND_FROM, getActivePropertyForStatements } from '@/lib/properties';
import { renderEmail, type EmailTemplate } from '@/lib/email-templates';
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
    .map(p => `<p style="margin:0 0 1em 0;">${boldMoney(escape(p).replace(/\n/g, '<br>'))}</p>`);
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

    const { subject, body: emailBody } = renderEmail({
      greeting: prop.owner_greeting,
      monthName: monthLabel(month),
      propertyShort: prop.name,
      fundsSentIso,
      ownerPayout: stmtRow ? stmtRow.owner_payout || undefined : undefined,
      template,
      properties: grouped ? members.map(m => ({ name: m.name, payout: m.owner_payout || undefined })) : undefined,
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

    return NextResponse.json({
      success: true,
      draft_id: draft.id,
      draft_url: draftUrl,
      subject,
      recipients,
      attached_pdf: pdfAttachments.length > 0,
      attached_pdf_count: pdfAttachments.length,
      covered_property_ids: coveredIds,
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
