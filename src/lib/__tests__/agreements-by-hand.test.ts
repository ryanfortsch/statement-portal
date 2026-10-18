/**
 * Agreements read by whose hand they are in.
 *
 * The list groups Waiting on us / Waiting on guest / Done, the form shows
 * the mid-term dials only for a mid-term agreement, and the detail page's
 * audit block reads as sentences with the raw trail behind "Show ids".
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGREEMENT_GROUPS,
  agreementGroup,
  agreementNextStep,
  agreementAuditSentences,
  agreementStatus,
} from '../agreement-types.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('which hand an agreement is in', () => {
  test('a draft and a guest signature wait on us; a sent link waits on the guest; executed and cancelled are done', () => {
    assert.equal(agreementGroup('draft'), 'us');
    assert.equal(agreementGroup('signed'), 'us');
    assert.equal(agreementGroup('sent'), 'guest');
    assert.equal(agreementGroup('executed'), 'done');
    assert.equal(agreementGroup('voided'), 'done');
  });

  test('the groups read in order, with plain labels', () => {
    assert.deepEqual(AGREEMENT_GROUPS.map((g) => g.label), ['Waiting on us', 'Waiting on guest', 'Done']);
  });

  test('a row waiting on us names its next step', () => {
    assert.equal(agreementNextStep('draft'), 'Send the signing link');
    assert.equal(agreementNextStep('signed'), 'Countersign');
    for (const s of ['sent', 'executed', 'voided'] as const) assert.equal(agreementNextStep(s), null);
  });

  test('a voided agreement is done even after the guest signed', () => {
    const status = agreementStatus({ voided_at: '2026-10-01T00:00:00Z', countersigned_at: null, guest_signed_at: '2026-09-30T00:00:00Z', sent_at: '2026-09-29T00:00:00Z' });
    assert.equal(agreementGroup(status), 'done');
  });

  test('the list groups through the rule', () => {
    const src = read('src/app/guests/AgreementsTab.tsx');
    assert.ok(src.includes('agreementGroup(agreementStatus(a)) === g.id'));
    assert.ok(src.includes('AGREEMENT_GROUPS.map('));
  });
});

describe('the form and the audit block', () => {
  test('the mid-term dials show only while Mid-term is picked', () => {
    const form = read('src/app/guests/agreements/AgreementForm.tsx');
    assert.ok(form.includes('className="rt-agreement-form"'));
    assert.ok(form.includes('<FormBlock title="Mid-term dials" className="rt-agreement-midterm">'));
    assert.ok(!form.includes('ignored for short-term.">'), 'no hint for a block that only shows when it applies');
    const css = read('src/app/globals.css');
    assert.ok(css.includes('.rt-agreement-midterm { display: none; }'));
    assert.ok(css.includes('.rt-agreement-form:has(input[name="kind"][value="mid_term"]:checked) .rt-agreement-midterm { display: block; }'));
  });

  test('the audit reads as sentences, in Eastern time', () => {
    const lines = agreementAuditSentences({
      guest_signed_name: 'Emily Hancock',
      guest_signed_at: '2026-10-18T19:40:00Z',
      guest_email_sent_at: '2026-10-18T19:41:00Z',
      countersigned_at: '2026-10-19T13:05:00Z',
      executed_email_sent_at: null,
    });
    assert.deepEqual(lines, [
      'Emily Hancock signed on Oct 18, 3:40 PM.',
      'Their signed copy was emailed Oct 18, 3:41 PM.',
      'Countersigned Oct 19, 9:05 AM.',
    ]);
    assert.deepEqual(agreementAuditSentences({ guest_signed_name: null, guest_signed_at: null, guest_email_sent_at: null, countersigned_at: null, executed_email_sent_at: null }), []);
  });

  test('the detail page prints the sentences and folds the ids', () => {
    const page = read('src/app/guests/agreements/[id]/page.tsx');
    assert.ok(page.includes("{agreementAuditSentences(a).join(' ')}"));
    assert.ok(page.includes('>Show ids</summary>'));
    for (const raw of ['signed_name:', 'signed_at:', 'signed_copy_emailed:', 'executed_emailed:']) {
      assert.ok(!page.includes(raw), `the audit still prints ${raw}`);
    }
  });
});
