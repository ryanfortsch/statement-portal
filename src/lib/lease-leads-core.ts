/**
 * Winter lease leads from Zillow: reading the mail and deciding which renters
 * are worth an owner's time (Dotti, 2026-10-21: "vet them and bubble only if
 * they are substantive / serious").
 *
 * Two halves, and the split is the fair-housing guard:
 *
 *   - the model (lease-leads.ts) only READS the renter's own words into
 *     LeadFacts: dates, why the stay ends, income or work, pets, scam signs.
 *     It is told never to record a protected trait.
 *   - this file DECIDES, in plain code, from those facts and the written
 *     criteria in docs/zillow-listing-playbook-2026-10.md (section 6): a
 *     documented April exit, dates inside the lease, income of three times the
 *     rent from any source. Every renter meets the same test, and the test
 *     never sees anything but those facts.
 *
 * Pure, so `npm test` pins the parsing and the verdicts.
 */

export type LeadKind = 'inquiry' | 'application' | 'message';

export type ParsedZillowMail = {
  kind: LeadKind;
  renterName: string | null;
  /** As Zillow writes it, lowercased and trimmed to street + unit: "17 beach rd #2". */
  zillowAddress: string | null;
  /** The renter's own words, when the mail carries them. */
  message: string | null;
  /** Zillow's inquiry / lead id: the stable key for one renter on one listing. */
  inquiryId: string | null;
  replyUrl: string | null;
  applicationUrl: string | null;
};

const ZILLOW_RELAY = /@convo\.zillow\.com\s*>?\s*$/i;

/** Mail from Zillow that is not a renter at all: listing live, receipts, promotions. */
export function isRenterMail(from: string, subject: string): boolean {
  if (ZILLOW_RELAY.test(from)) return true;
  if (!/zillow\.com/i.test(from)) return false;
  return /\bapplication\b/i.test(subject) && !/receipt|processing|published|now live/i.test(subject);
}

/** "17 Beach Rd #1, Gloucester, MA, 01930" -> "17 beach rd #1". */
export function normalizeZillowAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const street = raw.split(',')[0]?.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
  return street || null;
}

function firstUrl(body: string, marker: RegExp): string | null {
  const m = body.match(new RegExp(`${marker.source}[^\\]]*\\]\\((https://[^)\\s]+)\\)`, 'i'));
  if (!m) return null;
  return stripTracking(m[1]);
}

/** Drop Zillow's tracking parameters so a stored link carries nothing personal. */
function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|nid$|ref$)/.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * One Zillow email, read. The inquiry mail ("Jo is requesting information
 * about 17 Beach Rd #1, Gloucester, MA, 01930") carries the renter's message
 * between "Jo Smith says:" and the Reply link; a follow-up from the same
 * renter arrives the same way from the same relay address. Anything whose
 * subject names an application is kind 'application'.
 */
export function parseZillowMail(subject: string, body: string): ParsedZillowMail {
  const text = body.replace(/\r/g, '');
  const inquiry = subject.match(/^(.+?) is requesting information about (.+)$/i);
  const application = subject.match(/^(.+?)\s+(?:has\s+)?(?:submitted|sent|completed|started)\s+(?:an?\s+|their\s+)?(?:rental\s+)?application\b(?:\s+(?:for|to)\s+(.+))?/i);
  const says = text.match(/\|\s*([^|\n]+?)\s+says:\s*\|\s*\n\|\s*([\s\S]+?)\s*\|\s*\n/);
  const addressLine = text.match(/\|\s*(\d+[^|\n]*?,[^|\n]*?\d{5})\s*(?:\[\]\([^)]*\))?\.?\s*\|/);
  const inquiryId = text.match(/[?&](?:inquiryId|leadId)=(\d+)/)?.[1] ?? null;

  const kind: LeadKind = application ? 'application' : inquiry ? 'inquiry' : 'message';
  const renterName = (says?.[1] ?? application?.[1] ?? inquiry?.[1] ?? null)?.trim() || null;
  const zillowAddress = normalizeZillowAddress(inquiry?.[2] ?? application?.[2] ?? addressLine?.[1] ?? null);
  const message = says?.[2]?.replace(/\s*\|\s*\n\|\s*/g, '\n').trim() || null;
  return {
    kind,
    renterName,
    zillowAddress,
    message,
    inquiryId,
    replyUrl: firstUrl(text, /Reply to [^\]]*/),
    applicationUrl: firstUrl(text, /(?:Send|View|Review) application/),
  };
}

