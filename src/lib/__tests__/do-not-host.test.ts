/**
 * Do not host again: the wording, the fallback order, and where the line
 * must appear.
 *
 * The flag was added on 2026-10-30 after a guest harassed the team following
 * an October stay and Helm had nowhere to say so: Airbnb's Block covers
 * Airbnb, and VRBO, Booking.com and a direct Stay Cape Ann booking had no
 * guard. It is one row's worth of columns and one red line, and the line is
 * only worth anything if every surface that names a guest draws it. So the
 * second half of this file reads the source of each surface and asserts
 * the line is still there, and that no surface grew its own phone lookup.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  buildDoNotHostIndex,
  doNotHostDetail,
  doNotHostLine,
  doNotHostNote,
  EMPTY_DO_NOT_HOST_INDEX,
  type DoNotHostGuest,
} from '../do-not-host.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

function guest(patch: Partial<DoNotHostGuest> & { contact_id: string }): DoNotHostGuest {
  return {
    name: 'Synthetic Guest',
    guesty_guest_ids: [],
    emails: [],
    phones: [],
    reason: 'Harassed the team by text after checkout',
    set_by: 'owner@example.test',
    set_at: '2026-10-30T18:00:00Z',
    ...patch,
  };
}

describe('the one red line', () => {
  test('carries the label and the reason, one space apart', () => {
    assert.equal(doNotHostLine({ reason: 'Harassed the team by text after checkout' }), 'Do not host again · Harassed the team by text after checkout');
  });

  test('collapses the reason to one line', () => {
    assert.equal(doNotHostLine({ reason: '  Broke the  deck\nrail   ' }), 'Do not host again · Broke the deck rail');
  });

  test('is the bare label when a row was flagged with no reason', () => {
    assert.equal(doNotHostLine({ reason: null }), 'Do not host again');
    assert.equal(doNotHostLine({ reason: '   ' }), 'Do not host again');
  });

  test('says who decided and when behind it, in Eastern time', () => {
    assert.equal(doNotHostDetail({ set_by: 'dotti@example.test', set_at: '2026-10-31T02:30:00Z' }), 'Flagged by dotti@example.test on Oct 30, 2026');
    assert.equal(doNotHostDetail({ set_by: null, set_at: null }), 'Flagged');
    assert.equal(doNotHostDetail({ set_by: 'dotti@example.test', set_at: 'not a date' }), 'Flagged by dotti@example.test');
  });

  test('a record that is not flagged has no note', () => {
    assert.equal(doNotHostNote({ do_not_host: false, do_not_host_reason: 'stale', do_not_host_set_by: null, do_not_host_set_at: null }), null);
    assert.equal(doNotHostNote(null), null);
    assert.equal(doNotHostNote({}), null);
    assert.deepEqual(doNotHostNote({ do_not_host: true, do_not_host_reason: 'Damage', do_not_host_set_by: 'a@b.c', do_not_host_set_at: '2026-10-30T00:00:00Z' }), {
      reason: 'Damage',
      set_by: 'a@b.c',
      set_at: '2026-10-30T00:00:00Z',
    });
  });
});

describe('who is flagged: the fallback order', () => {
  const alex = guest({ contact_id: 'c-alex', name: 'Alex Flagged', guesty_guest_ids: ['gg-alex'], emails: ['Alex.Flagged@Example.test'], phones: ['+1 (978) 555-0101'], reason: 'Harassed the team' });
  const blair = guest({ contact_id: 'c-blair', name: 'Blair Flagged', guesty_guest_ids: ['gg-blair'], emails: ['blair@example.test'], phones: ['617-555-0102'], reason: 'Damaged the deck' });
  const index = buildDoNotHostIndex([alex, blair]);

  test('the record id wins over every other key', () => {
    const m = index.resolve({ contactId: 'c-alex', guestyGuestId: 'gg-blair', email: 'blair@example.test', phone: '6175550102' });
    assert.equal(m?.contact_id, 'c-alex');
    assert.equal(m?.matched_by, 'contact');
  });

  test('the Guesty guest id wins over email and phone', () => {
    const m = index.resolve({ guestyGuestId: 'gg-alex', email: 'blair@example.test', phone: '6175550102' });
    assert.equal(m?.contact_id, 'c-alex');
    assert.equal(m?.matched_by, 'guesty_guest');
  });

  test('email wins over phone, and is read lower-cased and trimmed', () => {
    const m = index.resolve({ email: '  ALEX.flagged@example.TEST ', phone: '6175550102' });
    assert.equal(m?.contact_id, 'c-alex');
    assert.equal(m?.matched_by, 'email');
  });

  test('phone is the last resort, by the last ten digits in any spelling', () => {
    for (const spelling of ['9785550101', '+19785550101', '(978) 555-0101', '978.555.0101']) {
      const m = index.resolve({ phone: spelling });
      assert.equal(m?.contact_id, 'c-alex', spelling);
      assert.equal(m?.matched_by, 'phone');
    }
  });

  test('a number that is not ten digits never matches, and neither does nothing', () => {
    assert.equal(index.resolve({ phone: '555-0101' }), null);
    assert.equal(index.resolve({ phone: '' }), null);
    assert.equal(index.resolve({}), null);
    assert.equal(index.resolve({ contactId: 'c-nobody', email: 'nobody@example.test', phone: '2125550199' }), null);
  });

  test('a match carries the note the line prints', () => {
    assert.deepEqual(index.resolve({ email: 'blair@example.test' }), {
      contact_id: 'c-blair',
      name: 'Blair Flagged',
      reason: 'Damaged the deck',
      set_by: 'owner@example.test',
      set_at: '2026-10-30T18:00:00Z',
      matched_by: 'email',
    });
  });

  test('a shared key goes to the first record in register order, newest flag first', () => {
    const shared = buildDoNotHostIndex([blair, guest({ contact_id: 'c-older', phones: ['617-555-0102'] })]);
    assert.equal(shared.resolve({ phone: '6175550102' })?.contact_id, 'c-blair');
  });

  test('an empty register answers nothing, so a failed read draws no line', () => {
    assert.equal(EMPTY_DO_NOT_HOST_INDEX.size, 0);
    assert.equal(EMPTY_DO_NOT_HOST_INDEX.resolve({ email: 'alex.flagged@example.test' }), null);
  });
});

describe('the flag is stored on the guest record and set with a reason', () => {
  test('the migration adds the four columns to audience_contacts and no table', () => {
    const files = readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter((f) => /do_not_host/.test(f));
    assert.equal(files.length, 1, `expected one do_not_host migration, found ${files.join(', ')}`);
    const sql = read(`supabase/migrations/${files[0]}`);
    assert.match(sql, /alter table public\.audience_contacts/);
    for (const col of ['do_not_host boolean not null default false', 'do_not_host_reason text', 'do_not_host_set_by text', 'do_not_host_set_at timestamptz']) {
      assert.ok(sql.includes(col), `migration is missing "${col}"`);
    }
    assert.ok(!/create\s+table/i.test(sql), 'the flag is columns on the record, not a table');
  });

  test('the record type carries the columns the resolver reads', () => {
    const src = read('src/lib/guests-types.ts');
    for (const col of ['do_not_host: boolean', 'do_not_host_reason: string | null', 'do_not_host_set_by: string | null', 'do_not_host_set_at: string | null']) {
      assert.ok(src.includes(col), `GuestContact is missing ${col}`);
    }
    assert.ok(src.includes("do_not_host_set: 'Do not host again'"), 'the timeline has no label for the set event');
    assert.ok(src.includes("do_not_host_cleared:"), 'the timeline has no label for the undo');
  });

  test('the server action takes a signed-in session, refuses an empty reason, and writes the flag and its event', () => {
    const src = read('src/app/guests/actions.ts');
    const set = src.slice(src.indexOf('export async function setDoNotHost'), src.indexOf('export async function clearDoNotHost'));
    assert.ok(set.includes('await auth()'), 'setDoNotHost does not check the session');
    assert.match(set, /if \(!reason\) return \{ ok: false/, 'setDoNotHost accepts an empty reason');
    assert.ok(set.includes('do_not_host: true'), 'setDoNotHost does not set the flag');
    assert.ok(set.includes("event_type: 'do_not_host_set'"), 'setDoNotHost leaves no timeline event');
    const clear = src.slice(src.indexOf('export async function clearDoNotHost'));
    assert.ok(clear.includes('await auth()'), 'clearDoNotHost does not check the session');
    assert.ok(clear.includes('do_not_host: false'), 'clearDoNotHost does not clear the flag');
    assert.ok(clear.includes("event_type: 'do_not_host_cleared'"), 'clearDoNotHost leaves no timeline event');
    // Owners and staff alike: a staff-only turn-away here would send the
    // person who took the texts to ask an owner to file it.
    assert.ok(!set.includes('requireOwnerEmail'), 'setDoNotHost must stay open to staff');
  });

  test('the control asks in the app dialog with the shared Button, never a native prompt', () => {
    const src = read('src/app/guests/[id]/DoNotHostControl.tsx');
    assert.ok(src.includes("import { Button } from '@/components/Button'"));
    assert.ok(src.includes("useConfirm()"), 'the control does not use useConfirm');
    assert.match(src, /askText\(\{[\s\S]*?inputLabel: 'Why'/, 'the reason is not asked for in the dialog');
    assert.ok(!/\b(window\.)?(confirm|prompt|alert)\(/.test(src), 'no native dialogs');
    assert.ok(src.includes('>\n            Undo\n          </Button>'), 'a flagged record offers Undo');
    assert.ok(src.includes('<DoNotHostLine'), 'the control does not draw the line');
    assert.ok(read('src/app/guests/[id]/page.tsx').includes('<DoNotHostControl'), 'the guest record does not mount the control');
  });
});

describe('every surface that names a guest draws the line', () => {
  const surfaces: Array<[string, string[]]> = [
    ['src/app/guests/[id]/DoNotHostControl.tsx', ['<DoNotHostLine']],
    // The card: the queue resolves the guest and hands the card its line.
    ['src/app/messaging/MessagingQueue.tsx', ['buildDoNotHostIndex(', 'flag={doNotHostMatch ? <DoNotHostLine']],
    ['src/components/messaging/card/ApprovalCard.tsx', ['flag?: ReactNode', '{flag && <div']],
    ['src/app/messaging/page.tsx', ['loadDoNotHostGuests()', 'flagged={flagged}']],
    ['src/app/channels/bookings/[id]/page.tsx', ['loadDoNotHostIndex()', '{flagged && <DoNotHostLine']],
    ['src/app/channels/bookings/page.tsx', ['loadDoNotHostIndex()', '{flagged && <DoNotHostLine']],
    ['src/lib/number-triage.ts', ['loadDoNotHostIndex()', 'doNotHostByPhone[u.phone] =']],
    ['src/components/messaging/NumberTriage.tsx', ['doNotHostByPhone', '{flagged && <DoNotHostLine']],
  ];
  for (const [file, needles] of surfaces) {
    test(file, () => {
      const src = read(file);
      for (const n of needles) assert.ok(src.includes(n), `${file} lost "${n}"`);
    });
  }

  test('the card resolves an OTA guest by the Guesty guest behind the reservation, then email, then phone', () => {
    const src = read('src/app/messaging/MessagingQueue.tsx');
    const call = /doNotHost\.resolve\(\{([\s\S]*?)\}\)/.exec(src);
    assert.ok(call, 'the guest card does not resolve the flag');
    assert.match(call![1], /guestyGuestId,[\s\S]*email:[\s\S]*phone:/);
    assert.ok(read('src/app/messaging/page.tsx').includes('loadGuestyGuestByReservation('), 'the page does not look up the Guesty guest behind each card');
  });

  test('the New numbers card hands the register the stay\'s email before the number', () => {
    const src = read('src/lib/number-triage.ts');
    assert.match(src, /doNotHost\.resolve\(\{ email: m\?\.guestEmail \?\? null, phone: u\.phone \}\)/);
    assert.ok(read('src/lib/unknown-number-guests.ts').includes('guest_email'), 'the stay match no longer carries the email');
  });
});

describe('no second phone lookup', () => {
  test('the resolver keys phones by the one normalizer the Quo ingest and the number directory use', () => {
    const src = read('src/lib/do-not-host.ts');
    assert.ok(src.includes("import { normalizePhone } from './quo-lines.ts';"));
    assert.ok(!src.includes('replace(/\\D/g'), 'do-not-host.ts grew its own digit stripping');
    assert.ok(read('src/lib/known-numbers.ts').includes("import { normalizePhone } from './quo-lines.ts';"), 'known-numbers.ts no longer shares the normalizer this test assumes');
  });

  test('the register reads phones only from where a guest\'s phone already lives', () => {
    const src = read('src/lib/do-not-host-server.ts');
    const tables = [...src.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]).sort();
    assert.deepEqual([...new Set(tables)], ['audience_contacts', 'bookings', 'guests', 'guesty_reservations']);
  });

  test('the smoke fixture that bundles the triage card knows the line', () => {
    const src = read('scripts/queue-actions-smoke.mjs');
    assert.ok(src.includes("'@/components/DoNotHostLine':'do-not-host-line'"));
    assert.ok(src.includes("'@/lib/do-not-host':'do-not-host'"));
  });
});
