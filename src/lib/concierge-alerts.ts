/**
 * Pure helpers for the concierge's alerts: the rows above the queue on
 * /messaging and the one-line count on the home page.
 *
 * Every alert the stay-concierge raises (a guest message that got no draft, a
 * reply the channel rejected, a payment link that never went out, a guest
 * emergency) was written for a team text list that has been empty since
 * 2026-08-20, and nothing in Helm read the attention items meant to replace
 * it. Sep 12-26 that was 19 guest messages with no draft and 12 emergency
 * alerts that reached nobody. The concierge now serves them at
 * /api/attention; this names and routes them.
 *
 * Pure imports only (the role rule), so `npm test` loads it without a
 * database.
 */

// Relative with the extension, the convention for modules under test.
import { roleMayOpen, type HelmRole } from './helm-access.ts';
import { resolvePropertyIdFromSlug } from './payment-links-text.ts';

export type ConciergeCritical = {
  item_key: string;
  summary: string;
  created_at: string;
  alert_count: number;
  conversation_id: string;
};

export type ConciergeAlert = {
  item_key: string;
  kind: string;
  summary: string;
  created_at: string;
};

export type ConciergeAttention = {
  generated_at: string;
  criticals: ConciergeCritical[];
  items: ConciergeAlert[];
};

const TITLES: Record<string, string> = {
  pipeline_failure: 'A guest message got no draft',
  send_delivery_failed: 'A reply never reached the guest',
  addon_sms_failed: 'A payment link did not go out',
  sca_email_empty: 'A Stay Cape Ann email could not be read',
  sca_email_needs_you: 'A Stay Cape Ann email needs you',
  far_future_hold_failed: 'A far-future booking step failed',
  far_future_slip_failed: 'A far-future booking step failed',
  owner_guest_notice_no_guest: "An owner's notice had no guest to go to",
  owner_guest_notice_no_property: "An owner's notice had no property on file",
  owner_guest_notice_no_date: "An owner's notice had no date",
  owner_guest_message_no_guest: "An owner's message had no guest to go to",
  owner_guest_message_no_property: "An owner's message had no property on file",
  unknown_owner_sms: 'Unknown number on the Owners line',
  owner_email_empty: 'An owner email could not be read',
};

/** A plain title for an alert kind. A kind nobody named yet still reads as
 *  words, never as a code, and still shows: unnamed is not the same as
 *  unimportant. */
