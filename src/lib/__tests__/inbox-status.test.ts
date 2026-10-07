import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inboxStatus } from '../inbox-status.ts';
import type { InboxHealthResponse } from '../stay-concierge.ts';

const now = 10000;
const emptyWork = { owner_items: [], delivery_items: [] };
const health = (changes: Partial<InboxHealthResponse> = {}): InboxHealthResponse => ({ channels: [], unresolved: [], unresolved_count: 0, unmatched_count: 0, ...changes });
const receipt = (status: string, age = 0) => ({ channel: 'email', source_id: status, status, detail: '', updated_at: now - age });

test('routine imports and known coverage limits do not become inbox tasks', () => {
  const result = inboxStatus(health({
    channels: ['partial', 'unverified', 'disabled', 'checking'].map(status => ({ id: status, label: status, status, coverage: '', detail: '', checked_at: now, success_at: null })),
    unresolved: [receipt('processing')], unresolved_count: 1, unmatched_count: 200,
  }), emptyWork, now);
  assert.equal(result.summary, '');
  assert.equal(result.attention, false);
});

test('review, retry, and expired processing are distinguished without counting active processing', () => {
  const result = inboxStatus(health({ unresolved: [receipt('processing'), receipt('retry'), receipt('review'), receipt('processing', 1800)], unresolved_count: 4 }), emptyWork, now);
  assert.equal(result.summary, '1 import to review · 1 import retrying · 1 import delayed');
  assert.equal(result.imports.length, 3);
  assert.equal(result.attention, true);
});

test('a truncated receipt list cannot be treated as a healthy inbox', () => {
  const result = inboxStatus(health({ unresolved: [receipt('processing')], unresolved_count: 51 }), emptyWork, now);
  assert.equal(result.summary, 'More imports pending');
});

test('failed reads and source checks remain visible without claiming missing messages', () => {
  assert.equal(inboxStatus(null, null, now).summary, 'Import status unavailable · Work status unavailable');
  const result = inboxStatus(health({ channels: ['failed', 'stale'].map(status => ({ id: status, label: status === 'failed' ? 'Guest email' : 'Guesty', status, coverage: '', detail: '', checked_at: now, success_at: null })) }), emptyWork, now);
  assert.equal(result.summary, 'Guest email check failed · Guesty check overdue');
  assert.equal(result.attention, true);
});

test('overlapping owner and delivery jobs never produce a combined task count', () => {
  const result = inboxStatus(health(), {
    owner_items: [{ id: 'owner-1', property_id: 'example', owner_name: 'Example', state: 'retrying', error: 'Retrying' }],
    delivery_items: [{ id: 'job-1', property_id: 'example', title: 'Same work', error: 'Retrying', attempts: 1 }],
  }, now);
  assert.equal(result.summary, 'Work sync pending');
  assert.equal(result.attention, true);
});

test('unconfirmed work stays visible but ordinary waiting is not a failure', () => {
  const result = inboxStatus(health(), { owner_items: [], delivery_items: [{ id: 'job-1', property_id: 'example', title: 'Work', error: 'Waiting to file', attempts: 0 }] }, now);
  assert.equal(result.summary, 'Work sync pending');
  assert.equal(result.attention, false);
});
