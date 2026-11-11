import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('a new property note is written inline; /notes/new lands on that form', () => {
  const page = readFileSync('src/app/properties/[id]/page.tsx', 'utf8');
  assert.ok(!page.includes('/notes/new'), 'the property page links the old page again');
  for (const kind of ['fact', 'issue']) {
    assert.ok(page.includes(`href="#new-${kind}"`), `the ${kind} verb opens the inline form`);
    assert.ok(page.includes(`<InlineNoteDisclosure id="new-${kind}"`), `the ${kind} form is on the page`);
  }
  assert.equal(page.split('createPropertyNote.bind(null, p.id)').length - 1, 2, 'both forms reuse the one note action');
  const route = readFileSync('src/app/properties/[id]/notes/new/page.tsx', 'utf8');
  assert.ok(route.includes('#new-${kind}`);'), 'old links redirect to the inline form, preset');
});
