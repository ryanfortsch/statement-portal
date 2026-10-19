import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stepperForwardLabel, ISSUE_BECOMES_WORK_ORDER, ISSUE_HINT_SEEN_KEY } from '../stepper-words.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const stepper = read('../../app/inspections/[id]/Stepper.tsx');

test('the forward button says Next on a marked card and Skip only on an unmarked one', () => {
  assert.equal(stepperForwardLabel(true), 'Next →');
  assert.equal(stepperForwardLabel(false), 'Skip →');
  assert.match(stepper, /onClick=\{goNext\}[^>]*>\s*\{stepperForwardLabel\(!!activeResult\)\}/);
  assert.ok(!/>\s*Skip →\s*</.test(stepper), 'no hard-coded Skip on the card bar');
});

test('the first Issue a contractor marks says what becomes of it, once per device', () => {
  assert.match(stepper, /\{ISSUE_BECOMES_WORK_ORDER\}/);
  const fn = stepper.slice(stepper.indexOf('function firstIssueOnDevice'), stepper.indexOf('function mark('));
  assert.match(fn, /if \(!photoRequired\) return false;/, 'contractor walks only (staff issues file at completion)');
  assert.match(fn, /localStorage\.getItem\(ISSUE_HINT_SEEN_KEY\)/);
  assert.match(fn, /localStorage\.setItem\(ISSUE_HINT_SEEN_KEY, '1'\)/);
  assert.match(stepper, /setIssueHint\(status === 'issue' && firstIssueOnDevice\(\)\)/);
  assert.equal(ISSUE_HINT_SEEN_KEY, 'helm-field-issue-hint-seen');
});

test('the line stays true: a contractor walk files its issues at the office approve, not at completion', () => {
  assert.equal(ISSUE_BECOMES_WORK_ORDER, 'An Issue becomes a work order once the office approves the trip.');
  const complete = read('../../app/inspections/actions.ts');
  assert.match(complete, /if \(actor\.kind !== 'contractor'\) \{[\s\S]{0,200}openWorkSlipsForInspectionIssues\(/, 'completion files staff issues only');
  const approve = read('../../app/fieldwork/packets/actions.ts');
  assert.match(approve, /openWorkSlipsForInspectionIssues\(iid, \{/, 'the packet approve files the contractor issues');
});
