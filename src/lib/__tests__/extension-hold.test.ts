import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extensionHoldChip, heldNights } from '../extension-hold.ts';

// A hold, not a booking, stopped an extension the guest asked for. The reply
// declines it by default; the chip says what the hold is so an owner can
// overrule a high-value ask (Dotti, 2026-10-22).

test('the held nights read as house dates', () => {
  assert.equal(heldNights('2026-10-27', '2026-10-27'), 'Oct 27');
  assert.equal(heldNights('2026-10-27', '2026-10-28'), 'Oct 27-28');
  assert.equal(heldNights('2026-10-31', '2026-11-01'), 'Oct 31-Nov 1');
  assert.equal(heldNights('not a date', '2026-11-01'), '');
});

test('a maintenance hold names itself and carries its note as the title', () => {
  const chip = extensionHoldChip({ start: '2026-10-27', end: '2026-10-28', reason: 'Maintenance', note: 'Routine check' });
  assert.deepEqual(chip, {
    label: 'Held Oct 27-28: Maintenance',
    title: 'Routine check. The reply does not offer these nights. Edit it to offer them.',
  });
});

test('no hold, or no readable night, shows nothing', () => {
  assert.equal(extensionHoldChip(null), null);
  assert.equal(extensionHoldChip(undefined), null);
  assert.equal(extensionHoldChip({ start: '', end: '', reason: 'Maintenance', note: '' }), null);
  assert.equal(extensionHoldChip({ start: '2026-10-27', end: '', reason: '', note: '' })?.label, 'Held Oct 27: Hold');
});

test('the guest card renders the chip, with no em dash in its words', () => {
  const card = readFileSync(new URL('../../app/messaging/MessagingQueue.tsx', import.meta.url), 'utf8');
  assert.ok(card.includes('const hold = extensionHoldChip(approval.extension_hold);'));
  assert.ok(card.includes('{hold.label}'));
  const lib = readFileSync(new URL('../extension-hold.ts', import.meta.url), 'utf8');
  assert.ok(!lib.includes('—'));
});
