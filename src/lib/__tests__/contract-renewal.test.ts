/**
 * A renewal draft is prefilled from the managed property and its last
 * register row (src/lib/contract-renewal.ts, used by startContractRenewal).
 * 16 Waterman's renewal (2026-10-19) printed "Gloucester, MA, MA" in the
 * contract's address, and its first form save dropped the LLC from the
 * contract party. These pin both, end to end through the contract's own
 * template vars and the register row countersign writes. It also opened
 * without the last agreement's ten negotiated edits; a renewal now carries
 * them, and the draft says where they came from.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  carriedRedlines,
  cityAndState,
  renewalCarriedFrom,
  renewalOwners,
  renewalPlace,
  type PriorAgreement,
} from '../contract-renewal.ts';
import { buildTemplateVars, changedContractTerms, type ContractTermsSource } from '../contract-terms.ts';
import { registerTermsFromProjection } from '../contract-register.ts';
import { deriveLegacyFromOwners, type Owner } from '../projections-types.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** The body of one function, up to the next top-level export. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const card = (first: string, last: string, full_legal: string | null = null): Owner => ({
  first_name: first,
  last_name: last,
  email: null,
  phone: null,
  full_legal,
});

const PARTY = 'Jane Marsh, Harbor Holdings, LLC';

/** A renewal draft's contract columns, the way the payload fills them. */
function draft(owners: Owner[], propertyCity: string): ContractTermsSource {
  return {
    ...deriveLegacyFromOwners(owners),
    property_address: '16 Waterman Street',
    property_city: renewalPlace(propertyCity).property_city,
    property_type: 'House',
    mgmt_fee_pct: 0.25,
    initial_deposit: 2000,
    min_account_balance: 2000,
    min_availability_days: 270,
    sale_notification_days: 185,
    reputation_fee: 5000,
    term_start: '2026-10-19',
    term_end: '2027-12-31',
    contract_overrides: null,
    custom_clauses: null,
  };
}

describe('the town and state from a stored city', () => {
  test('a city that already carries the state', () => {
    assert.deepEqual(cityAndState('Gloucester, MA'), { city: 'Gloucester', state: 'MA' });
  });
  test('an already-doubled state', () => {
    assert.deepEqual(cityAndState('Gloucester, MA, MA'), { city: 'Gloucester', state: 'MA' });
  });
  test('a zip after the state', () => {
    assert.deepEqual(cityAndState('Beverly, MA 01915'), { city: 'Beverly', state: 'MA' });
  });
  test('a state with no comma', () => {
    assert.deepEqual(cityAndState('Rockport MA'), { city: 'Rockport', state: 'MA' });
  });
  test('a town alone is in Massachusetts', () => {
    assert.deepEqual(cityAndState('Rockport'), { city: 'Rockport', state: 'MA' });
  });
  test('a hyphenated town keeps its name', () => {
    assert.deepEqual(cityAndState('Manchester-by-the-Sea, MA'), { city: 'Manchester-by-the-Sea', state: 'MA' });
  });
  test('blank is Gloucester', () => {
    assert.deepEqual(cityAndState(null), { city: 'Gloucester', state: 'MA' });
    assert.deepEqual(cityAndState('  '), { city: 'Gloucester', state: 'MA' });
  });
});

describe('the renewal draft names the place once', () => {
  test('the contract address prints the state once', () => {
    const v = buildTemplateVars(draft([card('Jane', 'Marsh')], 'Gloucester, MA'));
    assert.equal(v.propertyAddress, '16 Waterman Street, Gloucester, MA');
  });
  test('the market reads the town, not the town and state', () => {
    assert.deepEqual(renewalPlace('Rockport, MA'), { property_city: 'Rockport, MA', market: 'Rockport' });
    assert.deepEqual(renewalPlace('Beverly, MA'), { property_city: 'Beverly, MA', market: 'Beverly' });
    assert.deepEqual(renewalPlace('Gloucester, MA'), { property_city: 'Gloucester, MA', market: 'Gloucester' });
  });
});

