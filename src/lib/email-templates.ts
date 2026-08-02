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

  if (template === 'touch_base') {
    const touchBase = `I was hoping to touch base next week in regard to your guests and your thoughts on the next few months. If there's a time that works, just let me know.`;
    return {
      subject,
      body: `${greetingLine}\n\n${payoutLine}${statementLine}\n\n${touchBase}\n\nThanks so much,\nAllie & Ryan`,
    };
  }

  if (template === 'year_end') {
    return {
      subject,
      body: `${greetingLine}\n\n[Year-end recap template — YTD payout, review count + average, channel mix, and 2026 projection go here. Ryan/Allie fills the narrative each December.]\n\nWe've also attached your ${shortMonth} statement. Funds will be sent on ${fundsSent}.\n\nHappy New Year!\nAllie & Ryan`,
    };
  }

  // Default: monthly
  return {
    subject,
    body: `${greetingLine}\n\n${payoutLine}${statementLine}\n\nThanks!\nAllie & Ryan`,
  };
}
