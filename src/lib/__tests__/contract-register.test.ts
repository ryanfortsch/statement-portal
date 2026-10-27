/**
 * The contracts register's writing rules (src/lib/contract-register.ts):
 * a Helm agreement's terms come from the signed contract and a posted form
 * cannot move them; the form fills only what the contract leaves blank;
 * an off-roster home never prints as its id.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  driveFileIdFromUrl,
  executedRegisterRow,
  lastKnownName,
  parseRegisterForm,
  registerTermsFromProjection,
  RENEWAL_WORDS,
} from '../contract-register.ts';

const SIGNED = {
  prospect_full_legal: 'John A. Erickson',
  prospect_name: 'John Erickson',
  mgmt_fee_pct: 0.22,
  term_start: '2026-11-01',
  term_end: '2027-12-31',
  min_availability_days: 270,
  sale_notification_days: 90,
  reputation_fee: 5000,
  contract_overrides: null,
  custom_clauses: null,
};

const FORM = {
  owner_party: 'Someone Else',
  executed_on: '2026-10-20',
  term_start: '2025-01-01',
  term_end: '2025-12-31',
  renewal_type: 'auto_renew',
  notice_days_initial: '120',
  notice_days_renewal: '',
  fee_pct: '30',
  signed_via: 'external',
  drive_url: 'https://drive.google.com/file/d/1sEYQ-KIXBaHI7tsN5wiYQi1Pu3BphgRi/view',
  notes: '',
};

describe('a Helm agreement registers the terms the owner signed', () => {
  test('the contract states the fee as a whole percent, the term and the sale clause', () => {
    assert.deepEqual(registerTermsFromProjection(SIGNED), {
      owner_party: 'John A. Erickson',
      term_start: '2026-11-01',
      term_end: '2027-12-31',
      fee_pct: 22,
      min_availability: '270 days during the term',
      sale_notice_days: 90,
      sale_reputation_fee: 5000,
    });
  });

  test('a posted fee, party or term does not move a locked term', () => {
    const r = parseRegisterForm(FORM, registerTermsFromProjection(SIGNED));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.fields.fee_pct, 22);
    assert.equal(r.fields.owner_party, 'John A. Erickson');
    assert.equal(r.fields.term_start, '2026-11-01');
    assert.equal(r.fields.term_end, '2027-12-31');
    // What the contract does not state still comes from the form.
    assert.equal(r.fields.executed_on, '2026-10-20');
    assert.equal(r.fields.notice_days_initial, 120);
    assert.equal(r.fields.notice_days_renewal, 120, 'a blank later window keeps the first');
  });

  test('a term the contract leaves blank is filled from the form', () => {
    const r = parseRegisterForm(FORM, registerTermsFromProjection({ ...SIGNED, term_start: null }));
    assert.equal(r.ok && r.fields.term_start, '2025-01-01');
  });
});

describe('paper signed outside Helm', () => {
  test('reads every field from the form', () => {
    const r = parseRegisterForm(FORM, null);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.fields.fee_pct, 30);
    assert.equal(r.fields.owner_party, 'Someone Else');
    assert.equal(r.fields.signed_via, 'external');
  });

  test('says what is wrong in a sentence', () => {
    const bad = (patch: Partial<typeof FORM>) => {
      const r = parseRegisterForm({ ...FORM, ...patch }, null);
      return r.ok ? null : r.error;
    };
    assert.match(bad({ owner_party: '' }) ?? '', /owner party/);
    assert.match(bad({ term_end: '' }) ?? '', /term end/);
    assert.match(bad({ term_start: '2026-01-01' }) ?? '', /starts after it ends/);
    assert.match(bad({ renewal_type: 'forever' }) ?? '', /renews/);
    assert.match(bad({ fee_pct: '250' }) ?? '', /percent/);
    assert.match(bad({ notice_days_initial: '12.5' }) ?? '', /whole number/);
    assert.match(bad({ drive_url: 'drive.google.com/x' }) ?? '', /https/);
  });

  test('a fixed term carries no notice window', () => {
    const r = parseRegisterForm({ ...FORM, renewal_type: 'fixed' }, null);
    assert.equal(r.ok && r.fields.notice_days_initial, null);
  });
});

test('the Drive file id comes out of a share or view link', () => {
  assert.equal(driveFileIdFromUrl(FORM.drive_url), '1sEYQ-KIXBaHI7tsN5wiYQi1Pu3BphgRi');
  assert.equal(driveFileIdFromUrl('https://drive.google.com/open?id=1sEYQ-KIXBaHI7tsN5wiYQi1Pu3BphgRi'), '1sEYQ-KIXBaHI7tsN5wiYQi1Pu3BphgRi');
  assert.equal(driveFileIdFromUrl('https://example.com/contract.pdf'), null);
  assert.equal(driveFileIdFromUrl(null), null);
});

test('an off-roster home prints its last known name, never its id', () => {
  assert.equal(lastKnownName('4_brier_neck', { dbName: '4 Brier Neck' }), '4 Brier Neck');
  assert.equal(lastKnownName('4_brier_neck', { dbName: null, rosterName: '4 Brier' }), '4 Brier');
  assert.equal(lastKnownName('4_brier_neck', {}), '4 Brier Neck');
});

test('every renewal word has one plain line and no em dash', () => {
  for (const { word, meaning } of Object.values(RENEWAL_WORDS)) {
    assert.ok(word && meaning);
    assert.doesNotMatch(`${word} ${meaning}`, /\u2014/);
  }
});

describe('an agreement executed in Helm registers itself', () => {
  const opts = {
    propertyId: '47_atlantic',
    executedOn: '2026-10-15',
    driveUrl: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view',
    docTitle: null,
    note: 'Registered automatically.',
  };

  test('the row is active, signed in Helm, and carries the signed terms', () => {
    const row = executedRegisterRow(SIGNED, opts);
    assert.ok(row);
    assert.equal(row.property_id, '47_atlantic');
    assert.equal(row.status, 'active');
    assert.equal(row.signed_via, 'helm');
    assert.equal(row.fee_pct, 22);
    assert.equal(row.term_end, '2027-12-31');
    assert.equal(row.executed_on, '2026-10-15');
    assert.equal(row.drive_file_id, '1AbCdEfGhIjKlMnOp');
    assert.equal(row.notes, 'Registered automatically.');
  });

  test('a redlined contract is flagged for a read-through', () => {
    const row = executedRegisterRow({ ...SIGNED, custom_clauses: [{ title: 'Rider', body: 'Extra terms.' }] }, opts);
    assert.match(row?.notes ?? '', /Clause overrides are on file/);
  });

  test('no term end, no row: the register cannot hold one', () => {
    assert.equal(executedRegisterRow({ ...SIGNED, term_end: null }, opts), null);
  });

  // A new owner countersigns before the home exists, so countersign has
  // nothing to register against. Promote is the moment; without it every
  // new home opened on "Operating with no live contract".
  test('promote and countersign both write the register from the builder', () => {
    const src = readFileSync(new URL('../../app/projections/actions.ts', import.meta.url), 'utf8');
    const promote = src.slice(src.indexOf('export async function promoteToProperty'));
    const promoteBody = promote.slice(0, promote.indexOf('\nasync function pickPropertyId'));
    assert.match(promoteBody, /contract_countersigned_at && !projRow\.contract_marked_done_at/);
    assert.match(promoteBody, /executedRegisterRow\(/);
    assert.match(promoteBody, /from\('property_contracts'\)\.insert\(row\)/);
    const countersign = src.slice(src.indexOf('export async function countersignContract'));
    assert.match(countersign, /executedRegisterRow\(/);
  });
});
