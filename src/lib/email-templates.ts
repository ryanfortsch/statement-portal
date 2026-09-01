/**
 * Email template rendering for owner-statement sends.
 *
 * Shared between the dashboard's preview modal (client) and the /api/draft-email
 * route (server) so Gmail drafts and in-UI previews always match.
 */

import type { WorkSlipOwnerActionType, WorkSlipPriority } from '@/lib/work-types';

export type EmailTemplate = 'monthly' | 'touch_base' | 'year_end';

export type RenderedEmail = {
  subject: string;
  body: string;
};

/**
 * The opt-in owner-request section.
 *
 * Its job is the asks: maintenance and purchases that need the owner's
 * approval, decisions we are waiting on, and anything we want flagged. The
 * month's finished work is an optional footnote under them, never the lead.
 *
 * Every line is curated. loadOwnerRequestCandidates() (server, DB) hands us
 * candidates carrying a generated paragraph; the operator ticks, un-ticks
 * and rewrites; resolveOwnerRequests() below turns picks into the rendered
 * lists. It lives here, not in the loader, because the preview modal
 * (client) and /api/draft-email (server) both run it against the same
 * stored picks -- which is what keeps the preview honest.
 */

/** An ask needs an answer; a flag is for the owner's awareness only. */
export type OwnerRequestKind = 'ask' | 'flag';

export type OwnerRequestCandidate = {
  slipId: string;
  title: string;
  location: string | null;
  kind: OwnerRequestKind;
  actionType: WorkSlipOwnerActionType | null;
  priority: WorkSlipPriority;
  /** The deterministic owner-facing paragraph. Operator may override it. */
  defaultText: string;
  /**
   * Pre-ticked? True for slips already flagged owner_action_required --
   * somebody decided the owner needs to weigh in, so the default is in.
   * Everything else is a candidate the operator can pull in by hand.
   */
  suggested: boolean;
  /** owner_last_contacted_at, when we have asked before. */
  raisedOn: string | null;
};

/** One operator decision. `text` null/absent -> use the generated line. */
export type OwnerRequestSelection = {
  include: boolean;
  text?: string | null;
};

/** Keyed by work_slip id. Stored on close_tasks.owner_request_items. */
export type OwnerRequestSelections = Record<string, OwnerRequestSelection>;

export type PropertyRequestCandidates = {
  propertyId: string;
  propertyName: string;
  candidates: OwnerRequestCandidate[];
  /** The optional recap, already polished. */
  handled: string[];
};

/** What the email renders, per property. */
export type ResolvedOwnerRequests = {
  propertyName: string;
  /** Needs an answer. */
  requests: string[];
  /** For awareness only. */
  flags: string[];
  /** Optional recap of what we handled this month. */
  handled: string[];
  /** Slip ids sent as asks -- stamped owner_status='sent' by the route. */
  askedSlipIds: string[];
};

export function ownerRequestsHaveContent(r: ResolvedOwnerRequests): boolean {
  return r.requests.length + r.flags.length + r.handled.length > 0;
}

/** Apply the operator's picks to one property's candidates. */
export function resolveOwnerRequests(
  loaded: PropertyRequestCandidates,
  selections: OwnerRequestSelections | null | undefined,
  opts: { includeHandled: boolean },
): ResolvedOwnerRequests {
  const sel = selections || {};
  const requests: string[] = [];
  const flags: string[] = [];
  const askedSlipIds: string[] = [];

  for (const c of loaded.candidates) {
    const choice = sel[c.slipId];
    const include = choice ? choice.include : c.suggested;
    if (!include) continue;
    const text = (choice?.text || '').trim() || c.defaultText;
    if (c.kind === 'ask') {
      requests.push(text);
      askedSlipIds.push(c.slipId);
    } else {
      flags.push(text);
    }
  }

  return {
    propertyName: loaded.propertyName,
    requests,
    flags,
    handled: opts.includeHandled ? loaded.handled : [],
    askedSlipIds,
  };
}

