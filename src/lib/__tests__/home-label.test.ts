/**
 * Operator copy names a home, never its id (walk of 2026-10-18: the Team
 * inbox's "From the guests · add to the message?" rows printed
 * "21_horton:").
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeLabel, prettyPropertyId } from '../home-label.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

test('a home reads as its name, else as an address', () => {
  const names = new Map([['53_rocky_neck_2', '53 Rocky Neck, Downstairs']]);
  assert.equal(homeLabel('53_rocky_neck_2', names), '53 Rocky Neck, Downstairs');
  assert.equal(homeLabel('21_horton', names), '21 Horton');
  assert.equal(homeLabel('21_horton'), '21 Horton');
  assert.equal(prettyPropertyId('17_beach_back'), '17 Beach Back');
});

test('the guest-notes rows print the name', () => {
  const card = read('src/app/cleaner-messaging/ScheduleDigestCard.tsx');
  assert.ok(!card.includes('<strong>{n.property_id}</strong>'), 'a guest-notes row prints the property id again');
  assert.equal(card.split('<strong>{homeLabel(n.property_id, names)}</strong>').length - 1, 2);
});

test('the flip and revert notes say "this home", not the id', () => {
  const actions = read('src/app/channels/[propertyId]/cutover-actions.ts');
  assert.ok(!actions.includes('Helm runs ${propertyId}'));
  assert.ok(!actions.includes('calendar authority for ${propertyId}'));
});
