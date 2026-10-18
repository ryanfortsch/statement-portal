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

test('Bedroom photos redirects to the home launcher, the one place its photos are published', () => {
  const page = read('src/app/properties/bedroom-photos/page.tsx');
  assert.ok(page.includes("redirect(id ? `/properties/${id}/stay-cape-ann#sleeping` : '/properties/stay-cape-ann');"));
  assert.ok(!exists('src/app/properties/bedroom-photos/BedroomPhotosClient.tsx'));
  assert.ok(!exists('src/app/properties/bedroom-photos/actions.ts'));
  for (const file of ['src/app/properties/[id]/page.tsx', 'src/app/properties/page.tsx', 'src/lib/helm-modules.ts']) {
    assert.ok(!read(file).includes("'/properties/bedroom-photos") && !read(file).includes('"/properties/bedroom-photos'), `${file} still links Bedroom photos`);
    assert.ok(!read(file).includes('/properties/bedroom-photos?'), `${file} still links Bedroom photos`);
  }
  // The launcher's rooms carry the uploader, keyed by a stable identity.
  const client = read('src/app/properties/[id]/stay-cape-ann/ScaLaunchClient.tsx');
  assert.ok(client.includes('id="sleeping"') && client.includes('keys={roomKeys}'));
  assert.ok(client.includes('onFailedUploadsChange={(count) => { if (roomKeys[i]) setRoomFlag(setFailedSlots, roomKeys[i], count > 0); }}'));
});

test('a launcher PR writes over the live entry, never in place of it', () => {
  const actions = read('src/app/properties/[id]/stay-cape-ann/actions.ts');
  assert.match(actions, /function entryOverLive[\s\S]*?mergeRegistryEntry\(live, built\)/);
  for (const name of ['openScaPr', 'openScaUpdatePr']) {
    const body = actions.match(new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport async function )`))![0];
    assert.ok(body.includes('const entry = entryOverLive(file.contentUtf8, form);'), `${name} must merge over the live entry`);
    assert.ok(!body.includes('buildRegistryEntry(form)'), `${name} must not write the bare form entry`);
  }
  // A live listing opens on what guests see.
  const page = read('src/app/properties/[id]/stay-cape-ann/page.tsx');
  assert.ok(page.includes('liveDraft={liveDraft}') && page.includes('adoptable={adoptable}'));
});

test('the Listing Copy Studio is retired: one publish path per listing, reviewed from the launcher index', () => {
  assert.ok(read('src/app/properties/listing-copy-studio/page.tsx').includes("redirect('/properties/stay-cape-ann?filter=review');"));
  assert.ok(!exists('src/app/properties/listing-copy-studio/ListingCopyStudio.tsx'));
  const actions = read('src/app/properties/[id]/stay-cape-ann/actions.ts');
  for (const gone of ['stageListingCopyEdit', 'publishListingCopyBatch', 'listScaListingCopy', 'draftListingCopyFromGuesty', 'sca-listing-copy']) {
    assert.ok(!actions.includes(gone), `${gone} is the studio's second publish path`);
  }
  // The index is read-only: it links each home's launcher and writes nothing.
  const index = read('src/app/properties/stay-cape-ann/page.tsx');
  assert.ok(index.includes('href={`/properties/${r.propertyId}/stay-cape-ann`}'));
  assert.ok(index.includes('/properties/stay-cape-ann?filter=review'));
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(index), 'the index never writes');
  assert.ok(!index.includes("from '../[id]/stay-cape-ann/actions'"), 'the index calls no launcher action');
  assert.ok(read('src/app/properties/page.tsx').includes('href="/properties/stay-cape-ann"'));
  assert.ok(read('src/lib/helm-modules.ts').includes("href: '/properties/stay-cape-ann',"));
  // One verb on a live listing.
  const client = read('src/app/properties/[id]/stay-cape-ann/ScaLaunchClient.tsx');
  assert.ok(client.includes("{busy === 'publish' ? 'Publishing…' : 'Publish'}"));
  assert.ok(!client.includes("'Publish update'") && !client.includes('Stage edit'));
});
