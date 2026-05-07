import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { PROPERTIES } from '@/lib/properties';

/**
 * Reconcile owner-statement emails (what we actually sent) against the
 * Helm DB (what we now think the right numbers are). Run end-of-month
 * after the sends are out -- catches:
 *
 *   - emails that went out but Helm has different numbers (data drift
 *     since the send: a late repair, a corrected fee, a refund booked
 *     after-the-fact)
 *   - properties Helm has a statement for but no send went out (the
 *     close didn't actually finish for that owner)
 *   - properties an email went out for but Helm has no record (a send
 *     happened from outside Helm and we never ingested the underlying
 *     statement -- e.g. Melissa @ Supporting Strategies sends from the
 *     legacy Perfection / RTC@ssh.myworkplace.co system)
 *
 * Why subject patterns and not a single regex? In April 2026 alone we
 * saw three different subject conventions across senders:
 *   - Helm portal: "April 2026 Owner Statement, 17 Beach Rd"
 *   - RTC/Perfection: "April Owner Statement - 20 Hammond"
 *   - RTC typo:       "April Owner Statment - 73 Rocky Neck"  (no 'e')
 * The reconciler tolerates all three by searching multiple subject
 * variants and parsing the property name out of whatever's after the
 * separator.
 *
 * Side effect: writes a `data_gaps` row of type 'email_payout_mismatch'
 * for each divergence > $1, so the existing dashboard gap-resolution
 * flow can carry the explanation. Idempotent: re-running deletes any
 * unresolved rows of that gap_type for the affected property_statement
 * before inserting fresh ones, so the operator's "explained" state on
 * a resolved row is never overwritten.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const GMAIL_CLIENT_ID = () => process.env.GMAIL_CLIENT_ID || '';
const GMAIL_CLIENT_SECRET = () => process.env.GMAIL_CLIENT_SECRET || '';
const GMAIL_REFRESH_TOKEN = () => process.env.GMAIL_REFRESH_TOKEN || '';

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
  return data.access_token as string;
}

type GmailMessageMeta = {
  id: string;
  threadId: string;
  snippet: string;
  payload: {
    headers: { name: string; value: string }[];
  };
  internalDate: string;
};

/**
 * Search Gmail for owner-statement messages in the given month. We
 * search a 60-day window starting from the statement month so the
 * search catches sends that happen in the first week of the next
 * month (typical for Rising Tide -- April statements often go out
 * May 1-5).
 */
async function searchOwnerStatements(accessToken: string, month: string): Promise<GmailMessageMeta[]> {
  const [yStr, mStr] = month.split('-');
  const y = Number(yStr), m = Number(mStr);
  // Month start. End is two months later (covers late sends).
  const startDate = `${y}/${String(m).padStart(2, '0')}/01`;
  const endY = m === 11 ? y + 1 : (m === 12 ? y + 1 : y);
  const endM = ((m + 1) % 12) + 1; // m+2, wrapping
  const endDate = `${endY}/${String(endM).padStart(2, '0')}/01`;

  // Combined query: any of the three known subject variants in the time window.
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const subjectClauses = [
    `subject:"${monthName} Owner Statement"`,
    `subject:"${monthName} Owner Statment"`,   // legacy RTC typo, intentional
    `subject:"${monthName} ${y} Owner Statement"`, // Helm portal format
  ];
  const q = `(${subjectClauses.join(' OR ')}) after:${startDate} before:${endDate}`;

  const messages: GmailMessageMeta[] = [];
  let pageToken: string | undefined;
  // Cap pagination at 5 pages (~500 messages); a single month never approaches that.
  for (let page = 0; page < 5; page++) {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', q);
    url.searchParams.set('maxResults', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const listRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) {
      throw new Error(`Gmail list failed: ${listRes.status} ${await listRes.text()}`);
    }
    const list = await listRes.json() as { messages?: { id: string; threadId: string }[]; nextPageToken?: string };
    if (!list.messages || list.messages.length === 0) break;

    // Fetch metadata for each message (subject, from, snippet, date).
    // Sequential: Gmail rate-limits parallel batches and the volume is small.
    for (const m of list.messages) {
      const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
      const detRes = await fetch(detailUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!detRes.ok) continue;
      const det = await detRes.json() as GmailMessageMeta;
      messages.push(det);
    }

    if (!list.nextPageToken) break;
    pageToken = list.nextPageToken;
  }

  return messages;
}

