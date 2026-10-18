/**
 * Copy instead of Create.
 *
 * A work order or an owner email is drafted in the sender's own Gmail when
 * Helm holds a token for them (sessionMailbox in gmail-draft.ts). When it
 * holds none, the surface composes the same email and hands it over to
 * paste into their own mail, rather than drafting it in a mailbox the
 * sender cannot open. This is the client half: one text block, the
 * envelope lines first and then the body, and the clipboard write.
 */

export type CopiedEmail = { to: string[]; cc: string[]; subject: string; body: string };

/** The email as one paste: To, Cc and Subject on top, then the body. */
export function copiedEmailText(email: CopiedEmail): string {
  const lines = [`To: ${email.to.join(', ')}`];
  if (email.cc.length > 0) lines.push(`Cc: ${email.cc.join(', ')}`);
  lines.push(`Subject: ${email.subject}`, '', email.body);
  return lines.join('\n');
}

/** True once the text is on the clipboard. False when the browser refuses
 *  (no permission, an insecure origin): the surface then shows the text to
 *  select by hand. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** "allie@ + ryan@" for a line about who is copied. */
export function shortAddresses(list: string[]): string {
  return list.map((e) => `${e.split('@')[0]}@`).join(' + ');
}

/** Read a route's copy payload, or null when the response is not one. */
export function parseCopiedEmail(value: unknown): CopiedEmail | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((e): e is string => typeof e === 'string') : []);
  if (typeof v.subject !== 'string' || typeof v.body !== 'string' || !v.body.trim()) return null;
  const to = list(v.to);
  if (to.length === 0) return null;
  return { to, cc: list(v.cc), subject: v.subject, body: v.body };
}
