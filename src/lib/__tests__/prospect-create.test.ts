/**
 * A prospect is created from two fields, the owner's name and the address
 * (src/lib/prospect-create.ts). The row gets the old create form's
 * untouched defaults, a home value of 0 that keeps it out of the forecast,
 * and a market read from the town.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentPresentationMonth, NEW_PROSPECT_DEFAULTS, newProspectFields, ownersFromName } from '../prospect-create.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-18T15:00:00Z');

describe('owner cards from one typed name', () => {
  test('one owner', () => {
    assert.deepEqual(
      ownersFromName('John Erickson').map((o) => [o.first_name, o.last_name]),
      [['John', 'Erickson']],
    );
  });
  test('a couple sharing a family name', () => {
    assert.deepEqual(
      ownersFromName('John and Mary Erickson').map((o) => [o.first_name, o.last_name]),
      [['John', 'Erickson'], ['Mary', 'Erickson']],
    );
  });
  test('two full names', () => {
    assert.deepEqual(
      ownersFromName('Bethany Giblin & John Gavin').map((o) => [o.first_name, o.last_name]),
      [['Bethany', 'Giblin'], ['John', 'Gavin']],
    );
  });
  test('a middle name stays with the first', () => {
    assert.deepEqual(ownersFromName('Kathleen M. Snyder').map((o) => [o.first_name, o.last_name]), [['Kathleen M.', 'Snyder']]);
  });
  test('blank is nobody', () => {
    assert.deepEqual(ownersFromName('   '), []);
  });
});

describe('the row a two-field create inserts', () => {
  test('the town sets the street, the city and the market', () => {
    const r = newProspectFields({ ownerName: 'John Erickson', address: '12 Atlantic Road, Rockport' }, NOW);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.fields.property_address, '12 Atlantic Road');
    assert.equal(r.fields.property_city, 'Rockport, MA');
    assert.equal(r.fields.market, 'Rockport');
    assert.equal(r.fields.prospect_name, 'John Erickson');
    assert.equal(r.fields.presentation_month, '2026-10');
  });

  test('a street alone is Gloucester', () => {
    const r = newProspectFields({ ownerName: 'A B', address: '84 Thatcher Road' }, NOW);
    assert.equal(r.ok && r.fields.market, 'Gloucester');
    assert.equal(r.ok && r.fields.property_city, 'Gloucester, MA');
  });

  test('born with the old form\'s untouched defaults and no home value', () => {
    const r = newProspectFields({ ownerName: 'A B', address: '84 Thatcher Road' }, NOW);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    for (const [k, v] of Object.entries(NEW_PROSPECT_DEFAULTS)) assert.deepEqual(r.fields[k], v, k);
    assert.equal(r.fields.home_value, 0, 'out of the forecast until someone enters one');
  });

  test('says what is missing', () => {
    const noName = newProspectFields({ ownerName: '', address: '84 Thatcher Road' }, NOW);
    assert.equal(noName.ok, false);
    const noStreet = newProspectFields({ ownerName: 'A B', address: '  ' }, NOW);
    assert.equal(noStreet.ok, false);
  });

  test('the month is Eastern', () => {
    assert.equal(currentPresentationMonth(new Date('2026-11-01T02:00:00Z')), '2026-10');
  });
});

test('the defaults agree with the edit form they stand in for', () => {
  const form = read('src/components/projections/ProjectionForm.tsx');
  const dflt = (name: string) => form.match(new RegExp(`name="${name}"[\\s\\S]*?defaultValue=\\{[^}]*?\\?\\? ([^}]+)\\}`))?.[1]?.trim();
  assert.equal(dflt('bedrooms'), String(NEW_PROSPECT_DEFAULTS.bedrooms));
  assert.equal(dflt('turnovers_per_year'), String(NEW_PROSPECT_DEFAULTS.turnovers_per_year));
  assert.equal(dflt('base_cleaning'), String(NEW_PROSPECT_DEFAULTS.base_cleaning));
  assert.equal(dflt('addl_cleaning_per_br'), String(NEW_PROSPECT_DEFAULTS.addl_cleaning_per_br));
  assert.equal(dflt('start_month'), String(NEW_PROSPECT_DEFAULTS.start_month));
  assert.equal(dflt('initial_deposit'), String(NEW_PROSPECT_DEFAULTS.initial_deposit));
  assert.equal(dflt('min_account_balance'), String(NEW_PROSPECT_DEFAULTS.min_account_balance));
  assert.equal(dflt('min_availability_days'), String(NEW_PROSPECT_DEFAULTS.min_availability_days));
  assert.equal(dflt('sale_notification_days'), String(NEW_PROSPECT_DEFAULTS.sale_notification_days));
  assert.equal(dflt('reputation_fee'), String(NEW_PROSPECT_DEFAULTS.reputation_fee));
});

test('the create page is the two fields, and lands on the workroom with the form open', () => {
  const page = read('src/app/prospects/new/page.tsx');
  assert.doesNotMatch(page, /ProjectionForm/);
  const form = read('src/app/prospects/new/NewProspectForm.tsx');
  const names = [...form.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ['owner_name', 'property_address']);
  assert.match(read('src/app/projections/actions.ts'), /redirect\(`\/prospects\/\$\{data\.id\}\?edit=1#edit`\)/);
});
