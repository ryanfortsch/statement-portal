/**
 * The management contract's e-signature record.
 *
 * Three things have to hold, and each is spread thin enough to lose:
 *
 *   1. A signed contract's terms are locked. The contract is re-rendered
 *      from the projections row on every view, so an edit after signing
 *      used to rewrite the contract under the owner's signature. The lock
 *      compares exactly what the contract renders, which only works while
 *      the renderer and the lock share one builder.
 *   2. Each signature keeps a sealed copy: the PDF bytes Helm emailed, with
 *      their SHA-256. The certificate states a fingerprint only when one
 *      exists (it once claimed a "document hash" nothing computed).
 *   3. The countersign records who did it, and only an owner login may.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  changedContractTerms,
  contractTermsDigest,
  contractTermsLocked,
  countersignerName,
  LEGACY_COUNTERSIGNER_NAME,
  type ContractTermsSource,
} from '../contract-terms.ts';
import { deriveLegacyFromOwners } from '../projections-types.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** The body of one exported function, up to the next top-level export. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const SIGNED: ContractTermsSource = {
  prospect_full_legal: 'John A. Erickson',
  prospect_name: 'John Erickson',
  property_address: '12 Atlantic Road',
  property_city: 'Gloucester, MA',
  property_type: 'House',
  mgmt_fee_pct: 0.25,
  initial_deposit: 2000,
  min_account_balance: 2000,
  min_availability_days: 270,
  sale_notification_days: 90,
  reputation_fee: 5000,
  term_start: '2026-11-01',
  term_end: '2027-10-31',
  contract_overrides: null,
  custom_clauses: null,
};

describe('the lock compares what the contract says', () => {
  test('a form save that keeps every term changes nothing', () => {
    // What buildPayload hands back for an untouched form: the fee entered
    // as 25 becomes 0.25, money arrives as numbers, an empty Rider as null.
    assert.deepEqual(changedContractTerms(SIGNED, { ...SIGNED, mgmt_fee_pct: 25 / 100, custom_clauses: null }), []);
    assert.deepEqual(changedContractTerms({ ...SIGNED, custom_clauses: [] }, SIGNED), []);
  });

  test('a changed term is named', () => {
    assert.deepEqual(changedContractTerms(SIGNED, { ...SIGNED, mgmt_fee_pct: 0.22 }), ['Management fee']);
    assert.deepEqual(changedContractTerms(SIGNED, { ...SIGNED, initial_deposit: 0 }), ['Initial deposit']);
    assert.deepEqual(changedContractTerms(SIGNED, { ...SIGNED, term_end: '2028-10-31' }), ['Term end']);
    assert.deepEqual(changedContractTerms(SIGNED, { ...SIGNED, property_address: '14 Atlantic Road' }), ['Property address']);
  });

  test('a fee that prints the same but is not the same is still held', () => {
    // 25.4% prints "25%", but the register and the property row read the
    // raw number at countersign and promote.
    assert.deepEqual(changedContractTerms(SIGNED, { ...SIGNED, mgmt_fee_pct: 0.254 }), ['Management fee']);
  });

  test('adding a co-owner leaves the contract alone; renaming the signer does not', () => {
    const one = deriveLegacyFromOwners([
      { first_name: 'John', last_name: 'Erickson', email: null, phone: null, full_legal: 'John A. Erickson' },
    ]);
    const two = deriveLegacyFromOwners([
      { first_name: 'John', last_name: 'Erickson', email: 'j@example.com', phone: null, full_legal: 'John A. Erickson' },
      { first_name: 'Mary', last_name: 'Erickson', email: null, phone: null, full_legal: null },
    ]);
    const base = { ...SIGNED, ...one };
    assert.deepEqual(changedContractTerms(base, { ...base, ...two }), []);
    const renamed = deriveLegacyFromOwners([
      { first_name: 'Jon', last_name: 'Erickson', email: null, phone: null, full_legal: null },
    ]);
    assert.deepEqual(changedContractTerms(base, { ...base, ...renamed }), ['Owner name']);
  });

  test('redline edits are terms; the legacy Rider only while it renders', () => {
    const edits = [{ action: 'delete', targetId: 'sale-protection' }];
    assert.deepEqual(changedContractTerms(SIGNED, { ...SIGNED, contract_overrides: edits }), ['Contract edits']);
    const rider = [{ title: 'Dock', body: 'The dock is excluded.' }];
    assert.deepEqual(changedContractTerms(SIGNED, { ...SIGNED, custom_clauses: rider }), ['Rider clauses']);
    // With overrides in place the Rider page does not render, so editing
    // its hidden text changes nothing the owner signed.
    const withEdits = { ...SIGNED, contract_overrides: edits };
    assert.deepEqual(changedContractTerms(withEdits, { ...withEdits, custom_clauses: rider }), []);
  });

  test('locked exactly while an owner signature is on file', () => {
    assert.equal(contractTermsLocked({ contract_signed_at: null }), false);
    assert.equal(contractTermsLocked({ contract_signed_at: '2026-10-15T14:00:00Z' }), true);
  });
});

describe('the owner signs the terms they were shown', () => {
  test('the digest moves with a term and only with a term', () => {
    assert.equal(contractTermsDigest(SIGNED), contractTermsDigest({ ...SIGNED, custom_clauses: [] }));
    assert.notEqual(contractTermsDigest(SIGNED), contractTermsDigest({ ...SIGNED, reputation_fee: 2500 }));
  });

  test('the signing form carries it and the signature checks it', () => {
    const page = read('src/app/contract/[token]/page.tsx');
    assert.match(page, /name="terms_digest" value=\{termsDigest\}/);
    const body = fnBody(read('src/app/projections/actions.ts'), 'submitContractSignature');
    assert.match(body, /shownDigest !== contractTermsDigest\(/);
    assert.ok(
      body.indexOf('shownDigest !==') < body.indexOf('contract_signed_at: new Date()'),
      'the check runs before the signature is written',
    );
  });
});

describe('the renderer and the lock share one builder', () => {
  test('ContractDocument imports buildTemplateVars and keeps no copy of its own', () => {
    const doc = read('src/components/projections/ContractDocument.tsx');
    assert.match(doc, /import \{[^}]*buildTemplateVars[^}]*\} from '@\/lib\/contract-terms'/);
    assert.doesNotMatch(doc, /function buildTemplateVars\(/);
  });
});

describe('every writer of contract terms honours the lock', () => {
  const actions = read('src/app/projections/actions.ts');

  test('the prospect form holds changed terms on a signed contract', () => {
    const body = fnBody(actions, 'updateProjection');
    assert.match(body, /changedContractTerms\(/);
    assert.match(body, /contractTermsLocked\(/);
    assert.match(body, /\.is\('contract_signed_at', null\)/, 'the term-changing write must not race a signature');
  });

  // Each checks the signature before doing anything; the two that write
  // also filter the write itself, so a signature landing mid-action wins.
  const guards: [string, RegExp, boolean][] = [
    ['proposeContractRedlines', /if \(contractTermsLocked\(data as ProjectionRow\)\) return \{ ok: false, error: CONTRACT_LOCKED_MESSAGE \}/, false],
    ['applyContractRedlines', /if \(contractTermsLocked\(data as ProjectionRow\)\) return \{ ok: false, error: CONTRACT_LOCKED_MESSAGE \}/, true],
    ['resetContractOverrides', /if \(await isContractSigned\(id\)\) return \{ ok: false, error: CONTRACT_LOCKED_MESSAGE \}/, true],
  ];
  for (const [name, check, writes] of guards) {
    test(`${name} refuses a signed contract`, () => {
      const body = fnBody(actions, name);
      assert.match(body, check);
      if (writes) assert.match(body, /\.is\('contract_signed_at', null\)/);
    });
  }

  test('withdrawing a signature is owners-only, before countersign, and keeps the record', () => {
    const body = fnBody(actions, 'withdrawOwnerSignature');
    assert.match(body, /requireOwnerEmail\(\)/);
    assert.match(body, /contract_signature_history:/);
    assert.match(body, /\.is\('contract_countersigned_at', null\)/);
    assert.doesNotMatch(body, /storage[\s\S]*remove\(/, 'a withdrawn signature keeps its sealed copy');
  });
});

describe('each signature keeps a sealed copy', () => {
  const actions = read('src/app/projections/actions.ts');

  test('signing seals the owner-signed PDF and emails the same bytes', () => {
    const body = fnBody(actions, 'submitContractSignature');
    assert.match(body, /sealContractCopy\(\{[^}]*kind: 'signed'/);
    assert.match(body, /contract_signed_pdf_sha256: seal\.sha256/);
    assert.match(body, /sendOwnerSignedEmail\(\{[\s\S]*?pdf: signedPdf/);
  });

  test('countersign seals the executed PDF', () => {
    const body = fnBody(actions, 'countersignContract');
    assert.match(body, /sealContractCopy\(\{[^}]*kind: 'executed'/);
    assert.match(body, /contract_executed_pdf_sha256: seal\.sha256/);
  });

  test('the download refuses a copy that no longer matches its fingerprint', () => {
    const route = read('src/app/api/contracts/sealed/route.ts');
    assert.match(route, /sha256Hex\(pdf\) !== sha/);
    assert.match(route, /role !== 'owner'/);
  });

  test('the certificate claims a fingerprint only when one is stored', () => {
    const doc = read('src/components/projections/ContractDocument.tsx');
    assert.doesNotMatch(doc, /user-agent, document hash/);
    assert.match(doc, /\{signedCopySha && \(/);
  });
});

describe('the countersign names who signed', () => {
  test('owner login required, and the email is recorded', () => {
    const body = fnBody(read('src/app/projections/actions.ts'), 'countersignContract');
    assert.match(body, /const countersignerEmail = await requireOwnerEmail\(\)/);
    assert.match(body, /contract_countersigned_by: countersignerEmail/);
  });

  test('the name comes from the roster; older rows keep Allie, who signed them', () => {
    assert.equal(countersignerName('ryan@risingtidestr.com'), 'Ryan Fortsch');
    assert.equal(countersignerName('RYAN@risingtidestr.com'), 'Ryan Fortsch');
    assert.equal(countersignerName(null), LEGACY_COUNTERSIGNER_NAME);
    assert.equal(LEGACY_COUNTERSIGNER_NAME, "Allie O'Brien");
  });

  test('the contract no longer hardcodes Allie on the PM row or the certificate', () => {
    const doc = read('src/components/projections/ContractDocument.tsx');
    assert.doesNotMatch(doc, /printedName="Allie O'Brien/);
    assert.doesNotMatch(doc, /<strong>Allie O&rsquo;Brien<\/strong>, Rising Tide STR, LLC/);
  });
});
