import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { saveMissingCleanerCounts } from '../cleaner-count-save.ts';
import type { CleanerCountContext } from '../cleaner-guest-counts.ts';
import { GUESTY_ACCOUNT, GUESTY_CALDERWOOD } from '../channex-bookings/message-identity.ts';

const id = '00000000-0000-4000-8000-000000000001', sourceId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const context = (): CleanerCountContext => ({ authority: 'guesty',
  report: { propertyName: 'Synthetic home', from: '2030-01-01', through: '2031-01-01', stays: [{
    checkIn: '2030-02-10', checkOut: '2030-02-14', arrivalTime: '15:00', checkoutTime: '11:00',
    guests: null, staying: false, adjusted: false, noCleaning: false, needsReview: false,
  }] },
  bookings: [{ id, property_id: '65_calderwood', check_in: '2030-02-10', check_out: '2030-02-14',
    status: 'confirmed', duplicate_of: null, num_guests: null, guest_name: 'Private synthetic name', source: 'ical_import',
    first_seen_at: null, last_seen_at: '2030-01-01T12:00:00+00:00', external_confirmation_code: 'SYNTHETIC-CODE' }],
  mirror: [{ guesty_reservation_id: sourceId, property_id: '65_calderwood', listing_id: GUESTY_CALDERWOOD,
    confirmation_code: 'SYNTHETIC-CODE', check_in: '2030-02-10', check_out: '2030-02-14', status: 'confirmed' }],
});
const source = (guestsCount = 7) => ({ _id: sourceId, accountId: GUESTY_ACCOUNT, listingId: GUESTY_CALDERWOOD,
  confirmationCode: 'SYNTHETIC-CODE', checkInDateLocalized: '2030-02-10', checkOutDateLocalized: '2030-02-14',
  status: 'confirmed', guestsCount });
const now = () => new Date('2030-01-01T12:00:00Z');

test('save rechecks Guesty twice and local context, then commits a minimal guarded batch once', async () => {
  const order: string[] = []; const before = context(); const original = JSON.stringify(before);
  const result = await saveMissingCleanerCounts(before, {
    readReservation: async remoteId => { assert.equal(remoteId, sourceId); order.push('source'); return source(); },
    reloadContext: async () => { order.push('context'); return context(); }, now,
    commit: async (rows, at) => {
      order.push('commit'); assert.equal(at, now().toISOString());
      assert.deepEqual(rows, [{ booking_id: id, guesty_reservation_id: sourceId, confirmation_code: 'SYNTHETIC-CODE',
        check_in: '2030-02-10', check_out: '2030-02-14', source: 'ical_import', status: 'confirmed',
        last_seen_at: '2030-01-01T12:00:00+00:00', num_guests: 7 }]);
      assert.doesNotMatch(JSON.stringify(rows), /Private synthetic|guest_name|payout|phone|token/);
      return rows.length;
    },
  });
  assert.equal(result, 1); assert.deepEqual(order, ['source', 'source', 'context', 'commit']);
  assert.equal(JSON.stringify(before), original);
});

test('known counts and an empty report do not read or write', async () => {
  for (const empty of [true, false]) {
    const before = context();
    if (empty) before.report.stays = [];
    else { before.bookings[0].num_guests = 4; before.report.stays[0].guests = 4; }
    const unexpected = async (): Promise<never> => { throw Error('unexpected IO'); };
    assert.equal(await saveMissingCleanerCounts(before, { readReservation: unexpected, reloadContext: unexpected, commit: unexpected }), 0);
  }
});

test('manual/invalid canonical identity, ambiguous source, and other authority never commit', async () => {
  const changes: Array<(c: CleanerCountContext) => void> = [
    c => { c.authority = 'helm'; }, c => { c.bookings[0].id = 'not-uuid'; },
    c => { c.bookings[0].source = 'manual'; }, c => { c.bookings[0].num_guests = 3; },
    c => { c.bookings[0].last_seen_at = 'not-a-time'; }, c => { c.bookings[0].external_confirmation_code = null; },
    c => { c.report.stays[0].needsReview = true; }, c => { c.bookings.push({ ...c.bookings[0] }); },
  ];
  for (const change of changes) {
    const before = context(); change(before); let commits = 0;
    await assert.rejects(saveMissingCleanerCounts(before, { readReservation: async () => source(),
      reloadContext: async () => before, now, commit: async () => { commits++; return 1; } }));
    assert.equal(commits, 0);
  }
});

test('source mismatch, timeout, count disagreement, or concurrent local edits prevent every write', async () => {
  for (const mode of ['mismatch', 'timeout', 'disagree', 'local-change']) {
    let reads = 0; let commits = 0;
    await assert.rejects(saveMissingCleanerCounts(context(), {
      readReservation: async () => {
        reads++;
        if (mode === 'timeout') throw Error('private provider detail');
        if (mode === 'mismatch') return { ...source(), listingId: sourceId };
        return source(mode === 'disagree' ? reads : 7);
      },
      reloadContext: async () => { const after = context(); if (mode === 'local-change') after.bookings[0].num_guests = 9; return after; },
      commit: async () => { commits++; return 1; }, now,
    }));
    assert.equal(commits, 0);
  }
});

test('failed or incomplete commit results are never reported as success', async () => {
  for (const fail of [true, false]) {
    await assert.rejects(saveMissingCleanerCounts(context(), { readReservation: async () => source(),
      reloadContext: async () => context(), now,
      commit: async () => { if (fail) throw Error('stale database'); return 0; },
    }));
  }
});

test('action authenticates the owner before reads, accepts no client IDs/counts, and exposes no sends', () => {
  const action = readFileSync(new URL('../../app/channels/65_calderwood/cleaner-schedule/actions.ts', import.meta.url), 'utf8');
  assert.ok(action.indexOf('await requireOwnerEmail()') < action.indexOf('await reloadContext()'));
  assert.match(action, /saveGuestCounts\(\)/);
  assert.doesNotMatch(action, /FormData|formData|\.insert\(|\.update\(|sendMessage|sendTransactional|portal_token|console\./);
  assert.match(action, /helm_save_calderwood_guest_counts/);
  assert.match(action, /return \{ status: 'error', saved: 0 \}/);
});
