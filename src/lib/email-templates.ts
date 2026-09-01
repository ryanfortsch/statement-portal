/**
 * Email template rendering for owner-statement sends.
 *
 * Shared between the dashboard's preview modal (client) and the /api/draft-email
 * route (server) so Gmail drafts and in-UI previews always match.
 */

export type EmailTemplate = 'monthly' | 'touch_base' | 'year_end';

export type RenderedEmail = {
  subject: string;
  body: string;
};

/**
 * The opt-in "work notes" section: the month's work slips rewritten as
 * owner-friendly lines, grouped by where they stand. Lines arrive already
 * polished from lib/statement-work-notes.ts (server); this module only
 * lays them out, so the client preview and the Gmail draft compose the
 * exact same paragraphs from the same data.
 */
export type PropertyWorkNotes = {
  propertyName: string;
  /** Finished during the statement month. */
  completed: string[];
  /** In progress or on the calendar right now. */
  inProgress: string[];
  /** Waiting on the owner (approval, a decision, a date). */
  awaitingOwner: string[];
};

export function workNotesHaveContent(n: PropertyWorkNotes): boolean {
  return n.completed.length + n.inProgress.length + n.awaitingOwner.length > 0;
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
   * Opt-in work-notes section, one entry per property covered by the
   * email. Absent or all-empty -> no section, body identical to before.
   */
  workNotes?: PropertyWorkNotes[];
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
 * Lay out the work-notes section as email paragraphs. Empty input -> ''.
 * The framing sentences do the "polish": the section reads as an update
 * from the manager, not a pasted task list. Groups render only when they
 * have items, and the first group present carries the "around the house"
 * lead so the section always opens like prose.
 */
export function buildWorkNotesBlock(workNotes: PropertyWorkNotes[], shortMonth: string): string {
  const withContent = workNotes.filter(workNotesHaveContent);
  if (withContent.length === 0) return '';

  if (withContent.length === 1) {
    const n = withContent[0];
    const paras: string[] = [];
    if (n.completed.length > 0) {
      paras.push(group(`Around the house, here's what our team took care of in ${shortMonth}:`, n.completed));
    }
    if (n.inProgress.length > 0) {
      const intro = paras.length > 0
        ? 'Still in motion:'
        : `Around the house, here's what's in motion right now:`;
      paras.push(group(intro, n.inProgress));
    }
    if (n.awaitingOwner.length > 0) {
      const one = n.awaitingOwner.length === 1;
      const intro = paras.length > 0
        ? (one ? 'And one thing needs your input:' : 'And a few things need your input:')
        : (one ? 'One thing at the house needs your input:' : 'A few things at the house need your input:');
      paras.push(group(intro, n.awaitingOwner));
    }
    return paras.join('\n\n');
  }

  // Grouped owner email: label every group with its house.
  const paras: string[] = ['A few notes from the houses this month:'];
  for (const n of withContent) {
    if (n.completed.length > 0) paras.push(group(`At ${n.propertyName}, taken care of in ${shortMonth}:`, n.completed));
    if (n.inProgress.length > 0) paras.push(group(`At ${n.propertyName}, still in motion:`, n.inProgress));
    if (n.awaitingOwner.length > 0) paras.push(group(`At ${n.propertyName}, waiting on your input:`, n.awaitingOwner));
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

  // Opt-in work-notes section, slotted between the statement paragraph and
  // the closing so the payout stays the headline. '' when off or empty.
  const notesBlock = args.workNotes ? buildWorkNotesBlock(args.workNotes, shortMonth) : '';
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
