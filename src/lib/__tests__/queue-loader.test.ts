import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueueLoader, readQueue } from '../queue-loader.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

test('polls share a pending read; explicit refresh prevents an older response replacing new data', async () => {
  const reads = [deferred<number>(), deferred<number>()];
  const accepted: number[] = [];
  const states: string[] = [];
  let calls = 0;
  const loader = createQueueLoader({ read: () => reads[calls++].promise, accept: n => accepted.push(n), status: s => states.push(s) });
  const old = loader.load();
  assert.equal(loader.load(), old);
  const newest = loader.load(true);
  reads[1].resolve(2);
  await newest;
  reads[0].resolve(1);
  await old;
  assert.deepEqual(accepted, [2]);
  assert.deepEqual(states, ['refreshing', 'refreshing', 'ready']);
});

test('hung reads time out, keep existing data, and allow a successful retry', async () => {
  const accepted: number[] = [];
  const states: string[] = [];
  let calls = 0;
  const loader = createQueueLoader({ read: () => ++calls === 1 ? new Promise<number>(() => {}) : Promise.resolve(7), accept: n => accepted.push(n), status: s => states.push(s), timeoutMs: 5 });
  await loader.load();
  assert.deepEqual(accepted, []);
  assert.equal(states.at(-1), 'failed');
  await loader.load();
  assert.deepEqual(accepted, [7]);
  assert.equal(states.at(-1), 'ready');
});

test('offline/unmount cancellation suppresses late success and error notifications', async () => {
  const data = deferred<number>();
  const accepted: number[] = [];
  const states: string[] = [];
  const loader = createQueueLoader({ read: () => data.promise, accept: n => accepted.push(n), status: s => states.push(s) });
  const pending = loader.load();
  loader.cancel();
  data.resolve(1);
  await pending;
  assert.deepEqual(accepted, []);
  assert.deepEqual(states, ['refreshing']);
});

test('failed HTTP, invalid JSON, and malformed feeds cannot become a successful empty queue', async (t) => {
  const replies = [new Response('{}', { status: 503 }), new Response('<html>'), new Response('{}'), new Response('{"approvals":[null]}'), new Response('{"approvals":[]}')];
  t.mock.method(globalThis, 'fetch', async () => replies.shift()!);
  const signal = new AbortController().signal;
  for (let i = 0; i < 4; i++) await assert.rejects(readQueue('/synthetic', signal));
  assert.deepEqual(await readQueue('/synthetic', signal), { approvals: [] });
});