function header(msg: GmailMessageMeta, name: string): string {
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

/**
 * Extract the property short-name token from a subject line. Handles
 * all three known formats. Returns the trailing chunk (everything after
 * the separator after "Statement" / "Statment" / "Statemnt"); the caller
 * fuzzy-matches it to a property_id.
 */
function propertyNameFromSubject(subject: string): string | null {
  const m = subject.match(/(?:Statement|Statment|Statemnt)\s*[,\-]\s*(.+?)\s*$/i);
  if (!m) return null;
  // Drop "St" / "Rd" / "Ave" suffixes that some senders include and others don't.
  return m[1]
    .replace(/\s+(?:St|Rd|Ave|Avenue|Road|Street|Lane|Ln)\.?$/i, '')
    .trim();
}

/**
 * Extract the first dollar amount from the snippet (Gmail's snippet
 * field, ~150 chars, usually contains a phrase like "Your payout of
 * $2355.02 has been processed"). Returns null if no $ amount found
 * (typical for Helm portal sends, which only say "Please see attached
 * statement" with the figures on the PDF).
 */
function dollarFromSnippet(snippet: string): number | null {
  // Match the first $-prefixed amount, allowing optional comma thousands separator.
  const m = snippet.match(/\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+\.[0-9]{2})/);
  if (!m) return null;
  const cleaned = m[1].replace(/,/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function matchPropertyId(nameFragment: string): string | null {
  const lc = nameFragment.toLowerCase().trim();
  if (!lc) return null;
  // Exact short-name match wins. Fall back to listing_match substring.
  for (const [id, p] of Object.entries(PROPERTIES)) {
    if (p.name.toLowerCase() === lc) return id;
  }
  for (const [id, p] of Object.entries(PROPERTIES)) {
    if (lc.includes(p.listing_match)) return id;
  }
  return null;
}

export type ReconcileRow = {
  property_id: string;
  property_name: string;
  emailed_payout: number | null;
  helm_payout: number | null;
  delta: number | null;          // emailed - helm; null when either side missing
  email_message_id: string | null;
  email_sender: string | null;
  email_subject: string | null;
  email_date: string | null;     // ISO
  status: 'matched' | 'diverged' | 'helm_only' | 'email_only' | 'no_amount_in_email';
};

export type ReconcileResponse = {
  success: true;
  month: string;
  emails_found: number;
  emails_unparsed: { subject: string; sender: string; reason: string }[];
  rows: ReconcileRow[];
  gaps_written: number;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({} as { month?: string }));
    const month: string = body.month || '';
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month is required (YYYY-MM)' }, { status: 400 });
    }

    const accessToken = await getGmailAccessToken();
    const messages = await searchOwnerStatements(accessToken, month);

    // Bucket by property_id. Same property may have multiple sends (Helm
    // portal early send + RTC official send -- we saw both in April).
    // Keep the LATEST send per property since that's the most-recent
    // record the owner has. The prior is informational.
    type EmailRecord = {
      message_id: string;
      thread_id: string;
      subject: string;
      sender: string;
      date_iso: string;
      payout: number | null;
    };
    const emailsByProperty = new Map<string, EmailRecord>();
    const unparsed: { subject: string; sender: string; reason: string }[] = [];

    for (const msg of messages) {
      const subject = header(msg, 'Subject');
      const sender = header(msg, 'From');
      const internalMs = Number(msg.internalDate || '0');
      const dateIso = internalMs ? new Date(internalMs).toISOString() : '';

      // Skip forwards / replies -- those duplicate the original send and
      // their snippets contain the original payout but the conversation is
      // owner-side, not our side.
      if (/^(?:re|fwd|fw):/i.test(subject)) continue;

      const propName = propertyNameFromSubject(subject);
      if (!propName) {
        unparsed.push({ subject, sender, reason: 'no_property_in_subject' });
        continue;
      }
      const propId = matchPropertyId(propName);
      if (!propId) {
        unparsed.push({ subject, sender, reason: `unknown_property: "${propName}"` });
        continue;
      }

      const payout = dollarFromSnippet(msg.snippet || '');

      const existing = emailsByProperty.get(propId);
      if (!existing || (dateIso && dateIso > existing.date_iso)) {
        emailsByProperty.set(propId, {
          message_id: msg.id,
          thread_id: msg.threadId,
          subject,
          sender,
          date_iso: dateIso,
          payout,
        });
      }
    }

    // Pull the Helm period + statements for the month.
    const { data: period } = await supabase
      .from('statement_periods')
      .select('id')
      .eq('month', month)
      .single();

    type HelmStmt = {
      id: string;
      property_id: string;
      property_name: string;
      owner_payout: number;
    };
    const helmByProperty = new Map<string, HelmStmt>();
    if (period) {
      const { data: stmts } = await supabase
        .from('property_statements')
        .select('id, property_id, property_name, owner_payout')
        .eq('period_id', period.id);
      ((stmts || []) as HelmStmt[]).forEach(s => helmByProperty.set(s.property_id, s));
    }

    // Build rows for every property we see in EITHER side.
    const seen = new Set<string>([
      ...emailsByProperty.keys(),
      ...helmByProperty.keys(),
    ]);

    const rows: ReconcileRow[] = [];
    let gapsWritten = 0;

    for (const propertyId of seen) {
      const email = emailsByProperty.get(propertyId);
      const helm = helmByProperty.get(propertyId);
      const propName = helm?.property_name || PROPERTIES[propertyId]?.name || propertyId;

      let status: ReconcileRow['status'];
      let delta: number | null = null;

      if (email && helm) {
        if (email.payout == null) {
          status = 'no_amount_in_email';
        } else {
          delta = Math.round((email.payout - helm.owner_payout) * 100) / 100;
          status = Math.abs(delta) < 1 ? 'matched' : 'diverged';
        }
      } else if (helm && !email) {
        status = 'helm_only';
      } else {
        status = 'email_only';
      }

      const row: ReconcileRow = {
        property_id: propertyId,
        property_name: propName,
        emailed_payout: email?.payout ?? null,
        helm_payout: helm?.owner_payout ?? null,
        delta,
        email_message_id: email?.message_id ?? null,
        email_sender: email?.sender ?? null,
        email_subject: email?.subject ?? null,
        email_date: email?.date_iso || null,
        status,
      };
      rows.push(row);

      // Write a data_gap for unresolved divergences > $1. Skip resolved
      // gaps so explanations the operator already recorded survive.
      if (helm && status === 'diverged') {
        // Delete any existing UNRESOLVED gap of this type for the statement
        // before re-inserting; preserves resolved ones.
        await supabase
          .from('data_gaps')
          .delete()
          .eq('property_statement_id', helm.id)
          .eq('gap_type', 'email_payout_mismatch')
          .eq('resolved', false);

        // If a resolved gap already exists for the same delta and email,
        // assume the operator's explanation still applies and don't
        // re-flag. (Match by delta value to within a cent.)
        const { data: priorResolved } = await supabase
          .from('data_gaps')
          .select('id, expected_data')
          .eq('property_statement_id', helm.id)
          .eq('gap_type', 'email_payout_mismatch')
          .eq('resolved', true);
        const alreadyExplained = (priorResolved || []).some(p => {
          const m = (p.expected_data || '').match(/delta[:\s]+\$?(-?\d+\.\d{2})/i);
          if (!m) return false;
          const priorDelta = Number.parseFloat(m[1]);
          return Math.abs(priorDelta - (delta || 0)) < 0.01;
        });
        if (alreadyExplained) continue;

        await supabase.from('data_gaps').insert({
          property_statement_id: helm.id,
          gap_type: 'email_payout_mismatch',
          severity: 'warning',
          description: `Owner statement emailed for $${(email!.payout!).toFixed(2)} but Helm now shows $${helm.owner_payout.toFixed(2)} (delta: ${delta! >= 0 ? '+' : ''}$${(delta || 0).toFixed(2)}).`,
          expected_data: `Sent ${email!.date_iso?.slice(0, 10) || '?'} via ${email!.sender}. delta: ${delta}`,
        });
        gapsWritten++;
      }
    }

    // Sort: divergences first (most useful), then helm_only / email_only,
    // then matched, then no_amount_in_email.
    const order: Record<ReconcileRow['status'], number> = {
      diverged: 0, helm_only: 1, email_only: 2, no_amount_in_email: 3, matched: 4,
    };
    rows.sort((a, b) => order[a.status] - order[b.status] || a.property_name.localeCompare(b.property_name));

    const response: ReconcileResponse = {
      success: true,
      month,
      emails_found: messages.length,
      emails_unparsed: unparsed,
      rows,
      gaps_written: gapsWritten,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error('reconcile-emails error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
