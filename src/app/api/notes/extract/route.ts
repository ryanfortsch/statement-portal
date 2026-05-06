import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { z } from 'zod';
import { PROPERTIES } from '@/lib/properties';

/**
 * LLM extraction step for the "Add note" UI.
 *
 * Operator pastes an email or describes an eccentricity ("Guesty
 * auto-charged guest, I refunded half, the net Stripe payout was
 * $175.02..."). We can't ask Allie or whoever to format these in JSON,
 * so this route normalizes them into structured fields the operator
 * can confirm before saving.
 *
 * Flow:
 *   1. Read pasted text + optional attachment text from FormData
 *   2. Send to Claude via the Vercel AI Gateway (provider/model strings,
 *      no @ai-sdk/anthropic provider package -- per Vercel platform default)
 *   3. Server-side fuzzy-match the LLM's guest_name_match guess against
 *      reservations + guesty_reservations to surface confirmation_code
 *      candidates
 *   4. Return everything to the client; the modal renders an editable
 *      confirmation step before /api/notes/save persists
 *
 * Why two passes (LLM then DB match)? Allie's emails almost never include
 * the confirmation code, and the canonical name in our DB might be
 * "Evan Friese" while she writes "Evan F" or just "the Brier Neck guy
 * who got refunded." The LLM is good at pulling out a name; SQL fuzzy
 * matching is reliable at finding the actual reservation row. Doing
 * either alone is worse than chaining them.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const ExtractedNote = z.object({
  guest_name_match: z.string().describe(
    'The guest name as best inferred from the operator input. Full name when present; partial name otherwise. Empty string if no guest is mentioned.'
  ),
  property_match: z.string().describe(
    'The Rising Tide property as best inferred. Use the property\'s short name (e.g. "4 Brier Neck", "20 Enon", "21 Horton"). Empty string if not determinable.'
  ),
  body: z.string().describe(
    'A clean factual summary in 1-3 sentences, suitable to display below the affected reservation on an accounting statement. Include specific dollar amounts and dates the input mentions. Do not editorialize or add information not in the input.'
  ),
  amounts_referenced: z.array(z.number()).describe(
    'Every dollar amount mentioned, as numbers. Negative for refunds, debits, or money out (e.g. -150.00). Positive for deposits, credits, or money in (e.g. 175.02). Empty array if none.'
  ),
  dates_referenced: z.array(z.string()).describe(
    'Every date mentioned, formatted as YYYY-MM-DD. Empty array if none.'
  ),
  confidence: z.enum(['high', 'medium', 'low']).describe(
    'How confident the extractor is in guest_name_match and property_match together. "high" only when both are unambiguous in the input.'
  ),
});

export type ExtractedNote = z.infer<typeof ExtractedNote>;

export type ReservationCandidate = {
  confirmation_code: string;
  guest_name: string;
  property_id: string;
  property_name: string;
  check_in: string | null;
  check_out: string | null;
  source: 'reservations' | 'guesty_reservations';
};

export type ExtractResponse = {
  extraction: ExtractedNote;
  property_id_match: string | null; // id like "4_brier_neck" if property_match resolves cleanly
  candidates: ReservationCandidate[];
};

/**
 * Best-effort text extraction from the uploaded attachment. PDFs run
 * through pdf-parse (already in the project for Guesty statements);
 * everything else we treat as text. Images aren't OCR'd in v1 -- the
 * operator can describe what's in them in the textarea instead.
 */
async function extractAttachmentText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    const buffer = Buffer.from(await file.arrayBuffer());
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    const data = await pdfParse(buffer);
    return (data.text || '').slice(0, 20000); // hard cap to keep prompts bounded
  }
  if (name.endsWith('.eml') || name.endsWith('.txt') || name.endsWith('.csv') || name.endsWith('.html') || file.type.startsWith('text/')) {
    return (await file.text()).slice(0, 20000);
  }
  // Unknown type -- return empty and let the LLM rely on the textarea.
  return '';
}

function normalizePropertyMatch(propMatch: string): string | null {
  const m = propMatch.trim().toLowerCase();
  if (!m) return null;
  for (const [id, p] of Object.entries(PROPERTIES)) {
    if (m.includes(p.listing_match)) return id;
    if (m.includes(p.name.toLowerCase())) return id;
    if (m.includes(p.owner_last.toLowerCase())) return id;
  }
  return null;
}

