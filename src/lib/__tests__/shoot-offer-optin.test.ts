/**
 * A shoot is OFFERED to a contributor, never assigned: the invariant audit.
 *
 * The planner grid shipped writing a committed shoot and texting the
 * contributor "it's on for Wednesday" (Dotti, 2026-09-21: "you can't just
 * book him, he has to opt in"). The fix added two states, `offered` and
 * `declined`, and it all rests on one rule:
 *
 *     AN OFFER IS NEVER WORK.
 *
 * Until the contributor accepts, a shoot must not reveal a door code, must
 * not be scanned for deliveries, must not get the 8 AM go/no-go text, must
 * not enter the pay ledger, and must not count on anyone's profile. Each of
 * those is one filter in one file, and any of them quietly dropped puts us
 * back where we started.
 *
 * So this reads the source and asserts each guard is still there. That is an
 * unusual shape for a test, but these are one-line guards spread over eight
 * files with nothing else holding them in place, and the consequence of
 * losing one is a contractor sent to a house nobody asked him about.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('an offer is never work', () => {
  test('the status vocabulary carries consent as well as progress', () => {
    const src = read('src/lib/creative-shoots.ts');
    for (const s of ['offered', 'scheduled', 'declined', 'shot', 'delivered', 'approved', 'settled', 'cancelled']) {
      assert.ok(src.includes(`| '${s}'`), `ShootStatus is missing '${s}'`);
    }
    // The predicates the rest of this file leans on.
    assert.ok(src.includes("export const isOffer = (s: ShootStatus): boolean => s === 'offered';"));
    assert.ok(
      src.includes("export const isPreWork = (s: ShootStatus): boolean => s === 'offered' || s === 'declined';"),
    );
  });

  test('an unanswered offer does not reveal the door code', () => {
    const src = read('src/lib/creative-brief.ts');
    const set = /const ACTIVE_SHOOT_STATUSES = new Set\(\[([^\]]*)\]\)/.exec(src);
    assert.ok(set, 'ACTIVE_SHOOT_STATUSES not found in creative-brief.ts');
    // The brief still RENDERS for an offer (they have to see the day to
    // decide); it just withholds the property's own secrets until they say
    // yes. Adding 'offered' here would hand them out on a maybe.
    assert.ok(
      !set![1].includes("'offered'"),
      "'offered' was added to ACTIVE_SHOOT_STATUSES: an unanswered offer would reveal the door code",
    );
  });

  test('the 8 AM go/no-go text only covers days they accepted', () => {
    assert.match(
      read('src/lib/field-notify.ts'),
      /\.in\('status', \['scheduled', 'shot'\]\)/,
      'sendCreativeDayOfChecks no longer restricts to scheduled/shot, so an unanswered offer could get a go text',
    );
  });

  test('the delivery watcher does not scan an offer', () => {
    assert.ok(
      !read('src/lib/creative-drive.ts').includes("'offered'"),
      'creative-drive.ts mentions offered: the watcher must not scan a shoot nobody agreed to',
    );
  });

  test('a withdrawn or declined day goes back to green on the grid', () => {
    assert.ok(
      read('src/lib/creative-calendar.ts').includes(".not('status', 'in', '(cancelled,declined)')"),
      'the planner would keep showing a refused day as taken',
    );
  });

  test('offers and declines stay out of the pay groups', () => {
    assert.ok(
      read('src/app/fieldwork/shoots/page.tsx').includes('isPreWork(s.shoot.status)'),
      'an unanswered offer would sit in the money groups as though it were work',
    );
  });

  test('an offer never counts as a shoot done on the profile', () => {
    // The `happened` test there reads any past-dated row as completed, so an
    // offer that expired unanswered would have shown as work he did.
    assert.ok(
      read('src/lib/creative-shoots.ts').includes('if (isPreWork(sm.shoot.status)) continue;'),
      'creativeProfileStats no longer skips pre-work rows',
    );
  });
});

describe('the yes is the contributor own', () => {
  const fieldActions = read('src/app/field/actions.ts');

  test('they have both answers to give', () => {
    for (const fn of ['acceptShoot', 'declineShoot']) {
      assert.ok(fieldActions.includes(`export async function ${fn}(`), `${fn} is missing`);
    }
  });

  test('each answer lands once, and only from the person asked', () => {
    // Guarded on the row still being an offer, so a double tap, a back
    // button, or the office withdrawing first cannot flip a settled shoot.
    const guards = fieldActions.match(/\.eq\('status', 'offered'\)/g) ?? [];
    assert.ok(guards.length >= 2, 'accept and decline must both be guarded on the row still being an offer');
    // The brief link is short and guessable, so ownership is re-checked on
    // the write, not just on the page that drew the buttons.
    assert.ok(fieldActions.includes('shoot.contractor_id !== contractor.id'));
  });

  test('the office offers, and cannot accept on their behalf', () => {
    const office = read('src/app/fieldwork/shoots/actions.ts');
    assert.ok(office.includes("status: 'offered'"), 'the planner must offer, not book');
    assert.ok(
      !/status:\s*'scheduled'/.test(office),
      "the office writes status 'scheduled': only the contributor's own accept may do that",
    );
  });
});
