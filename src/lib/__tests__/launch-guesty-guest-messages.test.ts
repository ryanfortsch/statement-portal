import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LAUNCH_STEPS,
  deriveStepNotApplicable,
  resolveLaunchSteps,
  type LaunchDerivationContext,
} from '../launch-checklist.ts';

/**
 * A new home's Guesty guest message set must carry the stay-change
 * conditions (2026-11-12). The concierge marks a reservation "Checkout
 * moved" or "Arrival moved" when a guest pays to extend or arrive early;
 * only the conditions on Guesty's own messages make that mark do anything.
 * Guesty exposes no API for automations, so the Launch list is the one
 * place a new home's set gets them.
 */

function ctx(over: Partial<LaunchDerivationContext['property']> = {}): LaunchDerivationContext {
  return {
    property: {
      title: 'Stay at Black Rock Harbor',
      owner_full: null,
      owner_emails: null,
      owner_phone: null,
      management_fee_pct: null,
      bank_last4: null,
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
  };
}

const step = LAUNCH_STEPS.find((s) => s.key === 'guesty_guest_messages');

test('the step exists, is required, and opens Guesty automations', () => {
  assert.ok(step, 'guesty_guest_messages is on the Launch list');
  assert.equal(step!.required, true);
  assert.equal(step!.who, 'ops');
  assert.equal(step!.phase, 'integrations');
  assert.equal(step!.action, 'open_guesty_automations');
  const keys = LAUNCH_STEPS.map((s) => s.key);
  assert.equal(keys.indexOf('guesty_guest_messages'), keys.indexOf('guesty_cleaning_automation') + 1);
});

test('it names both fields, the early-arrival copies and their timing', () => {
  const d = step!.description ?? '';
  for (const needle of ['"Checkout moved is not"', '"Arrival moved is not"', '"Arrival moved is Yes"', '(early arrival)', '2 days', '25 hours', 'tomorrow']) {
    assert.ok(d.includes(needle), needle);
  }
});

test('only a Helm-run home resolves it n_a', () => {
  assert.equal(deriveStepNotApplicable('guesty_guest_messages', ctx()), false);
  assert.equal(deriveStepNotApplicable('guesty_guest_messages', ctx({ region: 'cape_ann', calendar_authority: 'guesty' })), false);
  // Out of region still messages its guests through Guesty (Lighthouse Point, 65 Calderwood).
  assert.equal(deriveStepNotApplicable('guesty_guest_messages', ctx({ region: 'lighthouse_point_fl', calendar_authority: 'guesty' })), false);
  assert.equal(deriveStepNotApplicable('guesty_guest_messages', ctx({ region: 'cape_ann', calendar_authority: 'helm' })), true);
  const e = resolveLaunchSteps([], ctx({ region: 'bridgeport_ct' })).find((x) => x.step.key === 'guesty_guest_messages')!;
  assert.equal(e.status, 'todo');
});

test('Coming online flags it while bookings are landing', () => {
  const src = readFileSync(new URL('../../app/properties/ComingOnline.tsx', import.meta.url), 'utf8');
  assert.match(src, /open\.has\('guesty_guest_messages'\) && load\.facts\.upcomingStays > 0/);
});
