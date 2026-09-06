/**
 * Turnover notes: what the guest told us about the state they are leaving
 * the house in.
 *
 * Guests routinely mention things that change what the cleaner should do on
 * the way out. Moira at 3 South, 2026-09-04: "we did break one wine glass
 * accidently and an animal got into the trash out back which we cleaned up
 * but some of the glass is in the grass." Nobody was going to remember to
 * tell Rosa, and none of Helm's rails carried it:
 *
 *   - a WORK SLIP (messages-to-slips.ts) is for a durable property issue.
 *     Broken glass in the grass is not a repair and would sit open forever.
 *   - a CHECKOUT ADJUSTMENT (mine-checkout-changes.ts) moves the day or the
 *     time. This changes neither.
 *
 * So this is the third thing, and it is deliberately the shortest-lived:
 * useful for exactly one clean, worthless the day after.
 *
 * NOTHING HERE REACHES THE CLEANERS ON ITS OWN. Every mined note lands
 * 'proposed' and shows on the approval card with the guest's own words
 * beside it. Only an operator's tap makes it 'added', and only then does
 * composeDigestBody render it into the message. That is the same posture as
 * the digest itself: the machine proposes, a human sends.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { z } from 'zod';
import {
  listConversations,
  getConversationThread,
  isStayConciergeConfigured,
  type ConversationSummary,
  type ThreadMessage,
} from '@/lib/stay-concierge';

const MAX_THREAD_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 1_200;
const MAX_TRANSCRIPT_CHARS = 14_000;
/** Only stays leaving within this many days can still be acted on. */
const DEFAULT_HORIZON_DAYS = 3;
/** The 3-day window routinely holds 20-plus checkouts across the fleet, and
 *  a note missed is the whole point of the feature. One model call per
 *  thread, once a day, is cheap enough to cover all of them. */
const DEFAULT_MAX_THREADS = 30;

export type TurnoverNote = {
  id: string;
  property_id: string;
  service_date: string;
  stay_check_in: string | null;
  source: string;
  source_key: string | null;
  note_pt: string;
  note_en: string;
  evidence: string | null;
  category: string | null;
  confidence: string | null;
  status: 'proposed' | 'added' | 'dismissed';
};

export type MineNotesResult = {
  conversationsListed: number;
  threadsScanned: number;
  notesFound: number;
  recorded: number;
  alreadyKnown: number;
  skippedNoProperty: number;
  errors: string[];
};

const NoteSchema = z.object({
  notes: z
    .array(
      z.object({
        note_en: z
          .string()
          .describe('One short line telling the cleaner what to do or look for. Imperative.'),
        note_pt: z.string().describe('The same line in Brazilian Portuguese, plain and short.'),
        evidence: z.string().describe("The guest's own words, quoted verbatim, that establish it."),
        category: z.enum(['breakage', 'spill', 'pet', 'trash', 'left_behind', 'access', 'other']),
        confidence: z.enum(['high', 'medium', 'low']),
      }),
    )
    .describe('Empty for almost every thread.'),
});

function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function buildTranscript(messages: ThreadMessage[]): string {
  const recent = messages.slice(-MAX_THREAD_MESSAGES);
  const lines: string[] = [];
  for (const m of recent) {
    const body = (m.body || '').trim();
    if (!body) continue;
    const clipped =
      body.length > MAX_MESSAGE_CHARS ? `${body.slice(0, MAX_MESSAGE_CHARS)} [...]` : body;
    lines.push(`[${(m.at || '').slice(0, 10)}] ${m.who === 'guest' ? 'GUEST' : 'HOST'}: ${clipped}`);
  }
  let out = lines.join('\n\n');
  while (out.length > MAX_TRANSCRIPT_CHARS && lines.length > 4) {
    lines.shift();
    out = lines.join('\n\n');
  }
  return out;
}

