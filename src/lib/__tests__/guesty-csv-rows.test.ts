import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { upsertCsvReservations } from '../guesty-csv-rows.ts';

/**
 * The bug class here is fail-open: the guard that existed in /api/ingest
 * discarded its read error, so a lookup failure read as "no API rows exist"
 * and every twin got minted anyway. These pin the refusal.
 */

type StoredRow = { confirmation_code: string; guesty_reservation_id: string };

/** Minimal stand-in for the supabase client, recording what it was asked. */
function stubClient(opts: {
  stored?: StoredRow[];
  selectError?: string;
  upsertError?: string;
}) {
  const calls = { selects: [] as string[][], upserted: [] as Record<string, unknown>[][] };
  const client = {
    from() {
      return {
        select() {
          return {
            in(_col: string, codes: string[]) {
              calls.selects.push(codes);
              if (opts.selectError) return Promise.resolve({ data: null, error: { message: opts.selectError } });
              const stored = (opts.stored || []).filter((r) => codes.includes(r.confirmation_code));
              return Promise.resolve({ data: stored, error: null });
            },
          };
        },
        upsert(rows: Record<string, unknown>[]) {
          calls.upserted.push(rows);
          return Promise.resolve({ error: opts.upsertError ? { message: opts.upsertError } : null });
        },
      };
    },
  };
  // The helper only uses .from().select().in() and .from().upsert().
  return { client: client as unknown as Parameters<typeof upsertCsvReservations>[0], calls };
}

const csvRow = (code: string) => ({
  guesty_reservation_id: `csv:${code}`,
  confirmation_code: code,
  total_paid: null,
});

const quiet: { error?: typeof console.error; warn?: typeof console.warn } = {};
beforeEach(() => {
  quiet.error = console.error;
  quiet.warn = console.warn;
  console.error = () => {};
  console.warn = () => {};
});
afterEach(() => {
  if (quiet.error) console.error = quiet.error;
  if (quiet.warn) console.warn = quiet.warn;
});

test('a booking the API already supplied does not get a CSV twin', async () => {
  const { client, calls } = stubClient({
    stored: [{ confirmation_code: 'HMABC123', guesty_reservation_id: '6512ff0a9b' }],
  });
  const res = await upsertCsvReservations(client, [csvRow('HMABC123')], '[test]');
  assert.deepEqual(res, { written: 0, suppressed: 1, skipped: false });
  assert.equal(calls.upserted.length, 0, 'nothing was written at all');
});

test('a booking the API has never seen is written', async () => {
  const { client, calls } = stubClient({ stored: [] });
  const res = await upsertCsvReservations(client, [csvRow('HMNEW999')], '[test]');
  assert.deepEqual(res, { written: 1, suppressed: 0, skipped: false });
  assert.equal(calls.upserted[0][0].guesty_reservation_id, 'csv:HMNEW999');
});

test('a row updating its OWN csv twin is not mistaken for an API row', async () => {
  // Same id, so the upsert updates rather than inserts. Suppressing this would
  // freeze CSV rows at whatever they were first written as.
  const { client } = stubClient({
    stored: [{ confirmation_code: 'HMCSV777', guesty_reservation_id: 'csv:HMCSV777' }],
  });
  const res = await upsertCsvReservations(client, [csvRow('HMCSV777')], '[test]');
  assert.equal(res.written, 1);
  assert.equal(res.suppressed, 0);
});

test('a mixed batch writes only the codes the API lacks', async () => {
  const { client, calls } = stubClient({
    stored: [{ confirmation_code: 'HMAPI001', guesty_reservation_id: '6512ff0a9b' }],
  });
  const res = await upsertCsvReservations(
    client,
    [csvRow('HMAPI001'), csvRow('HMNEW002'), csvRow('HMNEW003')],
    '[test]',
  );
  assert.deepEqual(res, { written: 2, suppressed: 1, skipped: false });
  assert.deepEqual(
    calls.upserted[0].map((r) => r.confirmation_code),
    ['HMNEW002', 'HMNEW003'],
  );
});

test('a failed existence read writes NOTHING, rather than minting every twin', async () => {
  const { client, calls } = stubClient({ selectError: 'connection reset' });
  const res = await upsertCsvReservations(client, [csvRow('HMABC123')], '[test]');
  assert.deepEqual(res, { written: 0, suppressed: 0, skipped: true });
  assert.equal(calls.upserted.length, 0, 'absence of an answer is not "no API rows exist"');
});

test('a failed upsert reports skipped rather than claiming a write', async () => {
  const { client } = stubClient({ stored: [], upsertError: 'permission denied' });
  const res = await upsertCsvReservations(client, [csvRow('HMNEW999')], '[test]');
  assert.equal(res.skipped, true);
  assert.equal(res.written, 0);
});

test('codes are looked up in chunks, so a fleet CSV cannot overrun the URL', async () => {
  const rows = Array.from({ length: 250 }, (_, i) => csvRow(`HM${String(i).padStart(5, '0')}`));
  const { client, calls } = stubClient({ stored: [] });
  const res = await upsertCsvReservations(client, rows, '[test]');
  assert.equal(res.written, 250);
  assert.deepEqual(calls.selects.map((c) => c.length), [100, 100, 50]);
});

test('duplicate codes within one CSV are looked up once', async () => {
  const { client, calls } = stubClient({ stored: [] });
  await upsertCsvReservations(client, [csvRow('HMDUP1'), csvRow('HMDUP1')], '[test]');
  assert.deepEqual(calls.selects, [['HMDUP1']]);
});

test('an empty batch touches the database not at all', async () => {
  const { client, calls } = stubClient({ stored: [] });
  const res = await upsertCsvReservations(client, [], '[test]');
  assert.deepEqual(res, { written: 0, suppressed: 0, skipped: false });
  assert.equal(calls.selects.length, 0);
  assert.equal(calls.upserted.length, 0);
});
