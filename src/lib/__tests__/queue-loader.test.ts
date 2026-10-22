/**
 * The messaging queue's feed read (src/lib/queue-loader.ts): bounded, ordered,
 * and loud about failure. A hung read times out, an older response can never
 * replace newer cards, a failure keeps the last good cards and says so, and
 * nothing that is not a queue (a 503, an HTML error page, a malformed body)
 * can become an empty inbox.
 *
 * The source checks at the bottom hold the wiring: the hook reads through the
 * loader, every queue hands its status to the one control, and the feed route
 * no longer answers "not connected" with an empty queue.
 *
 * Run: npm test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { combineQueueStatus, createQueueLoader, readQueue, type QueueLoadStatus } from '../queue-loader.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = (repoPath: string): string => readFileSync(join(repo, repoPath), 'utf8');

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness<T>(read: (signal: AbortSignal) => Promise<T>, timeoutMs?: number) {
  const accepted: T[] = [];
  const states: QueueLoadStatus[] = [];
  const loader = createQueueLoader<T>({ read, accept: (d) => accepted.push(d), status: (s) => states.push(s), timeoutMs });
  return { loader, accepted, states };
}

describe('the queue loader', () => {
  test('a poll joins the read in flight instead of starting a second one', async () => {
    const reply = deferred<number>();
    let calls = 0;
    const { loader, accepted, states } = harness(() => {
      calls++;
      return reply.promise;
    });
    const first = loader.load();
    assert.equal(loader.load(), first, 'the second poll shares the first read');
    reply.resolve(1);
    await first;
    assert.equal(calls, 1);
    assert.deepEqual(accepted, [1]);
    assert.deepEqual(states, ['ready'], 'a background poll reports nothing until it settles');
  });

  test('a refresh someone asked for supersedes the read in flight; the older reply never lands', async () => {
    const replies = [deferred<string>(), deferred<string>()];
    const signals: AbortSignal[] = [];
    const { loader, accepted, states } = harness((signal) => {
      signals.push(signal);
      return replies[signals.length - 1].promise;
    });
    const poll = loader.load('poll');
    const now = loader.load('now');
    assert.equal(signals[0].aborted, true, 'the superseded fetch is cancelled, not just ignored');
    replies[1].resolve('after the approve');
    await now;
    replies[0].resolve('before the approve');
    await poll;
    assert.deepEqual(accepted, ['after the approve']);
    assert.deepEqual(states, ['refreshing', 'ready']);
  });

  test('two refreshes in a row: only the newest one replaces the cards', async () => {
    const replies = [deferred<string>(), deferred<string>()];
    let calls = 0;
    const { loader, accepted } = harness(() => replies[calls++].promise);
    const older = loader.load('now');
    const newer = loader.load('now');
    replies[0].resolve('older');
    replies[1].resolve('newer');
    await Promise.all([older, newer]);
    assert.deepEqual(accepted, ['newer']);
  });

  test('a hung read gives up at the deadline, keeps what is on screen, and a retry recovers', async () => {
    let calls = 0;
    // The first read ignores its signal entirely: the loader still bounds it.
    const { loader, accepted, states } = harness(
      () => (++calls === 1 ? new Promise<number>(() => {}) : Promise.resolve(7)),
      5,
    );
    await loader.load('now');
    assert.deepEqual(accepted, [], 'a timeout never replaces the cards');
    assert.deepEqual(states, ['refreshing', 'failed']);
    await loader.load('now');
    assert.deepEqual(accepted, [7]);
    assert.equal(states.at(-1), 'ready');
  });

  test('the deadline aborts the fetch itself', async () => {
    let seen: AbortSignal | undefined;
    const { loader, states } = harness((signal) => {
      seen = signal;
      return new Promise<number>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }, 5);
    await loader.load();
    assert.equal(seen?.aborted, true);
    assert.deepEqual(states, ['failed']);
  });

  test('a failed read after a good one reports failed and leaves the good cards alone', async () => {
    let calls = 0;
    const { loader, accepted, states } = harness(() => (++calls === 1 ? Promise.resolve('good') : Promise.reject(new Error('502'))));
    await loader.load();
    await loader.load();
    assert.deepEqual(accepted, ['good']);
    assert.deepEqual(states, ['ready', 'failed']);
  });

  test('a read that throws before it returns a promise still reports failed', async () => {
    const { loader, states } = harness<number>(() => {
      throw new Error('no fetch');
    });
    await loader.load();
    assert.deepEqual(states, ['failed']);
  });

  test('cancel (offline, unmount) silences a late reply and a late failure', async () => {
    const ok = deferred<number>();
    const { loader, accepted, states } = harness(() => ok.promise);
    const pending = loader.load('now');
    loader.cancel();
    ok.resolve(1);
    await pending;
    assert.deepEqual(accepted, []);
    assert.deepEqual(states, ['refreshing']);

    const bad = deferred<number>();
    const second = harness(() => bad.promise);
    const p2 = second.loader.load();
    second.loader.cancel();
    bad.reject(new Error('late'));
    await p2;
    assert.deepEqual(second.states, []);
  });

  test('after a cancel the next poll starts a fresh read', async () => {
    const replies = [deferred<number>(), deferred<number>()];
    let calls = 0;
    const { loader, accepted } = harness(() => replies[calls++].promise);
    void loader.load();
    loader.cancel();
    const fresh = loader.load();
    replies[1].resolve(2);
    await fresh;
    assert.equal(calls, 2);
    assert.deepEqual(accepted, [2]);
  });
});

describe('one Refresh over two feeds (the Team inbox)', () => {
  test('offline wins, then a refresh still running, then a failure', () => {
    assert.equal(combineQueueStatus('ready', 'ready'), 'ready');
    assert.equal(combineQueueStatus('ready', 'failed'), 'failed');
    assert.equal(combineQueueStatus('failed', 'refreshing'), 'refreshing', 'Retry stays pending until both feeds settle');
    assert.equal(combineQueueStatus('refreshing', 'offline'), 'offline');
    assert.equal(combineQueueStatus(), 'ready');
  });
});

describe('readQueue: only a queue is a queue', () => {
  test('a non-200, an HTML page, a body with no list and a malformed card all throw', async (t) => {
    const replies = [
      new Response('{"error":"The messaging service is not connected to Helm."}', { status: 503 }),
      new Response('{"error":"bad gateway"}', { status: 502 }),
      new Response('<html>Sign in</html>', { status: 200 }),
      new Response('{}', { status: 200 }),
      new Response('{"approvals":null}', { status: 200 }),
      new Response('{"approvals":[null]}', { status: 200 }),
      new Response('{"approvals":[{"id":42}]}', { status: 200 }),
    ];
    const count = replies.length;
    t.mock.method(globalThis, 'fetch', async () => replies.shift()!);
    const signal = new AbortController().signal;
    for (let i = 0; i < count; i++) await assert.rejects(readQueue('/api/messaging/queue?audience=guests', signal));
  });

  test('a real queue, empty or not, comes back as sent, read fresh and cancellable', async (t) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const replies = [
      new Response('{"approvals":[]}'),
      new Response('{"approvals":[{"id":"a1","status":"pending"}],"context":{"a1":{"total":1}}}'),
    ];
    t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return replies.shift()!;
    });
    const signal = new AbortController().signal;
    assert.deepEqual(await readQueue('/q', signal), { approvals: [] });
    assert.deepEqual(await readQueue('/q', signal), { approvals: [{ id: 'a1', status: 'pending' }], context: { a1: { total: 1 } } });
    assert.equal(calls[0].init?.cache, 'no-store');
    assert.equal(calls[0].init?.signal, signal);
  });
});

describe('the wiring', () => {
  test('the hook reads through the loader, never a bare fetch that swallows errors', () => {
    const hook = read('src/lib/use-approval-queue.ts');
    assert.ok(hook.includes('createQueueLoader<'), 'useApprovalQueue builds its reads on createQueueLoader');
    assert.ok(hook.includes('readQueue<T, C>(`/api/messaging/queue?audience=${audience}`, signal)'));
    assert.ok(!/\bfetch\(/.test(hook), 'no second, unbounded read of the feed');
    assert.ok(hook.includes("void load('now');"), 'a refresh someone asked for supersedes the read in flight');
    assert.ok(hook.includes("refreshStatus: online ? loadStatus : 'offline'"));
  });

  test('every queue hands its status to the one Refresh control', () => {
    const queue = read('src/components/messaging/card/ApprovalQueue.tsx');
    assert.ok(queue.includes('<QueueRefreshControl onRefresh={onRefresh} status={refreshStatus} />'));
    for (const file of ['src/app/messaging/MessagingQueue.tsx', 'src/app/owner-messaging/OwnerMessagingQueue.tsx']) {
      assert.ok(read(file).includes('refreshStatus={refreshStatus}'), `${file} drops the feed status`);
    }
    assert.ok(
      read('src/app/messaging/team/TeamInboxQueue.tsx').includes(
        'refreshStatus={combineQueueStatus(cleaners.refreshStatus, contractors.refreshStatus)}',
      ),
      'the Team inbox reports both of its feeds',
    );
  });

  test('the control says nothing extra while healthy and never brings the clock back', () => {
    const control = read('src/components/QueueRefreshControl.tsx');
    // What renders: the control's body with its comments taken out.
    const body = control
      .slice(control.indexOf('export function QueueRefreshControl'))
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\/.*$/gm, '');
    assert.ok(!/Updated|ago\b|seconds|refreshTick/.test(body), 'no "Updated Xs ago" (cut 2026-10-19)');
    assert.ok(control.includes("status === 'offline' ? 'Offline' : failed ? 'Refresh failed' : ''"));
    assert.ok(control.includes("{failed ? 'Retry' : 'Refresh'}"));
    assert.ok(control.includes('onClick={() => onRefresh()}'), 'the click event is not passed on as an argument');
    assert.ok(!control.includes('\u2014'), 'no em dashes');
  });

  test('the feed answers "not connected" as a failure, not as an empty queue', () => {
    const route = read('src/app/api/messaging/queue/route.ts');
    const branch = route.slice(route.indexOf('if (!isStayConciergeConfigured()) {'));
    assert.ok(branch.startsWith('if (!isStayConciergeConfigured()) {\n    return NextResponse.json({ error:'), 'the unconfigured branch returns an error');
    assert.ok(branch.slice(0, 200).includes('{ status: 503 }'));
    assert.ok(!route.includes('NextResponse.json({ approvals: [] })'));
  });
});
