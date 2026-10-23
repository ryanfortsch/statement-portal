import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionKeys, initialSkipped, skipPlan } from '../owner-action-skip.ts';

const roof = [{ key: '749bab8f3be1' }, { key: '2f29acd4f2fb' }];

test('the roof card: skip the guest notice, keep the calendar hold', () => {
  const keys = actionKeys(roof);
  const plan = skipPlan(keys, new Set(['749bab8f3be1']));
  assert.deepEqual(plan, { fileActions: true, skipActions: ['749bab8f3be1'] });
});

test('nothing unticked files everything and sends no list', () => {
  assert.deepEqual(skipPlan(actionKeys(roof), new Set()), { fileActions: true, skipActions: [] });
});

test('everything unticked files nothing, the old single box', () => {
  assert.deepEqual(skipPlan(actionKeys(roof), new Set(actionKeys(roof))), { fileActions: false, skipActions: [] });
});

test('a card with no actions never turns filing off', () => {
  assert.deepEqual(skipPlan([], new Set()), { fileActions: true, skipActions: [] });
});

test('position keys from an older concierge are never sent', () => {
  const keys = actionKeys([{}, { key: 'aaaaaaaaaaaa' }]);
  assert.deepEqual(keys, ['idx-0', 'aaaaaaaaaaaa']);
  assert.deepEqual(skipPlan(keys, new Set(['idx-0'])), { fileActions: true, skipActions: [] });
});

test('a card reopens with the ticks she left', () => {
  const keys = actionKeys(roof);
  assert.deepEqual([...initialSkipped(keys, { enabled: 1, skipped: ['749bab8f3be1', 'gone00000000'] })], ['749bab8f3be1']);
  assert.deepEqual([...initialSkipped(keys, { enabled: 0 })].sort(), [...keys].sort());
  assert.deepEqual([...initialSkipped(keys, undefined)], []);
});
