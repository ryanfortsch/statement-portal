import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestedHouses, suggestedContact, houseSuggestions } from '../matching-suggestions.ts';
const houses = [{ id: 'a', name: '21 Harbor' }, { id: 'b', name: '4 Beach' }, { id: 'c', name: '21 Harbor Unit 2' }];
test('house suggestions use numbered street evidence, never a calendar number', () => {
  assert.deepEqual(suggestedHouses('Done at 4 Beach!', houses).map(p => p.id), ['b']);
  assert.deepEqual(suggestedHouses('Wed 10/21, Harbor area', houses), []);
  assert.deepEqual(suggestedHouses('Done at 121 Harbor', houses), []);
  assert.deepEqual(suggestedHouses('21 Harbor and 4 Beach done', houses).map(p => p.id), ['a', 'b']);
  assert.equal(suggestedHouses('21 Harbor Unit 2 done', houses).length, 2, 'unit and base remain ambiguous');
});
test('a spelled-out house number is the same evidence as digits', () => {
  const fleet = [{ id: 's', name: '7 Sumac' }, { id: 'r', name: '53 Rocky Neck' }];
  assert.deepEqual(suggestedHouses('Seven Sumac I did clean yesterday', fleet).map(p => p.id), ['s']);
  assert.deepEqual(suggestedHouses('Fifty three Rocky Neck is done', fleet).map(p => p.id), ['r']);
  assert.deepEqual(suggestedHouses('Seventy Sumac', fleet), []);
});
test('a street named with its street word suggests the one house on it, and only one', () => {
  const fleet = [{ id: 'e', name: '20 Enon' }, { id: 'r', name: '53 Rocky Neck' }, { id: 'd', name: '53 Rocky Neck, Downstairs' }, { id: 'x', name: '73 Rocky Neck' }, { id: 'h', name: '21 Horton' }];
  assert.deepEqual(houseSuggestions('Hi Ray, we cleaned Enon Street today.', fleet), { houses: [fleet[0]], by: 'street' });
  assert.deepEqual(houseSuggestions('done at horton st', fleet).houses.map(p => p.id), ['h']);
  assert.deepEqual(houseSuggestions('Rocky Neck Ave is done', fleet), { houses: [], by: null }, 'three houses on the street');
  assert.deepEqual(houseSuggestions('Enon is done', fleet), { houses: [], by: null }, 'a bare street word is not evidence');
  assert.deepEqual(houseSuggestions('20 Enon and Horton St', fleet), { houses: [fleet[0]], by: 'house' }, 'a house named in full wins');
});
test('contact suggestions require unique identity evidence', () => {
  const contacts = [{ id: 'a', name: 'Alex Example' }, { id: 'b', name: 'Sam Sample' }];
  assert.equal(suggestedContact('Hi, this is Alex Example.', undefined, contacts)?.contact.id, 'a');
  assert.equal(suggestedContact('Call Alex Example tomorrow', undefined, contacts), null);
  assert.equal(suggestedContact('This is Alex', undefined, contacts), null);
  assert.equal(suggestedContact('', 'Alex Example', [...contacts, { id: 'c', name: 'Alex Example' }]), null);
});