/** The key one renter's mail files under: Zillow's id, else name + listing. */
export function leadKey(p: Pick<ParsedZillowMail, 'inquiryId' | 'renterName' | 'zillowAddress'>, relayAddress: string | null): string {
  if (p.inquiryId) return `zillow:${p.inquiryId}`;
  if (relayAddress) return `zillow-relay:${relayAddress.toLowerCase()}`;
  return `zillow-name:${(p.renterName ?? 'unknown').toLowerCase()}|${p.zillowAddress ?? 'unknown'}`;
}

// ---------------------------------------------------------------------------
// Scam signs, before any model reads the mail.

/** Phrases the scam inquiries on Zillow use, seen on 17 Beach the hour it listed. */
const SCAM_PHRASES: readonly RegExp[] = [
  /we are awaiting your reply/i,
  /\bwhats\s?app\b/i,
  /\b(?:cashier'?s|certified) check\b/i,
  /\bwestern union\b|\bmoney ?gram\b|\bzelle me\b/i,
  /\b(?:out of the country|overseas|deployed abroad|offshore)\b/i,
  /\bmy (?:shipping|moving) (?:agent|company) will\b/i,
  /\bsight unseen\b/i,
];

/** Plain-code scam signs in the renter's words. Empty when none. */
export function scamSigns(message: string | null | undefined): string[] {
  const m = message ?? '';
  return SCAM_PHRASES.filter((re) => re.test(m)).map((re) => `says "${m.match(re)?.[0] ?? ''}"`);
}

// ---------------------------------------------------------------------------
// What the model reads out of the renter's words.

export type LeadFacts = {
  /** YYYY-MM-DD when the renter named a date or a month (the 1st of it), else null. */
  moveIn: string | null;
  moveOut: string | null;
  wantsMonthToMonth: boolean;
  wantsYearLease: boolean;
  /** Why the stay ends: a contract end, a closing, a renovation. Null when unsaid. */
  exitReason: string | null;
  /** Household income per month in dollars, from any source, when stated. */
  monthlyIncome: number | null;
  /** Work, contract or assignment, when stated ("travel nurse at Addison Gilbert"). */
  work: string | null;
  occupants: number | null;
  pets: 'none' | 'pet' | 'assistance_animal' | 'unknown';
  wantsViewing: boolean;
  /** Asks to move the conversation off Zillow, to pay or be paid outside it, or reads as a template. */
  scamLike: boolean;
  scamWhy: string | null;
};

export const EMPTY_FACTS: LeadFacts = {
  moveIn: null,
  moveOut: null,
  wantsMonthToMonth: false,
  wantsYearLease: false,
  exitReason: null,
  monthlyIncome: null,
  work: null,
  occupants: null,
  pets: 'unknown',
  wantsViewing: false,
  scamLike: false,
  scamWhy: null,
};

export type LeaseListing = {
  zillow_address: string;
  property_id: string;
  label: string;
  monthly_rent: number;
  lease_start: string;
  lease_end: string;
};

export type Verdict = 'serious' | 'needs_answers' | 'not_a_fit' | 'spam';

export type VerdictResult = { verdict: Verdict; reasons: string[]; missing: string[] };

/** The playbook's stop rule: no lease ending after May 15. */
const LATEST_MOVE_OUT_DAYS_PAST_LEASE = 15;
/** A move-in this long after the lease starts still fits (January prorates). */
const LATE_MOVE_IN_DAYS = 31;

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The verdict, in plain code, from the facts and the listing. Same test for
 * every renter:
 *
 *   spam        - scam signs in the words, or the model read it as one
 *   serious     - a submitted Zillow application (they paid for screening),
 *                 or every written criterion is answered and met: dates that
 *                 sit inside the lease, a reason the stay ends, and income of
 *                 three times the rent or stated work
 *   not_a_fit   - asks for what the lease cannot be: month to month, a year,
 *                 a stay running past May 15, or a start long after the lease
 *   needs_answers - anything else; `missing` names the questions to ask
 *
 * Income counts from any source (wages, a contract stipend, a housing
 * voucher); Massachusetts law makes source of income a protected class.
 */
export function decideVerdict(
  facts: LeadFacts,
  listing: LeaseListing | null,
  opts: { hasApplication: boolean; scamSigns: string[] },
): VerdictResult {
  if (opts.scamSigns.length > 0 || facts.scamLike) {
    return { verdict: 'spam', reasons: opts.scamSigns.length > 0 ? opts.scamSigns : [facts.scamWhy ?? 'reads as a scam template'], missing: [] };
  }
  if (opts.hasApplication) {
    return { verdict: 'serious', reasons: ['submitted a Zillow application (screening report attached in Rental Manager)'], missing: [] };
  }

  const reasons: string[] = [];
  if (facts.wantsMonthToMonth) return { verdict: 'not_a_fit', reasons: ['wants month to month; the lease is a fixed term'], missing: [] };
  if (facts.wantsYearLease) return { verdict: 'not_a_fit', reasons: ['wants a year lease; the home goes back to short stays in May'], missing: [] };
  if (listing && facts.moveOut && facts.moveOut > addDays(listing.lease_end, LATEST_MOVE_OUT_DAYS_PAST_LEASE)) {
    return { verdict: 'not_a_fit', reasons: [`needs it until ${facts.moveOut}; the lease ends ${listing.lease_end}`], missing: [] };
  }
  if (listing && facts.moveIn && facts.moveIn > addDays(listing.lease_start, LATE_MOVE_IN_DAYS)) {
    return { verdict: 'not_a_fit', reasons: [`moves in ${facts.moveIn}; the lease starts ${listing.lease_start}`], missing: [] };
  }

  const missing: string[] = [];
  if (!facts.moveIn || !facts.moveOut) missing.push('the dates they need');
  if (facts.occupants == null) missing.push('who is moving in');
  if (!facts.exitReason) missing.push('why the stay ends in April');
  if (facts.monthlyIncome == null && !facts.work) missing.push('household income');
  if (facts.pets === 'unknown') missing.push('pets');

  // Stated income is the test when there is one; stated work stands in only
  // when no figure was given (the Zillow application screens it later).
  const incomeOk = listing && facts.monthlyIncome != null ? facts.monthlyIncome >= 3 * listing.monthly_rent : null;
  if (incomeOk === false) missing.push(`income of 3x the rent (${3 * (listing?.monthly_rent ?? 0)} a month) from any source`);
  const meansOk = incomeOk === true || (incomeOk === null && !!facts.work);

  const core = !!(facts.moveIn && facts.moveOut && facts.exitReason && meansOk);
  if (core) {
    reasons.push(`${facts.moveIn} to ${facts.moveOut}`, `exit: ${facts.exitReason}`);
    if (facts.monthlyIncome != null) reasons.push(`income ${facts.monthlyIncome} a month`);
    if (facts.work) reasons.push(`work: ${facts.work}`);
    return { verdict: 'serious', reasons, missing: missing.filter((m) => m === 'pets' || m === 'who is moving in') };
  }
  return { verdict: 'needs_answers', reasons: facts.wantsViewing ? ['asked to see it'] : [], missing };
}

/** The listing a parsed address belongs to: exact, else the longest prefix match. */
export function listingFor(address: string | null, listings: readonly LeaseListing[]): LeaseListing | null {
  if (!address) return null;
  const exact = listings.find((l) => l.zillow_address === address);
  if (exact) return exact;
  return [...listings].sort((a, b) => b.zillow_address.length - a.zillow_address.length).find((l) => address.startsWith(l.zillow_address)) ?? null;
}

/** The home feed's one line for the serious leads, or null when there are none. */
export function seriousQueueText(rows: ReadonlyArray<{ renter_name: string | null; label: string | null }>): string | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return `Leases: ${rows[0].renter_name ?? 'a renter'} is a serious applicant for ${rows[0].label ?? 'a listing'}`;
  const homes = [...new Set(rows.map((r) => r.label ?? 'a listing'))];
  return `Leases: ${rows.length} serious applicants (${homes.join(', ')})`;
}

