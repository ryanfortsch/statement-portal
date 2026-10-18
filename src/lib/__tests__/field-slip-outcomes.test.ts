import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SLIP_OUTCOME_LABEL, SLIP_OUTCOME_HINT, alreadyHandledNote, slipVerdictLists } from '../field-slip-outcomes.ts';

// One meaning of done on the contractor portal (audit Phase 3, Field): the
// stepper's review screen offers the packet page's three outcomes in the
// packet page's words, and "Done on this trip" says the office closes it on
// approval. Before, a tap on the stepper meant "found it handled" while the
// same tap on the packet page meant "I did it".

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('three outcomes, one set of words, and done says when it closes', () => {
  assert.deepEqual(SLIP_OUTCOME_LABEL, { done: 'Done on this trip', handled: 'Already handled', open: 'Still open' });
  assert.match(SLIP_OUTCOME_HINT.done, /office closes it when they approve/);
  assert.match(SLIP_OUTCOME_HINT.handled, /not done by you/);
  assert.equal(alreadyHandledNote('Sam'), 'Already handled by the time Sam arrived (Field)');
  assert.equal(alreadyHandledNote('Sam', 'owner fixed it'), 'Already handled by the time Sam arrived (Field): owner fixed it');
});

test('one answer per slip: done wins over handled, either over still open', () => {
  assert.deepEqual(slipVerdictLists({ done: ['a', ' a ', ''], handled: ['a', 'b'], open: ['a', 'b', 'c'] }), { done: ['a'], handled: ['b'], open: ['c'] });
  assert.deepEqual(slipVerdictLists({}), { done: [], handled: [], open: [] });
});

test('the stepper offers all three and sends all three', () => {
  const stepper = code('src/app/inspections/[id]/Stepper.tsx');
  assert.ok(stepper.includes("(['done', 'handled', 'open'] as const).map((o) =>"), 'three choices per slip');
  assert.ok(stepper.includes('{SLIP_OUTCOME_LABEL[o]}') && stepper.includes('{SLIP_OUTCOME_HINT[verdict]}'));
  for (const list of ['slipsDone:', 'slipsHandled:', 'slipsStillOpen:']) assert.ok(stepper.includes(list), `sends ${list}`);
  assert.doesNotMatch(stepper, /It's handled|Still needs doing|Still on the list/, 'the old one-toggle words are gone');
});

test('both rails write the same outcome the same way', () => {
  const inspections = code('src/app/inspections/actions.ts');
  assert.ok(inspections.includes('slipVerdictLists({'), 'the precedence is the tested one');
  assert.ok(inspections.includes("for (const [ids, outcome] of [[slipsDone, 'done'], [slipsHandled, 'handled']] as const)"), 'done rides the same rail as handled');
  assert.ok(inspections.includes("outcome === 'done' ? doneOnTripNote(verifierName) : alreadyHandledNote(verifierName)"));
  const field = code('src/app/field/actions.ts');
  assert.ok(field.includes('alreadyHandledNote(contractor.full_name, trimmed)'), 'the packet page writes the same handled note');
  const list = code('src/app/field/packet/[packetId]/StopWorkList.tsx');
  assert.ok(list.includes('SLIP_OUTCOME_LABEL.done') && list.includes('SLIP_OUTCOME_LABEL.handled'));
  assert.ok(list.includes('The office closes each one when they approve the trip.'), 'a tick says when it closes');
});
