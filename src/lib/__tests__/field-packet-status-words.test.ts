/**
 * One packet status vocabulary, from the board to the packet page.
 *
 * The UI/UX audit (2026-10-17) found one status with four names: "published"
 * in code, "Open · unclaimed" on the board chip, "Unassigned soon" in the
 * filter, "Out to contractors" as the section heading, and the packet page
 * printing `in_progress` and `submitted` raw in its header, `pending` on
 * each stop and event types in the Activity fold. The fix is one label map
 * in field-packet-status.ts and one PacketStatusStrip on both pages.
 *
 * A label map is exactly the kind of thing a later edit routes around (a
 * new row prints `p.status` because it was quickest), so this reads the
 * page sources and fails the moment a stored value reaches the screen or a
 * retired phrase comes back. Same shape as shoot-offer-optin.test.ts.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PACKET_STEPS,
  PACKET_STEP_LABEL,
  PACKET_STATUS_ORDER,
  STOP_STATUS_LABEL,
  packetStep,
  packetStatusLabel,
  stopStatusLabel,
  packetEventLabel,
} from '../field-packet-status.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** The source with comments blanked, so a docblock that quotes an old phrase
 *  is neither a hit nor a pass. */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

/** Every page that names a packet's state. */
const PAGES = [
  'src/app/fieldwork/packets/page.tsx',
  'src/app/fieldwork/packets/[id]/page.tsx',
  'src/app/fieldwork/packets/test/page.tsx',
];

/** A stored status reaching the screen: `{p.status}`, `{p.status.replace(…)}`,
 *  or the arm of a ternary that ends the expression (`: packet.status}`).
 *  Two shapes are not renders and are let through: a `${…}` interpolation
 *  (the nav-count revision key carries the status on purpose) and a prop,
 *  `status={p.status}`, which is how the strip itself is fed. */
const RAW_STATUS = /(?<![$=])[{:?]\s*(?:packet|p|s|row|r)\.status(?:\.replace\([^)]*\))?\s*\}/;

describe('one packet status vocabulary', () => {
  test('the line is Draft · Open · Claimed · On site · Submitted · Approved · Paid, in that order', () => {
    assert.deepEqual(PACKET_STEPS.map((s) => PACKET_STEP_LABEL[s]), ['Draft', 'Open', 'Claimed', 'On site', 'Submitted', 'Approved', 'Paid']);
  });

  test('every stored status lands on a step, and paid is approved plus the flag', () => {
    const seen = new Map(PACKET_STATUS_ORDER.map((s) => [s, packetStatusLabel(s, null)]));
    assert.deepEqual(
      [...seen.entries()],
      [
        ['draft', 'Draft'],
        ['published', 'Open'],
        ['claimed', 'Claimed'],
        ['in_progress', 'On site'],
        ['submitted', 'Submitted'],
        ['approved', 'Approved'],
        ['cancelled', 'Cancelled'],
      ],
    );
    assert.equal(packetStatusLabel('approved', '2026-10-17T12:00:00Z'), 'Paid');
    assert.equal(packetStep('approved', '2026-10-17T12:00:00Z'), 'paid');
    // The flag means nothing before approval.
    assert.equal(packetStatusLabel('submitted', '2026-10-17T12:00:00Z'), 'Submitted');
    // No label is ever the stored word.
    for (const s of PACKET_STATUS_ORDER) assert.notEqual(packetStatusLabel(s, null), s);
  });

  test('stop rows say Not started / On site / Done / Skipped', () => {
    assert.deepEqual(STOP_STATUS_LABEL, { pending: 'Not started', in_progress: 'On site', complete: 'Done', skipped: 'Skipped' });
    assert.equal(stopStatusLabel('in_progress'), 'On site');
    // An unknown value still reads as words, never with an underscore.
    assert.equal(stopStatusLabel('some_new_state'), 'some new state');
  });

  test('the Activity fold reads in sentences', () => {
    assert.equal(packetEventLabel('submitted_by_office'), 'Submitted by the office');
    assert.equal(packetEventLabel('offer_pick_unavailable_held_as_draft'), 'Held as a draft: a picked contractor could not claim');
    assert.equal(packetEventLabel('something_unlisted'), 'something unlisted');
    for (const type of ['published', 'claimed', 'assigned', 'released', 'expired', 'submitted', 'approved', 'paid', 'changes_requested', 'stop_added', 'stop_removed', 'recorded_past_visit']) {
      assert.ok(!packetEventLabel(type).includes('_'), `${type} still prints an underscore`);
    }
  });

  for (const file of PAGES) {
    test(`${file} never prints a stored status`, () => {
      const src = withoutComments(read(file));
      const hit = RAW_STATUS.exec(src);
      assert.ok(!hit, `${file} renders a raw status: ${hit?.[0].trim()}`);
      assert.ok(src.includes("from '@/lib/field-packet-status'"), `${file} no longer imports the status words`);
    });
  }

  test('the board and the packet page both render the strip', () => {
    for (const file of PAGES.slice(0, 2)) {
      const src = withoutComments(read(file));
      assert.ok(src.includes('<PacketStatusStrip status='), `${file} does not render PacketStatusStrip`);
    }
  });

  test('the retired phrases stay retired', () => {
    for (const file of PAGES) {
      const src = withoutComments(read(file));
      for (const phrase of ['Open · unclaimed', 'Out to contractors', 'Unassigned soon', 'statusChip(']) {
        assert.ok(!src.includes(phrase), `${file} brought back "${phrase}"`);
      }
    }
  });

  test('the strip component prints every step from the one map', () => {
    const src = withoutComments(read('src/app/fieldwork/packets/PacketStatusStrip.tsx'));
    assert.ok(src.includes('PACKET_STEPS.map('), 'the strip must walk PACKET_STEPS, not its own list');
    assert.ok(src.includes('PACKET_STEP_LABEL[s]'), 'the strip must print the shared labels');
    for (const word of ['Open · unclaimed', 'In progress', 'Needs review']) {
      assert.ok(!src.includes(word), `the strip carries its own word: ${word}`);
    }
  });
});
