import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadListingCopyEntries } from '../sca-listing-copy.ts';

const path = 'data/listings.json';
const original = {
  publicName: 'Harbor House', internalName: 'Harbor',
  tagline: 'By the harbor', description: 'Original description',
  highlights: ['Water views', 'Parking', 'Patio'],
};
type Listings = Record<string, Record<string, unknown>>;

function fixture(live: Listings, batch?: Listings, base: Listings = live) {
  const files: Record<string, string | null> = {
    production: JSON.stringify({ listings: live }),
    batch: batch ? JSON.stringify({ listings: batch }) : null,
    ancestor: JSON.stringify({ listings: base }),
  };
  const calls: string[] = [];
  const reader = {
    async getFile(filePath: string, ref: string) {
      assert.equal(filePath, path);
      calls.push(ref);
      return files[ref] === null ? null : { contentUtf8: files[ref] };
    },
    async branchExists(branch: string) { assert.equal(branch, 'batch'); return batch !== undefined; },
    async getMergeBaseSha(liveRef: string, batchRef: string) {
      assert.equal(liveRef, 'production');
      assert.equal(batchRef, 'batch');
      return 'ancestor';
    },
  };
  return { files, reader, calls, load: () => loadListingCopyEntries(reader, path, 'production', 'batch') };
}

test('without a batch, loads live copy with no staged rows and no draft reads', async () => {
  const f = fixture({ harbor: original });
  assert.deepEqual(await f.load(), [{ id: 'harbor', entry: original, staged: false }]);
  assert.deepEqual(f.calls, ['production']);
});

test('reopening restores all saved copy fields and counts changed listings once', async () => {
  const edited = { ...original, tagline: 'New tagline', description: 'New About', highlights: ['New highlight'] };
  const f = fixture({ harbor: original, other: original }, { harbor: edited, other: original });
  const rows = await f.load();
  assert.deepEqual(rows[0], { id: 'harbor', entry: edited, staged: true });
  assert.equal(rows.filter(row => row.staged).length, 1);
  assert.deepEqual(await f.load(), rows, 'a second page load restores the same saved state');
});

test('an existing branch with no editorial edits has no staged rows', async () => {
  const f = fixture({ harbor: original }, { harbor: { ...original, publicName: 'Branch metadata' } });
  assert.deepEqual(await f.load(), [{ id: 'harbor', entry: original, staged: false }]);
});

test('new live fields, metadata and listings survive an older batch', async () => {
  const live = { ...original, publicName: 'Renamed live', description: 'New live About', extra: 'live metadata' };
  const edited = { ...original, tagline: 'Staged tagline' };
  const f = fixture({ harbor: live, newListing: original }, { harbor: edited }, { harbor: original });
  assert.deepEqual(await f.load(), [
    { id: 'harbor', entry: { ...live, tagline: 'Staged tagline' }, staged: true },
    { id: 'newListing', entry: original, staged: false },
  ]);
});

test('a branch predating live edits does not mistake those differences for saved work', async () => {
  const live = { ...original, tagline: 'New live tagline' };
  const f = fixture({ harbor: live }, { harbor: original }, { harbor: original });
  assert.deepEqual(await f.load(), [{ id: 'harbor', entry: live, staged: false }]);
});

test('saved field deletions are restored and remain staged', async () => {
  const edited = { publicName: original.publicName, internalName: original.internalName };
  const f = fixture({ harbor: original }, { harbor: edited });
  assert.deepEqual(await f.load(), [{ id: 'harbor', entry: edited, staged: true }]);
});

test('a leftover branch after publication has no staged rows', async () => {
  const published = { ...original, description: 'Published About' };
  const f = fixture({ harbor: published }, { harbor: published }, { harbor: original });
  assert.deepEqual(await f.load(), [{ id: 'harbor', entry: published, staged: false }]);
});

test('normalizes blanks and whitespace like the editor when detecting pending copy', async () => {
  const f = fixture({ harbor: original }, { harbor: {
    ...original, tagline: ' By the harbor ', highlights: [' Water views ', 'Parking', 'Patio', ''],
  } });
  assert.equal((await f.load())[0].staged, false);
});

test('empty registries are valid and retired listings do not reappear', async () => {
  assert.deepEqual(await fixture({}).load(), []);
  assert.deepEqual(await fixture({}, { harbor: original }, { harbor: original }).load(), []);
});

for (const ref of ['production', 'batch', 'ancestor']) {
  test(`a missing ${ref} registry fails instead of pretending there is no saved work`, async () => {
    const f = fixture({ harbor: original }, { harbor: original });
    f.files[ref] = null;
    await assert.rejects(f.load(), new RegExp(`Could not read .* at ${ref}`));
  });
  test(`an invalid ${ref} registry fails instead of silently discarding edits`, async () => {
    const f = fixture({ harbor: original }, { harbor: original });
    f.files[ref] = JSON.stringify({ listings: [] });
    await assert.rejects(f.load(), new RegExp(`Invalid listing registry at ${ref}`));
    f.files[ref] = '{broken';
    await assert.rejects(f.load(), SyntaxError);
  });
}

test('GitHub read failures propagate so the page can show its existing error notice', async () => {
  const f = fixture({ harbor: original }, { harbor: original });
  f.reader.getMergeBaseSha = async () => { throw new Error('GitHub unavailable'); };
  await assert.rejects(f.load(), /GitHub unavailable/);
  f.reader.branchExists = async () => { throw new Error('Access denied'); };
  await assert.rejects(f.load(), /Access denied/);
});
