/**
 * Listing and launch tools: one place per job (UI/UX audit 2026-10-17,
 * appendix 05, "Pages to merge, demote or delete").
 *
 * Draft listing saved nothing: the operator drafted on its own page, copied,
 * and pasted into the form that saves. Its generator is now Draft with AI in
 * the two forms that save the copy, and the old route only redirects.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const exists = (repoPath: string): boolean => existsSync(new URL(`../../../${repoPath}`, import.meta.url));

test('Draft listing redirects to the launcher and keeps no form of its own', () => {
  const page = read('src/app/properties/[id]/listing-copy/page.tsx');
  assert.match(page, /redirect\(`\/properties\/\$\{encodeURIComponent\(id\)\}\/stay-cape-ann`\)/);
  assert.ok(!exists('src/app/properties/[id]/listing-copy/ListingCopyClient.tsx'));
  assert.ok(!exists('src/app/properties/[id]/listing-copy/actions.ts'));
  // Nothing links to it any more.
  for (const file of ['src/app/properties/[id]/page.tsx', 'src/app/properties/[id]/launch/LaunchStepCard.tsx']) {
    assert.ok(!read(file).includes('/listing-copy`'), `${file} still links the retired Draft listing page`);
  }
});

test('Draft with AI sits beside Pull from Guesty and in the Listing form, on one generator', () => {
  const client = read('src/app/properties/[id]/stay-cape-ann/ScaLaunchClient.tsx');
  const pull = client.indexOf("'Pull from Guesty'}");
  const draft = client.indexOf("'Draft with AI'}");
  assert.ok(pull > 0 && draft > pull && draft - pull < 400, 'Draft with AI is the button after Pull from Guesty');

  const sca = read('src/app/properties/[id]/stay-cape-ann/actions.ts');
  assert.match(sca, /export async function draftScaCopyWithAi[\s\S]*?draftListingCopy\(propertyId, 'sca', brief\)/);
  const listing = read('src/app/properties/[id]/listing-actions.ts');
  assert.match(listing, /export async function draftListingWithAiAction[\s\S]*?draftListingCopy\(propertyId, 'airbnb', brief\)/);
  const panel = read('src/app/properties/[id]/ListingPanel.tsx');
  assert.ok(panel.includes('draftListingWithAiAction(propertyId, aiBrief)'));
  // The draft only fills the form; Save listing is still the one write.
  assert.ok(!/upsertListingContent/.test(listing.match(/export async function draftListingWithAiAction[\s\S]*?\n\}/)![0]));

  // The launch step opens the Listing section, where the draft lands.
  assert.ok(read('src/app/properties/[id]/launch/LaunchStepCard.tsx').includes("href: `/properties/${propertyId}?tab=guest#listing`, label: 'Open Listing'"));
});
