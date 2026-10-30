/**
 * A number Helm can already name is not a new number.
 *
 * On 2026-10-19 the New numbers card opened on three people Helm had on
 * file: two owners whose CRM contact held only an email (the Quo address
 * book and the owners registry had their phones) and the incoming
 * operations manager, whose number was on the Field roster. The only check
 * was `contacts.phone`. These pin the resolver's rules with synthetic
 * people, and read the source for the three places that must ask it.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildNumberIndex, nameTokens, type NumberDirectory } from '../known-numbers.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

function directory(patch: Partial<NumberDirectory> = {}): NumberDirectory {
  return {
    contacts: [
      { id: 'c-hale', name: 'The Hale Family', type: 'owner', phone: null, linked_property_ids: ['9_elm'] },
      { id: 'c-vance', name: 'The Vance Family', type: 'owner', phone: null, linked_property_ids: ['4_oak'] },
      { id: 'c-ash', name: 'Robin Ash', type: 'owner', phone: '(978) 555-0100', linked_property_ids: ['2_ash'] },
      { id: 'c-lead', name: 'Pat Lead', type: 'lead', phone: null, linked_property_ids: [] },
    ],
    owners: [
      { id: 'o-hale', name_full: 'The Hale Family', name_greeting: 'Dana and Mark', name_last: 'Hale', phones: [] },
      { id: 'o-vance', name_full: 'The Vance Family', name_greeting: 'Jim', name_last: 'Vance', phones: ['+16175550199'] },
      { id: 'o-ash', name_full: 'Robin Ash', name_greeting: 'Robin and Lee', name_last: 'Ash', phones: [] },
    ],
    properties: [
      { id: '9_elm', owner_id: 'o-hale', owner_full: 'The Hale Family', owner_greeting: 'Dana and Mark', owner_last: 'Hale' },
      { id: '4_oak', owner_id: 'o-vance', owner_full: 'The Vance Family', owner_greeting: 'Jim', owner_last: 'Vance' },
      { id: '2_ash', owner_id: 'o-ash', owner_full: 'Robin Ash', owner_greeting: 'Robin and Lee', owner_last: 'Ash' },
    ],
    field: [{ phone: '(917) 555-0142', name: 'Casey Field' }],
    trades: [{ phone: '978-555-0177', name: 'Harbor Plumbing' }],
    prospects: [{ phone: '+15085550123', name: 'Quinn Prospect' }],
    addressBook: [
      { phone: '+16175550101', name: 'Dana Hale' },
      { phone: '+16175550102', name: 'James Vance' },
      { phone: '+16175550103', name: 'Lee Ash' },
      { phone: '+16175550104', name: 'Sam Nobody' },
    ],
    ...patch,
  };
}

describe('who a number is', () => {
  test('the owners registry names the household it belongs to, in any format', () => {
    const k = buildNumberIndex(directory()).resolve('(617) 555-0199');
    assert.deepEqual(k, { name: 'Jim Vance', source: 'owner', contact: { id: 'c-vance', name: 'The Vance Family', fillsPhone: true }, settled: false });
  });

  test('a Quo name that is unmistakably a household is that household', () => {
    const k = buildNumberIndex(directory()).resolve('+16175550101');
    assert.equal(k?.source, 'quo');
    assert.equal(k?.name, 'Dana Hale');
    assert.deepEqual(k?.contact, { id: 'c-hale', name: 'The Hale Family', fillsPhone: true });
  });

  test('a household that already has a phone keeps it: this number is linked, not made primary', () => {
    const k = buildNumberIndex(directory()).resolve('+16175550103');
    assert.deepEqual(k?.contact, { id: 'c-ash', name: 'Robin Ash', fillsPhone: false });
  });

  test('a name the household does not use is named, never filed: "James" is not "Jim"', () => {
    const k = buildNumberIndex(directory()).resolve('+16175550102');
    assert.deepEqual(k, { name: 'James Vance', source: 'quo', settled: false });
  });

  test('the Field roster and trade vendors are known, and off the card', () => {
    const idx = buildNumberIndex(directory());
    assert.deepEqual(idx.resolve('+19175550142'), { name: 'Casey Field', source: 'field', settled: true });
    assert.deepEqual(idx.resolve('(978) 555-0177'), { name: 'Harbor Plumbing', source: 'trade', settled: true });
  });

  test('a number already on a contact is settled: the queue row is stale', () => {
    const k = buildNumberIndex(directory()).resolve('+19785550100');
    assert.equal(k?.source, 'contact');
    assert.equal(k?.settled, true);
    assert.equal(k?.contact?.id, 'c-ash');
  });

  test('a prospect and a bare address-book name are named and stay on the card', () => {
    const idx = buildNumberIndex(directory());
    assert.deepEqual(idx.resolve('508-555-0123'), { name: 'Quinn Prospect', source: 'prospect', settled: false });
    assert.deepEqual(idx.resolve('+16175550104'), { name: 'Sam Nobody', source: 'quo', settled: false });
    assert.equal(idx.resolve('+12125550000'), null);
    assert.equal(idx.resolve(''), null);
  });

  test('a household beats the Field roster when one number is in both', () => {
    const idx = buildNumberIndex(directory({ field: [{ phone: '+16175550101', name: 'Dana Hale' }] }));
    assert.equal(idx.resolve('+16175550101')?.contact?.id, 'c-hale');
  });

  test('a registry owner whose homes link two owner contacts is nobody', () => {
    const dir = directory();
    dir.contacts.push({ id: 'c-vance-2', name: 'Jim Vance', type: 'owner', phone: null, linked_property_ids: ['4_oak'] });
    assert.deepEqual(buildNumberIndex(dir).resolve('+16175550199'), { name: 'Jim Vance', source: 'owner', settled: false });
  });
});

describe('the strict name rule', () => {
  test('name words drop the filler a household name carries', () => {
    assert.deepEqual(nameTokens("The O'Hale Family"), ['ohale']);
    assert.deepEqual(nameTokens('Marci & Paul Bailey'), ['marci', 'paul', 'bailey']);
    assert.deepEqual(nameTokens(null), []);
  });

  test('one word is not a name', () => {
    const dir = directory({ addressBook: [{ phone: '+16175550105', name: 'Dana' }] });
    assert.deepEqual(buildNumberIndex(dir).resolve('+16175550105'), { name: 'Dana', source: 'quo', settled: false });
  });

  test('two households that both fit is no answer', () => {
    const dir = directory();
    dir.contacts.push({ id: 'c-hale-2', name: 'Dana Hale', type: 'owner', phone: null, linked_property_ids: [] });
    assert.equal(buildNumberIndex(dir).resolve('+16175550101')?.contact, undefined);
  });

  test('only owner contacts are households', () => {
    const dir = directory({ addressBook: [{ phone: '+16175550106', name: 'Pat Lead' }] });
    assert.equal(buildNumberIndex(dir).resolve('+16175550106')?.contact, undefined);
  });
});

describe('the three places that ask', () => {
  const ingest = read('src/lib/quo-ingest.ts');

  test('the webhook files a household number onto the household before it calls anyone new', () => {
    const find = ingest.slice(ingest.indexOf('async function findContactByPhone'), ingest.indexOf('async function householdForPhone'));
    assert.ok(find.includes('return householdForPhone(phone);'), 'the contact lookup falls back to the household');
    assert.ok(find.includes('selectAllPaged<ContactRow>'), 'the contact lookup is read whole, never capped at 1000');
    const household = ingest.slice(ingest.indexOf('async function householdForPhone'));
    assert.ok(household.includes('cachedNumberIndex()'), 'the household comes from the shared resolver');
    assert.ok(household.includes('fillContactPhone(contact.id, phone)'), 'an empty household phone is filled');
  });

  test('the Field roster and trade vendors are never captured as new numbers', () => {
    const capture = ingest.slice(ingest.indexOf('export async function captureUnknownInbound'));
    assert.ok(capture.indexOf('?.settled) return;') > -1, 'capture asks the resolver first');
    assert.ok(capture.indexOf('?.settled) return;') < capture.indexOf(".from('quo_unknown_numbers')"), 'before it writes');
  });

  test('the replay after Attach reads every event for the number, not the first 1000 of all of them', () => {
    const backfill = ingest.slice(ingest.indexOf('export async function backfillTouchesForPhone'), ingest.indexOf('// ── Handlers'));
    assert.ok(backfill.includes('selectAllPaged<{ payload: QuoEventEnvelope }>'), 'paged');
    assert.ok(backfill.includes('payload->data->object->>from.ilike.*${target}*'), 'narrowed to the number');
    assert.ok(backfill.includes(".order('id')"), 'a stable page order');
  });

  test('a household phone is filled only when empty, and the guard is on the write', () => {
    const server = read('src/lib/known-numbers-server.ts');
    const fill = server.slice(server.indexOf('export async function fillContactPhone'));
    assert.ok(fill.includes(".is('phone', null)"), 'fill-empty only');
  });

  test('the card drops what is settled and names the rest', () => {
    const triage = read('src/lib/number-triage.ts');
    assert.ok(triage.includes('!index.resolve(u.phone)?.settled'), 'settled numbers leave the card');
    assert.ok(triage.includes('return !known?.settled && !known?.contact;'), 'an address-book row for a known household folds');
    assert.ok(triage.includes('knownByPhone,'), 'the names reach the card');
    const card = read('src/components/messaging/NumberTriage.tsx');
    assert.ok(card.includes("attachSel[phone] ?? knownByPhone[phone]?.contactId ?? contactSuggestions[phone]?.contact.id ?? ''"), 'the household is picked');
    assert.ok(card.includes('initialName={knownByPhone[promote.phone]?.name}'), 'New contact opens named');
  });

  test('the sweep runs after the address-book pass, nightly and on Refresh', () => {
    const route = read('src/app/api/sync-quo-contacts/route.ts');
    assert.ok(route.indexOf('await attachKnownNumbers()') > route.indexOf('await runReconcile()'), 'tonight\'s names first');
    const sweep = read('src/lib/known-numbers-sweep.ts');
    assert.ok(sweep.includes(".eq('status', 'pending');"), 'a decided row is never re-filed');
    assert.ok(sweep.includes('backfillTouchesForPhone(phone)'), 'the conversation follows the number');
  });
});
