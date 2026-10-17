/**
 * Every Gmail link carries the mailbox it belongs to, and renders only for
 * the session that owns that mailbox. See gmail-links.ts.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canOpenMailbox, draftSavedNotice, gmailUrl, mailboxOwnerLabel } from '../gmail-links.ts';

describe('gmail links', () => {
  test('a link names its mailbox and never the first-signed-in account', () => {
    assert.equal(
      gmailUrl('allie@risingtidestr.com', 'drafts/r123'),
      'https://mail.google.com/mail/?authuser=allie%40risingtidestr.com#drafts/r123',
    );
    assert.equal(gmailUrl('dotti@risingtidestr.com', '#inbox/abc'), 'https://mail.google.com/mail/?authuser=dotti%40risingtidestr.com#inbox/abc');
    assert.ok(!gmailUrl('allie@risingtidestr.com', 'inbox').includes('/u/0/'));
    // Unknown mailbox: a plain link, which nobody is offered (below).
    assert.equal(gmailUrl(null, 'drafts'), 'https://mail.google.com/mail/#drafts');
  });

  test('only the mailbox owner may open it; unknown is nobody', () => {
    assert.equal(canOpenMailbox('allie@risingtidestr.com', 'allie@risingtidestr.com'), true);
    assert.equal(canOpenMailbox('Allie@RisingTideSTR.com ', 'allie@risingtidestr.com'), true, 'case and whitespace do not matter');
    assert.equal(canOpenMailbox('delaney@risingtidestr.com', 'allie@risingtidestr.com'), false);
    assert.equal(canOpenMailbox('ryan@risingtidestr.com', 'allie@risingtidestr.com'), false);
    assert.equal(canOpenMailbox('allie@risingtidestr.com', null), false, 'no known mailbox, no link for anyone');
    assert.equal(canOpenMailbox(null, 'allie@risingtidestr.com'), false);
    assert.equal(canOpenMailbox(undefined, undefined), false);
  });

  test('where a draft went reads as a plain sentence', () => {
    assert.equal(mailboxOwnerLabel('allie@risingtidestr.com'), "Allie's");
    assert.equal(mailboxOwnerLabel('DOTTI@risingtidestr.com'), "Dotti's");
    assert.equal(mailboxOwnerLabel(null), "the team's");
    assert.equal(draftSavedNotice('allie@risingtidestr.com'), "Draft saved in Allie's Gmail drafts, ready for them to send.");
    assert.ok(!draftSavedNotice(null).includes('—'));
  });
});
