/**
 * Gmail links that open the right mailbox, for the right person.
 *
 * Helm's Gmail token belongs to one Workspace mailbox (the bare
 * GMAIL_REFRESH_TOKEN; Dotti's own token for the work-order drafts). A link
 * of the form mail.google.com/mail/u/0/... opens whatever account the
 * browser signed into first, so for anyone but that mailbox's owner it
 * landed on the wrong inbox, or on a draft that is not there. Two rules,
 * and every Gmail link in Helm follows both:
 *
 *  - the link carries the mailbox: `?authuser=<address>` makes Gmail
 *    switch to that account when the browser has it signed in
 *  - the link renders only for the session that owns the mailbox. Everyone
 *    else sees the subject and the summary, and where a draft went, with
 *    nothing clickable to a place they cannot open.
 *
 * Which address a token opens is asked of Gmail itself (`gmailMailbox` in
 * gmail-draft.ts); this module is the pure half, shared by server routes,
 * client components and the tests.
 */

/** A link into a mailbox. With no known mailbox the link has no authuser
 *  and nobody is offered it (`canOpenMailbox` is false for null). */
export function gmailUrl(mailbox: string | null | undefined, fragment: string): string {
  const hash = fragment.replace(/^#/, '');
  const base = 'https://mail.google.com/mail/';
  return mailbox ? `${base}?authuser=${encodeURIComponent(mailbox)}#${hash}` : `${base}#${hash}`;
}

/** True when the signed-in person IS the mailbox, so a link is useful. */
export function canOpenMailbox(sessionEmail: string | null | undefined, mailbox: string | null | undefined): boolean {
  if (!sessionEmail || !mailbox) return false;
  return sessionEmail.trim().toLowerCase() === mailbox.trim().toLowerCase();
}

/** "allie@risingtidestr.com" reads as "Allie's" in a sentence about where a
 *  draft went; an unknown mailbox reads as "the team's". */
export function mailboxOwnerLabel(mailbox: string | null | undefined): string {
  const local = (mailbox || '').split('@')[0].trim();
  if (!local) return "the team's";
  return `${local.charAt(0).toUpperCase()}${local.slice(1).toLowerCase()}'s`;
}

/** The sentence a non-owner of the mailbox sees after a draft is made. */
export function draftSavedNotice(mailbox: string | null | undefined): string {
  return `Draft saved in ${mailboxOwnerLabel(mailbox)} Gmail drafts, ready for them to send.`;
}
