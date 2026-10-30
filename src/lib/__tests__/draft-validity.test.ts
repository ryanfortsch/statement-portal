import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftValidity } from '../draft-validity.ts';

test('relative drafts follow Eastern midnight, including DST, not elapsed hours', () => {
  const draft = { createdAt: '2026-10-30T23:00:00Z', text: 'Please finish today.' };
  assert.equal(draftValidity(draft, new Date('2026-10-31T03:59:00Z')).blocked, undefined);
  assert.ok(draftValidity(draft, new Date('2026-10-31T04:00:00Z')).blocked);
  assert.match(draftValidity(draft).context!, /2026-10-30/);
  assert.equal(draftValidity({ createdAt: '2026-11-01T12:00:00Z', text: 'Finish tonight' }, new Date('2026-11-02T04:59:00Z')).blocked, undefined);
});
test('tomorrow and Portuguese are dated and stop meaning a new day', () => {
  const now = new Date('2026-10-31T15:00:00Z');
  for (const text of ['Come tomorrow', 'Termine hoje', 'Pode vir amanhã?']) {
    assert.ok(draftValidity({ createdAt: '2026-10-30T15:00:00Z', text }, now).blocked);
  }
  assert.match(draftValidity({ createdAt: '2026-10-30T15:00:00Z', text: 'Come tomorrow' }, now).context!, /2026-10-31/);
});
test('evergreen work survives age; explicit dates and missing timestamps need review', () => {
  const now = new Date('2026-10-30T15:00:00Z');
  assert.equal(draftValidity({ createdAt: '2020-01-01', text: 'Please repair the vacuum.' }, now).blocked, undefined);
  assert.ok(draftValidity({ createdAt: null, text: 'Come today' }, now).blocked);
  assert.ok(draftValidity({ createdAt: '2026-10-01', text: 'Visit 2026-10-29' }, now).blocked);
  assert.equal(draftValidity({ createdAt: '2026-10-01', text: 'Visit 2026-10-31' }, now).blocked, undefined);
});
