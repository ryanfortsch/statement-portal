/**
 * One person, two records (UX audit 2026-11-07, slice 3): the Guest list
 * record and the CRM contact link each other on an exact email or phone, and
 * Cmd+K finds a guest and opens the record that knows the most. One match is
 * a link; none or several is no link, never a guess. Synthetic records only.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  crmCandidateFilter,
  emailVariants,
  gatherPeople,
  oneCrmContact,
  oneGuestListRecord,
  phoneQueryDigits,
  resolveGuestMatches,
  withoutListedContacts,
  type CrmLinkRow,
} from '../person-record-link.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const crm = (id: string, extra: Partial<CrmLinkRow> = {}): CrmLinkRow => ({ id, emails: null, phone: null, ...extra });

test('an exact email, case aside, links to that CRM contact', () => {
  const rows = [crm('c1', { emails: ['Guest@Example.TEST'] }), crm('c2', { emails: ['other@example.test'] })];
  assert.equal(oneCrmContact({ emails: ['guest@example.test'], phones: [] }, rows), 'c1');
});

test('an exact phone links however it was typed', () => {
  const rows = [crm('c1', { phone: '(555) 010-0001' })];
  assert.equal(oneCrmContact({ emails: [], phones: ['+1 555 010 0001'] }, rows), 'c1');
  assert.equal(oneCrmContact({ emails: [], phones: ['555 010 0002'] }, rows), null);
});

test('two contacts holding the same email, or none, is no link', () => {
  const rows = [crm('c1', { emails: ['shared@example.test'] }), crm('c2', { emails: ['shared@example.test'] })];
  assert.equal(oneCrmContact({ emails: ['shared@example.test'], phones: [] }, rows), null);
  assert.equal(oneCrmContact({ emails: ['nobody@example.test'], phones: [] }, rows), null);
  assert.equal(oneCrmContact({ emails: [], phones: [] }, rows), null);
});

test('email and phone naming two different contacts is no link', () => {
  const rows = [crm('c1', { emails: ['guest@example.test'] }), crm('c2', { phone: '5550100001' })];
  assert.equal(oneCrmContact({ emails: ['guest@example.test'], phones: ['5550100001'] }, rows), null);
});

test('a substring is not a match', () => {
  const rows = [crm('c1', { emails: ['xguest@example.test'], phone: '5550100001' })];
  assert.equal(oneCrmContact({ emails: ['guest@example.test'], phones: ['0100001'] }, rows), null);
});

test('a CRM contact finds its one Guest list record, and several emails on two records is no link', () => {
  const list = [{ id: 'g1', email: 'guest@example.test' }, { id: 'g2', email: 'work@example.test' }];
  assert.equal(oneGuestListRecord(['GUEST@example.test'], list), 'g1');
  assert.equal(oneGuestListRecord(['guest@example.test', 'work@example.test'], list), null);
  assert.equal(oneGuestListRecord([], list), null);
});

test('only safe emails reach a filter, in both spellings', () => {
  assert.deepEqual(emailVariants(['Guest@Example.TEST', 'not-an-email', 'a,b@example.test', null]), ['Guest@Example.TEST', 'guest@example.test']);
  assert.equal(crmCandidateFilter([], []), null);
  assert.equal(crmCandidateFilter(['guest@example.test'], ['(555) 010-0001']), 'emails.ov.{guest@example.test},phone.ilike.%5%5%5%0%1%0%0%0%0%1%');
});

test('a query reads as a phone only when it is digits and phone punctuation', () => {
  assert.equal(phoneQueryDigits('(555) 010-0001'), '5550100001');
  assert.equal(phoneQueryDigits('+1 555 010 0001'), '5550100001');
  assert.equal(phoneQueryDigits('0001'), '0001');
  assert.equal(phoneQueryDigits('12'), '');
  assert.equal(phoneQueryDigits('Smith 555'), '');
});

test('search opens the CRM contact when one matches, else the Guest list record, else nothing', () => {
  const people = gatherPeople(
    [
      { id: 'g1', email: 'crm@example.test', first_name: 'Ada', last_name: 'Lovelace' },
      { id: 'g2', email: 'list@example.test', first_name: 'Grace', last_name: 'Hopper' },
    ],
    [
      // The same person as g2, found by phone: merged by email, carries the phone.
      { email: 'LIST@example.test', phone: '555-010-0002', phone_e164: null, first_name: null, last_name: null, full_name: 'Grace Hopper' },
      // Only in the Helm guests table: reaches the Guest list by email.
      { email: 'direct@example.test', phone: null, phone_e164: '+15550100003', first_name: 'Alan', last_name: 'Turing', full_name: null },
      // No email, no CRM contact, no Guest list record: nothing to open.
      { email: null, phone: '5550100004', phone_e164: null, first_name: 'No', last_name: 'Record', full_name: null },
    ],
  );
  const matches = resolveGuestMatches(
    people,
    [{ id: 'g3', email: 'direct@example.test' }],
    [crm('c1', { emails: ['crm@example.test'] })],
    10,
  );
  assert.deepEqual(matches.map((m) => [m.name, m.href, m.record]), [
    ['Ada Lovelace', '/crm/c1', 'crm'],
    ['Grace Hopper', '/guests/g2', 'guest_list'],
    ['Alan Turing', '/guests/g3', 'guest_list'],
  ]);
  assert.equal(matches[1].phone, '5550100002');
});

test('a guest whose CRM contact the Contacts group already lists is said once', () => {
  const guests = [
    { href: '/crm/c1', name: 'A', email: null, phone: null, record: 'crm' as const },
    { href: '/guests/g1', name: 'B', email: null, phone: null, record: 'guest_list' as const },
  ];
  assert.deepEqual(withoutListedContacts(guests, ['c1']).map((g) => g.href), ['/guests/g1']);
});

test('the two records link each other, and search carries guests on both surfaces', () => {
  const guest = read('src/app/guests/[id]/page.tsx');
  assert.ok(guest.includes('crmContactHrefForGuest(contact.email)'));
  assert.ok(guest.includes('CRM contact →'));
  assert.ok(guest.includes('← Guest list'));
  const contact = read('src/app/crm/[id]/page.tsx');
  assert.ok(contact.includes('guestListHrefForContact(c.emails)'));
  assert.ok(contact.includes('Guest list record →'));
  assert.ok(read('src/lib/search.ts').includes('searchGuests(trimmed, perGroup)'));
  assert.ok(read('src/app/search/page.tsx').includes('searchGuests(q, 20)'));
  assert.ok(read('src/components/UniversalSearch.tsx').includes("group: 'Guests'"));
});

test('every lookup fails quiet and links only pages staff can open', () => {
  const server = read('src/lib/person-record-link-server.ts');
  assert.equal((server.match(/abortSignal\(/g) ?? []).length >= 4, true, 'each read has a deadline');
  assert.equal((server.match(/catch \{/g) ?? []).length, 3, 'each lookup fails quiet');
  const access = read('src/lib/helm-access.ts');
  for (const prefix of ["'/crm'", "'/guests'"]) assert.ok(!access.includes(prefix), `${prefix} stays open to staff`);
});
