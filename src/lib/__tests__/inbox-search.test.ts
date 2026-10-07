import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvalSearchRow, approvalSearchStatus, mergeInboxSearch, searchInbox, matchesInboxText, loadInboxSearch, reviewCountsByConversation } from '../inbox-search.ts';

test('saved status distinguishes drafts, scheduled sends and actual decisions', () => {
  assert.equal(approvalSearchStatus({ id: '1', status: 'pending', draft: 'Reply' }, true).status, 'Draft ready');
  assert.equal(approvalSearchStatus({ id: '1', status: 'pending', draft: '  ' }, true).status, 'Needs review');
  assert.equal(approvalSearchStatus({ id: '1', status: 'scheduled' }, true).filter, 'scheduled');
  assert.equal(approvalSearchStatus({ id: '1', status: 'sending' }, true).status, 'Sending');
  assert.equal(approvalSearchStatus({ id: '1', status: 'approved' }, false).status, 'Sent');
  assert.equal(approvalSearchStatus({ id: '1', status: 'courtesy_ack' }, false).status, 'No reply needed');
  assert.equal(approvalSearchStatus({ id: '1', status: 'future_state' }, false).filter, 'all');
  assert.equal(approvalSearchStatus({ id: '1', status: 'expired' }, false).status, 'Expired draft');
  assert.notEqual(approvalSearchStatus({ id: '1', status: 'expired' }, false).filter, 'handled');
});

test('search spans names, properties, inbound text, replies and translations', () => {
  const row = approvalSearchRow('cleaners', { id: 'c', status: 'pending', cleaner_name: 'José', property_name: 'Harbor Cottage', cleaner_text: 'Tudo pronto', cleaner_text_english: 'Kitchen ready', draft: 'Obrigado' }, true);
  assert.equal(searchInbox([row], 'jose kitchen', 'all', 'review').length, 1);
  assert.equal(searchInbox([row], 'harbor obrigado', 'cleaners', 'all').length, 1);
  assert.equal(searchInbox([row], 'harbor', 'owners', 'all').length, 0);
  assert.equal(searchInbox([row], 'harbor', 'all', 'handled').length, 0);
  assert.equal(matchesInboxText('thermostat Alex', ['Alex', 'Check the thermostat']), true);
});

test('active snapshot wins without merging unrelated people across inboxes', () => {
  const saved = approvalSearchRow('owners', { id: 'same', status: 'approved', owner_name: 'Jamie', created_at: '2026-10-01' }, false);
  const active = approvalSearchRow('owners', { id: 'same', status: 'pending', owner_name: 'Jamie', draft: 'Ready', created_at: '2026-09-30' }, true);
  const other = approvalSearchRow('guests', { id: 'same', status: 'pending', guest_first: 'Alex' }, true);
  for (const list of [[saved, active, other], [active, saved, other]]) {
    const rows = mergeInboxSearch(list);
    assert.equal(rows.length, 2);
    assert.equal(rows.find(r => r.audience === 'owners')?.status, 'Draft ready');
  }
});

test('resolved search results do not link to cards absent from the queue or leak contact fields', () => {
  const source = { id: 'a/#b', status: 'approved', owner_name: 'Jamie', owner_contact: 'private@example.test', owner_text: 'Question', final_response: 'Final text', draft: 'Old text' };
  const resolved = approvalSearchRow('owners', source, false);
  assert.equal(resolved.href, '/owner-messaging');
  assert.equal(resolved.reply, 'Final text');
  assert.equal(JSON.stringify(resolved).includes('private@example.test'), false);
  assert.equal(approvalSearchRow('owners', source, true).href, '/owner-messaging#approval-a%2F%23b');
});

test('partial failures keep good sources and identify failed feeds instead of pretending they are empty', async () => {
  const result = await loadInboxSearch(async (audience, recent) => {
    if (audience === 'owners') throw new Error('synthetic failure');
    if (audience === 'cleaners' && recent) return { ok: false };
    return { ok: true, data: { approvals: recent ? [] : [{ id: audience, status: 'pending', draft: 'Reply' }] } };
  });
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.unavailable, ['owners current drafts', 'owners recent activity', 'cleaners recent activity']);
});

test('bounded history and total failure remain explicit', async () => {
  const failed = await loadInboxSearch(async () => ({ ok: false }));
  assert.equal(failed.unavailable.length, 8);
  const capped = await loadInboxSearch(async (audience, recent) => ({ ok: true, data: { approvals: audience === 'owners' && recent ? Array.from({ length: 50 }, (_, i) => ({ id: String(i), status: 'approved' })) : [] } }));
  assert.deepEqual(capped.limited, ['owners']);
  assert.equal(capped.rows.length, 50);
});

test('conversation review counts exclude scheduled sends and require a conversation match', () => {
  const counts = reviewCountsByConversation([
    { id: '1', status: 'pending', conversation_id: 'a' },
    { id: '2', status: 'pending', conversation_id: 'a', draft: 'Ready' },
    { id: '3', status: 'scheduled', conversation_id: 'b' },
    { id: '4', status: 'sending', conversation_id: 'a' },
    { id: '5', status: 'pending' },
  ]);
  assert.deepEqual([...counts], [['a', 2]]);
});