describe('the contract party survives the first form save', () => {
  const llcParty = () =>
    renewalOwners({
      owners: [card('Jane', 'Marsh')],
      registerParty: PARTY,
      ownerFull: 'Jane Marsh',
      ownerLast: 'Marsh',
      email: 'jane@example.com',
      phone: null,
    });

  test('the first card carries the register party', () => {
    const { owners, party } = llcParty();
    assert.equal(party, PARTY);
    assert.equal(owners[0].full_legal, PARTY);
    assert.equal(owners[0].first_name, 'Jane');
    assert.equal(owners[0].last_name, 'Marsh');
  });

  test('a save re-derives the same party, and the contract and register name it', () => {
    // A form save is deriveLegacyFromOwners over the cards it posts back,
    // full_legal included (parseOwners in src/app/projections/actions.ts).
    const { owners } = llcParty();
    const saved = draft(structuredClone(owners), 'Gloucester, MA');
    assert.equal(saved.prospect_full_legal, PARTY);
    assert.equal(buildTemplateVars(saved).ownerName, PARTY);
    assert.equal(registerTermsFromProjection(saved).owner_party, PARTY);
  });

  test('a card that already has a legal name keeps it', () => {
    const { owners } = renewalOwners({
      owners: [card('Jane', 'Marsh', 'Jane R. Marsh, Trustee')],
      registerParty: PARTY,
      ownerFull: null,
      ownerLast: null,
      email: null,
      phone: null,
    });
    assert.equal(owners[0].full_legal, 'Jane R. Marsh, Trustee');
  });

  test('only the first named card is seeded, past a blank one', () => {
    const { owners } = renewalOwners({
      owners: [card('', ''), card('Jane', 'Marsh'), card('Sam', 'Marsh')],
      registerParty: PARTY,
      ownerFull: null,
      ownerLast: null,
      email: null,
      phone: null,
    });
    assert.deepEqual(owners.map((o) => o.full_legal), [null, PARTY, null]);
    assert.equal(deriveLegacyFromOwners(owners).prospect_full_legal, PARTY);
  });

  test('the property row is not changed in place', () => {
    const cards = [card('Jane', 'Marsh')];
    renewalOwners({ owners: cards, registerParty: PARTY, ownerFull: null, ownerLast: null, email: null, phone: null });
    assert.equal(cards[0].full_legal, null);
  });

  test('with no register row, the cards are the party', () => {
    const { owners, party } = renewalOwners({
      owners: [card('Jane', 'Marsh')],
      registerParty: null,
      ownerFull: 'Jane Marsh',
      ownerLast: 'Marsh',
      email: null,
      phone: null,
    });
    assert.equal(party, 'Jane Marsh');
    assert.equal(owners[0].full_legal, null);
    assert.equal(deriveLegacyFromOwners(owners).prospect_full_legal, 'Jane Marsh');
  });

  test('with no owner cards, one card is made from the party', () => {
    const { owners } = renewalOwners({
      owners: null,
      registerParty: PARTY,
      ownerFull: null,
      ownerLast: null,
      email: 'jane@example.com',
      phone: '+19785550100',
    });
    assert.deepEqual(owners, [
      { first_name: 'Jane', last_name: 'Marsh', email: 'jane@example.com', phone: '+19785550100', full_legal: PARTY },
    ]);
    assert.equal(deriveLegacyFromOwners(owners).prospect_full_legal, PARTY);
  });

  test('owner cards with no names count as none', () => {
    const { owners } = renewalOwners({
      owners: [card('', '')],
      registerParty: null,
      ownerFull: 'Ann Lowell',
      ownerLast: 'Lowell',
      email: null,
      phone: null,
    });
    assert.equal(owners.length, 1);
    assert.equal(owners[0].first_name, 'Ann');
    assert.equal(deriveLegacyFromOwners(owners).prospect_full_legal, 'Ann Lowell');
  });
});

