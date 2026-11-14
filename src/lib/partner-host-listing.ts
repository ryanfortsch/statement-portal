/**
 * A partner home's host asks to change their listing's words on
 * staycapeann.com/host/listing, and the office approves it before a guest
 * sees it.
 *
 * The words are the home's own listing record (property_listing_content),
 * the one staycapeann.com reads through toScaListing: the title, the summary
 * (a short line plus checkmarked highlights, split by splitSummary), the
 * space (the About text) and the neighborhood. A host sees them in their own
 * terms (title, short summary, highlights, about the home, the neighborhood)
 * and sends what they changed; Helm keeps it as one pending proposal per
 * home (partner_listing_proposals) until someone in the office approves or
 * declines it on the home's Partner home panel.
 *
 * Why not straight to the site: the office builds every listing to one
 * standard, and a phone number, an email or a "book direct" link in a
 * description would take a guest off staycapeann.com. So the words are
 * checked twice: no contact or link at all (refused here, in the host's
 * words), then a person reads it. Photos, rooms, amenities, house rules and
 * the rest stay the office's.
 *
 * PURE MODULE: no env, no database, no server-only imports.
 */
import { splitSummary } from './listing-copy-shape.ts';
import { maskContact } from './partner-messages.ts';
import { buildHostEmail, type HostEmail } from './partner-host.ts';
import { displayTitle } from './sca-quotes-types.ts';

/** How long each part may be, in characters (highlights: how many and how long each). */
export const HOST_LISTING_LIMITS = {
  title: 80,
  tagline: 500,
  highlights: 8,
  highlight: 120,
  about: 8_000,
  neighborhood: 4_000,
  note: 1_000,
  declineReason: 500,
} as const;

/** The listing record's columns a host may change, and no others. */
export const HOST_LISTING_COLUMNS = ['title', 'summary', 'space', 'neighborhood'] as const;
export type HostListingColumn = (typeof HOST_LISTING_COLUMNS)[number];
export type HostListingChanges = Partial<Record<HostListingColumn, string | null>>;

export type ProposalStatus = 'pending' | 'approved' | 'declined' | 'withdrawn' | 'replaced';

export type ListingProposalRow = {
  id: string;
  property_id: string;
  host_email: string;
  changes: HostListingChanges;
  before: HostListingChanges;
  note: string | null;
  status: ProposalStatus;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decline_reason: string | null;
  host_emailed_at: string | null;
};

export const LISTING_PROPOSAL_COLS =
  'id, property_id, host_email, changes, before, note, status, created_at, decided_at, decided_by, decline_reason, host_emailed_at';

