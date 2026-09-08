/**
 * The three Rising Tide Quo lines, plus phone normalization.
 *
 * Deliberately free of Node imports: CrmListClient (a client component)
 * reads QUO_LINES for its badge, and quo.ts pulls node:crypto for webhook
 * signatures, which cannot ship to the browser. quo.ts re-exports all of
 * this, so server code keeps importing from '@/lib/quo'.
 */

// ── Phone normalization ────────────────────────────────────────────
// Inbound webhooks give phones in E.164 already (`+15551234567`); local
// records (cleaner_phones, contacts.phone) may not be normalized. Make
// matching tolerant by stripping non-digits and right-anchoring on the
// last 10 digits (US/CA assumption, fine for Rising Tide).

export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits;
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length > 0 && na === nb;
}

// ── The three Rising Tide lines ─────────────────────────────────────
// Every Quo number has an audience, and the audience decides which line a
// text goes out on and how an inbound is read (Dotti, 2026-09-08):
//   GUESTS           (978) 865-2575  anyone staying with us: Stay Cape Ann,
//                                    OTA guests, gear + add-on links
//   RISING TIDE 24/7 (978) 865-2500  the back office: cleaners, contractors,
//                                    vendors, employees, internal pings
//   OWNERS           (978) 865-2387  homeowners and prospects, unchanged
// If it came in on the GUESTS line it is a guest. Nothing guest-facing may
// send from 2500 or 2387, and nothing operational may send from 2575.
//
// The ids and numbers are Quo's own (GET /v1/phone-numbers). Each has an env
// override so a renumbering never needs a deploy, but the defaults are the
// real lines: there is deliberately no "first number Quo lists" fallback any
// more. That fallback is how contractor texts went out on the GUESTS line
// the afternoon it was created (it sorted first).

export type QuoLine = 'guests' | 'ops' | 'owners';

export type QuoLineInfo = {
  line: QuoLine;
  id: string;
  number: string;
  name: string;
  /** Short label for UI badges. */
  label: string;
};

export const QUO_LINES: Record<QuoLine, QuoLineInfo> = {
  guests: { line: 'guests', id: 'PNTSICOAAA', number: '+19788652575', name: 'GUESTS', label: 'Guest line' },
  ops: { line: 'ops', id: 'PNq253fFrk', number: '+19788652500', name: 'RISING TIDE 24/7', label: '24/7 line' },
  owners: { line: 'owners', id: 'PNpVESxsNW', number: '+19788652387', name: 'OWNERS', label: 'Owners line' },
};

const LINE_ENV: Record<QuoLine, string> = {
  guests: 'QUO_GUEST_FROM_NUMBER',
  ops: 'QUO_FROM_NUMBER',
  owners: 'QUO_OWNER_FROM_NUMBER',
};

function toE164(raw: string): string {
  return raw.startsWith('+') ? raw : `+1${normalizePhone(raw)}`;
}

/** The E.164 to send from for an audience. Env override first, then the
 *  known line. Never consults Quo, so it cannot pick the wrong line when a
 *  new number appears on the workspace. */
export function quoFromNumber(line: QuoLine): string {
  const override = (process.env[LINE_ENV[line]] || '').trim();
  return override ? toE164(override) : QUO_LINES[line].number;
}

/** Which of our lines a Quo phoneNumberId or E.164 belongs to. Checks env
 *  overrides too, so a renumbered line still classifies. Null for a number
 *  that is not ours (a retired line, a test number). */
export function quoLineFor(numberOrId: string | null | undefined): QuoLine | null {
  if (!numberOrId) return null;
  const raw = numberOrId.trim();
  for (const info of Object.values(QUO_LINES)) {
    if (raw === info.id) return info.line;
  }
  const digits = normalizePhone(raw);
  if (!digits) return null;
  for (const info of Object.values(QUO_LINES)) {
    if (normalizePhone(quoFromNumber(info.line)) === digits) return info.line;
    if (normalizePhone(info.number) === digits) return info.line;
  }
  return null;
}

/** Given a webhook message's `to` (string or array) and its phoneNumberId,
 *  name the line it arrived on. phoneNumberId is authoritative; `to` is the
 *  fallback for REST-shaped payloads that omit it. */
export function quoLineOfInbound(msg: {
  phoneNumberId?: string | null;
  to?: string | string[] | null;
}): QuoLine | null {
  const byId = quoLineFor(msg.phoneNumberId);
  if (byId) return byId;
  const tos = Array.isArray(msg.to) ? msg.to : msg.to ? [msg.to] : [];
  for (const t of tos) {
    const l = quoLineFor(t);
    if (l) return l;
  }
  return null;
}