describe('startContractRenewal prefills through the helper', () => {
  const body = fnBody(read('src/app/projections/actions.ts'), 'startContractRenewal');

  test('the city goes through renewalPlace and never gets ", MA" appended', () => {
    assert.match(body, /\.\.\.renewalPlace\(property\.city\)/);
    assert.doesNotMatch(body, /,\s*MA`/);
  });

  test('the party comes from the cards, not a scalar laid over them', () => {
    assert.match(body, /renewalOwners\(\{/);
    assert.doesNotMatch(body, /prospect_full_legal:/);
  });
});

const meta = {
  ownerAsk: 'Owner asked for it',
  ourPosition: 'accept' as const,
  positionDetail: '',
  reviewPriority: 'normal' as const,
  sensitiveSection: false,
};
const EDITS = [
  { action: 'replace', targetId: 'notice', newText: 'Sixty days for the first year, then 120.', meta },
  { action: 'delete', targetId: 'linens', meta },
];
const RIDER = [{ title: 'Cleaning', body: 'Cleaning is a pass-through.' }];

const prior = (over: Partial<PriorAgreement> = {}): PriorAgreement => ({
  id: 'prior-projection',
  contract_countersigned_at: '2026-05-22T16:04:00.000Z',
  contract_overrides: EDITS,
  custom_clauses: null,
  ...over,
});
const helmRow = { signed_via: 'helm', executed_on: '2026-05-22' };

describe('a renewal carries the last agreement\'s edits', () => {
  test('the redlines come over, as copies, and the draft says where from', () => {
    const r = carriedRedlines(prior(), helmRow);
    assert.deepEqual(r.contract_overrides, EDITS);
    assert.notEqual(r.contract_overrides, EDITS, 'a copy, not the prior row\'s array');
    assert.equal(r.custom_clauses, null);
    assert.deepEqual(r.carried_from, {
      projection_id: 'prior-projection',
      countersigned_at: '2026-05-22T16:04:00.000Z',
      edits: 2,
    });
  });

  test('the draft renders the same edits the owner signed', () => {
    const r = carriedRedlines(prior(), helmRow);
    const renewal = { ...draft([card('Jane', 'Marsh')], 'Gloucester, MA'), contract_overrides: r.contract_overrides };
    const signed = { ...renewal, contract_overrides: EDITS };
    assert.deepEqual(changedContractTerms(signed, renewal), []);
  });

  test('a legacy Rider comes over and counts when there are no redlines', () => {
    const r = carriedRedlines(prior({ contract_overrides: null, custom_clauses: RIDER }), helmRow);
    assert.deepEqual(r.custom_clauses, RIDER);
    assert.equal(r.carried_from?.edits, 1);
  });

  test('with both, the count is the redlines, the Rider still comes over', () => {
    const r = carriedRedlines(prior({ custom_clauses: RIDER }), helmRow);
    assert.deepEqual(r.custom_clauses, RIDER);
    assert.equal(r.carried_from?.edits, 2);
  });

  test('a plain agreement carries nothing and says nothing', () => {
    const none = { contract_overrides: null, custom_clauses: null, carried_from: null };
    assert.deepEqual(carriedRedlines(prior({ contract_overrides: [], custom_clauses: [] }), helmRow), none);
    assert.deepEqual(carriedRedlines(null, helmRow), none);
  });

  test('an agreement never executed in Helm carries nothing', () => {
    assert.equal(carriedRedlines(prior({ contract_countersigned_at: null }), null).carried_from, null);
  });

  test('paper signed outside Helm after it wins: the older edits stay behind', () => {
    const docusign = { signed_via: 'docusign', executed_on: '2026-07-31' };
    assert.deepEqual(carriedRedlines(prior(), docusign).contract_overrides, null);
    const olderPaper = { signed_via: 'external', executed_on: '2025-06-05' };
    assert.equal(carriedRedlines(prior(), olderPaper).carried_from?.edits, 2);
    assert.equal(carriedRedlines(prior(), null).carried_from?.edits, 2, 'no register row');
  });
});

describe('the draft reads where its edits came from', () => {
  test('a renewal draft\'s import_source', () => {
    const carried = carriedRedlines(prior(), helmRow).carried_from;
    const source = { kind: 'renewal', property_id: '16_waterman', from_contract_id: null, drafted_at: '2026-10-19', carried_from: carried };
    assert.deepEqual(renewalCarriedFrom(source), carried);
  });

  test('anything else is no note', () => {
    assert.equal(renewalCarriedFrom(null), null);
    assert.equal(renewalCarriedFrom({ kind: 'renewal', carried_from: null }), null, 'a renewal drafted before carrying');
    assert.equal(renewalCarriedFrom({ source: 'gmail_inquiry', gmail_message_id: 'x', mailbox: 'y' }), null);
    assert.equal(renewalCarriedFrom({ kind: 'renewal', carried_from: { projection_id: 'p', countersigned_at: 'd', edits: 0 } }), null);
    assert.equal(renewalCarriedFrom({ kind: 'renewal', carried_from: { projection_id: 7, countersigned_at: 'd', edits: 2 } }), null);
  });
});

describe('startContractRenewal carries the edits and the page says so', () => {
  const body = fnBody(read('src/app/projections/actions.ts'), 'startContractRenewal');

  test('the last agreement is the newest projection executed in Helm for this home', () => {
    assert.match(body, /\.from\('projections'\)\s*\.select\('id, contract_countersigned_at, contract_overrides, custom_clauses'\)\s*\.eq\('property_id', propertyId\)\s*\.not\('contract_countersigned_at', 'is', null\)\s*\.order\('contract_countersigned_at', \{ ascending: false \}\)/);
    assert.match(body, /if \(priorErr\) throw/, 'a failed read stops the draft');
  });

  test('the draft takes the edits and records where they came from', () => {
    assert.match(body, /contract_overrides: redlines\.contract_overrides,/);
    assert.match(body, /custom_clauses: redlines\.custom_clauses,/);
    assert.match(body, /carried_from: redlines\.carried_from,/);
  });

  test('the Contract panel prints the line', () => {
    const page = read('src/app/prospects/[id]/page.tsx');
    assert.match(page, /const carried = renewalCarriedFrom\(projection\.import_source\)/);
    assert.match(page, /carried over from\{' '\}/);
  });
});