export type RenderArgs = {
  greeting: string;        // "Claudia and Vicente"
  monthName: string;       // "April 2026"
  propertyShort: string;   // "21 Horton"
  fundsSentIso: string;    // "2026-05-04"
  ownerPayout?: number;    // optional -- when present, surfaces as a highlighted line in the body
  template: EmailTemplate;
  /**
   * Multi-property owners (Prudenzi: 53 Rocky Neck + the Downstairs
   * apartment) get ONE email covering every property, each statement PDF
   * attached. When 2+ entries are present they override propertyShort /
   * ownerPayout: the subject lists all property names and the body gets a
   * per-property payout sentence. Single-entry or absent -> the classic
   * one-property render, byte-identical to before this field existed.
   */
  properties?: { name: string; payout?: number }[];
  /**
   * Opt-in owner-request section, one entry per property covered by the
   * email. Absent or all-empty -> no section, body identical to before.
   */
  ownerRequests?: ResolvedOwnerRequests[];
};

/** "2026-05-04" -> "Monday 5/4" */
export function fmtFundsSentDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const mmdd = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  return `${weekday} ${mmdd}`;
}

/** Format a number as "$X,XXX.XX". Used inline in the body so the
 *  draft-email route's plainToHtml can bold the amount in the HTML
 *  alternative. Rounded to whole dollars -- the owner-facing payout line
 *  reads cleaner as "Your June payout is $14,164." than "...$14,164.19". */
