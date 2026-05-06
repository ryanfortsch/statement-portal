import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ALWAYS_CC, SEND_FROM } from '@/lib/properties';
import type { WorkSlipRow, WorkSlipOwnerActionType } from '@/lib/work-types';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/crm/draft-contact-email
 * Body: { contact_id: string }
 *
 * Cross-property version of /api/work/draft-owner-email (#136). Pulls a
 * CRM contact + every open owner-action work slip across all of the
 * contact's linked_property_ids and drafts a single email listing each
 * item, grouped by property.
 *
 * Stamps owner_last_contacted_at + owner_status='sent' on every
 * included slip and bumps the contact's properties' off-thread
 * last-contacted timestamps via the existing Draft Owner Email
 * pattern (slip-driven path only — properties.owner_last_contacted_at
 * stays untouched, that's for free-form touches).
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
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
  const headers = [`From: ${from}`, `To: ${to.join(', ')}`];
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

type ContactRow = {
  id: string;
  name: string;
  emails: string[] | null;
  linked_property_ids: string[] | null;
};

type PropertyRow = {
  id: string;
  name: string;
};

function renderBody(args: {
  greeting: string;
  totalCount: number;
  byProperty: Map<string, { name: string; slips: WorkSlipRow[] }>;
}): string {
  const { greeting, totalCount, byProperty } = args;

  const propertyCount = byProperty.size;
  const intro = totalCount === 1
    ? `One item across your properties needs your input.`
    : `${totalCount} items across ${propertyCount === 1 ? 'your property' : `your ${propertyCount} properties`} need your input.`;

  const sections: string[] = [];
  let counter = 1;
  for (const [, group] of byProperty) {
    const lines: string[] = [];
    lines.push(`— ${group.name} —`);
    for (const s of group.slips) {
      const num = String(counter).padStart(2, '0');
      counter += 1;
      lines.push('');
      lines.push(`${num}. ${s.title}`);
      if (s.owner_action_type) lines.push(`    ${ACTION_TYPE_LABELS[s.owner_action_type]}`);
      if (s.location) lines.push(`    Location: ${s.location}`);
      if (s.description?.trim()) {
        lines.push('');
        lines.push(`    ${s.description.trim().split('\n').join('\n    ')}`);
      }
      if (s.owner_action_notes?.trim()) {
        lines.push('');
        lines.push(`    Notes: ${s.owner_action_notes.trim().split('\n').join('\n    ')}`);
      }
    }
    sections.push(lines.join('\n'));
  }

  const closing = totalCount === 1
    ? 'Reply when you have a moment with how you\'d like us to handle it.'
    : 'Reply when you have a moment with how you\'d like us to handle each.';

  return [
    `Hi ${greeting},`,
    '',
    intro,
    '',
    sections.join('\n\n'),
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
    const contactId: string = (body && typeof body === 'object' && 'contact_id' in body && typeof body.contact_id === 'string')
      ? body.contact_id
      : '';

    if (!contactId) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });
    }

    const sb = getSupabase();

    const { data: contact, error: contactErr } = await sb
      .from('contacts')
      .select('id, name, emails, linked_property_ids')
      .eq('id', contactId)
      .maybeSingle();

    if (contactErr) {
      return NextResponse.json({ error: `Lookup failed: ${contactErr.message}` }, { status: 500 });
    }
    if (!contact) {
      return NextResponse.json({ error: `Contact not found: ${contactId}` }, { status: 404 });
    }

    const c = contact as ContactRow;
    const emails = (c.emails ?? []).filter((e) => !!e?.trim());
    if (emails.length === 0) {
      return NextResponse.json({
        error: `No email on file for ${c.name}. Add one on the contact page first.`,
      }, { status: 400 });
    }

    const linkedIds = c.linked_property_ids ?? [];
    if (linkedIds.length === 0) {
      return NextResponse.json({
        error: `${c.name} has no linked properties. Add at least one property to draft a cross-property check-in.`,
      }, { status: 400 });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const [{ data: slipsRaw, error: slipsErr }, { data: propertiesRaw }] = await Promise.all([
      sb
        .from('work_slips')
        .select('*')
        .in('property_id', linkedIds)
        .eq('owner_action_required', true)
        .in('status', ACTIVE_WORK_SLIP_STATUSES)
        .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true }),
      sb
        .from('properties')
        .select('id, name')
        .in('id', linkedIds),
    ]);

    if (slipsErr) {
      return NextResponse.json({ error: `Slip lookup failed: ${slipsErr.message}` }, { status: 500 });
    }

    const slips = (slipsRaw ?? []) as WorkSlipRow[];
    if (slips.length === 0) {
      return NextResponse.json({
        error: `No open owner-action items across ${c.name}'s properties. Nothing to draft.`,
      }, { status: 400 });
    }

    const propertyMap = new Map<string, string>(
      ((propertiesRaw ?? []) as PropertyRow[]).map((p) => [p.id, p.name])
    );

    // Bucket slips by property, preserving the priority order within each.
    const byProperty = new Map<string, { name: string; slips: WorkSlipRow[] }>();
    for (const s of slips) {
      const name = propertyMap.get(s.property_id) ?? '(property)';
      const bucket = byProperty.get(s.property_id) ?? { name, slips: [] };
      bucket.slips.push(s);
      byProperty.set(s.property_id, bucket);
    }

    const greeting = c.name.split(' ')[0] || 'there';
    const subject = slips.length === 1
      ? `${c.name} - one item needs your input`
      : `${c.name} - ${slips.length} items across your properties`;

    const emailBody = renderBody({
      greeting,
      totalCount: slips.length,
      byProperty,
    });

    const mime = buildMimeMessage({
      from: `${SEND_FROM.name} <${SEND_FROM.email}>`,
      to: emails,
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

    // Stamp owner_last_contacted_at on each included slip + flip
    // owner_status to 'sent'. Failure here doesn't fail the whole
    // request — the draft itself is created.
    try {
      const nowIso = new Date().toISOString();
      const slipIds = slips.map((s) => s.id);
      await sb
        .from('work_slips')
        .update({ owner_last_contacted_at: nowIso, owner_status: 'sent' })
        .in('id', slipIds);
    } catch (stampErr) {
      console.error('draft-contact-email: contacted-at stamp failed', stampErr);
    }

    return NextResponse.json({
      success: true,
      draft_id: draft.id,
      draft_url: draftUrl,
      subject,
      recipients: emails,
      slip_count: slips.length,
      property_count: byProperty.size,
    });
  } catch (err) {
    console.error('draft-contact-email error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
