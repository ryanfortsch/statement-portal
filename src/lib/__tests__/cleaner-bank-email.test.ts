import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildCleanerBankEmail,
  validRoutingNumber,
  CAPE_ANN_ELITE_BILLING_TO,
  CHASE_ACH_ROUTING,
  type CleanerBankEmailInput,
} from '../cleaner-bank-email.ts';
import {
  CLEANER_BANK_STEP_SINCE,
  LAUNCH_STEPS,
  deriveStepNotApplicable,
  deriveStepResolved,
  resolveLaunchSteps,
  summarizeLaunch,
  type LaunchDerivationContext,
} from '../launch-checklist.ts';
import { dutyEmails } from '../team-recipients.ts';

/**
 * Every new home sends its bank account to Cape Ann Elite so Andrew can
 * charge its cleanings (Allie, 2026-11-02, after 7 Sumac). The email is
 * built here; the Launch step `cleaner_bank_sent` gates go-live on it.
 */

const input = (over: Partial<CleanerBankEmailInput> = {}): CleanerBankEmailInput => ({
  propertyName: '12 Example',
  address: '12 Example Lane',
  bankLast4: '4321',
  accountNumber: '1234564321',
  routingNumber: CHASE_ACH_ROUTING,
  senderShort: 'Allie',
  cc: [],
  ...over,
});

