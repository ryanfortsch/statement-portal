import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ALWAYS_CC, SEND_FROM } from '@/lib/properties';
import type { WorkSlipRow, WorkSlipOwnerActionType } from '@/lib/work-types';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/work/draft-owner-email
 * Body: { property_id: string }
 *
 * Pulls the Helm property + every open work slip on it that's flagged
 * `owner_action_required = true`, builds a plain-text email body listing each
 * one, and creates a Gmail draft via the same OAuth pattern used by
 * /api/draft-email. Returns the Gmail web URL so the operator can review +
 * send from their inbox.
 *
 * Stamps `owner_last_contacted_at` on each included slip on success so the
 * queue can show "owner contacted: <date>" and avoid double-sending.
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

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

function buildMimeMessage(args: {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}): string {
  const { from, to, cc, subject, body } = args;
  const headers = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
  ];
  if (cc && cc.length > 0) headers.push(`Cc: ${cc.join(', ')}`);
  headers.push(`Subject: ${encodeHeader(subject)}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset=UTF-8');
  headers.push('Content-Transfer-Encoding: 8bit');
  return headers.join('\r\n') + '\r\n\r\n' + body;
}

const ACTION_TYPE_LABELS: Record<WorkSlipOwnerActionType, string> = {
  approve: 'Needs your approval',
  purchase: 'Purchase decision',
  schedule: 'Scheduling decision',
  decide: 'Needs your call',
  reimburse: 'Reimbursement',
};

type HelmPropertyEmailRow = {
  id: string;
  name: string;
  address: string;
  owner_greeting: string | null;
  owner_emails: string[] | null;
};

function renderBody(args: {
  greeting: string;
  propertyName: string;
  slips: WorkSlipRow[];
}): string {
  const { greeting, propertyName, slips } = args;

  const intro = slips.length === 1
    ? `One item at ${propertyName} needs your input.`
    : `${slips.length} items at ${propertyName} need your input.`;

  const items = slips.map((s, i) => {
    const lines: string[] = [];
    const num = String(i + 1).padStart(2, '0');
    lines.push(`${num}. ${s.title}`);

    if (s.owner_action_type) {
      lines.push(`    ${ACTION_TYPE_LABELS[s.owner_action_type]}`);
    }
    if (s.location) {
      lines.push(`    Location: ${s.location}`);
    }
    if (s.description?.trim()) {
      lines.push('');
      lines.push(`    ${s.description.trim().split('\n').join('\n    ')}`);
    }
    if (s.owner_action_notes?.trim()) {
      lines.push('');
      lines.push(`    Notes: ${s.owner_action_notes.trim().split('\n').join('\n    ')}`);
    }
    return lines.join('\n');
  }).join('\n\n');

  const closing = slips.length === 1
    ? 'Reply when you have a moment with how you\'d like us to handle it.'
    : 'Reply when you have a moment with how you\'d like us to handle each.';

  return [
    `Hi ${greeting},`,
    '',
    intro,
    '',
    items,
    '',
    closing,
    '',
    'Thanks,',
    'Allie & Ryan',
  ].join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const propertyId: string = (body && typeof body === 'object' && 'property_id' in body && typeof body.property_id === 'string')
      ? body.property_id
      : '';

    if (!propertyId) {
      return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
    }

    const sb = getSupabase();

    const { data: property, error: propErr } = await sb
      .from('properties')
      .select('id, name, address, owner_greeting, owner_emails')
      .eq('id', propertyId)
      .maybeSingle();

    if (propErr) {
      return NextResponse.json({ error: `Lookup failed: ${propErr.message}` }, { status: 500 });
    }
    if (!property) {
      return NextResponse.json({ error: `Property not found: ${propertyId}` }, { status: 404 });
    }

    const prop = property as HelmPropertyEmailRow;
    const ownerEmails = (prop.owner_emails ?? []).filter((e) => !!e?.trim());
    if (ownerEmails.length === 0) {
      return NextResponse.json({
        error: `No owner email on file for ${prop.name}. Add one on the property page first.`,
      }, { status: 400 });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const { data: slipsRaw, error: slipsErr } = await sb
      .from('work_slips')
      .select('*')
      .eq('property_id', propertyId)
      .eq('owner_action_required', true)
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });

    if (slipsErr) {
      return NextResponse.json({ error: `Slip lookup failed: ${slipsErr.message}` }, { status: 500 });
    }

    const slips = (slipsRaw ?? []) as WorkSlipRow[];
    if (slips.length === 0) {
      return NextResponse.json({
        error: `No open owner-action items at ${prop.name}. Nothing to draft.`,
      }, { status: 400 });
    }

    const greeting = prop.owner_greeting?.trim() || 'there';
    const subject = slips.length === 1
      ? `${prop.name} - one item needs your input`
      : `${prop.name} - ${slips.length} items need your input`;

    const emailBody = renderBody({
      greeting,
      propertyName: prop.name,
      slips,
    });

    const mime = buildMimeMessage({
      from: `${SEND_FROM.name} <${SEND_FROM.email}>`,
      to: ownerEmails,
      cc: ALWAYS_CC,
      subject,
      body: emailBody,
    });

    const accessToken = await getGmailAccessToken();

    const draftRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: { raw: base64url(mime) } }),
    });

    if (!draftRes.ok) {
      const errText = await draftRes.text();
      const hint = draftRes.status === 403 && /insufficient/i.test(errText)
        ? ' The Gmail OAuth token probably lacks gmail.compose scope. Re-authorize the Gmail OAuth app adding that scope and regenerate GMAIL_REFRESH_TOKEN.'
        : '';
      return NextResponse.json({
        error: `Gmail draft creation failed (${draftRes.status}): ${errText}${hint}`,
      }, { status: 502 });
    }

    const draft = await draftRes.json();
    const draftUrl = `https://mail.google.com/mail/u/0/#drafts/${draft.id}`;

    // Stamp owner_last_contacted_at on each slip we included so the queue can
    // show that the owner has been pinged. Failure here shouldn't fail the
    // whole request -- the draft itself is created.
    try {
      const nowIso = new Date().toISOString();
      const slipIds = slips.map((s) => s.id);
      await sb
        .from('work_slips')
        .update({ owner_last_contacted_at: nowIso, owner_status: 'sent' })
        .in('id', slipIds);
    } catch (stampErr) {
      console.error('draft-owner-email: contacted-at stamp failed', stampErr);
    }

    return NextResponse.json({
      success: true,
      draft_id: draft.id,
      draft_url: draftUrl,
      subject,
      recipients: ownerEmails,
      slip_count: slips.length,
    });
  } catch (err) {
    console.error('draft-owner-email error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
