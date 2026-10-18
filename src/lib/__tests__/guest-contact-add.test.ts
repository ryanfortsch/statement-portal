/**
 * Add contact never puts an unsubscribed, bounced or complained address back
 * on the list (audit 2026-10-17, report 10: the old upsert wrote
 * status 'subscribed' and marketing consent over whatever was on file, then
 * mirrored the address to Resend as subscribed).
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addContactMessage, keepsExistingStatus, mergeTags } from '../guest-contact-add.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('an existing contact keeps its status', () => {
  test('only subscribed may be left as it is; everything else is kept', () => {
    assert.equal(keepsExistingStatus('subscribed'), false);
    for (const s of ['unsubscribed', 'bounced', 'complained', 'pending']) assert.equal(keepsExistingStatus(s), true, s);
    assert.equal(keepsExistingStatus(null), false);
  });

  test('tags merge rather than replace', () => {
    assert.deepEqual(mergeTags(['vip', 'beach'], ['beach', 'winter']), ['vip', 'beach', 'winter']);
    assert.deepEqual(mergeTags(null, ['a']), ['a']);
  });

  test('the form says which case it was', () => {
    assert.equal(addContactMessage({ kind: 'added' }), 'Contact added');
    assert.equal(addContactMessage(undefined), 'Contact added');
    assert.match(addContactMessage({ kind: 'updated' }), /^Already on the list and subscribed/);
    assert.match(addContactMessage({ kind: 'kept', status: 'unsubscribed' }), /stay unsubscribed and get no campaigns/);
    assert.match(addContactMessage({ kind: 'kept', status: 'bounced' }), /stays bounced/);
    assert.match(addContactMessage({ kind: 'kept', status: 'complained' }), /stay off every send/);
  });
});

describe('the action is wired that way', () => {
  const src = read('src/app/guests/actions.ts');
  const fn = src.slice(src.indexOf('export async function manuallyAddContact'), src.indexOf('export async function', src.indexOf('export async function manuallyAddContact') + 10));

  test('no upsert over an existing address', () => {
    assert.ok(fn.length > 0, 'manuallyAddContact not found');
    assert.ok(!fn.includes('.upsert('), 'manuallyAddContact upserts again: an existing status would be overwritten');
    assert.ok(fn.includes(".eq('email', email)") && fn.includes('.maybeSingle()'), 'it no longer reads the existing row first');
  });

  test('an existing row is updated with names and tags only', () => {
    const existingBranch = fn.slice(fn.indexOf('if (existing) {'), fn.indexOf('} else {', fn.indexOf('if (existing) {')));
    assert.ok(existingBranch.includes('const updates: Record<string, unknown> = { tags: mergeTags(row.tags, tags) };'));
    assert.ok(!/updates\.(status|marketing_consent|subscribed_at)\b/.test(existingBranch), 'the existing-row update writes a status or consent');
    assert.ok(!existingBranch.includes('marketing_consent'), 'the existing-row update writes consent');
  });

  test('a kept status is never mirrored to Resend', () => {
    const guard = fn.indexOf("if (outcome.kind !== 'kept') {");
    assert.ok(guard > 0 && guard < fn.indexOf('pushContactToResend('), 'the Resend mirror is no longer behind the kept guard');
  });
});
