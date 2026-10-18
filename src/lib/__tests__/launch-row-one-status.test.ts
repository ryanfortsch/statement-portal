/**
 * A Launch row has one status control and one way to set its field
 * (UI/UX audit 2026-10-17, appendix 05, /properties/[id]/launch).
 *
 * Run: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { LAUNCH_STATUS_CHOICES, LAUNCH_STEPS, normalizeLaunchStatus, openStepTitle, resolveLaunchSteps } from '../launch-checklist.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('three statuses: Done, Not done, Does not apply', () => {
  assert.deepEqual(LAUNCH_STATUS_CHOICES.map((c) => c.label), ['Done', 'Not done', 'Does not apply']);
  assert.deepEqual(LAUNCH_STATUS_CHOICES.map((c) => c.value), ['done', 'todo', 'n_a']);
  assert.equal(normalizeLaunchStatus('in_progress'), 'todo');
  assert.equal(normalizeLaunchStatus('skipped'), 'n_a');
  assert.equal(normalizeLaunchStatus(null), 'todo');
  assert.equal(normalizeLaunchStatus('done'), 'done');
  const actions = read('src/app/properties/[id]/launch/actions.ts');
  assert.ok(actions.includes("const VALID_STATUSES: ReadonlyArray<LaunchStepStatus> = ['todo', 'done', 'n_a'];"));
  const card = read('src/app/properties/[id]/launch/LaunchStepCard.tsx');
  assert.ok(card.includes('const STATUS_OPTIONS = LAUNCH_STATUS_CHOICES;'));
  assert.ok(card.includes('const manualStatus: LaunchStepStatus = normalizeLaunchStatus(row?.status);'));
});

test('a row still marked in progress reads as open, and derivation can lift it', () => {
  const step = LAUNCH_STEPS.find((s) => s.key === 'owner_contact_confirmed')!;
  const eff = resolveLaunchSteps([{ step_key: step.key, status: 'in_progress' }, { step_key: 'tax_cert', status: 'skipped' }], {
    // Minimal context: nothing derivable.
    property: {} as never,
  } as never);
  assert.equal(eff.find((e) => e.step.key === step.key)?.resolved, false);
  const tax = eff.find((e) => e.step.key === 'tax_cert');
  assert.equal(tax?.status, 'n_a');
  assert.equal(tax?.resolved, true);
});

test('a row with an inline editor has no second link to the edit page', () => {
  const card = read('src/app/properties/[id]/launch/LaunchStepCard.tsx');
  const m = card.match(/function deepLinkFor[\s\S]*?\n\}/)![0];
  assert.match(m, /case 'set_listing_match':\s*\n\s*case 'set_bank_last4':\s*\n\s*case 'set_tax_cert':[\s\S]*?return null;/);
  assert.match(m, /case 'edit_field':\s*\n\s*return \{ href: `\/properties\/\$\{propertyId\}\/edit`, label: 'Open property edit'/);
  assert.ok(m.includes("href: 'https://my.quo.com/', label: 'Open Quo'"), 'the Quo step opens Quo');
});

test('the code roster step reads as what the operator sees; the file path is in its why line', () => {
  const step = LAUNCH_STEPS.find((s) => s.key === 'code_roster_entry')!;
  assert.equal(openStepTitle(step), 'Book page does not resolve yet; ask Systems');
  assert.ok(!step.title.includes('src/') && !(step.description ?? '').includes('src/'));
  assert.ok(step.why?.includes('src/lib/properties.ts'));
  assert.ok(read('src/app/properties/ComingOnline.tsx').includes("'Book page does not resolve yet; ask Systems for the roster entry.'"));
});

test('the Stripe account check runs on a button, for owners only', () => {
  const check = read('src/app/properties/[id]/launch/StripeAccountCheck.tsx');
  assert.ok(!check.includes('useEffect'), 'no check on load');
  assert.ok(check.includes("'Check this key'"));
  const page = read('src/app/properties/[id]/launch/page.tsx');
  assert.ok(page.includes("{phase.key === 'financial' && owner && <StripeAccountCheck propertyId={p.id} />}"));
  assert.ok(page.includes('const owner = await isOwnerSession();'));
});