export function conciergeAlertTitle(kind: string): string {
  if (TITLES[kind]) return TITLES[kind];
  const words = (kind || 'alert').replace(/[_:]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Where the operator goes to act on it. */
export function conciergeAlertHref(kind: string): string {
  if (kind === 'addon_sms_failed') return '/messaging/send?tab=charge#payment-links';
  if (kind === 'unknown_owner_sms' || kind.startsWith('owner_')) return '/owner-messaging';
  return '/messaging';
}

/**
 * Kinds the concierge files that are not alerts here. The weekly reflection
 * report is a batch of proposed rules, not something waiting on anyone; it
 * lives on the Quality lens. An AI outage already has the "Drafts paused"
 * banner on both pages that would show it.
 */
export const NOT_ALERTS: ReadonlySet<string> = new Set(['reflection_report', 'ai_down']);

/**
 * The alerts a role may act on. An owner-line alert (`owner_*`,
 * `unknown_owner_sms`) is handled on /owner-messaging, an owner page, so the
 * list never shows one to a staff login: a row whose link bounces is a row
 * nobody can clear. Guest alerts route to /messaging and pass for everyone.
 */
export function conciergeAlertsFor<T extends { kind: string }>(role: HelmRole, items: T[]): T[] {
  return items.filter((i) => !NOT_ALERTS.has(i.kind) && roleMayOpen(role, conciergeAlertHref(i.kind)));
}

/** Collapse whitespace and cap a summary for a one-line row. */
export function alertSummary(text: string, max = 260): string {
  const flat = (text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

// ── Human copy ───────────────────────────────────────────────────────────
//
// The concierge writes each summary for a team text list: a property slug, an
// ISO date, ALL CAPS, a file path, an error string ("17_beach_back: nobody in
// house 2026-11-03, no guest notice sent"). The row on Helm reads as the
// home's name, a plain date, one sentence an operator can act on, and one
// verb. The words are Helm's, per kind; the summary only lends the names in
// it (guest, home, what was said). A kind nobody wrote words for yet still
// shows, with the summary cleaned of its machine parts.

export type AlertHome = { id: string; name: string };
export type AlertVerb = { label: string; href: string };
export type AlertCopy = { home: string | null; sentence: string; verb: AlertVerb | null };

const CHARGE: AlertVerb = { label: 'Send the link', href: '/messaging/send?tab=charge#payment-links' };
const CONVERSATIONS: AlertVerb = { label: 'Open Conversations', href: '/messaging#conversations' };
const WORK: AlertVerb = { label: 'File a slip', href: '/work' };
const OWNER_INBOX: AlertVerb = { label: 'Open owner messages', href: '/owner-messaging' };
const CLEANER_INBOX: AlertVerb = { label: 'Open cleaner messages', href: '/messaging/team?audience=cleaners' };
const ONBOARDING: AlertVerb = { label: 'Open onboarding', href: '/properties/onboarding' };

/** The thread on the Inbox's Conversations list, opened. */
export function threadVerb(conversationId: string): AlertVerb {
  return { label: 'Open the thread', href: `/messaging?open=${encodeURIComponent(conversationId)}#conversations` };
}

function grab(re: RegExp, text: string): string | null {
  const m = text.match(re);
  const v = m?.[1]?.trim();
  return v ? v : null;
}

/** A charge label mid-sentence: "Late checkout" reads "late checkout". */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** Guest words in curly quotes, one line, capped. */
function quoted(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim().replace(/^["“]|["”]$/g, '');
  const cut = flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
  return `“${cut}”`;
}

/** "Tue, Nov 3" for a YYYY-MM-DD, read at noon UTC so no zone moves the day. */
export function plainDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** When an alert was raised, in Gloucester: "Today, 2:45 PM",
 *  "Yesterday, 9:10 AM", or "Thu, Oct 15". */
export function plainAlertDate(createdAt: string, now: Date = new Date()): string {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return '';
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const today = day(now);
  const yesterday = day(new Date(now.getTime() - 86_400_000));
  if (day(at) === today) return `Today, ${time}`;
  if (day(at) === yesterday) return `Yesterday, ${time}`;
  return at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

/** "17_beach_back" -> "17 Beach Back": a slug Helm cannot resolve still
 *  reads as an address, never as a code. */
function prettySlug(slug: string): string {
  return slug
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const SLUG_RE = /\b\d+[a-z]?_[a-z0-9_]+\b/gi;

/** The home an alert is about: a property slug in the text resolved to its
 *  Helm name, else a Helm property name written out, longest first (so a
 *  sub-unit wins over its house), else the slug made readable. */
export function alertHome(text: string, homes: AlertHome[]): string | null {
  const ids = homes.map((h) => h.id);
  const nameFor = new Map(homes.map((h) => [h.id, h.name]));
  const slugs = text.match(SLUG_RE) ?? [];
  for (const slug of slugs) {
    const id = resolvePropertyIdFromSlug(slug, ids);
    if (id) return nameFor.get(id) ?? prettySlug(id);
  }
  const lower = text.toLowerCase();
  const byLength = [...homes].sort((a, b) => b.name.length - a.name.length);
  for (const h of byLength) {
    if (h.name && lower.includes(h.name.toLowerCase())) return h.name;
  }
  return slugs[0] ? prettySlug(slugs[0]) : null;
}

/** A summary with no written words: slugs to names, dates made plain,
 *  shouting lowered, file paths, ids, links and error tails dropped, first
 *  sentence only. */
export function humanizeSummary(text: string, homes: AlertHome[]): string {
  const ids = homes.map((h) => h.id);
  const nameFor = new Map(homes.map((h) => [h.id, h.name]));
  let t = (text || '').replace(/\s+/g, ' ').trim();
  t = t
    .replace(/\((?:reason|flag): [^)]*\)/gi, '')
    .replace(/\(conv [^)]*\)/gi, '')
    .replace(/\(open Gmail\)/gi, '')
    .replace(/Guesty error: .*$/i, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\b[\w.-]+\/[\w./-]+\.(?:md|py|ts|json)\b/g, 'the AI notes')
    .replace(/\/messaging\/send\b/g, 'Charge');
  t = t.replace(SLUG_RE, (slug) => {
    const id = resolvePropertyIdFromSlug(slug, ids);
    return id ? nameFor.get(id) ?? prettySlug(id) : prettySlug(slug);
  });
  t = t.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => plainDay(iso));
  // Words in capitals are the text list shouting; lower all but short
  // acronyms (AI, SMS, SCA).
  t = t.replace(/\b[A-Z][A-Z']{3,}\b/g, (w) => w.toLowerCase());
  t = t.replace(/\s+-\s+/g, '; ').replace(/\s+([,.;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  const first = t.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? t;
  const out = first.charAt(0).toUpperCase() + first.slice(1);
  return /[.!?]$/.test(out) ? out : `${out}.`;
}

/** The row for one alert: home, one sentence, one verb. */
export function conciergeAlertCopy(alert: Pick<ConciergeAlert, 'kind' | 'summary' | 'item_key'>, homes: AlertHome[]): AlertCopy {
  const s = (alert.summary || '').replace(/\s+/g, ' ').trim();
  const home = alertHome(s, homes);
  const out = (sentence: string, verb: AlertVerb | null, at: string | null = home): AlertCopy => ({ home: at, sentence, verb });
  const day = (iso: string | null) => (iso ? plainDay(iso) : null);

  switch (alert.kind) {
    case 'pipeline_failure': {
      const where = grab(/FAILED at (.+?) - no draft/i, s);
      const said = grab(/Guest said: (.+?)(?: \(reason:|$)/i, s);
      const conv = alert.item_key.startsWith('pipefail:') ? alert.item_key.slice('pipefail:'.length) : '';
      const verb = conv && !/\s/.test(conv) ? threadVerb(conv) : CONVERSATIONS;
      return out(
        said ? `A guest wrote ${quoted(said)} and no reply was drafted; answer it from the thread.` : 'A guest message got no draft; answer it from the thread.',
        verb,
        home ?? (where && where !== 'a property' ? where : null),
      );
    }
    case 'send_delivery_failed': {
      const body = grab(/: "(.+?)" - the guest/i, s);
      return out(
        `The channel refused our reply${body ? ` ${quoted(body, 70)}` : ''}, so the guest never got it; send it again from the thread.`,
        CONVERSATIONS,
      );
    }
    case 'addon_sms_failed': {
      const paidExt = s.match(/PAID extension for (.+?) at (.+?) but the calendar block (\S+?)\.\.(\S+?) FAILED/i);
      if (paidExt) {
        return out(
          `${paidExt[1]} paid for extra nights and the calendar is not blocked ${plainDay(paidExt[3])} to ${plainDay(paidExt[4])}; block those nights in Guesty now.`,
          null,
          home ?? paidExt[2],
        );
      }
      const promised = s.match(/^(.+?) booked .+? \((.+?)\); we promised the (.+?) \((.+?)\) but/i);
      if (promised) return out(`${promised[1]} booked ${promised[2]} and was promised the ${lowerFirst(promised[3])} (${promised[4]}); charge it from Charge.`, CHARGE);
      const smsFailed = s.match(/SMS FAILED for (.+?) \((.+?), \$(\d+)\)/i);
      if (smsFailed) return out(`${smsFailed[1]} was told a ${lowerFirst(smsFailed[2])} link ($${smsFailed[3]}) is coming and the text did not go out; send it from Charge.`, CHARGE);
      const mintFailed = s.match(/\((.+?), \$(\d+)\) but link mint failed/i);
      if (mintFailed) return out(`A ${lowerFirst(mintFailed[1])} charge ($${mintFailed[2]}) was promised and the link could not be made; make it on Charge.`, CHARGE);
      const noPhone = s.match(/minted.*?\((.+?)\) but guest has no phone/i);
      if (noPhone) return out(`The ${lowerFirst(noPhone[1])} link is ready and the guest has no phone on file; send it to them by email.`, { label: 'See the link', href: CHARGE.href });
      return out('A guest payment link did not go out; send it from Charge.', CHARGE);
    }
    case 'sca_email_empty': {
      const who = grab(/^(.+?) - empty/i, s);
      const subject = grab(/SCA email: (.+?)(?: \(open Gmail\))?$/i, s);
      return out(`${who ?? 'A guest'}'s Stay Cape Ann email had no new text${subject ? ` (${quoted(subject, 60)})` : ''}; read it in the hello@ inbox.`, null);
    }
    case 'sca_email_needs_you': {
      const who = grab(/^(.+?) - SCA email/i, s);
      const subject = grab(/no auto-draft: (.+?)(?: \/ |$)/i, s);
      return out(`${who ?? 'A guest'} wrote to Stay Cape Ann${subject ? ` about ${quoted(subject, 60)}` : ''} and needs a reply from the hello@ inbox.`, null);
    }
    case 'far_future_hold_failed': {
      const m = s.match(/by (.+?) for (.+?) at /i);
      return out(
        m ? `${m[1]} paid a deposit for ${m[2]} and those dates are not held; block them in Guesty now.` : 'A paid far-future booking is not held on the calendar; block the dates in Guesty now.',
        null,
      );
    }
    case 'far_future_slip_failed': {
      const m = s.match(/FAILED for (.+?) at .+? \((.+?)\)/i);
      return out(m ? `The reminder for ${m[1]}'s ${m[2]} booking was not filed; file a slip for it.` : 'A far-future booking reminder was not filed; file a slip for it.', WORK);
    }
    case 'prerelease_slip_failed': {
      const m = s.match(/FAILED for (.+?) at .+? \((.+?)\)/i);
      return out(m ? `${m[1]}'s deposit reminder for ${m[2]} was not filed; send the 50% deposit link from Charge.` : 'A deposit reminder was not filed; send the 50% deposit link from Charge.', CHARGE);
    }
    case 'gear_slip_failed': {
      const title = grab(/: (.+?) - stage it/i, s);
      return out(`A guest's gear request${title && title !== '?' ? ` (${quoted(title, 60)})` : ''} did not become a slip; file it on the board.`, WORK);
    }
    case 'unknown_listing': {
      const nick = grab(/PROPERTY: (.+?) \(/i, s);
      return out(`Guesty has a new listing${nick ? `, ${nick},` : ''} that Helm has no home for; add the home in onboarding.`, ONBOARDING, nick ?? home);
    }
    case 'unmapped_listing': {
      const nick = grab(/Guesty listing (.+?) has no/i, s);
      return out(`${nick ?? 'A new home'} has no guest knowledge yet, so its drafts are generic; finish its setup in onboarding.`, ONBOARDING, nick ?? home);
    }
    case 'review_sweep_skipped':
      return out('Review asks were skipped on the last pass and none went out; it tries again on its own.', null);
    case 'owner_guest_notice_no_guest': {
      const d = day(grab(/nobody in house (\d{4}-\d{2}-\d{2})/i, s));
      return out(`No guest is staying${d ? ` on ${d}` : ''}, so the owner's visit notice went to nobody; nothing to send unless someone books.`, OWNER_INBOX);
    }
    case 'owner_guest_notice_no_property':
      return out("An owner sent a visit notice and has no home on file; pick the home on the owner's card.", OWNER_INBOX);
    case 'owner_guest_notice_no_date':
      return out("An owner sent a visit notice with no date Helm could read; check the owner's message.", OWNER_INBOX);
    case 'owner_guest_notice_ambiguous': {
      const n = grab(/: (\d+) overlapping/i, s);
      const d = day(grab(/stays on (\d{4}-\d{2}-\d{2})/i, s));
      return out(`${n ?? 'Several'} stays overlap${d ? ` on ${d}` : ''}, so the owner's visit notice was not sent; tell the right guest yourself.`, OWNER_INBOX);
    }
    case 'owner_guest_message_no_property':
      return out("An owner asked us to pass a message to a guest and has no home on file; pick the home on the owner's card.", OWNER_INBOX);
    case 'owner_guest_message_no_guest':
      return out("An owner asked us to pass a message to the guest and nobody is staying today; nothing went out.", OWNER_INBOX);
    case 'owner_guest_message_ambiguous': {
      const n = grab(/: (\d+) overlapping/i, s);
      return out(`${n ?? 'Several'} stays overlap today, so the owner's message was not passed on; send it to the right guest yourself.`, OWNER_INBOX);
    }
    case 'unknown_owner_sms': {
      const who = grab(/LINE: (.+?) \(/i, s);
      const said = grab(/wrote "(.+?)"\./i, s);
      return out(
        `${who ?? 'Someone'} texted the Owners line and matches no owner${said ? `: ${quoted(said, 80)}` : ''}; add their number to the owner it belongs to.`,
        { label: 'Open CRM', href: '/crm' },
        null,
      );
    }
    case 'owner_email_empty': {
      const who = grab(/^(.+?) - empty/i, s);
      const subject = grab(/email: (.+?)(?: \(open Gmail\))?$/i, s);
      return out(`${who ?? 'An owner'}'s email had no new text${subject ? ` (${quoted(subject, 60)})` : ''}; read it in Gmail.`, null);
    }
    case 'owner_statement_recipient_failed': {
      const m = s.match(/Could not (\w+) (\S+) on the statement emails/i);
      return out(
        m ? `Helm could not ${m[1]} ${m[2]} on the statement emails; change it on the home's page under Owner.` : "A change to the statement email list did not save; make it on the home's page under Owner.",
        { label: 'Open Properties', href: '/properties' },
      );
    }
    case 'owner_turnover_note_failed': {
      const note = grab(/\): (.+?) - add it by hand/i, s);
      return out(`An owner's note for the crew${note && note !== '?' ? ` (${quoted(note, 70)})` : ''} did not reach the cleaner schedule; add it on that day's cleaner card.`, CLEANER_INBOX);
    }
    default:
      return out(humanizeSummary(s, homes), null);
  }
}

/** The row for a guest emergency: who wrote what, at which home. */
export function criticalAlertCopy(c: Pick<ConciergeCritical, 'summary' | 'conversation_id'>, homes: AlertHome[]): AlertCopy {
  const s = (c.summary || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.+?) at (.+?): (.+?)(?: \(flag: [^)]*\))?$/);
  const verb = c.conversation_id ? threadVerb(c.conversation_id) : CONVERSATIONS;
  if (!m) return { home: alertHome(s, homes), sentence: humanizeSummary(s, homes), verb };
  const where = m[2] === 'a property' ? null : m[2];
  return {
    home: alertHome(where ?? '', homes) ?? where,
    sentence: `${m[1]} wrote ${quoted(m[3], 140)}; answer them now.`,
    verb,
  };
}