async function mineThread(
  c: ConversationSummary,
  messages: ThreadMessage[],
  propertyName: string,
): Promise<z.infer<typeof NoteSchema>['notes']> {
  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4.5',
    schema: NoteSchema,
    system: `You read guest message threads for Rising Tide STR, a vacation-rental manager on Cape Ann MA, and pull out anything the housekeeping crew needs to know about THE STATE THE GUEST IS LEAVING THE HOUSE IN.

The crew gets one short SMS the evening before. A line you write costs them attention on a real turnover, so precision beats recall. Most threads produce nothing. Return an empty array and that is the normal, correct answer.

EXTRACT only a physical fact about this house, reported in this thread, that changes what the cleaner should do or look for on this one turnover:
  - something broken or spilled and where it is ("some of the glass is in the grass out back")
  - a mess needing more than a normal clean (pet accident, animal in the trash, sand everywhere)
  - something the guest left behind or lost that the cleaner should look for
  - an access or entry detail that will differ for this turnover

DO NOT EXTRACT, because another part of Helm already owns it:
  - anything to REPAIR or REPLACE, or an appliance that stopped working. Those become work slips and outlive the turnover.
  - a request to STOCK or ADD something (towels, cutting board, coffee). Inventory, not this.
  - checkout TIME or DATE changes, late checkouts, extensions. A different miner owns those.
  - compliments, complaints, or feedback with nothing physical for a cleaner to act on
  - anything the guest says they already fully handled and left no trace of

If the guest both made a mess AND cleaned it up, extract only the part that is still there. Moira's message is the model case: she broke a glass and cleaned it up, but said "some of the glass is in the grass", so the note is about the grass and nothing else.

Write note_en as one short imperative line a busy person reads in two seconds. Write note_pt as the same line in plain Brazilian Portuguese. Quote the guest verbatim in evidence so the operator can check you.`,
    prompt: `Property: ${propertyName}
Guest: ${c.guest_full || 'unknown'}
Booked stay: check-in ${c.check_in || '?'}, checkout ${c.check_out || '?'} (${c.channel || 'Direct'}, ${c.stay_status || 'unknown'})

Transcript (oldest first):
${buildTranscript(messages)}`,
  });
  return object.notes;
}

/**
 * Scan recent guest threads for stays leaving inside the horizon and record
 * what the crew would want to know. Everything lands 'proposed'.
 */
