/**
 * Two small truths on the prospect pages.
 *
 * - A workroom link box shows the absolute URL that Copy puts on the
 *   clipboard, so what the reader sees is what lands in the email.
 * - The funnel's Sync Gmail note names the mailboxes the sync's tokens
 *   open, as Gmail reports them, never a remembered name ("Allie's sent
 *   folder" was the copy; the bare token's mailbox is Gmail's to say).
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prospectMailboxes, prospectSyncNote } from '../prospect-mailboxes.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

test('the link box prints the URL Copy copies', () => {
  const page = read('src/app/prospects/[id]/page.tsx');
  const row = page.slice(page.indexOf('function LinkRow('), page.indexOf('function StageStat('));
  assert.match(row, /\{fullUrl\}\s*<\/code>/);
  assert.match(row, /<CopyLinkButton text=\{fullUrl\} \/>/);
  assert.doesNotMatch(row, /\{link\}\s*<\/code>/);
});

test('the note names what Gmail says, and says less when Gmail cannot', () => {
  assert.equal(
    prospectSyncNote(['dotti@risingtidestr.com']),
    'Sync reads the sent mail of dotti@risingtidestr.com and tags each prospect with the last deliverable it finds.',
  );
  assert.equal(
    prospectSyncNote(['a@x.com', 'b@x.com', 'c@x.com']),
    'Sync reads the sent mail of a@x.com, b@x.com and c@x.com and tags each prospect with the last deliverable it finds.',
  );
  assert.match(prospectSyncNote([]), /^Sync reads the team’s sent mail/);
  assert.match(prospectSyncNote([null, null]), /^Sync reads the team’s sent mail/, 'Gmail could not say');
  assert.equal(prospectSyncNote(['a@x.com', 'a@x.com']), prospectSyncNote(['a@x.com']), 'one mailbox behind two tokens is named once');
  const panel = read('src/components/projections/ProspectsPanel.tsx');
  assert.match(panel, /prospectSyncNote\(syncMailboxes\)/);
  assert.match(panel, /prospectMailboxes\(\)\.map\(\(m\) => gmailMailbox\(m\.key\)/, 'asks Gmail through the one cached lookup');
  assert.doesNotMatch(panel, /Allie&rsquo;s sent folder|Allie's sent folder/);
});

test('the sync and the note read one list of mailboxes', () => {
  const route = read('src/app/api/sync-prospect-mail/route.ts');
  assert.match(route, /const MAILBOXES: Mailbox\[\] = prospectMailboxes\(\);/);
  const saved = { ...process.env };
  try {
    for (const k of ['GMAIL_REFRESH_TOKEN', 'GMAIL_REFRESH_TOKEN_ALLIE', 'GMAIL_REFRESH_TOKEN_RYAN', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_CLIENT_ID_RYAN', 'GMAIL_CLIENT_SECRET_RYAN', 'GMAIL_CLIENT_ID_ALLIE', 'GMAIL_CLIENT_SECRET_ALLIE']) delete process.env[k];
    assert.deepEqual(prospectMailboxes(), []);
    process.env.GMAIL_CLIENT_ID = 'id';
    process.env.GMAIL_CLIENT_SECRET = 'secret';
    process.env.GMAIL_REFRESH_TOKEN = 'synthetic-bare';
    assert.deepEqual(prospectMailboxes().map((m) => [m.name, m.key]), [['Allie', 'shared']]);
    process.env.GMAIL_REFRESH_TOKEN_RYAN = 'synthetic-ryan';
    assert.deepEqual(prospectMailboxes().map((m) => [m.name, m.key]), [['Allie', 'shared'], ['Ryan', 'ryan']]);
    delete process.env.GMAIL_REFRESH_TOKEN;
    process.env.GMAIL_REFRESH_TOKEN_ALLIE = 'synthetic-allie';
    assert.deepEqual(prospectMailboxes().map((m) => [m.name, m.key]), [['Allie', 'allie'], ['Ryan', 'ryan']]);
  } finally {
    process.env = saved;
  }
});
