import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmedSave } from '../confirmed-save.ts';
import { fieldSubmissionId } from '../field-submission-id.ts';
const token = '138f4efe-fdc5-4d1d-bb11-6ba9cbbf8383';
test('report IDs are stable per actor and attempt, distinct for another actor or attempt', () => {
  const a = fieldSubmissionId('actor-a', token);
  assert.equal(a, fieldSubmissionId('actor-a', token));
  assert.match(a!, /^[a-f0-9-]{36}$/);
  assert.notEqual(a, fieldSubmissionId('actor-b', token));
  assert.notEqual(a, fieldSubmissionId('actor-a', '238f4efe-fdc5-4d1d-bb11-6ba9cbbf8383'));
  assert.equal(fieldSubmissionId('actor-a', 'invalid'), null);
});
test('successful saves and known validation failures do not make an extra request', async () => {
  const confirm = async () => { throw Error('must not run'); };
  assert.deepEqual(await confirmedSave(async () => ({ ok: true }), confirm), { ok: true });
  assert.deepEqual(await confirmedSave(async () => ({ ok: false, error: 'Required' }), confirm), { ok: false, error: 'Required' });
});
test('lost response checks the server, never retries the write', async () => {
  let writes = 0, reads = 0;
  assert.deepEqual(await confirmedSave(async () => { writes++; throw Error('lost'); }, async () => { reads++; return { ok: true }; }), { ok: true });
  assert.equal(writes, 1); assert.equal(reads, 1);
});
test('hung writes and checks release the UI with uncertainty, not false success', async () => {
  const never = () => new Promise<{ ok: boolean }>(() => {});
  const result = await confirmedSave(never, never, { timeoutMs: 5 });
  assert.equal(result.ok, false); assert.equal('uncertain' in result && result.uncertain, true);
});
test('a timeout can confirm a write that landed; returned task errors can be checked too', async () => {
  assert.deepEqual(await confirmedSave(() => new Promise<{ ok: boolean }>(() => {}), async () => ({ ok: true }), { timeoutMs: 5 }), { ok: true });
  assert.deepEqual(await confirmedSave(async () => ({ ok: false }), async () => ({ ok: true }), { checkReturnedFailure: true }), { ok: true });
});