test('the email goes to Cape Ann Elite with the full account and routing number', () => {
  const r = buildCleanerBankEmail(input({ cc: ['allie@risingtidestr.com'] }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.email.to, [...CAPE_ANN_ELITE_BILLING_TO]);
  assert.deepEqual(r.email.cc, ['allie@risingtidestr.com']);
  assert.equal(r.email.subject, 'Bank account for 12 Example Lane');
  assert.match(r.email.body, /^Hi Andrew -/);
  assert.match(r.email.body, /\n12 Example Lane\nRouting #: 021000021\nAccount #: 1234564321\n/);
  assert.match(r.email.body, /Thanks,\nAllie$/);
  assert.doesNotMatch(r.email.body, /—/);
});

test('spaces and dashes in a pasted number are dropped', () => {
  const r = buildCleanerBankEmail(input({ accountNumber: ' 1234-56-4321 ', routingNumber: '021 000 021' }));
  assert.ok(r.ok);
  if (r.ok) assert.match(r.email.body, /Routing #: 021000021\nAccount #: 1234564321\n/);
});

test('an account that does not end in the last 4 on file is refused', () => {
  const r = buildCleanerBankEmail(input({ accountNumber: '1234561111' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /ends in 1111.*ends in 4321/);
});

test('no last 4 on file: refused, so there is nothing to check against', () => {
  for (const bankLast4 of [null, '', '12']) {
    const r = buildCleanerBankEmail(input({ bankLast4 }));
    assert.equal(r.ok, false, String(bankLast4));
  }
});

test('a short account or a bad routing number is refused', () => {
  assert.equal(buildCleanerBankEmail(input({ accountNumber: '4321' })).ok, false);
  assert.equal(buildCleanerBankEmail(input({ routingNumber: '021000022' })).ok, false);
  assert.equal(buildCleanerBankEmail(input({ routingNumber: '02100002' })).ok, false);
});

test('routing checksum: Chase MA passes, a one-digit change fails', () => {
  assert.equal(validRoutingNumber('021000021'), true);
  assert.equal(validRoutingNumber('011000138'), true);
  assert.equal(validRoutingNumber('021000012'), false);
});

test('a blank address falls back to the internal name', () => {
  const r = buildCleanerBankEmail(input({ address: '  ' }));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.email.subject, 'Bank account for 12 Example');
});

test('Allie holds cleaning_billing, so she is copied', () => {
  assert.deepEqual(dutyEmails('cleaning_billing', '2026-11-02'), ['allie@risingtidestr.com']);
});

// ── The Launch step ────────────────────────────────────────────────────

function ctx(over: Partial<LaunchDerivationContext['property']> = {}, rest: Partial<LaunchDerivationContext> = {}): LaunchDerivationContext {
  return {
    property: {
      title: null,
      owner_full: null,
      owner_emails: null,
      owner_phone: null,
      management_fee_pct: null,
      bank_last4: '4321',
      tax_cert_id: null,
      guesty_listing_id: null,
      is_active: true,
      activated_at: null,
      ...over,
    },
    scaLaunchStatus: null,
    hasQuoCleanerMapping: false,
    locksMapped: 0,
    forwardDistinctPrices: 0,
    firstStayStarted: false,
    invoiceNeedleMapped: false,
    inCodeRoster: false,
    ...rest,
  };
}

test('the step is required, financial, right after the last 4', () => {
  const i = LAUNCH_STEPS.findIndex((s) => s.key === 'cleaner_bank_sent');
  assert.ok(i > 0);
  const step = LAUNCH_STEPS[i];
  assert.equal(step.required, true);
  assert.equal(step.phase, 'financial');
  assert.equal(step.action, 'email_cleaner_bank');
  assert.equal(LAUNCH_STEPS[i - 1].key, 'bank_last4');
});

test('a home coming online now: the step stays open, even with the last 4 entered', () => {
  const c = ctx({}, { firstStayStarted: true, firstStayCheckIn: CLEANER_BANK_STEP_SINCE });
  assert.equal(deriveStepResolved('cleaner_bank_sent', c), false);
  assert.equal(deriveStepNotApplicable('cleaner_bank_sent', c), false);
  const s = summarizeLaunch(resolveLaunchSteps([], c));
  assert.ok(s.requiredRemaining > 0);
});

test('a home live before the step existed reads as sent, not a loose end', () => {
  assert.equal(deriveStepResolved('cleaner_bank_sent', ctx({ activated_at: '2026-08-01T12:00:00.000Z' })), true);
  assert.equal(deriveStepResolved('cleaner_bank_sent', ctx({}, { firstStayStarted: true, firstStayCheckIn: '2026-10-30' })), true);
});

test('outside Cape Ann the step is n_a; a Helm-run Cape Ann home still sends it', () => {
  assert.equal(deriveStepNotApplicable('cleaner_bank_sent', ctx({ region: 'bridgeport_ct' })), true);
  assert.equal(deriveStepNotApplicable('cleaner_bank_sent', ctx({ region: 'cape_ann', calendar_authority: 'helm' })), false);
  assert.equal(deriveStepNotApplicable('cleaner_bank_sent', ctx({ region: null })), false);
});

test('a manual Not done still wins over nothing; a manual Done resolves it', () => {
  const byKey = new Map(resolveLaunchSteps([{ step_key: 'cleaner_bank_sent', status: 'done' }], ctx()).map((e) => [e.step.key, e]));
  assert.equal(byKey.get('cleaner_bank_sent')?.resolved, true);
  assert.equal(byKey.get('cleaner_bank_sent')?.auto, false);
});

// ── Guards on the action and the page ─────────────────────────────────

const actions = readFileSync(new URL('../../app/properties/[id]/launch/actions.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../app/properties/[id]/launch/page.tsx', import.meta.url), 'utf8');

test('the draft action is owners only and stores the number nowhere', () => {
  const start = actions.indexOf('export async function draftCleanerBankEmail');
  assert.ok(start > 0, 'draftCleanerBankEmail exists');
  const body = actions.slice(start);
  assert.match(body, /await requireOwnerEmail\(\)/);
  assert.doesNotMatch(body, /\.(update|insert|upsert)\(/, 'no write while the account number is in hand');
  assert.doesNotMatch(body, /console\.(log|error|warn|info)/, 'no log line can carry the number');
});

test('the page renders the composer for owners only', () => {
  assert.match(page, /step\.action === 'email_cleaner_bank' && owner &&/);
});
