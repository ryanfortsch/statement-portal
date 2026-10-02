/**
 * Who receives a property's owner statements, changed because an owner asked.
 *
 * Dotti, 2026-10-02, on Alex Rosenstein (4 Middle) writing "Can you add Laura
 * to these communications (lacbc5@gmail.com)": "shouldnt this trigger an
 * action?" The drafted reply said "Done, Laura's added" and nothing on the
 * card made that true. The send list is `properties.owner_emails`
 * (/api/draft-email addresses statements To it), so a reply promising a
 * change to it has to come with a change to it.
 *
 * Two lists move together, because they answer two different questions:
 *
 *   owner_emails  who the statement is addressed to. The source of truth for
 *                 statements and contracts.
 *   owners        the structured contact cards. /api/owners-sync feeds these
 *                 to stay-concierge, and that is how an inbound email from
 *                 the new address is recognised as an owner instead of being
 *                 missed. Adding to owner_emails alone would put Laura on
 *                 the statement and leave her replies unwatched.
 *
 * Pure: the route reads the rows, this decides the new values, the route
 * writes them. Nothing here talks to the database.
 */

export type RecipientOp = 'add' | 'remove';

export type OwnerCardLike = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  is_primary?: boolean;
  role?: string;
  notes?: string;
};

export type RecipientPlan = {
  owner_emails: string[];
  owners: OwnerCardLike[];
  changed: boolean;
  /** Why nothing was changed, when that was a refusal rather than a no-op. */
  refused?: 'last_recipient' | 'primary_contact';
};

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

export function normalizeEmail(raw: unknown): string | null {
  const email = String(raw ?? '').trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

/** "Laura Rosenstein" -> first/last. A single word is a first name. */
export function splitName(raw: unknown): { first_name: string; last_name: string } {
  const parts = String(raw ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '', last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

/**
 * The property rows this change applies to. An owner asking to "add Laura to
 * these communications" means every statement they receive, so it follows
 * the requesting owner's address across the fleet (Prudenzi gets one email
 * for two units). When the requester is on no property's list, or was not
 * given, the named property is the scope.
 */
export function scopeProperties<T extends { id: string; owner_emails: string[] | null }>(
  rows: T[],
  propertyId: string,
  requesterEmail: string | null,
): T[] {
  if (requesterEmail) {
    const mine = rows.filter((r) =>
      (r.owner_emails ?? []).some((e) => e.trim().toLowerCase() === requesterEmail),
    );
    if (mine.length > 0) return mine;
  }
  return rows.filter((r) => r.id === propertyId);
}

export function planRecipientChange(
  current: { owner_emails: string[] | null; owners: OwnerCardLike[] | null },
  op: RecipientOp,
  email: string,
  opts: { name?: string; note?: string } = {},
): RecipientPlan {
  const emails = (current.owner_emails ?? []).map((e) => e.trim()).filter(Boolean);
  const owners = Array.isArray(current.owners) ? current.owners.map((c) => ({ ...c })) : [];
  const has = (e: string) => e.trim().toLowerCase() === email;

  if (op === 'add') {
    const nextEmails = emails.some(has) ? emails : [...emails, email];
    const cardExists = owners.some((c) => has(String(c.email ?? '')));
    const nextOwners = cardExists
      ? owners
      : [
          ...owners,
          {
            ...splitName(opts.name),
            email,
            phone: '',
            is_primary: owners.length === 0,
            role: 'Other',
            notes: opts.note ?? '',
          },
        ];
    return {
      owner_emails: nextEmails,
      owners: nextOwners,
      changed: nextEmails.length !== emails.length || nextOwners.length !== owners.length,
    };
  }

  // Remove. Never leave a statement addressed to nobody, and never delete the
  // primary contact card on an owner's say-so in an email: both are a call
  // for the operator on the property page, not something a reply can do.
  const remaining = emails.filter((e) => !has(e));
  if (remaining.length === 0 && emails.length > 0) {
    return { owner_emails: emails, owners, changed: false, refused: 'last_recipient' };
  }
  if (owners.some((c) => c.is_primary && has(String(c.email ?? '')))) {
    return { owner_emails: emails, owners, changed: false, refused: 'primary_contact' };
  }
  const nextOwners = owners.filter((c) => !has(String(c.email ?? '')));
  return {
    owner_emails: remaining,
    owners: nextOwners,
    changed: remaining.length !== emails.length || nextOwners.length !== owners.length,
  };
}
