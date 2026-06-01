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
 *  alternative (it regex-wraps anything matching $X,XXX.XX in <strong>). */
function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function renderEmail(args: RenderArgs): RenderedEmail {
  const { greeting, monthName, propertyShort, fundsSentIso, ownerPayout, template } = args;
  const fundsSent = fmtFundsSentDate(fundsSentIso);
  const shortMonth = monthName.split(' ')[0]; // "April"

  const subject = `${monthName} Owner Statement, ${propertyShort}`;
  const greetingLine = `Hi ${greeting},`;
  // Highlighted payout line -- "what everybody comes for" so they don't have
  // to open the PDF. Skipped if the caller didn't pass a payout (e.g. a
  // template render in a UI where the statement isn't on file yet).
  const payoutLine = ownerPayout != null && ownerPayout > 0
    ? `Your ${shortMonth} payout is ${fmtMoney(ownerPayout)}.\n\n`
    : '';
  const statementLine = `Please see the attached ${shortMonth} statement. The funds will be sent to your bank account on ${fundsSent}. If you have any questions, please let us know.`;

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