function fmtMoneyRound(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/** One group: the intro line with its bullets right under it, single-
 *  newline separated so the plain text stays tight. The draft route's
 *  HTML pass detects the "• " run and upgrades it to a real list. */
function group(intro: string, lines: string[]): string {
  return `${intro}\n${lines.map(l => `• ${l}`).join('\n')}`;
}

/**
 * Lay out the owner-request section as email paragraphs. Empty input -> ''.
 *
 * Order is the whole point: what we need from you, then what we want you to
 * know, then (opt-in) what we handled. The framing sentences do the polish
 * so it reads as a note from the manager, not a pasted task list, and the
 * asks close with an invitation to reply so the owner knows the ball is in
 * their court.
 */
export function buildOwnerRequestsBlock(
  entries: ResolvedOwnerRequests[],
  shortMonth: string,
  /**
   * True when the email covers 2+ properties. Houses with nothing to say are
   * dropped before we get here, so a combined owner email can arrive with a
   * single entry -- and unlabeled prose would leave the owner guessing WHICH
   * house. Prudenzi tolerated that (one building, two units); Moynahan's two
   * homes are a mile apart.
   */
  labelHouses = false,
): string {
  const withContent = entries.filter(ownerRequestsHaveContent);
  if (withContent.length === 0) return '';
  const anyAsks = withContent.some(e => e.requests.length > 0);

  const paras: string[] = [];

  if (withContent.length === 1 && !labelHouses) {
    const e = withContent[0];
    if (e.requests.length > 0) {
      const one = e.requests.length === 1;
      paras.push(group(
        one
          ? 'One thing at the house needs your go-ahead before we move on it:'
          : `A few things at the house need your go-ahead before we move on them:`,
        e.requests));
    }
    if (e.flags.length > 0) {
      paras.push(group(
        paras.length > 0
          ? 'Also worth flagging, nothing needed from you:'
          : 'A couple of things worth flagging, nothing needed from you:',
        e.flags));
    }
    if (e.handled.length > 0) {
      paras.push(group(
        paras.length > 0
          ? `And here's what we took care of in ${shortMonth}:`
          : `Around the house, here's what we took care of in ${shortMonth}:`,
        e.handled));
    }
  } else {
    // Grouped owner email: label every group with its house.
    paras.push(withContent.length === 1
      ? 'A few notes from the house this month:'
      : 'A few notes from the houses this month:');
    for (const e of withContent) {
      if (e.requests.length > 0) paras.push(group(`At ${e.propertyName}, waiting on your go-ahead:`, e.requests));
      if (e.flags.length > 0) paras.push(group(`At ${e.propertyName}, worth flagging:`, e.flags));
      if (e.handled.length > 0) paras.push(group(`At ${e.propertyName}, taken care of in ${shortMonth}:`, e.handled));
    }
  }

  if (anyAsks) {
    paras.push('Just reply here with a yes or a no on each and we\'ll take it from there.');
  }
  return paras.join('\n\n');
}

export function renderEmail(args: RenderArgs): RenderedEmail {
  const { greeting, monthName, propertyShort, fundsSentIso, ownerPayout, template } = args;
  const fundsSent = fmtFundsSentDate(fundsSentIso);
  const shortMonth = monthName.split(' ')[0]; // "April"

  // Multi-property render: subject carries every property name; the body's
  // payout line itemizes per property. "Owner Statement" stays singular in
  // the subject on purpose -- /api/reconcile-emails matches sent mail on
  // that exact phrase.
  const multi = (args.properties?.length ?? 0) >= 2 ? args.properties! : null;
  const subjectProperty = multi ? multi.map(p => p.name).join(' & ') : propertyShort;

  const subject = `${monthName} Owner Statement, ${subjectProperty}`;
  // Strip stray trailing punctuation from the stored greeting ("John
  // Gavin," in properties.owner_greeting) so the template's own comma
  // can't double up into "Hi John Gavin,,".
  const cleanGreeting = greeting.trim().replace(/[,.;\s]+$/, '') || 'there';
  const greetingLine = `Hi ${cleanGreeting},`;
  // Highlighted payout line -- "what everybody comes for" so they don't have
  // to open the PDF. Skipped if the caller didn't pass a payout (e.g. a
  // template render in a UI where the statement isn't on file yet).
  let payoutLine = ownerPayout != null && ownerPayout > 0
    ? `Your ${shortMonth} payout is ${fmtMoneyRound(ownerPayout)}.\n\n`
    : '';
  let statementLine = `Please see the attached ${shortMonth} statement. The funds will be sent to your bank account on ${fundsSent}. If you have any questions, please let us know.`;
  if (multi) {
    // A grouped owner can still end up with one payable property (a sibling
    // at $0 from a reserve holdback drops out of the list) -- keep the
    // sentence singular there instead of "payouts are $X for <one name>".
    const withPayout = multi.filter(p => p.payout != null && p.payout > 0);
    if (withPayout.length >= 2) {
      const total = withPayout.reduce((sum, p) => sum + p.payout!, 0);
      const itemized = withPayout.map(p => `${fmtMoneyRound(p.payout!)} for ${p.name}`).join(' and ');
      payoutLine = `Your ${shortMonth} payouts total ${fmtMoneyRound(total)}: ${itemized}.\n\n`;
    } else if (withPayout.length === 1) {
      payoutLine = `Your ${shortMonth} payout is ${fmtMoneyRound(withPayout[0].payout!)} for ${withPayout[0].name}.\n\n`;
    } else {
      payoutLine = '';
    }
    statementLine = `Please see the attached ${shortMonth} statements, one per property. The funds will be sent to your bank accounts on ${fundsSent}. If you have any questions, please let us know.`;
  }

  // Opt-in owner-request section, slotted between the statement paragraph
  // and the closing so the payout stays the headline. '' when off or empty.
  const notesBlock = args.ownerRequests ? buildOwnerRequestsBlock(args.ownerRequests, shortMonth, !!multi) : '';
  const notesPart = notesBlock ? `${notesBlock}\n\n` : '';

  if (template === 'touch_base') {
    const touchBase = `I was hoping to touch base next week in regard to your guests and your thoughts on the next few months. If there's a time that works, just let me know.`;
    return {
      subject,
      body: `${greetingLine}\n\n${payoutLine}${statementLine}\n\n${notesPart}${touchBase}\n\nThanks so much,\nAllie & Ryan`,
    };
  }

  if (template === 'year_end') {
    return {
      subject,
      body: `${greetingLine}\n\n[Year-end recap template — YTD payout, review count + average, channel mix, and 2026 projection go here. Ryan/Allie fills the narrative each December.]\n\nWe've also attached your ${shortMonth} statement. Funds will be sent on ${fundsSent}.\n\n${notesPart}Happy New Year!\nAllie & Ryan`,
    };
  }

  // Default: monthly
  return {
    subject,
    body: `${greetingLine}\n\n${payoutLine}${statementLine}\n\n${notesPart}Thanks!\nAllie & Ryan`,
  };
}
