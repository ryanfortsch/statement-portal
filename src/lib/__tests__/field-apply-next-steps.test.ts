import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = read('../../app/field/apply/page.tsx');
const thanks = page.slice(page.indexOf('if (sp.submitted) {'), page.indexOf('// The live standard card'));

test('the thank-you says who will be in touch and what setup asks, and nothing the office cannot keep', () => {
  assert.ok(thanks.length > 0, 'thank-you block found');
  assert.match(thanks, /goes to the Rising Tide office/);
  assert.match(thanks, /an email from Rising Tide Field/);
  assert.match(thanks, /your W-9, how you want to be paid, and a short agreement/);
  assert.match(thanks, /starts your background check/, 'packet trades are told the check comes next');
  assert.match(thanks, /FIELD_OFFICE_PHONE/);
  const words = thanks.replace(/\/\/.*$/gm, '');
  assert.ok(!/follow up by email/i.test(words), 'a decline sends nothing, so no reply is promised');
  assert.ok(!/\b(within|business days?|\d+\s*(hours?|days?|weeks?))\b/i.test(words), 'no turnaround is named');
});

test('the thank-you stays true: every application reaches the office; the invite comes from Rising Tide Field', () => {
  const apply = read('../../app/field/apply/actions.ts');
  assert.match(apply, /sendNewApplicantEmail\(/);
  const notify = read('../field-notify.ts');
  assert.match(notify, /const FROM_NAME = 'Rising Tide Field';/);
  const invite = notify.slice(notify.indexOf('export async function sendInviteEmail'), notify.indexOf('/** Contractor receipt when'));
  assert.match(invite, /fromName: FROM_NAME/);
  assert.match(invite, /set up your account/);
});

test('the application phone is the onboarding PhoneInput', () => {
  const form = read('../../app/field/apply/ApplyForm.tsx');
  assert.match(form, /<PhoneInput name="phone" required/);
  assert.ok(!/<input name="phone"/.test(form), 'no raw phone input left');
});
