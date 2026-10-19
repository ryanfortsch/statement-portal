/**
 * A renewal draft is prefilled from the managed property and its last
 * register row (src/lib/contract-renewal.ts, used by startContractRenewal).
 * 16 Waterman's renewal (2026-10-19) printed "Gloucester, MA, MA" in the
 * contract's address, and its first form save dropped the LLC from the
 * contract party. These pin both, end to end through the contract's own
 * template vars and the register row countersign writes.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityAndState, renewalOwners, renewalPlace } from '../contract-renewal.ts';
import { buildTemplateVars, type ContractTermsSource } from '../contract-terms.ts';
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
