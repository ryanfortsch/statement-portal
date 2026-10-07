import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveStepNotApplicable,
  deriveStepResolved,
  resolveLaunchSteps,
  type LaunchDerivationContext,
} from '../launch-checklist.ts';

/**
 * Four launch steps presuppose a Guesty listing or a Cape Ann surface:
 * guesty_listing_match, guesty_cleaning_automation, code_roster_entry,
 * sca_page_live. A Helm-run home (calendar_authority = 'helm') or a home
 * outside Cape Ann (region != cape_ann) resolves them n_a instead of
 * asking the operator to tick a step with no object. A manual status
 * still wins, and everything else derives exactly as before.
 */

const SCOPED = ['guesty_listing_match', 'guesty_cleaning_automation', 'code_roster_entry', 'sca_page_live'];

function ctx(over: Partial<LaunchDerivationContext['property']> = {}, rest: Partial<LaunchDerivationContext> = {}): LaunchDerivationContext {
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
    ...rest,
  };
}

test('a Guesty-run Cape Ann home: nothing is n_a, including when region is missing', () => {
  for (const key of SCOPED) {
    assert.equal(deriveStepNotApplicable(key, ctx()), false, key);
    assert.equal(deriveStepNotApplicable(key, ctx({ region: 'cape_ann', calendar_authority: 'guesty' })), false, key);
    assert.equal(deriveStepNotApplicable(key, ctx({ region: null, calendar_authority: null })), false, key);
  }
});

test('a Helm-run home resolves the four Guesty / Cape Ann steps n_a', () => {
  const c = ctx({ region: 'cape_ann', calendar_authority: 'helm' });
  for (const key of SCOPED) assert.equal(deriveStepNotApplicable(key, c), true, key);
  const byKey = new Map(resolveLaunchSteps([], c).map((e) => [e.step.key, e]));
  for (const key of SCOPED) {
    const e = byKey.get(key)!;
    assert.equal(e.status, 'n_a', key);
    assert.equal(e.resolved, true, key);
    assert.equal(e.auto, true, key);
  }
});

test('an out-of-region home resolves them n_a even while Guesty still runs it', () => {
  const c = ctx({ region: 'bridgeport_ct', calendar_authority: 'guesty' });
  for (const key of SCOPED) assert.equal(deriveStepNotApplicable(key, c), true, key);
});

test('only those four steps are scoped; the rest derive as before', () => {
  const c = ctx({ region: 'bridgeport_ct', calendar_authority: 'helm', bank_last4: '1226' }, { locksMapped: 1 });
  for (const key of ['bank_last4', 'seam_lock_paired', 'pricing_flowing', 'quo_cleaner_mapped', 'activated', 'external_title']) {
    assert.equal(deriveStepNotApplicable(key, c), false, key);
  }
  assert.equal(deriveStepResolved('bank_last4', c), true);
  assert.equal(deriveStepResolved('seam_lock_paired', c), true);
  assert.equal(deriveStepResolved('pricing_flowing', c), false);
  const byKey = new Map(resolveLaunchSteps([], c).map((e) => [e.step.key, e]));
  assert.equal(byKey.get('bank_last4')!.status, 'done');
  assert.equal(byKey.get('pricing_flowing')!.status, 'todo');
});

test('a manual status wins over the n_a derive', () => {
  const c = ctx({ region: 'bridgeport_ct', calendar_authority: 'helm' });
  const rows = [
    { step_key: 'sca_page_live', status: 'done' as const },
    { step_key: 'code_roster_entry', status: 'in_progress' as const },
  ];
  const byKey = new Map(resolveLaunchSteps(rows, c).map((e) => [e.step.key, e]));
  assert.equal(byKey.get('sca_page_live')!.status, 'done');
  assert.equal(byKey.get('sca_page_live')!.auto, false);
  // in_progress is not todo, so derivation does not touch it.
  assert.equal(byKey.get('code_roster_entry')!.status, 'in_progress');
  assert.equal(byKey.get('code_roster_entry')!.resolved, false);
  // The untouched ones still go n_a.
  assert.equal(byKey.get('guesty_listing_match')!.status, 'n_a');
});

test('the guard is still wired into resolveLaunchSteps', () => {
  // Break the n_a branch in resolveLaunchSteps and this fails before the
  // launch page silently starts nagging for a Guesty listing on a Helm home.
  const c = ctx({ region: 'lighthouse_point_fl' });
  const e = resolveLaunchSteps([], c).find((x) => x.step.key === 'guesty_cleaning_automation')!;
  assert.equal(e.status, 'n_a');
});