async function findCandidates(
  guestName: string,
  propertyId: string | null,
): Promise<ReservationCandidate[]> {
  const guestLc = guestName.trim().toLowerCase();
  if (!guestLc) return [];

  // Search reservations table first (in-period rows we've ingested) and
  // guesty_reservations (covers future stays not yet on a statement).
  // We keep this simple: ilike match on guest_name, optionally narrowed
  // by property. Postgres handles the wildcards.
  const pattern = `%${guestLc.replace(/[%_]/g, '')}%`;

  type ResRow = {
    confirmation_code: string;
    guest_name: string | null;
    check_in: string | null;
    check_out: string | null;
    property_statement_id: string;
  };
  const resQuery = supabase
    .from('reservations')
    .select('confirmation_code, guest_name, check_in, check_out, property_statement_id')
    .ilike('guest_name', pattern)
    .limit(15);
  const { data: resRows } = await resQuery;

  // Map property_statement_id -> property_id for the reservations rows.
  const stmtIds = (resRows || []).map(r => r.property_statement_id);
  const stmtMap = new Map<string, { property_id: string; property_name: string }>();
  if (stmtIds.length > 0) {
    const { data: stmts } = await supabase
      .from('property_statements')
      .select('id, property_id, property_name')
      .in('id', stmtIds);
    (stmts || []).forEach(s => stmtMap.set(s.id as string, {
      property_id: s.property_id as string,
      property_name: s.property_name as string,
    }));
  }

  type GuestyRow = {
    confirmation_code: string;
    guest_name: string | null;
    check_in: string | null;
    check_out: string | null;
    property_id: string;
  };
  let guestyQuery = supabase
    .from('guesty_reservations')
    .select('confirmation_code, guest_name, check_in, check_out, property_id')
    .ilike('guest_name', pattern)
    .limit(15);
  if (propertyId) guestyQuery = guestyQuery.eq('property_id', propertyId);
  const { data: guestyRows } = await guestyQuery;

  const candidates: ReservationCandidate[] = [];

  for (const r of (resRows || []) as ResRow[]) {
    const stmt = stmtMap.get(r.property_statement_id);
    if (!stmt) continue;
    if (propertyId && stmt.property_id !== propertyId) continue;
    candidates.push({
      confirmation_code: r.confirmation_code,
      guest_name: r.guest_name || '',
      property_id: stmt.property_id,
      property_name: stmt.property_name,
      check_in: r.check_in,
      check_out: r.check_out,
      source: 'reservations',
    });
  }

  for (const g of (guestyRows || []) as GuestyRow[]) {
    if (candidates.some(c => c.confirmation_code === g.confirmation_code)) continue;
    const propName = PROPERTIES[g.property_id]?.name || g.property_id;
    candidates.push({
      confirmation_code: g.confirmation_code,
      guest_name: g.guest_name || '',
      property_id: g.property_id,
      property_name: propName,
      check_in: g.check_in,
      check_out: g.check_out,
      source: 'guesty_reservations',
    });
  }

  // Sort by check_in desc (most recent / upcoming stays first), nulls last.
  candidates.sort((a, b) => {
    if (!a.check_in && !b.check_in) return 0;
    if (!a.check_in) return 1;
    if (!b.check_in) return -1;
    return b.check_in.localeCompare(a.check_in);
  });

  return candidates.slice(0, 8);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const text = ((formData.get('text') as string) || '').trim();
    const attachment = formData.get('attachment') as File | null;

    if (!text && !attachment) {
      return NextResponse.json({ error: 'Provide text or an attachment' }, { status: 400 });
    }

    let attachmentText = '';
    if (attachment && attachment.size > 0) {
      attachmentText = await extractAttachmentText(attachment);
    }

    // Build the property reference list for the LLM. Just the short names
    // and owner last names so it can resolve "Brier Neck" or "Snyder" to
    // the right property without us pre-pasting all the addresses.
    const propertyList = Object.values(PROPERTIES)
      .map(p => `${p.name} (owner: ${p.owner_last})`)
      .join('\n');

    const today = new Date().toISOString().slice(0, 10);

    const { object: extraction } = await generateObject({
      model: 'anthropic/claude-sonnet-4.5',
      schema: ExtractedNote,
      system: `You are extracting a structured "reservation note" from a Rising Tide STR operator's freeform input. The note will be displayed on monthly accounting statements next to the affected reservation, so accuracy matters and you must not invent details.

Today's date is ${today}. Rising Tide manages these properties:
${propertyList}

When the input is ambiguous, prefer a more specific body summary over confident-but-wrong guesses for guest_name_match and property_match. Lower the confidence rating instead.`,
      prompt: `OPERATOR INPUT:
<text>
${text || '(none)'}
</text>

${attachmentText ? `<attachment_text>\n${attachmentText}\n</attachment_text>` : ''}

Extract the structured fields per the schema.`,
    });

    const propertyIdMatch = normalizePropertyMatch(extraction.property_match);
    const candidates = extraction.guest_name_match
      ? await findCandidates(extraction.guest_name_match, propertyIdMatch)
      : [];

    const response: ExtractResponse = {
      extraction,
      property_id_match: propertyIdMatch,
      candidates,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error('notes/extract error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
