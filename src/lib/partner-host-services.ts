/**
 * A partner home's host asks about one of our paid services on
 * staycapeann.com/host/services, and an owner answers with the price.
 *
 * The services are the rungs of the ladder above listing: a Verified walk, a
 * photo shoot, the guest app, turnovers, guest messages. Each one we already
 * run for our own homes; a partner home is walled off from all of them
 * (src/lib/property-scope.ts), so nothing here books, schedules or charges
 * anything. An ask is a question: one row in partner_service_asks per home
 * and service while it is open, answered by an owner on the home's Partner
 * home panel in their own words (the price and a date), which emails the
 * host. No price is set yet, so none is shown or computed here.
 *
 * Full management is not on the menu on purpose: we see how a home books
 * before we offer it, and a home a management company runs is never offered
 * it at all.
 *
 * The catalog's words live here and nowhere else: staycapeann.com shows what
 * Helm sends.
 *
 * PURE MODULE: no env, no database, no server-only imports.
 */
import { normalizeText } from './partner-host-listing.ts';
import { buildHostEmail, type HostEmail } from './partner-host.ts';
import { displayTitle } from './sca-quotes-types.ts';

export const PARTNER_SERVICES = [
  {
    key: 'verified_walk',
    name: 'A Verified walk',
    phrase: 'a Verified walk',
    line: 'We walk the home, and your listing shows Verified by Rising Tide.',
  },
  {
    key: 'photo_shoot',
    name: 'A photo shoot',
    phrase: 'a photo shoot',
    line: 'Our photographers shoot the home for your listing.',
  },
  {
    key: 'guest_app',
    name: 'The guest app',
    phrase: 'the guest app',
    line: "A guide to the home on your guests' phones, with a QR card for the house.",
  },
  {
    key: 'turnovers',
    name: 'Turnovers',
    phrase: 'turnovers',
    line: 'We schedule the cleaning around every checkout.',
  },
  {
    key: 'guest_messages',
    name: 'Guest messages',
    phrase: 'guest messages',
    line: "We answer your guests' messages for you.",
  },
] as const;

export type PartnerService = (typeof PARTNER_SERVICES)[number];
export type PartnerServiceKey = PartnerService['key'];

export const SERVICE_ASK_LIMITS = { note: 1000, reply: 2000 } as const;

export type ServiceAskStatus = 'open' | 'answered' | 'closed' | 'withdrawn';

export type ServiceAskRow = {
  id: string;
  property_id: string;
  host_email: string;
  service: PartnerServiceKey;
  note: string | null;
  status: ServiceAskStatus;
  created_at: string;
  reply: string | null;
  answered_at: string | null;
  answered_by: string | null;
  host_emailed_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
};

export const SERVICE_ASK_COLS =
  'id, property_id, host_email, service, note, status, created_at, reply, answered_at, answered_by, host_emailed_at, closed_at, closed_by';

/** Still with us: waiting for an answer, or answered and not yet settled. */
export const LIVE_ASK_STATUSES = ['open', 'answered'] as const;

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

export function isPartnerService(v: unknown): v is PartnerServiceKey {
  return typeof v === 'string' && PARTNER_SERVICES.some((s) => s.key === v);
}

export function serviceOf(key: PartnerServiceKey): PartnerService {
  return PARTNER_SERVICES.find((s) => s.key === key) as PartnerService;
}

/** The host's ask: which service, and a note for us if they wrote one. */
export function parseServiceAsk(raw: unknown): Parsed<{ service: PartnerServiceKey; note: string | null }> {
  const b = (raw ?? {}) as Record<string, unknown>;
  if (!isPartnerService(b.service)) return { ok: false, reason: 'Pick a service to ask about.' };
  const note = normalizeText(b.note);
  if (note.length > SERVICE_ASK_LIMITS.note) {
    return { ok: false, reason: `Keep the note to ${SERVICE_ASK_LIMITS.note.toLocaleString('en-US')} characters.` };
  }
  return { ok: true, value: { service: b.service, note: note || null } };
}

/** The owner's answer, in the words the host will read. */
export function parseServiceReply(raw: unknown): Parsed<string> {
  const r = normalizeText(raw);
  if (!r) return { ok: false, reason: 'Write the answer the host will read: the price and when we can do it.' };
  if (r.length > SERVICE_ASK_LIMITS.reply) return { ok: false, reason: `Keep it to ${SERVICE_ASK_LIMITS.reply.toLocaleString('en-US')} characters.` };
  return { ok: true, value: r };
}

// ─── What the host sees ────────────────────────────────────────────────────

export type HostServiceAsk = {
  id: string;
  status: 'open' | 'answered';
  asked_at: string;
  note: string | null;
  reply: string | null;
  answered_at: string | null;
};

export type HostServicesHome = {
  id: string;
  title: string;
  services: Array<{ key: PartnerServiceKey; name: string; line: string; ask: HostServiceAsk | null }>;
};

/** Every service for one home, each with the host's live ask if there is one. */
export function hostServicesHome(home: { id: string; title: string | null }, rows: readonly ServiceAskRow[]): HostServicesHome {
  const live = rows.filter((r) => r.property_id === home.id && (r.status === 'open' || r.status === 'answered'));
  return {
    id: home.id,
    title: displayTitle(home.title) || 'Your home',
    services: PARTNER_SERVICES.map((s) => {
      const r = live.find((x) => x.service === s.key);
      return {
        key: s.key,
        name: s.name,
        line: s.line,
        ask: r
          ? {
              id: r.id,
              status: r.status as 'open' | 'answered',
              asked_at: r.created_at,
              note: r.note,
              reply: r.status === 'answered' ? r.reply : null,
              answered_at: r.status === 'answered' ? r.answered_at : null,
            }
          : null,
      };
    }),
  };
}

// ─── The office's queue ────────────────────────────────────────────────────

/**
 * The home feed's owners' queue line for asks nobody has answered: one home
 * goes straight to its panel, several to the partner homes list.
 */
export function serviceQueueCard(
  waiting: ReadonlyArray<{ property_id: string }>,
  nameOf: (propertyId: string) => string | null,
): { href: string; text: string } | null {
  const ids = [...new Set(waiting.map((w) => w.property_id))];
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    const name = nameOf(ids[0]);
    const n = waiting.length;
    return {
      href: `/properties/${ids[0]}#partner-services`,
      text: `${n === 1 ? 'A host asked about a service' : `A host asked about ${n} services`}${name ? `: ${name}` : ''}`,
    };
  }
  return { href: '/guests/requests#partner-homes', text: `Hosts asked about services: ${ids.length} homes to answer` };
}

// ─── Email to the host ─────────────────────────────────────────────────────

function servicesUrl(siteOrigin: string): string {
  return `${siteOrigin.replace(/\/+$/, '')}/host/services`;
}

/** The owner's answer, word for word, from hello@. The host replies to the email to go ahead. */
export function serviceReplyEmail(title: string | null, service: PartnerServiceKey, reply: string, siteOrigin: string): HostEmail {
  const home = displayTitle(title) || 'your home';
  return buildHostEmail(`About ${serviceOf(service).phrase} for ${home}`, [
    ...reply.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean),
    'Reply to this email to go ahead, or with any questions.',
    ['What you asked about:', servicesUrl(siteOrigin), 'Your services'],
  ]);
}
