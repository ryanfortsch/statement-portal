/**
 * One capture box, two parsers: which one reads what was said.
 *
 * The bias matters more than the accuracy. A walk misread as a note is one
 * click from being re-read; a one-line fact sent to the room-by-room parser
 * comes back as rooms nobody asked for, in a review screen the operator then
 * has to clear. So the heuristic must stay reluctant, and these assert the
 * reluctance rather than just the happy path.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeWalkthrough } from '../capture-routing.ts';

describe('looksLikeWalkthrough', () => {
  test('a single dictated fact is never a walk', () => {
    for (const s of [
      'Gate code is 4455.',
      'Trash goes out Tuesday.',
      'The downstairs shower runs hot for a minute, let guests know.',
      'Rosa has a key to the basement.',
      '',
      '   ',
    ]) {
      assert.equal(looksLikeWalkthrough(s), false, `routed to the room parser: ${JSON.stringify(s)}`);
    }
  });

  test('a long note about ONE room is still a note', () => {
    // Names a room repeatedly, and is long, but never moves. This is the
    // case that would waste the operator's time if the bias went the other
    // way: they would get a rooms review screen for one observation.
    const s =
      'The primary bedroom air conditioner has been rattling since the spring and the ' +
      'previous guest mentioned it twice in their message thread. I have asked the ' +
      'handyman to look at the primary bedroom unit before the next check in, and if ' +
      'he cannot get to it we should tell the bedroom guests it may be noisy at night.';
    assert.ok(s.length >= 160);
    assert.equal(looksLikeWalkthrough(s), false);
  });

  test('length alone is not a walk', () => {
    const s =
      'The owner called about the quarterly statement and wants the cleaning line broken '.repeat(3);
    assert.ok(s.length >= 160);
    assert.equal(looksLikeWalkthrough(s), false);
  });

  test('two distinct rooms at length is a walk', () => {
    const s =
      'Starting in the kitchen, the dishwasher needs the door lifted slightly to latch, and the ' +
      'coffee grinder lives in the cabinet left of the sink. The primary bathroom has the good ' +
      'towels in the linen closet and the shower diverter sticks.';
    assert.ok(s.length >= 160);
    assert.equal(looksLikeWalkthrough(s), true);
  });

  test('one room plus an explicit move is a walk', () => {
    const s =
      'We are starting at the front door where the Schlage keypad is, the code goes in and then ' +
      'the lock beeps twice before it turns over. Now the kitchen, where the left burner on the ' +
      'range only lights with the igniter held down for a few seconds.';
    assert.ok(s.length >= 160);
    assert.equal(looksLikeWalkthrough(s), true);
  });

  test('the short-circuit is length first, so a short walk stays quick', () => {
    // Under the floor even though it names two rooms and moves between them.
    // Deliberate: a short utterance is cheap to re-read, and the quick parser
    // handles a two-clause sentence perfectly well.
    const s = 'Kitchen light is out. Now the bathroom, the fan rattles.';
    assert.ok(s.length < 160);
    assert.equal(looksLikeWalkthrough(s), false);
  });
});
