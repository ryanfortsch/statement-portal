/**
 * Owner stays reach the cleaner schedule from the calendar mirror, not from
 * bookings. The fixtures are the two live holds that fell through on
 * 2026-10-08 (21 Horton, 225 Washington), as the mirror actually stored
 * them: type 'm', reason 'Owner block', note 'Owner use'.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  holdDeclinesCleaning,
  isOwnerNight,
  ownerHoldCheckouts,
  type HeldNight,
} from '../owner-hold-checkouts.ts';

function night(
  property_id: string,
  date: string,
  extra: Partial<HeldNight> = {},
): HeldNight {
  return { property_id, date, block_type: 'm', block_reason: 'Owner block', block_note: 'Owner use', ...extra };
}

describe('isOwnerNight', () => {
  test('the office-made owner block (type m, reason Owner block) is an owner night', () => {
    assert.equal(isOwnerNight(night('21_horton', '2026-10-03')), true);
  });
  test('the owner-portal block (type o, no reason) is an owner night', () => {
    assert.equal(isOwnerNight({ block_type: 'o', block_reason: null, block_note: null }), true);
  });
  test('"Owner use" in the note alone is enough, whatever the reason', () => {
    assert.equal(isOwnerNight({ block_type: 'm', block_reason: 'Maintenance', block_note: 'Owner use- Alarm Install' }), true);
    assert.equal(isOwnerNight({ block_type: 'm', block_reason: null, block_note: 'Owner Block' }), true);
  });
  test('a channel block, a maintenance hold, an onboarding hold are not', () => {
    assert.equal(isOwnerNight({ block_type: 'm', block_reason: 'Channel block', block_note: null }), false);
    assert.equal(isOwnerNight({ block_type: 'm', block_reason: 'Maintenance', block_note: 'new roof' }), false);
    assert.equal(isOwnerNight({ block_type: 'm', block_reason: 'Onboarding', block_note: 'Onboarding' }), false);
  });
  test('a rule artifact is never a hold, however it is labelled', () => {
    assert.equal(isOwnerNight({ block_type: null, block_reason: 'Owner block', block_note: 'Owner use' }), false);
    assert.equal(isOwnerNight({ block_type: 'an', block_reason: 'Owner block', block_note: null }), false);
  });
  test('"ownership" or "homeowner" in a note does not match the word', () => {
    assert.equal(isOwnerNight({ block_type: 'm', block_reason: null, block_note: 'homeowners insurance visit' }), false);
  });
});

describe('holdDeclinesCleaning', () => {
  test('reads the note the operator wrote on the block', () => {
    assert.equal(holdDeclinesCleaning({ block_note: 'Owner use- no cleaning' }), true);
    assert.equal(holdDeclinesCleaning({ block_note: 'Owner use, no-clean' }), true);
    assert.equal(holdDeclinesCleaning({ block_note: 'uso do dono, sem limpeza' }), true);
    assert.equal(holdDeclinesCleaning({ block_note: 'Owner use' }), false);
    assert.equal(holdDeclinesCleaning({ block_note: null }), false);
  });
});

describe('ownerHoldCheckouts', () => {
  const horizon = '2026-10-15';

  test('21 Horton: held Oct 3-4, checkout Oct 5', () => {
    const rows = ownerHoldCheckouts(
      [
        night('21_horton', '2026-10-03', { block_start: '2026-10-03' }),
        night('21_horton', '2026-10-04', { block_start: '2026-10-03' }),
      ],
      horizon,
    );
    assert.deepEqual(rows, [
      { propertyId: '21_horton', checkIn: '2026-10-03', checkOut: '2026-10-05', blockType: 'm', reason: 'Owner block', note: 'Owner use' },
    ]);
  });

  test('225 Washington: held Oct 5-8, checkout Oct 9', () => {
    const rows = ownerHoldCheckouts(
      ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map((d) => night('225_washington', d, { block_start: '2026-10-05' })),
      horizon,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].checkOut, '2026-10-09');
    assert.equal(rows[0].checkIn, '2026-10-05');
  });

  test('a run still held at the horizon has not ended: nothing is listed', () => {
    const rows = ownerHoldCheckouts(
      ['2026-10-13', '2026-10-14', '2026-10-15'].map((d) => night('21_horton', d)),
      horizon,
    );
    assert.deepEqual(rows, []);
  });

  test('a run ending the night before the horizon checks out ON the horizon', () => {
    const rows = ownerHoldCheckouts(['2026-10-13', '2026-10-14'].map((d) => night('21_horton', d)), horizon);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].checkOut, '2026-10-15');
  });

  test('an owner stay followed straight by a maintenance hold is one occupancy, cleaned once after both', () => {
    const rows = ownerHoldCheckouts(
      [
        night('3_south_st', '2026-10-03'),
        night('3_south_st', '2026-10-04'),
        night('3_south_st', '2026-10-05', { block_reason: 'Maintenance', block_note: 'new roof' }),
        night('3_south_st', '2026-10-06', { block_reason: 'Maintenance', block_note: 'new roof' }),
      ],
      horizon,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].checkOut, '2026-10-07');
    assert.equal(rows[0].note, 'Owner use');
  });

  test('two separate owner stays with a gap are two checkouts', () => {
    const rows = ownerHoldCheckouts(
      [night('21_horton', '2026-10-03'), night('21_horton', '2026-10-04'), night('21_horton', '2026-10-09')],
      horizon,
    );
    assert.deepEqual(rows.map((r) => r.checkOut), ['2026-10-05', '2026-10-10']);
  });

  test('a maintenance-only hold, a channel block, an artifact: nothing', () => {
    const rows = ownerHoldCheckouts(
      [
        night('21_horton', '2026-10-03', { block_reason: 'Maintenance', block_note: 'Chimney Work' }),
        night('3_south_st', '2026-10-03', { block_reason: 'Channel block', block_note: null }),
        night('20_enon', '2026-10-03', { block_type: null, block_reason: null, block_note: null }),
        night('20_enon', '2026-10-04', { block_type: 'an', block_reason: null, block_note: null }),
      ],
      horizon,
    );
    assert.deepEqual(rows, []);
  });

  test('"no cleaning" on the block keeps the whole stay off the list', () => {
    const rows = ownerHoldCheckouts(
      [
        night('21_horton', '2026-10-03', { block_note: 'Owner use- no cleaning' }),
        night('21_horton', '2026-10-04', { block_note: 'Owner use- no cleaning' }),
      ],
      horizon,
    );
    assert.deepEqual(rows, []);
  });

  test('a rule artifact between two held nights splits the run (no hold there)', () => {
    const rows = ownerHoldCheckouts(
      [
        night('21_horton', '2026-10-03'),
        night('21_horton', '2026-10-04', { block_type: null, block_reason: null, block_note: null }),
        night('21_horton', '2026-10-05'),
      ],
      horizon,
    );
    assert.deepEqual(rows.map((r) => r.checkOut), ['2026-10-04', '2026-10-06']);
  });

  test('check-in comes from the ref start when the window clipped the run', () => {
    // The caller fetched from 2026-10-04; the hold began 2026-09-20.
    const rows = ownerHoldCheckouts(
      [night('21_horton', '2026-10-04', { block_start: '2026-09-20' }), night('21_horton', '2026-10-05', { block_start: '2026-09-20' })],
      horizon,
    );
    assert.equal(rows[0].checkIn, '2026-09-20');
  });

  test('duplicate night rows and unsorted input are tolerated', () => {
    const rows = ownerHoldCheckouts(
      [night('21_horton', '2026-10-04'), night('21_horton', '2026-10-03'), night('21_horton', '2026-10-04')],
      horizon,
    );
    assert.deepEqual(rows.map((r) => [r.checkIn, r.checkOut]), [['2026-10-03', '2026-10-05']]);
  });
});
