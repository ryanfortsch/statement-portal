/**
 * The Gmail mailboxes the prospect mail sync reads (/api/sync-prospect-mail):
 * the bare GMAIL_REFRESH_TOKEN (or Allie's own, when only that is set), and
 * Ryan's when GMAIL_REFRESH_TOKEN_RYAN is set. The names are labels the sync
 * stamps on a touch. Which address a token actually opens is not something
 * the code knows, so the funnel's note asks Gmail through `gmailMailbox`
 * (gmail-draft.ts, keyed by `key` here) and names what it says. The note
 * used to say "Allie's sent folder" from memory.
 *
 * Pure (env reads only), so the tests import it; the Gmail lookup lives in
 * gmail-draft.ts, which is server-only.
 */

export type ProspectMailbox = {
  name: string;
  /** The gmail-draft.ts token key for this mailbox, for asking whose it is. */
  key: 'shared' | 'allie' | 'ryan';
  refreshToken: string;
  clientId: string;
  clientSecret: string;
};

/** Every configured mailbox; one with no token or client is skipped. */
export function prospectMailboxes(): ProspectMailbox[] {
  const bare = process.env.GMAIL_REFRESH_TOKEN || '';
  return ([
    {
      name: 'Allie',
      key: bare ? 'shared' : 'allie',
      refreshToken: bare || process.env.GMAIL_REFRESH_TOKEN_ALLIE || '',
      clientId: bare ? process.env.GMAIL_CLIENT_ID || '' : process.env.GMAIL_CLIENT_ID_ALLIE || process.env.GMAIL_CLIENT_ID || '',
      clientSecret: bare ? process.env.GMAIL_CLIENT_SECRET || '' : process.env.GMAIL_CLIENT_SECRET_ALLIE || process.env.GMAIL_CLIENT_SECRET || '',
    },
    {
      name: 'Ryan',
      key: 'ryan',
      refreshToken: process.env.GMAIL_REFRESH_TOKEN_RYAN || '',
      // Per-user OAuth client overrides if the OAuth app isn't shared across
      // mailboxes; default to the same shared client + secret.
      clientId: process.env.GMAIL_CLIENT_ID_RYAN || process.env.GMAIL_CLIENT_ID || '',
      clientSecret: process.env.GMAIL_CLIENT_SECRET_RYAN || process.env.GMAIL_CLIENT_SECRET || '',
    },
  ] satisfies ProspectMailbox[]).filter((m) => m.refreshToken && m.clientId && m.clientSecret);
}

export async function prospectMailboxAccessToken(mb: ProspectMailbox): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: mb.clientId,
      client_secret: mb.clientSecret,
      refresh_token: mb.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Failed to refresh ${mb.name}'s Gmail token: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

/** The funnel's one line about what Sync Gmail reads. */
export function prospectSyncNote(addresses: (string | null)[]): string {
  const known = [...new Set(addresses.filter((a): a is string => !!a))];
  const tail = 'and tags each prospect with the last deliverable it finds.';
  if (known.length === 0) return `Sync reads the team’s sent mail ${tail}`;
  const list = known.length === 1 ? known[0] : `${known.slice(0, -1).join(', ')} and ${known[known.length - 1]}`;
  return `Sync reads the sent mail of ${list} ${tail}`;
}
