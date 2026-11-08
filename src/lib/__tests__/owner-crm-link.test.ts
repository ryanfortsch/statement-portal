/**
 * /owner-messaging no longer keeps its own per-owner history (the Contacts
 * block, UX audit 2026-11-07). Each owner card links to the owner's CRM
 * contact instead. The match is exact (that phone, that email) or the home's
 * one owner contact; anything less is no link, never a guess. Synthetic
 * records only.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { buildOwnerCrmDirectory, ownerContactKey, ownerCrmHref, type CrmContactRow } from '../owner-crm-link.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const row = (id: string, extra: Partial<CrmContactRow> = {}): CrmContactRow => ({ id, type: 'owner', phone: null, emails: null, linked_property_ids: null, ...extra });

test('a phone and an email key the same way however they are written', () => {
  assert.equal(ownerContactKey('+1 (555) 010-0001'), '5550100001');
  assert.equal(ownerContactKey('5550100001'), '5550100001');
  assert.equal(ownerContactKey(' Owner@Example.TEST '), 'owner@example.test');
  assert.equal(ownerContactKey('12'), '');
  assert.equal(ownerContactKey(null), '');
});

test('an exact phone or email links to that contact', () => {
  const dir = buildOwnerCrmDirectory([
    row('c1', { phone: '(555) 010-0001' }),
    row('c2', { emails: ['second@example.test'] }),
  ]);
  assert.equal(ownerCrmHref(dir, '+15550100001', null), '/crm/c1');
  assert.equal(ownerCrmHref(dir, 'Second@Example.test', null), '/crm/c2');
});

test('an owner row wins a number another kind of contact also carries', () => {
  const dir = buildOwnerCrmDirectory([row('vendor', { type: 'vendor', phone: '5550100001' }), row('owner', { phone: '5550100001' })]);
  assert.equal(ownerCrmHref(dir, '5550100001', null), '/crm/owner');
});

test('the home is the fallback only when it has exactly one owner contact', () => {
  const dir = buildOwnerCrmDirectory([
    row('solo', { emails: ['solo@example.test'], linked_property_ids: ['home_a'] }),
    row('one', { linked_property_ids: ['home_b'] }),
    row('two', { linked_property_ids: ['home_b'] }),
    row('lead', { type: 'lead', linked_property_ids: ['home_c'] }),
  ]);
  assert.equal(ownerCrmHref(dir, '5550109999', 'home_a'), '/crm/solo', 'a household with an email texting from its phone');
  assert.equal(ownerCrmHref(dir, '5550109999', 'home_b'), null, 'two owners on one home is no guess');
  assert.equal(ownerCrmHref(dir, '5550109999', 'home_c'), null, 'only owner contacts stand for a home');
  assert.equal(ownerCrmHref(dir, '', null), null);
});

test('the Contacts history is gone and every owner card offers the CRM link', () => {
  assert.ok(!existsSync(new URL('../../app/owner-messaging/OwnerContactsHistory.tsx', import.meta.url)));
  const page = read('src/app/owner-messaging/page.tsx');
  assert.ok(!page.includes('OwnerContactsHistory') && !page.includes('listOwnerHistory('), 'the page keeps its own CRM');
  assert.ok(page.includes('loadOwnerCrmDirectory()'), 'the queue gets the directory');
  const queue = read('src/app/owner-messaging/OwnerMessagingQueue.tsx');
  assert.ok(queue.includes('crmHref={ownerCrmHref(crm, approval.owner_contact, approval.property_id)}'), 'each card resolves its contact');
  assert.ok(queue.includes('History in CRM'), 'the card links to the history');
});
