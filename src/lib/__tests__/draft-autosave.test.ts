import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createDraftAutosave, type DraftSaveResult, type DraftSaveState } from '../draft-autosave.ts';

function fixture() {
  let answer = 'first';
  const states: DraftSaveState[] = [];
  const requests: Array<{ answer: string; resolve: (result: DraftSaveResult) => void; reject: (error: Error) => void }> = [];
  const queue = createDraftAutosave({
    capture: () => answer,
    save: (snapshot) => new Promise<DraftSaveResult>((resolve, reject) => requests.push({ answer: snapshot, resolve, reject })),
    onState: state => states.push(state),
  });
  return { queue, requests, states, edit(value: string) { answer = value; queue.changed(); } };
}
const saved = { ok: true, savedAt: '2026-09-28T14:00:00Z' } as const;

test('edits immediately stop looking saved and debounce the latest snapshot', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.edit('first');
  assert.equal(f.states.at(-1)?.status, 'pending');
  t.mock.timers.tick(1000); f.edit('latest');
  t.mock.timers.tick(1499); assert.equal(f.requests.length, 0);
  t.mock.timers.tick(1); assert.equal(f.requests[0].answer, 'latest');
  f.requests[0].resolve(saved); await nextTurn();
  assert.deepEqual(f.states.at(-1), { status: 'saved', savedAt: saved.savedAt });
  f.queue.dispose();
});

test('an older success cannot mark newer answers saved or suppress the tab-hide flush', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.edit('first'); t.mock.timers.tick(1500);
  f.edit('newer');
  f.requests[0].resolve(saved); await nextTurn();
  assert.equal(f.states.at(-1)?.status, 'pending');
  assert.equal(f.states.some(state => state.status === 'saved'), false);
  const flush = f.queue.flush();
  assert.equal(f.requests[1].answer, 'newer');
  f.requests[1].resolve(saved); await flush;
  assert.equal(f.states.at(-1)?.status, 'saved');
  f.queue.dispose();
});

test('slow saves serialize and coalesce queued edits into the latest answers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.edit('first'); t.mock.timers.tick(1500);
  f.edit('second'); t.mock.timers.tick(1500);
  f.edit('third');
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve(saved); await nextTurn();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].answer, 'third');
  assert.equal(f.states.some(state => state.status === 'saved'), false);
  f.requests[1].resolve(saved); await nextTurn();
  t.mock.timers.tick(1500);
  assert.equal(f.requests.length, 2);
  assert.equal(f.states.at(-1)?.status, 'saved');
  f.queue.dispose();
});

test('hiding the tab during a slow save queues the latest snapshot without another timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.edit('first'); t.mock.timers.tick(1500);
  f.edit('newer'); void f.queue.flush();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve(saved); await nextTurn();
  assert.equal(f.requests[1].answer, 'newer');
  f.requests[1].resolve(saved); await nextTurn();
  f.queue.dispose();
});

test('repeated flushes of an unchanged in-flight snapshot do not duplicate successful writes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.edit('first');
  const done = f.queue.flush(); void f.queue.flush(); void f.queue.flush();
  f.requests[0].resolve(saved); await done; await nextTurn();
  await f.queue.flush(); t.mock.timers.tick(2000);
  assert.equal(f.requests.length, 1);
  f.queue.dispose();
});

for (const failure of ['response', 'exception'] as const) {
  test(`${failure} failure keeps the draft unsaved and allows a later retry`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(); f.edit('latest'); void f.queue.flush();
    if (failure === 'response') f.requests[0].resolve({ ok: false, reason: 'Synthetic failure' });
    else f.requests[0].reject(new Error('Synthetic failure'));
    await nextTurn();
    assert.equal(f.states.at(-1)?.status, 'error');
    t.mock.timers.tick(10000); assert.equal(f.requests.length, 1);
    const done = f.queue.flush(); assert.equal(f.requests[1].answer, 'latest');
    f.requests[1].resolve(saved); await done;
    assert.equal(f.states.at(-1)?.status, 'saved');
    f.queue.dispose();
  });
}

test('an older failure does not discard the next queued save', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.edit('first'); void f.queue.flush();
  f.edit('newer'); void f.queue.flush();
  f.requests[0].reject(new Error('Synthetic failure')); await nextTurn();
  assert.equal(f.requests[1].answer, 'newer');
  f.requests[1].resolve(saved); await nextTurn();
  assert.equal(f.states.at(-1)?.status, 'saved');
  f.queue.dispose();
});

test('final submission cancels a pending debounce', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.edit('latest');
  assert.equal(f.queue.pause(), null);
  t.mock.timers.tick(2000);
  assert.equal(f.requests.length, 0);
  f.queue.dispose();
});

test('final submission can await an older write without launching another draft', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.edit('first'); void f.queue.flush();
  f.edit('newer'); void f.queue.flush();
  const older = f.queue.pause(); assert.ok(older);
  f.requests[0].resolve(saved); await older; await nextTurn();
  t.mock.timers.tick(2000);
  assert.equal(f.requests.length, 1);
  assert.equal(f.states.some(state => state.status === 'saved'), false);
  f.queue.dispose();
});

test('a validation-blocked submission can resume autosaving the latest edits', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.edit('first'); void f.queue.flush();
  const older = f.queue.pause(); f.edit('newer');
  f.requests[0].resolve(saved); await older;
  f.queue.resume(); t.mock.timers.tick(1500);
  assert.equal(f.requests[1].answer, 'newer');
  f.requests[1].resolve(saved); await nextTurn();
  assert.equal(f.states.at(-1)?.status, 'saved');
  f.queue.dispose();
});

test('unmount clears timers and ignores late responses or queued work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.edit('first'); void f.queue.flush();
  f.edit('newer'); void f.queue.flush();
  const count = f.states.length;
  f.queue.dispose(); f.requests[0].resolve(saved); await nextTurn();
  t.mock.timers.tick(2000); f.edit('ignored'); await f.queue.flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.states.length, count);
});
