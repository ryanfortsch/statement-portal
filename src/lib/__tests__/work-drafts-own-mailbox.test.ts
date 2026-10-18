/**
 * Work-order and owner-email drafts land where the sender can see them.
 *
 * The UI/UX audit of 2026-10-17 found every Work draft made in one fixed
 * mailbox: work orders in Dotti's (or the shared one), owner emails in the
 * shared one, so for anyone else "Create Gmail draft" produced a draft they
 * could not find, and the composer said "from dotti@" to whoever clicked.
 * #1811 made links carry their mailbox; this makes the draft itself go to
 * the signed-in person's own Gmail when Helm holds a token for them
 * (GMAIL_REFRESH_TOKEN_<DOTTI|RYAN|ALLIE>, or the shared token when it is
 * theirs), with the composer saying so, and Copy instead of Create when it
 * holds none. gmail-draft.ts imports server-only, so the server half is
 * read from source; the pure half runs.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copiedEmailText, parseCopiedEmail, shortAddresses } from '../copy-email.ts';
import { ALWAYS_CC, alwaysCcFor } from '../always-cc.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the email to copy', () => {
  test('one paste: To, Cc and Subject on top, then the body', () => {
    assert.equal(
      copiedEmailText({ to: ['owner@example.test'], cc: ['ryan@risingtidestr.com'], subject: 'Work order', body: 'Hi there,\n\nJobs.' }),
      'To: owner@example.test\nCc: ryan@risingtidestr.com\nSubject: Work order\n\nHi there,\n\nJobs.',
    );
    assert.equal(copiedEmailText({ to: ['a@example.test'], cc: [], subject: 'S', body: 'B' }), 'To: a@example.test\nSubject: S\n\nB');
  });

  test('a malformed copy payload is never read as one', () => {
    assert.equal(parseCopiedEmail(undefined), null);
    assert.equal(parseCopiedEmail({ to: [], subject: 'S', body: 'B' }), null);
    assert.equal(parseCopiedEmail({ to: ['a@example.test'], subject: 'S', body: '   ' }), null);
    assert.deepEqual(parseCopiedEmail({ to: ['a@example.test', 7], cc: 'x', subject: 'S', body: 'B' }), { to: ['a@example.test'], cc: [], subject: 'S', body: 'B' });
  });

  test('a sender is never copied on their own email', () => {
    assert.deepEqual(alwaysCcFor('Ryan@RisingTideSTR.com'), ['allie@risingtidestr.com']);
    assert.deepEqual(alwaysCcFor('dotti@risingtidestr.com'), ALWAYS_CC);
    assert.deepEqual(alwaysCcFor(null), ALWAYS_CC);
    assert.equal(shortAddresses(alwaysCcFor('dotti@risingtidestr.com')), 'allie@ + ryan@');
  });
});

describe('the draft goes to the sender’s own Gmail', () => {
  const helper = code(read('src/lib/gmail-draft.ts'));

  test('a token counts as yours only when Gmail says its address is yours', () => {
    const fn = helper.slice(helper.indexOf('export async function sessionMailbox('), helper.indexOf('async function getAccessToken('));
    assert.ok(fn.length > 0, 'sessionMailbox is where it was');
    assert.ok(fn.includes('const address = await gmailMailbox(key);'), 'each token is asked of Gmail');
    assert.ok(fn.includes('address === email'), 'the address must be the session’s own');
    assert.ok(helper.includes('GMAIL_REFRESH_TOKEN_${suffix}'), 'one token per person, by name');
  });

  test('a draft names its mailbox; nothing prefers one person’s', () => {
    assert.ok(/mailbox: MailboxKey;\n\}\): Promise<GmailDraftResult>/.test(helper), 'createGmailDraft takes the mailbox');
    assert.ok(!helper.includes('preferDotti'), 'a draft no longer prefers Dotti’s mailbox');
  });

  test('a work order is from the sender, drafted in their mailbox, and only composed when they have none', () => {
    const order = code(read('src/lib/work-order-email.ts'));
    assert.ok(!order.includes("'dotti@risingtidestr.com'"), 'the work order still comes from a fixed person');
    assert.ok(order.includes('from: `${args.senderName} <${args.sentByEmail}>`'), 'From is the sender');
    assert.ok(order.includes('const cc = alwaysCcFor(args.sentByEmail);'), 'the sender is not copied on their own email');
    assert.ok(order.includes('if (args.mailbox !== null) {'), 'a draft is made only in the sender’s own mailbox');
    assert.ok(order.includes("args.mailbox === null ? plan.map(() => null)"), 'copying fetches no photo bytes');
    const action = code(read('src/app/work/runs-actions.ts'));
    assert.ok(action.includes('const mine = await sessionMailbox(session.user.email);'));
    assert.ok(action.includes('mailbox: mine?.key ?? null,'));
  });

  test('an owner email is drafted in the sender’s Gmail, or handed back to copy', () => {
    const route = code(read('src/app/api/work/draft-owner-email/route.ts'));
    assert.ok(route.includes('const mine = await sessionMailbox(senderEmail);'));
    assert.ok(/if \(mine\) \{\s*const draft = await createGmailDraft\(/.test(route), 'the draft is created only in the sender’s mailbox');
    assert.ok(route.includes('mailbox: mine.key,'));
    assert.ok(route.includes('copy: { to: ownerEmails, cc, subject, body: emailBody },'), 'no mailbox: the email comes back to copy');
    assert.ok(!route.includes('process.env.GMAIL_REFRESH_TOKEN'), 'the route holds no token of its own');
  });

  test('every page that drafts asks whose Gmail the session has', () => {
    for (const page of ['src/app/work/page.tsx', 'src/app/work/[id]/page.tsx', 'src/app/work/maintenance/page.tsx', 'src/app/properties/[id]/page.tsx']) {
      assert.ok(read(page).includes('sessionMailbox('), `${page} does not ask for the session's mailbox`);
    }
  });
});

describe('the composer says whose draft it will be', () => {
  test('the work-order composer names the mailbox, or offers Copy', () => {
    const rail = read('src/app/work/RunsRail.tsx');
    assert.ok(rail.includes("const copyMode = myMailbox === null;"));
    assert.ok(rail.includes('Drafts in ${myMailbox ? `your Gmail (${myMailbox})` : \'your Gmail\'}'), 'the composer names the mailbox');
    assert.ok(rail.includes("'Copy email'"), 'with no Gmail the button copies');
    assert.ok(!rail.includes('from dotti@'), 'the composer still says from dotti@ to everyone');
  });

  test('the owner-email buttons copy when the session has no Gmail', () => {
    for (const file of ['src/app/work/QueueClient.tsx', 'src/app/properties/[id]/PropertyDraftOwnerEmailButton.tsx', 'src/app/work/[id]/SlipOwnerActionEditor.tsx']) {
      const src = read(file);
      assert.ok(src.includes("'Copy owner email'"), `${file} has no Copy`);
      assert.ok(src.includes('CopiedEmailNotice'), `${file} does not say where the copy goes`);
    }
    assert.ok(read('src/lib/use-owner-email-draft.ts').includes('const copy = parseCopiedEmail(data?.copy);'));
  });
});
