import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';

/**
 * Inbound sync endpoint: prospective-owner leads captured by the
 * stay-concierge Formspree watcher (Rental Estimator consultation requests
 * landing at hello@). Each submission becomes a CRM row so the lead pipeline
 * lives in Helm instead of Ryan's inbox:
 *
 *   - contacts: matched by email across ALL types (an existing owner filling
 *     the estimator must not become a duplicate lead row); created as
 *     type='lead' tagged 'rental-estimator' when new.
 *   - contact_touches: one per submission, channel='email',
 *     direction='inbound', deduped by the Formspree notification's Gmail
 *     message id (partial unique index from the inbound-capture migration),
 *     so the watcher can replay its whole history safely.
 *
 * Auth: same STAY_CONCIERGE_KEY shared secret as kb-facts / payment-links.
 * Server-to-server only.
 *
 *   POST /api/prospects?key=<STAY_CONCIERGE_KEY>
 *   { submissions: [{ gmail_message_id, name, email, phone, kind, address,
 *                     requested_slot, summary, notes, submitted_at }] }
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
);

const SYNC_AUTHOR = 'stay-concierge@helm';
const LEAD_TAG = 'rental-estimator';

type Submission = {
  gmail_message_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  kind?: string;
  address?: string;
  requested_slot?: string;
  summary?: string;
  notes?: string;
  submitted_at?: string;
};

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;

  let body: { submissions?: Submission[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const submissions = Array.isArray(body?.submissions) ? body.submissions : [];

  let contactsCreated = 0;
  let contactsMatched = 0;
  let touchesAdded = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const sub of submissions) {
    const email = (sub.email || '').trim().toLowerCase();
    const gmailId = (sub.gmail_message_id || '').trim();
    if (!email || !gmailId) {
      skipped += 1;
      continue;
    }

    try {
      // Already captured? The partial unique index makes the insert the real
      // guard; this pre-check just avoids pointless contact work on replays.
      const { data: existingTouch } = await supabase
        .from('contact_touches')
        .select('id')
        .eq('gmail_message_id', gmailId)
        .limit(1);
      if (existingTouch && existingTouch.length > 0) {
        skipped += 1;
        continue;
      }

      // Match by email across all contact types.
      const { data: found, error: findErr } = await supabase
        .from('contacts')
        .select('id, tags, type')
        .contains('emails', [email])
        .limit(1);
      if (findErr) throw new Error(`contact lookup: ${findErr.message}`);

      let contactId: string;
      if (found && found.length > 0) {
        contactId = found[0].id as string;
        contactsMatched += 1;
        const tags: string[] = Array.isArray(found[0].tags) ? found[0].tags : [];
        if (!tags.includes(LEAD_TAG)) {
          await supabase
            .from('contacts')
            .update({ tags: [...tags, LEAD_TAG] })
            .eq('id', contactId);
        }
      } else {
        const { data: created, error: createErr } = await supabase
          .from('contacts')
          .insert({
            type: 'lead',
            name: (sub.name || '').trim() || email,
            emails: [email],
            phone: (sub.phone || '').trim() || null,
            notes: (sub.address || '').trim() ? `Property: ${(sub.address || '').trim()}` : null,
            tags: [LEAD_TAG],
            created_by_email: SYNC_AUTHOR,
          })
          .select('id')
          .single();
        if (createErr || !created) {
          throw new Error(`contact insert: ${createErr?.message || 'no row returned'}`);
        }
        contactId = created.id as string;
        contactsCreated += 1;
      }

      const { error: touchErr } = await supabase.from('contact_touches').insert({
        contact_id: contactId,
        touched_at: (sub.submitted_at || '').trim() || new Date().toISOString(),
        channel: 'email',
        direction: 'inbound',
        summary: (sub.summary || '').trim() || 'Rental Estimator submission',
        notes: (sub.notes || '').trim() || null,
        by_email: SYNC_AUTHOR,
        gmail_message_id: gmailId,
      });
      if (touchErr) {
        // 23505 = unique violation on gmail_message_id: a concurrent replay
        // already recorded it. That's a skip, not an error.
        if (touchErr.code === '23505') {
          skipped += 1;
          continue;
        }
        throw new Error(`touch insert: ${touchErr.message}`);
      }
      touchesAdded += 1;
    } catch (e) {
      errors.push(`${gmailId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    contacts_created: contactsCreated,
    contacts_matched: contactsMatched,
    touches_added: touchesAdded,
    skipped,
    errors,
  });
}
