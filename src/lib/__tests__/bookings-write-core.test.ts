/**
 * The pure half of the locked booking writer: the confirmation code mint,
 * the booking_events diff, the P0002 detail parser and the redirect
 * contract that hands a refused overlap back to the form.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CROCKFORD_ALPHABET,
  mintHelmConfirmationCode,
  isHelmCode,
  diffForEvent,
  parseOverlapDetail,
  isOverlapErrorCode,
  conflictToSearchParams,
  conflictFromSearchParams,
  describeConflict,
  nightsBetween,
  isYmd,
  pickPatch,
  GUEST_FIELD_KEYS,
  MONEY_FIELD_KEYS,
} from '../bookings-write-core.ts';

describe('mintHelmConfirmationCode', () => {
  test('is HELM- plus six Crockford base32 characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = mintHelmConfirmationCode();
      assert.match(code, /^HELM-[0-9A-Z]{6}$/);
      for (const ch of code.slice(5)) assert.ok(CROCKFORD_ALPHABET.includes(ch), `${ch} not in alphabet`);
      assert.ok(isHelmCode(code));
    }
  });

  test('the alphabet has 32 symbols and omits I, L, O, U', () => {
    assert.equal(CROCKFORD_ALPHABET.length, 32);
    assert.equal(new Set(CROCKFORD_ALPHABET).size, 32);
    for (const bad of ['I', 'L', 'O', 'U']) assert.ok(!CROCKFORD_ALPHABET.includes(bad), `${bad} must be excluded`);
  });

  test('is deterministic under an injected random source', () => {
    const seq = [0, 0.5, 0.999, 1 / 32, 31 / 32, 0.25];
    let i = 0;
    const code = mintHelmConfirmationCode(() => seq[i++ % seq.length]);
    assert.equal(code, 'HELM-0GZ1Z8');
  });

  test('clamps a random source that misbehaves at the edges', () => {
    assert.equal(mintHelmConfirmationCode(() => 1), 'HELM-ZZZZZZ');
    assert.equal(mintHelmConfirmationCode(() => -0.2), 'HELM-000000');
  });

  test('never collides with the OTA and Guesty prefixes', () => {
    const code = mintHelmConfirmationCode();
    for (const p of ['HM', 'HA-', 'BC-', 'GY-']) {
      assert.ok(!code.startsWith(p), `${code} must not look like a ${p} code`);
    }
    assert.ok(code.startsWith('HELM-'));
  });
});

describe('isHelmCode', () => {
  test('accepts only the minted shape', () => {
    assert.ok(isHelmCode('HELM-0GZ1Z8'));
    assert.ok(isHelmCode(' HELM-0GZ1Z8 '));
    assert.ok(!isHelmCode('HELM-0GZ1Z'));
    assert.ok(!isHelmCode('HELM-0GZ1ZI'), 'I is not Crockford');
    assert.ok(!isHelmCode('helm-0gz1z8'), 'lowercase is not a code');
    assert.ok(!isHelmCode('HMABCDEFGH'));
    assert.ok(!isHelmCode(null));
    assert.ok(!isHelmCode(undefined));
  });
});

describe('diffForEvent', () => {
  test('reports only the keys that changed', () => {
    const before = { guest_name: 'Jane', guest_email: 'j@x.com', num_guests: 2, notes: null };
    const after = { guest_name: 'Jane Doe', guest_email: 'j@x.com', num_guests: 2, notes: 'late arrival' };
    const d = diffForEvent(before, after);
    assert.deepEqual(d.changed, ['guest_name', 'notes']);
    assert.deepEqual(d.before, { guest_name: 'Jane', notes: null });
    assert.deepEqual(d.after, { guest_name: 'Jane Doe', notes: 'late arrival' });
  });

  test('a blank form field is not a change against null', () => {
    const d = diffForEvent({ guest_phone: null, notes: undefined }, { guest_phone: '', notes: '' });
    assert.deepEqual(d.changed, []);
  });

  test('a numeric column typed back as the same string is not a change', () => {
    const d = diffForEvent({ num_guests: 4, gross_amount: 1200.5 }, { num_guests: '4', gross_amount: '1200.5' });
    assert.deepEqual(d.changed, []);
  });

  test('narrows to the requested keys', () => {
    const d = diffForEvent(
      { guest_name: 'A', gross_amount: 100 },
      { guest_name: 'B', gross_amount: 200 },
      ['guest_name'],
    );
    assert.deepEqual(d.changed, ['guest_name']);
    assert.ok(!('gross_amount' in d.after));
  });

  test('tolerates null inputs', () => {
    assert.deepEqual(diffForEvent(null, null).changed, []);
    assert.deepEqual(diffForEvent(null, { a: 1 }).changed, ['a']);
  });
});

describe('parseOverlapDetail', () => {
  test('reads the JSON detail the RPC raises', () => {
    const c = parseOverlapDetail(
      '{"booking_id":"7b0f0f4e-1111-4222-8333-444455556666","status":"confirmed","check_in":"2026-10-03","check_out":"2026-10-07"}',
    );
    assert.deepEqual(c, {
      booking_id: '7b0f0f4e-1111-4222-8333-444455556666',
      status: 'confirmed',
      check_in: '2026-10-03',
      check_out: '2026-10-07',
    });
  });

  test('accepts an already-parsed object and trims timestamps to dates', () => {
    const c = parseOverlapDetail({ booking_id: 'x', status: 'block', check_in: '2026-10-03T00:00:00', check_out: '2026-10-07' });
    assert.equal(c?.check_in, '2026-10-03');
    assert.equal(c?.status, 'block');
  });

  test('anything malformed is null, never a throw', () => {
    assert.equal(parseOverlapDetail('not json'), null);
    assert.equal(parseOverlapDetail('{"booking_id":"x"}'), null);
    assert.equal(parseOverlapDetail(null), null);
    assert.equal(parseOverlapDetail(42), null);
  });

  test('only SQLSTATE P0002 is the overlap', () => {
    assert.ok(isOverlapErrorCode('P0002'));
    assert.ok(!isOverlapErrorCode('P0001'));
    assert.ok(!isOverlapErrorCode('23505'));
    assert.ok(!isOverlapErrorCode(undefined));
  });
});

describe('the redirect contract', () => {
  const conflict = { booking_id: 'abc', status: 'confirmed', check_in: '2026-10-03', check_out: '2026-10-07' };

  test('round-trips through a query string', () => {
    const qs = conflictToSearchParams(conflict, { property: '21_horton', type: 'block', check_in: '2026-10-04', check_out: '2026-10-06', skip: null, empty: '' });
    const sp = new URLSearchParams(qs);
    assert.equal(sp.get('property'), '21_horton');
    assert.equal(sp.get('type'), 'block');
    assert.equal(sp.get('check_in'), '2026-10-04');
    assert.ok(!sp.has('skip'));
    assert.ok(!sp.has('empty'));
    assert.deepEqual(conflictFromSearchParams(sp), conflict);
    assert.deepEqual(conflictFromSearchParams(Object.fromEntries(sp.entries())), conflict);
  });

  test('a page without a conflict reads null', () => {
    assert.equal(conflictFromSearchParams(new URLSearchParams('property=21_horton')), null);
    assert.equal(conflictFromSearchParams({}), null);
    assert.equal(conflictFromSearchParams({ conflict_id: 'x', conflict_in: 'garbage', conflict_out: '2026-10-07' }), null);
  });

  test('describes the conflict for a banner', () => {
    assert.equal(describeConflict(conflict), 'Those nights overlap a confirmed stay, 2026-10-03 to 2026-10-07.');
    assert.equal(describeConflict({ ...conflict, status: 'block' }), 'Those nights overlap a block, 2026-10-03 to 2026-10-07.');
    assert.equal(describeConflict({ ...conflict, status: 'completed' }), 'Those nights overlap a completed stay, 2026-10-03 to 2026-10-07.');
  });
});

describe('date guards and patch allowlists', () => {
  test('nightsBetween and isYmd', () => {
    assert.equal(nightsBetween('2026-10-03', '2026-10-07'), 4);
    assert.equal(nightsBetween('2026-10-07', '2026-10-03'), -4);
    assert.ok(isYmd('2026-10-03'));
    assert.ok(!isYmd('10/03/2026'));
    assert.ok(!isYmd(null));
  });

  test('pickPatch keeps allowed keys, drops undefined, blanks to null', () => {
    const p = pickPatch(
      { guest_name: 'Jane', guest_email: '', guest_phone: undefined, gross_amount: 100, notes: 'x' },
      GUEST_FIELD_KEYS,
    );
    assert.deepEqual(p, { guest_name: 'Jane', guest_email: null, notes: 'x' });
    const m = pickPatch({ gross_amount: 100, guest_name: 'Jane' }, MONEY_FIELD_KEYS);
    assert.deepEqual(m, { gross_amount: 100 });
  });
});