export async function mineTurnoverNotes(
  supabase: SupabaseClient,
  opts?: { horizonDays?: number; maxThreads?: number; conversationId?: string },
): Promise<MineNotesResult> {
  const result: MineNotesResult = {
    conversationsListed: 0,
    threadsScanned: 0,
    notesFound: 0,
    recorded: 0,
    alreadyKnown: 0,
    skippedNoProperty: 0,
    errors: [],
  };
  if (!isStayConciergeConfigured()) {
    result.errors.push('stay-concierge not configured (STAY_CONCIERGE_URL/KEY)');
    return result;
  }

  const today = todayET();
  const horizonEnd = addDays(today, opts?.horizonDays ?? DEFAULT_HORIZON_DAYS);

  const listRes = await listConversations(30);
  if (!listRes.ok) {
    result.errors.push(`listConversations failed: ${listRes.error.kind}`);
    return result;
  }
  const conversations = listRes.data.conversations ?? [];
  result.conversationsListed = conversations.length;

  // Map the concierge's listing_id onto a Helm property. Same join the
  // checkout miner uses.
  const [{ data: listingRows }, { data: propRows }] = await Promise.all([
    supabase.from('guesty_listings').select('listing_id, property_id'),
    supabase.from('properties').select('id, name'),
  ]);
  const propertyByListing = new Map(
    ((listingRows ?? []) as Array<{ listing_id: string; property_id: string | null }>)
      .filter((r) => r.property_id)
      .map((r) => [r.listing_id, r.property_id as string]),
  );
  const nameById = new Map(
    ((propRows ?? []) as Array<{ id: string; name: string | null }>).map((r) => [r.id, r.name ?? r.id]),
  );

  const candidates = conversations
    .filter((c) => c.conversation_id)
    .filter((c) => (opts?.conversationId ? c.conversation_id === opts.conversationId : true))
    // Only stays whose checkout is still ahead of us and inside the horizon.
    // A note about a house that was already cleaned helps nobody.
    .filter((c) => opts?.conversationId || (c.check_out >= today && c.check_out <= horizonEnd))
    .slice(0, opts?.conversationId ? 1 : (opts?.maxThreads ?? DEFAULT_MAX_THREADS));

  for (const c of candidates) {
    const propertyId = propertyByListing.get(c.listing_id);
    if (!propertyId) {
      result.skippedNoProperty += 1;
      continue;
    }
    const threadRes = await getConversationThread(c.conversation_id);
    if (!threadRes.ok) {
      result.errors.push(`thread ${c.conversation_id}: ${threadRes.error.kind}`);
      continue;
    }
    result.threadsScanned += 1;

    let notes: z.infer<typeof NoteSchema>['notes'];
    try {
      notes = await mineThread(c, threadRes.data.messages ?? [], nameById.get(propertyId) ?? propertyId);
    } catch (err) {
      result.errors.push(
        `mine ${c.conversation_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    for (const n of notes) {
      const noteEn = (n.note_en || '').trim();
      const notePt = (n.note_pt || '').trim();
      if (!noteEn || !notePt) continue;
      result.notesFound += 1;
      const sourceKey = `gnote:${c.conversation_id}:${slugOf(noteEn)}`;
      // The key is derived from the note itself, so a re-scan of the same
      // thread re-derives it and the unique index makes this a no-op. A
      // note the operator already dismissed therefore stays dismissed.
      const { error } = await supabase.from('cleaner_turnover_notes').insert({
        property_id: propertyId,
        service_date: c.check_out,
        stay_check_in: c.check_in || null,
        source: 'guest_message',
        source_key: sourceKey,
        note_pt: notePt.slice(0, 240),
        note_en: noteEn.slice(0, 240),
        evidence: (n.evidence || '').slice(0, 600),
        category: n.category,
        confidence: n.confidence,
        status: 'proposed',
      });
      if (!error) result.recorded += 1;
      else if (error.code === '23505') result.alreadyKnown += 1;
      else result.errors.push(`insert ${sourceKey}: ${error.message}`);
    }
  }
  return result;
}

/** Notes for a service date, newest first. */
export async function loadTurnoverNotes(
  supabase: SupabaseClient,
  serviceDate: string,
  statuses: Array<'proposed' | 'added' | 'dismissed'> = ['proposed', 'added'],
): Promise<TurnoverNote[]> {
  const { data } = await supabase
    .from('cleaner_turnover_notes')
    .select('*')
    .eq('service_date', serviceDate)
    .in('status', statuses)
    .order('created_at', { ascending: true });
  return (data ?? []) as TurnoverNote[];
}

/**
 * The added notes, keyed by property, for composeDigestBody. Read errors
 * return an empty map: a message missing an optional note is a smaller
 * failure than a message that fails to send.
 */
export async function loadAddedNotesByProperty(
  supabase: SupabaseClient,
  serviceDate: string,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const { data, error } = await supabase
    .from('cleaner_turnover_notes')
    .select('property_id, note_pt')
    .eq('service_date', serviceDate)
    .eq('status', 'added')
    .order('created_at', { ascending: true });
  if (error || !data) return out;
  for (const r of data as Array<{ property_id: string; note_pt: string }>) {
    const arr = out.get(r.property_id) ?? [];
    arr.push(r.note_pt);
    out.set(r.property_id, arr);
  }
  return out;
}

export async function decideTurnoverNote(
  supabase: SupabaseClient,
  id: string,
  status: 'added' | 'dismissed',
  who: string,
): Promise<void> {
  await supabase
    .from('cleaner_turnover_notes')
    .update({ status, decided_by: who, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
}
