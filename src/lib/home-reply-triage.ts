/** Presentation only: acknowledgments remain available in Updates and CRM.
 * Full-message matching is deliberately narrow. Unknown or substantive text,
 * dates, requests and negations continue to need review. */
export function isAcknowledgment(text: string): boolean {
  const normalized = text.toLowerCase().normalize('NFKC').replace(/[.!?,;:…👍🙏😊]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^(?:(?:thank you(?: so much)?|thanks(?: so much)?|thx|ty|tysm|thank u|of course|no problem|you bet|perfect|great|ok(?:ay)?|got it|sounds good|appreciate it|you're welcome|you’re welcome)(?:\s+|$))+$/.test(normalized);
}

export function splitReplyUpdates<T extends { summary: string }>(touches: T[]): { replies: T[]; updates: T[] } {
  const replies: T[] = [], updates: T[] = [];
  for (const touch of touches) (isAcknowledgment(touch.summary) ? updates : replies).push(touch);
  return { replies, updates };
}

/**
 * Whether a staff login's home may show a contact's waiting message. Owners
 * and prospects (CRM type 'lead') are the owners' relationships, like the
 * contracts and the prospect pipeline staff cannot open, so their messages
 * stay off a staff feed (2026-11-08, Dotti). A contact whose type could not
 * be read fails closed: absence is not permission.
 */
export function staffMaySeeInbound(contactType: string | null | undefined): boolean {
  return contactType === 'vendor' || contactType === 'other';
}
