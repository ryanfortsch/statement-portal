import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRosaCleaningTag, listingTags, ROSA_CLEANING_TAG } from '../guesty-listing-tags.ts';
import {
  LAUNCH_STEPS,
  deriveStepResolved,
  resolveLaunchSteps,
  type LaunchDerivationContext,
} from '../launch-checklist.ts';

/**
 * Onboarding a Cape Ann home in Guesty takes two hand steps for Rosa: tag
 * the listing "Cleaning - Rosa", and add it to the "Cleaning updates - Rosa"
 * message automation. Both are required Launch steps. The tag step ticks
 * itself from the tags /api/sync-guesty stores; the automation has no API
 * and stays a hand tick.
 */

function ctx(tags: string[] | null | undefined, over: Partial<LaunchDerivationContext['property']> = {}): LaunchDerivationContext {
  return {
    property: {
      title: 'Stay at Wingaersheek',
      owner_full: null,
      owner_emails: null,
      owner_phone: null,
      management_fee_pct: null,
      bank_last4: null,
      tax_cert_id: null,
      guesty_listing_id: 'abc',
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
    guestyListingTags: tags,
  };
}

test('both Rosa steps are on the Launch list, required, and the tag comes first', () => {
  const keys = LAUNCH_STEPS.map((s) => s.key);
  const tag = LAUNCH_STEPS.find((s) => s.key === 'guesty_rosa_tag');
  const auto = LAUNCH_STEPS.find((s) => s.key === 'guesty_cleaning_automation');
  assert.ok(tag && auto);
  assert.equal(tag.required, true);
  assert.equal(auto.required, true);
  assert.ok(tag.title.includes(ROSA_CLEANING_TAG));
  assert.ok(auto.description?.includes('Cleaning updates - Rosa'));
  assert.ok(keys.indexOf('guesty_rosa_tag') < keys.indexOf('guesty_cleaning_automation'));
});

test('the tag matches whatever the case, spacing or dash', () => {
  assert.equal(hasRosaCleaningTag(['Cleaning - Rosa']), true);
  assert.equal(hasRosaCleaningTag(['3BR', 'cleaning-rosa', 'Gloucester']), true);
  assert.equal(hasRosaCleaningTag(['Cleaning – Rosa']), true);
  assert.equal(hasRosaCleaningTag(['Cleaning - Luana']), false);
  assert.equal(hasRosaCleaningTag(['Rosa']), false);
  assert.equal(hasRosaCleaningTag([]), false);
  assert.equal(hasRosaCleaningTag(null), false);
});

test('listingTags keeps strings only', () => {
  assert.deepEqual(listingTags([' Cleaning - Rosa ', '', 3, null, '3BR']), ['Cleaning - Rosa', '3BR']);
  assert.deepEqual(listingTags(undefined), []);
  assert.deepEqual(listingTags('Cleaning - Rosa'), []);
});

test('the tag step ticks itself on the tag, and asks when tags are unknown', () => {
  assert.equal(deriveStepResolved('guesty_rosa_tag', ctx(['3BR', 'Cleaning - Rosa'])), true);
  assert.equal(deriveStepResolved('guesty_rosa_tag', ctx(['3BR'])), false);
  assert.equal(deriveStepResolved('guesty_rosa_tag', ctx(null)), false);
  assert.equal(deriveStepResolved('guesty_rosa_tag', ctx(undefined)), false);
  const byKey = new Map(resolveLaunchSteps([], ctx(['Cleaning - Rosa'])).map((e) => [e.step.key, e]));
  assert.equal(byKey.get('guesty_rosa_tag')!.status, 'done');
  assert.equal(byKey.get('guesty_rosa_tag')!.auto, true);
  // The automation never derives: Guesty has no API for it.
  assert.equal(byKey.get('guesty_cleaning_automation')!.status, 'todo');
});

test('an out-of-region home does not ask for the Rosa tag', () => {
  const e = resolveLaunchSteps([], ctx(null, { region: 'lighthouse_point_fl' })).find((x) => x.step.key === 'guesty_rosa_tag')!;
  assert.equal(e.status, 'n_a');
});

test('the Guesty sync stores listing tags, apart from the map upsert', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../app/api/sync-guesty/route.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('listingTags(l.tags)'), 'sync must read tags off the listing objects');
  assert.ok(/\.update\(\{ tags:/.test(src), 'tags go in their own update so a missing column cannot fail the map');
});
