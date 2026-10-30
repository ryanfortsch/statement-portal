import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestedHouses, suggestedContact } from '../matching-suggestions.ts';
const houses = [{ id: 'a', name: '21 Harbor' }, { id: 'b', name: '4 Beach' }, { id: 'c', name: '21 Harbor Unit 2' }];
test('house suggestions use numbered street evidence, never a calendar number', () => {
  assert.deepEqual(suggestedHouses('Done at 4 Beach!', houses).map(p => p.id), ['b']);
  assert.deepEqual(suggestedHouses('Wed 10/21, Harbor area', houses), []);
  assert.deepEqual(suggestedHouses('Done at 121 Harbor', houses), []);
  assert.deepEqual(suggestedHouses('21 Harbor and 4 Beach done', houses).map(p => p.id), ['a', 'b']);
  assert.equal(suggestedHouses('21 Harbor Unit 2 done', houses).length, 2, 'unit and base remain ambiguous');
});
test('contact suggestions require unique identity evidence', () => {
  const contacts = [{ id: 'a', name: 'Alex Example' }, { id: 'b', name: 'Sam Sample' }];
  assert.equal(suggestedContact('Hi, this is Alex Example.', undefined, contacts)?.contact.id, 'a');
  assert.equal(suggestedContact('Call Alex Example tomorrow', undefined, contacts), null);
  assert.equal(suggestedContact('This is Alex', undefined, contacts), null);
  assert.equal(suggestedContact('', 'Alex Example', [...contacts, { id: 'c', name: 'Alex Example' }]), null);
});
