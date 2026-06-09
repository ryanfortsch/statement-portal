/**
 * Parser for inbound inquiry-form emails (e.g. the "Schedule a call" form on
 * risingtidestr.com). These arrive in a Helm-monitored Gmail mailbox with a
 * structured body — either inline "label: value" pairs or label-on-one-line
 * value-on-next, with `notes` spanning multiple lines at the end.
 *
 * The parser normalises both shapes into a flat object the cron route uses
 * to seed a new draft projection (so Dotti doesn't have to copy fields out
 * of an email by hand).
 *
 * Robustness goals: never throw on a malformed message — return null and let
 * the caller skip + log. The cron processes a batch; one bad email shouldn't
 * bring the rest down.
 */

import type { AirDnaMarket } from './projections-airdna';

export type InquiryFields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  address: string;
  kind: string | null;
  requestedSlot: string | null;
  notes: string | null;
};

/** All structured field names the parser will recognize on a label line. */
const KNOWN_FIELDS = new Set([
  '_replyto',
  'kind',
  'firstName',
  'firstname',
  'first_name',
  'lastName',
  'lastname',
  'last_name',
  'email',
  'phone',
  'address',
  'requestedDate',
  'requestedTime',
  'requestedSlot',
  'requestedslot',
  'timezone',
  'notes',
]);

/** Canonical key for the parser's output dict. */
function canonical(key: string): string {
  const k = key.toLowerCase();
  if (k === 'firstname' || k === 'first_name') return 'firstName';
  if (k === 'lastname' || k === 'last_name') return 'lastName';
  if (k === 'requestedslot') return 'requestedSlot';
  return k;
}

/**
 * Parse an inquiry email body into structured fields. Returns null if the
 * body doesn't contain at least firstName + email + address — those are
 * the minimum signals needed to create a useful prospect row.
 */
export function parseInquiryEmail(rawBody: string): InquiryFields | null {
  // Strip HTML if present — Gmail bodies can be either text or HTML; the
  // parser doesn't care which. <br> and </p> become newlines so the line-
  // based scan still works on HTML-only emails.
  const cleaned = stripHtml(rawBody);
  const lines = cleaned.split(/\r?\n/).map((l) => l.trim());

  const out: Record<string, string> = {};
  const noteAccumulator: string[] = [];
  let inNotes = false;
  let sawHeaderForNotes = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Inline "key: value" form.
    const inline = line.match(/^([A-Za-z_][\w]*)\s*:\s*(.*)$/);
    if (inline && KNOWN_FIELDS.has(inline[1])) {
      const key = canonical(inline[1]);
      const value = inline[2].trim();
      if (key === 'notes') {
        inNotes = true;
        sawHeaderForNotes = true;
        if (value) noteAccumulator.push(value);
      } else {
        out[key] = value;
        inNotes = false;
      }
      continue;
    }

    // "key" alone on a line, value on the next non-empty line. The Gmail
    // form-submission style we've seen in the wild renders this way.
    if (KNOWN_FIELDS.has(line)) {
      const key = canonical(line);
      if (key === 'notes') {
        inNotes = true;
        sawHeaderForNotes = true;
        continue;
      }
      // Find the next non-empty line.
      let j = i + 1;
      while (j < lines.length && !lines[j]) j++;
      if (j < lines.length) {
        out[key] = lines[j];
        i = j;
      }
      inNotes = false;
      continue;
    }

    // Free-form notes body: accumulate everything after the `notes:` label
    // until the email ends (or we hit a clear sign-off pattern). Preserves
    // paragraph breaks so the body reads naturally in Helm.
    if (inNotes) {
      noteAccumulator.push(line);
    }
  }

  if (sawHeaderForNotes && noteAccumulator.length > 0) {
    out.notes = noteAccumulator.join('\n').trim().replace(/\n{3,}/g, '\n\n');
  }

  if (!out.firstName || !out.email || !out.address) return null;

  return {
    firstName: out.firstName,
    lastName: out.lastName || '',
    email: out.email,
    phone: out.phone || null,
    address: out.address,
    kind: out.kind || null,
    requestedSlot: out.requestedSlot || null,
    notes: out.notes || null,
  };
}

/**
 * Split "6 Grove Street, Beverly MA 01915" into street + city + state + zip
 * pieces. Tolerant of double-comma variants and missing zip. Returns
 * defaults rather than null so the caller can still create a prospect with
 * whatever info was parseable.
 */
export function splitAddressLine(address: string): {
  street: string;
  city: string;
  state: string | null;
  zip: string | null;
} {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { street: '', city: '', state: null, zip: null };
  const street = parts[0];

  // Either "City State Zip" packed into the 2nd comma slot, or "City",
  // "State Zip" across slots 2 and 3.
  const tail = parts.slice(1).join(' ').trim();
  const tailParts = tail.split(/\s+/);
  let zip: string | null = null;
  let state: string | null = null;
  let city = '';

  if (tailParts.length > 0 && /^\d{5}(?:-\d{4})?$/.test(tailParts[tailParts.length - 1])) {
    zip = tailParts.pop()!;
  }
  if (tailParts.length > 0 && /^[A-Z]{2}$/.test(tailParts[tailParts.length - 1])) {
    state = tailParts.pop()!;
  }
  city = tailParts.join(' ');

  return { street, city, state, zip };
}

/**
 * Infer the AirDNA market from a parsed city. Defaults to Gloucester for
 * Cape Ann–adjacent addresses we don't have explicit data for, since
 * Gloucester is the densest local market.
 */
export function inferMarketFromCity(city: string): AirDnaMarket {
  const c = city.toLowerCase();
  if (c.includes('rockport')) return 'Rockport';
  if (c.includes('beverly')) return 'Beverly';
  return 'Gloucester';
}

// ─── Internals ──────────────────────────────────────────────────────────────

/** Best-effort HTML → plaintext. <br> + <p> become \n; everything else
 *  stripped. Decodes common entities. Good enough for parsing label lines
 *  out of a form-submission email body. */
function stripHtml(input: string): string {
  if (!/<[^>]+>/.test(input)) return input;
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/div\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