// ---------------------------------------------------------------------------
// The screening message (Dotti, 2026-10-21: "yes, auto-send the screening
// questions"). One fixed text, the same five questions for every renter, so
// the file shows the same test was applied (playbook section 6). No model
// writes it.

/** Leads older than this get no automatic first message; a person picks them up. */
export const SCREENING_MAX_AGE_DAYS = 14;
/** A send that keeps failing stops trying; the page shows the error. */
export const SCREENING_MAX_ATTEMPTS = 3;

function longDate(ymd: string, withYear: boolean): string {
  return new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

export function screeningMessage(renterName: string | null, listing: LeaseListing, originalSubject: string | null): { subject: string; body: string } {
  const first = (renterName ?? '').trim().split(/\s+/)[0];
  const greeting = first && /^[\p{L}'-]{2,}$/u.test(first) ? `Hi ${first[0].toUpperCase()}${first.slice(1)},` : 'Hi,';
  // Grouped by hand: the server's Intl printed "$5000" on 2026-10-21.
  const rent = `$${String(Math.round(listing.monthly_rent)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  const subject = originalSubject ? (/^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`) : `Re: ${listing.label}`;
  const body = [
    greeting,
    '',
    `Thanks for your interest in ${listing.label}. It is a furnished winter rental on a fixed-term lease from ${longDate(listing.lease_start, false)} to ${longDate(listing.lease_end, true)}, at ${rent} a month.`,
    '',
    'So we can see whether it fits, could you reply with:',
    '',
    '1. The dates you need',
    '2. How many people will be living there',
    '3. Your plans after April, so we know the dates work (for example, a work contract ending or a home closing)',
    "4. Your household's monthly income (all sources count)",
    '5. Whether you will have any pets',
    '',
    "Once we have these, we'll be in touch about a showing, in person or by video, and the application.",
    '',
    'Thank you,',
    'Rising Tide',
  ].join('\n');
  return { subject, body };
}

export type ScreeningLead = {
  verdict: string;
  relay_address: string | null;
  first_seen_at: string;
  screening_sent_at: string | null;
  screening_attempts: number;
  dismissed_at: string | null;
  has_application: boolean;
};

/**
 * Send the screening message? Once per lead, only through Zillow's relay
 * (never a renter's own address), only for a listing Helm knows with
 * autosend on, never to spam or a lead someone dismissed, never once they
 * have applied, and never to a lead older than SCREENING_MAX_AGE_DAYS.
 */
export function shouldSendScreening(lead: ScreeningLead, listing: (LeaseListing & { screening_autosend?: boolean }) | null, now: Date): boolean {
  if (!listing || listing.screening_autosend === false) return false;
  if (lead.screening_sent_at || lead.dismissed_at || lead.has_application) return false;
  if (lead.screening_attempts >= SCREENING_MAX_ATTEMPTS) return false;
  if (lead.verdict !== 'needs_answers') return false;
  if (!lead.relay_address || !/^[\w.+-]+@convo\.zillow\.com$/i.test(lead.relay_address)) return false;
  const ageDays = (now.getTime() - new Date(lead.first_seen_at).getTime()) / 86_400_000;
  return ageDays <= SCREENING_MAX_AGE_DAYS;
}

/** RFC 2822 plain-text mail, base64url for Gmail's messages.send. */
export function rawReply(args: { from: string; to: string; subject: string; body: string; inReplyTo: string | null }): string {
  const headers = [
    `From: ${args.from}`,
    `To: ${args.to}`,
    `Subject: ${/^[\x20-\x7e]*$/.test(args.subject) ? args.subject : `=?UTF-8?B?${Buffer.from(args.subject, 'utf8').toString('base64')}?=`}`,
    ...(args.inReplyTo ? [`In-Reply-To: ${args.inReplyTo}`, `References: ${args.inReplyTo}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  const mime = `${headers.join('\r\n')}\r\n\r\n${args.body.replace(/\r?\n/g, '\r\n')}\r\n`;
  return Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