/** The listing's words as a host reads and writes them. */
export type HostCopy = {
  title: string;
  tagline: string;
  highlights: string[];
  about: string;
  neighborhood: string;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const L = HOST_LISTING_LIMITS;

/** Line breaks as \n, no trailing spaces on a line, no runs of blank lines, trimmed. */
export function normalizeText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One line: every run of whitespace a single space. */
function oneLine(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

/**
 * The record's words in the host's terms. With no title of its own the
 * listing shows the home's (properties.title, then its name), as toScaListing does.
 */
export function hostCopyOf(
  content: { title: string | null; summary: string | null; space: string | null; neighborhood: string | null } | null,
  fallbackTitle: string | null,
): HostCopy {
  const { tagline, highlights } = splitSummary(content?.summary);
  return {
    title: oneLine(content?.title ?? fallbackTitle ?? ''),
    tagline,
    highlights,
    about: normalizeText(content?.space),
    neighborhood: normalizeText(content?.neighborhood),
  };
}

/** A short summary and its highlights as the one summary field splitSummary reads back. */
export function composeSummary(tagline: string, highlights: readonly string[]): string {
  const lines = highlights.map((h) => `✓ ${h}`);
  return [tagline, lines.join('\n')].filter(Boolean).join('\n\n');
}

/** The record's columns as the host's copy would write them. */
export function hostColumns(copy: HostCopy): Record<HostListingColumn, string | null> {
  return {
    title: copy.title,
    summary: composeSummary(copy.tagline, copy.highlights),
    space: copy.about || null,
    neighborhood: copy.neighborhood || null,
  };
}

/** Highlights as typed: one a line, or an array; a leading checkmark or dash dropped. */
function highlightsFrom(raw: unknown): string[] {
  const lines = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\r?\n/) : [];
  return lines
    .map((l) => oneLine(l).replace(/^(?:✓|✔|•|-|→|\*)\s*/, ''))
    .filter(Boolean);
}

const CONTACT =
  'Leave out phone numbers, emails and website links. Guests reach you through Stay Cape Ann, and you have their contact once a stay is booked.';

/**
 * What the host sent, checked, as the columns that differ from the live
 * listing. Nothing changed is a refusal, so a host never sends an empty
 * review.
 */
export function parseHostListingEdit(
  raw: unknown,
  live: HostCopy,
): Parsed<{ copy: HostCopy; changes: HostListingChanges; before: HostListingChanges; note: string | null }> {
  const b = (raw ?? {}) as Record<string, unknown>;
  const copy: HostCopy = {
    title: oneLine(b.title),
    tagline: oneLine(b.tagline),
    highlights: highlightsFrom(b.highlights),
    about: normalizeText(b.about),
    neighborhood: normalizeText(b.neighborhood),
  };
  const note = normalizeText(b.note) || null;

  if (!copy.title) return { ok: false, reason: 'Give the home a title.' };
  if (copy.title.length > L.title) return { ok: false, reason: `Keep the title to ${L.title} characters.` };
  if (!copy.tagline) return { ok: false, reason: 'Write a short summary: a line or two on what makes the home.' };
  if (copy.tagline.length > L.tagline) return { ok: false, reason: `Keep the short summary to ${L.tagline} characters.` };
  if (copy.highlights.length > L.highlights) return { ok: false, reason: `Choose up to ${L.highlights} highlights.` };
  if (copy.highlights.some((h) => h.length > L.highlight)) return { ok: false, reason: `Keep each highlight to ${L.highlight} characters.` };
  if (!copy.about) return { ok: false, reason: 'Write about the home: what a guest finds when they arrive.' };
  if (copy.about.length > L.about) return { ok: false, reason: `Keep About the home to ${L.about.toLocaleString('en-US')} characters.` };
  if (copy.neighborhood.length > L.neighborhood) return { ok: false, reason: `Keep the neighborhood to ${L.neighborhood.toLocaleString('en-US')} characters.` };
  if (note && note.length > L.note) return { ok: false, reason: `Keep the note to ${L.note.toLocaleString('en-US')} characters.` };

  const next = hostColumns(copy);
  const was = hostColumns(live);
  const changes: HostListingChanges = {};
  const before: HostListingChanges = {};
  for (const col of HOST_LISTING_COLUMNS) {
    if ((next[col] ?? '') !== (was[col] ?? '')) {
      changes[col] = next[col];
      before[col] = was[col];
    }
  }
  if (Object.keys(changes).length === 0) return { ok: false, reason: 'Nothing changed from your listing as it reads now.' };
  if (Object.values(changes).some((v) => v != null && maskContact(v).masked)) return { ok: false, reason: CONTACT };
  return { ok: true, value: { copy, changes, before, note } };
}

/** Only the four columns, each a string or null; anything else in a stored jsonb is dropped. */
export function cleanChanges(raw: unknown): HostListingChanges {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: HostListingChanges = {};
  for (const col of HOST_LISTING_COLUMNS) {
    if (!(col in b)) continue;
    const v = b[col];
    if (v === null || typeof v === 'string') out[col] = v;
  }
  return out;
}

/** The listing patch Approve writes: the property and the changed columns, nothing else. */
export function approvalPatch(propertyId: string, changes: HostListingChanges): { property_id: string } & HostListingChanges {
  return { property_id: propertyId, ...cleanChanges(changes) };
}

/** The live copy with a pending proposal laid over it: what the host's form shows while it waits. */
export function copyWithChanges(live: HostCopy, changes: HostListingChanges): HostCopy {
  const c = cleanChanges(changes);
  const summary = 'summary' in c ? splitSummary(c.summary) : null;
  return {
    title: 'title' in c ? oneLine(c.title ?? '') : live.title,
    tagline: summary ? summary.tagline : live.tagline,
    highlights: summary ? summary.highlights : live.highlights,
    about: 'space' in c ? normalizeText(c.space) : live.about,
    neighborhood: 'neighborhood' in c ? normalizeText(c.neighborhood) : live.neighborhood,
  };
}

/** The parts a proposal changes, in the host's words. */
export function changedParts(changes: HostListingChanges): string[] {
  const c = cleanChanges(changes);
  const parts: string[] = [];
  if ('title' in c) parts.push('the title');
  if ('summary' in c) parts.push('the summary and highlights');
  if ('space' in c) parts.push('about the home');
  if ('neighborhood' in c) parts.push('the neighborhood');
  return parts;
}

export function joinParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** The office's reason for declining, checked. */
export function parseDeclineReason(raw: unknown): Parsed<string> {
  const r = normalizeText(raw);
  if (!r) return { ok: false, reason: 'Say why, in a line the host will read.' };
  if (r.length > L.declineReason) return { ok: false, reason: `Keep it to ${L.declineReason} characters.` };
  return { ok: true, value: r };
}

// ─── What the host sees ────────────────────────────────────────────────────

export type HostListingHome = {
  id: string;
  title: string;
  /** The listing as guests read it now. */
  live: HostCopy;
  /** Waiting for the office: the copy as sent, and when. */
  pending: { id: string; copy: HostCopy; parts: string[]; note: string | null; sent_at: string } | null;
  /** The last answer from the office, if it came after the last thing the host sent. */
  last: { status: 'approved' | 'declined'; decided_at: string; reason: string | null; parts: string[] } | null;
};

export function hostListingHome(
  home: { id: string; title: string | null },
  live: HostCopy,
  pending: ListingProposalRow | null,
  latestDecided: ListingProposalRow | null,
): HostListingHome {
  const decided =
    latestDecided && (latestDecided.status === 'approved' || latestDecided.status === 'declined') && latestDecided.decided_at ? latestDecided : null;
  return {
    id: home.id,
    title: displayTitle(home.title) || 'Your home',
    live,
    pending: pending
      ? {
          id: pending.id,
          copy: copyWithChanges(live, pending.changes),
          parts: changedParts(pending.changes),
          note: pending.note,
          sent_at: pending.created_at,
        }
      : null,
    last:
      decided && !pending
        ? {
            status: decided.status as 'approved' | 'declined',
            decided_at: decided.decided_at as string,
            reason: decided.status === 'declined' ? decided.decline_reason : null,
            parts: changedParts(decided.changes),
          }
        : null,
  };
}

// ─── The office's queue ────────────────────────────────────────────────────

/**
 * The home feed's owners' queue line for host listing changes waiting: one
 * home goes straight to its panel, several to the partner homes list.
 */
export function listingQueueCard(
  waiting: ReadonlyArray<{ property_id: string }>,
  nameOf: (propertyId: string) => string | null,
): { href: string; text: string } | null {
  const ids = [...new Set(waiting.map((w) => w.property_id))];
  if (ids.length === 0) return null;
  if (ids.length === 1) {
    const name = nameOf(ids[0]);
    return { href: `/properties/${ids[0]}#partner-listing-change`, text: `Listing change from a host to review${name ? `: ${name}` : ''}` };
  }
  return { href: '/guests/requests#partner-homes', text: `Listing changes from hosts: ${ids.length} homes to review` };
}

// ─── Email to the host ─────────────────────────────────────────────────────

function listingUrl(siteOrigin: string): string {
  return `${siteOrigin.replace(/\/+$/, '')}/host/listing`;
}

export function listingApprovedEmail(title: string | null, parts: readonly string[], siteOrigin: string): HostEmail {
  const home = displayTitle(title) || 'your home';
  return buildHostEmail(`Your listing changes for ${home} are live`, [
    `We approved your changes to ${joinParts(parts) || 'your listing'} for ${home}. Guests see them on staycapeann.com now.`,
    ['See your listing:', listingUrl(siteOrigin), 'Your listing'],
  ]);
}

export function listingDeclinedEmail(title: string | null, parts: readonly string[], reason: string, siteOrigin: string): HostEmail {
  const home = displayTitle(title) || 'your home';
  return buildHostEmail(`About your listing changes for ${home}`, [
    `We did not make your changes to ${joinParts(parts) || 'your listing'} for ${home}. Your listing reads as it did.`,
    `Why: ${reason}`,
    ['You can change it and send it again:', listingUrl(siteOrigin), 'Your listing'],
    'Or reply to this email and we will work it out with you.',
  ]);
}
