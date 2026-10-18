/**
 * An executed guest rental agreement is never voided.
 *
 * The audit (2026-10-17, report 10) found "Void agreement" rendering on an
 * executed, Drive-archived agreement, and `voidAgreement` writing voided_at
 * with no state check; `agreementStatus` then filed the signed lease under
 * Voided. The rule now lives in `agreementVoidability`, and three places lean
 * on it: the action refuses, the write is guarded, and the page never offers
 * the button. This reads the source for the last two.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agreementVoidability } from '../agreement-types.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const base = { voided_at: null, countersigned_at: null, guest_signed_at: null, sent_at: null };
const at = '2026-10-18T14:00:00Z';

describe('agreementVoidability', () => {
  test('an executed agreement cannot be voided', () => {
    const v = agreementVoidability({ ...base, sent_at: at, guest_signed_at: at, countersigned_at: at });
    assert.equal(v.ok, false);
  });

  test('an already voided agreement is not voided twice', () => {
    assert.equal(agreementVoidability({ ...base, voided_at: at }).ok, false);
  });

  test('a sent agreement asks once, naming what the guest loses', () => {
    const v = agreementVoidability({ ...base, sent_at: at });
    assert.ok(v.ok);
    assert.equal(v.confirm, 'Kills the signing link. The guest can no longer sign.');
  });

  test('a signed agreement asks, and says the signature goes', () => {
    const v = agreementVoidability({ ...base, sent_at: at, guest_signed_at: at });
    assert.ok(v.ok);
    assert.match(v.confirm ?? '', /already signed/);
  });

  test('a draft the guest never received voids without a question', () => {
    const v = agreementVoidability(base);
    assert.ok(v.ok);
    assert.equal(v.confirm, null);
  });
});

describe('the void guard is wired', () => {
  const action = (() => {
    const src = read('src/app/guests/agreements/actions.ts');
    const start = src.indexOf('export async function voidAgreement');
    assert.ok(start >= 0, 'voidAgreement not found');
    return src.slice(start, src.indexOf('export async function', start + 10));
  })();

  test('voidAgreement asks agreementVoidability before writing', () => {
    assert.ok(action.includes('agreementVoidability('), 'voidAgreement no longer checks agreementVoidability');
    assert.ok(action.indexOf('agreementVoidability(') < action.indexOf('.update('));
  });

  test('the write itself refuses a countersigned row', () => {
    assert.match(action, /\.update\(\{ voided_at:[^}]*\}\)[\s\S]*?\.is\('countersigned_at', null\)/);
  });

  test('the page offers Void only when voidable, with the confirm', () => {
    const page = read('src/app/guests/agreements/[id]/page.tsx');
    assert.ok(page.includes('agreementVoidability(a)'));
    const form = page.indexOf('<form action={voidAgreement}>');
    assert.ok(form > 0);
    assert.ok(page.lastIndexOf('voidable.ok ?', form) > 0, 'the Void form is not behind voidable.ok');
    assert.ok(page.includes('confirm={voidable.confirm ?? undefined}'));
    assert.ok(page.includes('Cancel this agreement'));
    assert.ok(!page.includes('Danger zone'));
  });
});
