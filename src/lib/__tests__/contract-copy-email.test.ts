/**
 * A sealed contract copy that never reached the owner says so, and can be sent.
 *
 * Both signature actions email the copy they seal and only log when the
 * send is skipped; with no prospect_email on the row that was every time
 * (47 Atlantic, 2026-10-15: signed, countersigned, sealed and archived,
 * neither email sent, nothing on the page). Three things have to hold:
 *
 *   1. Each copy pairs with the right stamp. The owner-signed copy's is
 *      contract_owner_email_sent_at, not a *_signed_* name, and the page
 *      and the send action must agree on it.
 *   2. The send action is owners-only, attaches the sealed bytes after
 *      re-checking their fingerprint (never a re-render), and stamps only
 *      after a send. The email helpers keep their other failure reasons.
 *   3. The owner's email can be set without touching a locked term, the
 *      owner card the form derives it from moves with it, and the page
 *      warns under the sign link while there is none.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTRACT_COPY_COLUMNS,
  NO_OWNER_EMAIL_WARNING,
  contractCopyStatus,
  contractCopyStatuses,
  isContractCopyKind,
  ownerEmailOnRecord,
  ownersWithEmail,
  parseOwnerEmail,
  type ContractCopyRow,
} from '../contract-copy-email.ts';
import { deriveLegacyFromOwners, type Owner } from '../projections-types.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** The body of one exported function, up to the next top-level export. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf('\nexport ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

/** Both markers present, `first` ahead of `second`. A missing marker fails, never passes by -1. */
function assertBefore(src: string, first: string, second: string, why: string): void {
  const a = src.indexOf(first);
  const b = src.indexOf(second);
  assert.ok(a >= 0, `${first} not found`);
  assert.ok(b >= 0, `${second} not found`);
  assert.ok(a < b, why);
}

/** 47 Atlantic as it sat on 2026-10-15: both copies sealed, neither emailed. */
const ATLANTIC: ContractCopyRow = {
  prospect_email: null,
  contract_signed_pdf_path: '5373a935/signed-2026-10-15T14-02-11-000Z.pdf',
  contract_signed_pdf_sha256: 'a'.repeat(64),
  contract_executed_pdf_path: '5373a935/executed-2026-10-15T15-40-03-000Z.pdf',
  contract_executed_pdf_sha256: 'b'.repeat(64),
  contract_owner_email_sent_at: null,
  contract_executed_email_sent_at: null,
};

describe('each copy pairs with its own stamp', () => {
  test('the owner-signed copy reads contract_owner_email_sent_at; the executed copy its own', () => {
    assert.equal(CONTRACT_COPY_COLUMNS.signed.sentAtColumn, 'contract_owner_email_sent_at');
    assert.equal(CONTRACT_COPY_COLUMNS.signed.pathColumn, 'contract_signed_pdf_path');
    assert.equal(CONTRACT_COPY_COLUMNS.signed.shaColumn, 'contract_signed_pdf_sha256');
    assert.equal(CONTRACT_COPY_COLUMNS.executed.sentAtColumn, 'contract_executed_email_sent_at');
    assert.equal(CONTRACT_COPY_COLUMNS.executed.pathColumn, 'contract_executed_pdf_path');
    assert.equal(CONTRACT_COPY_COLUMNS.executed.shaColumn, 'contract_executed_pdf_sha256');
  });

  test('47 Atlantic: two sealed copies, neither emailed', () => {
    const statuses = contractCopyStatuses(ATLANTIC);
    assert.deepEqual(statuses.map((s) => [s.kind, s.emailedAt]), [['signed', null], ['executed', null]]);
    assert.equal(statuses[0].path, ATLANTIC.contract_signed_pdf_path);
    assert.equal(statuses[0].sha256, ATLANTIC.contract_signed_pdf_sha256);
    assert.equal(statuses[1].label, 'Executed copy');
  });

  test('a stamp shows on its own copy and not the other', () => {
    const sent = { ...ATLANTIC, contract_executed_email_sent_at: '2026-10-16T12:00:00Z' };
    assert.equal(contractCopyStatus(sent, 'signed')?.emailedAt, null);
    assert.equal(contractCopyStatus(sent, 'executed')?.emailedAt, '2026-10-16T12:00:00Z');
  });

  test('a copy is offered only with both its path and its fingerprint', () => {
    assert.deepEqual(contractCopyStatuses({ ...ATLANTIC, contract_executed_pdf_sha256: null }).map((s) => s.kind), ['signed']);
    assert.deepEqual(contractCopyStatuses({ ...ATLANTIC, contract_signed_pdf_path: null }).map((s) => s.kind), ['executed']);
    assert.equal(contractCopyStatus({ ...ATLANTIC, contract_executed_pdf_path: null }, 'executed'), null);
    // Signed before Helm sealed copies: nothing to send.
    assert.deepEqual(
      contractCopyStatuses({ ...ATLANTIC, contract_signed_pdf_path: null, contract_signed_pdf_sha256: null, contract_executed_pdf_path: null, contract_executed_pdf_sha256: null }),
      [],
    );
  });

  test('only the two kinds are kinds', () => {
    assert.equal(isContractCopyKind('signed'), true);
    assert.equal(isContractCopyKind('executed'), true);
    assert.equal(isContractCopyKind('withdrawn'), false);
    assert.equal(isContractCopyKind(null), false);
  });
});

describe('the owner email on record', () => {
  test('null, empty and blank are all none; a typed address is kept as typed, trimmed', () => {
    assert.equal(ownerEmailOnRecord({ prospect_email: null }), null);
    assert.equal(ownerEmailOnRecord({ prospect_email: '' }), null);
    assert.equal(ownerEmailOnRecord({ prospect_email: '   ' }), null);
    assert.equal(ownerEmailOnRecord({ prospect_email: ' jre@amg.com ' }), 'jre@amg.com');
  });

  test('the editor accepts an address and nothing else', () => {
    assert.equal(parseOwnerEmail(' jre@amg.com '), 'jre@amg.com');
    assert.equal(parseOwnerEmail('jre'), null);
    assert.equal(parseOwnerEmail('jre@amg'), null);
    assert.equal(parseOwnerEmail('j re@amg.com'), null);
    assert.equal(parseOwnerEmail(''), null);
    assert.equal(parseOwnerEmail(null), null);
  });

  test('the first named owner card moves with it, so the next form save keeps it', () => {
    const owners: Owner[] = [
      { first_name: '', last_name: '', email: null, phone: null, full_legal: null },
      { first_name: 'John', last_name: 'Erickson', email: null, phone: '978-555-0100', full_legal: 'John A. Erickson' },
      { first_name: 'Mary', last_name: 'Erickson', email: 'mary@example.com', phone: null, full_legal: null },
    ];
    const next = ownersWithEmail(owners, 'jre@amg.com');
    assert.ok(next);
    assert.equal(next[1].email, 'jre@amg.com');
    assert.equal(next[1].phone, '978-555-0100', 'the rest of the card is untouched');
    assert.equal(next[2].email, 'mary@example.com', 'other owners are untouched');
    assert.equal(deriveLegacyFromOwners(next).prospect_email, 'jre@amg.com');
    assert.notEqual(next, owners, 'a new array, never a mutation');
    assert.equal(owners[1].email, null);
  });

  test('with no owner cards there is nothing to keep in step', () => {
    assert.equal(ownersWithEmail(null, 'jre@amg.com'), null);
    assert.equal(ownersWithEmail([], 'jre@amg.com'), null);
    assert.equal(ownersWithEmail([{ first_name: '', last_name: '', email: null, phone: null, full_legal: null }], 'jre@amg.com'), null);
  });
});

describe('the send action', () => {
  const body = fnBody(read('src/app/projections/actions.ts'), 'sendContractCopy');

  test('is owners-only, like countersign and the sealed download', () => {
    assert.match(body, /await requireOwnerEmail\(\)/);
  });

  test('attaches the sealed bytes after re-checking their fingerprint, and never re-renders', () => {
    assert.match(body, /readSealedCopy\(copy\.path\)/);
    assertBefore(body, 'sha256Hex(pdf) !== copy.sha256', 'sendOwnerSignedEmail(', 'the check runs before the send');
    assert.doesNotMatch(body, /fetchContractPdf\(/);
    assert.match(body, /sendExecutedEmail\(/);
  });

  test('stamps the copy\'s own column, only after the send', () => {
    assert.match(body, /\[copy\.sentAtColumn\]: new Date\(\)\.toISOString\(\)/);
    assertBefore(body, 'if (!result.ok)', '[copy.sentAtColumn]', 'a failed send stamps nothing');
  });

  test('a copy with no owner email on record is refused, not sent nowhere', () => {
    assert.match(body, /ownerEmailOnRecord\(projection\)/);
    assert.match(body, /no owner email on record/);
  });
});

describe('the email helpers keep their other reasons', () => {
  const src = read('src/lib/contract-email.ts');
  for (const reason of ['no prospect_email on projection', 'pdf fetch failed', 'resend send failed']) {
    test(`both copy emails still report '${reason}'`, () => {
      assert.equal(src.split(`reason: '${reason}'`).length - 1, 2);
    });
  }
});

describe('the owner email can be set without touching a locked term', () => {
  const body = fnBody(read('src/app/projections/actions.ts'), 'setProspectEmail');

  test('writes the address, the owner card and updated_at, nothing the contract renders', () => {
    assert.match(body, /prospect_email: email/);
    assert.match(body, /ownersWithEmail\(/);
    assert.match(body, /updated_at: new Date\(\)\.toISOString\(\)/);
    assert.doesNotMatch(
      body,
      /prospect_name|prospect_full_legal|property_address|property_city|property_type|mgmt_fee_pct|initial_deposit|min_account_balance|min_availability_days|sale_notification_days|reputation_fee|term_start|term_end|contract_overrides|custom_clauses/,
    );
    assert.doesNotMatch(body, /contractTermsLocked|CONTRACT_LOCKED_MESSAGE/, 'the lock has no say over a contact detail');
  });

  test('refuses anything that is not an address', () => {
    assert.match(body, /parseOwnerEmail\(formData\.get\('email'\)\)/);
    assert.match(body, /owner_email=invalid/);
  });
});

describe('the prospect page', () => {
  const page = read('src/app/prospects/[id]/page.tsx');

  test('says which copy never emailed and offers to send it', () => {
    assert.match(page, /contractCopyStatuses\(projection\)/);
    assert.match(page, /Not emailed to the owner/);
    assert.match(page, /<form action=\{sendContractCopy\}/);
    assert.match(page, /<SendCopyButton resend=\{!!c\.emailedAt\}/);
  });

  test('warns under the sign link while the row has no owner email, with the editor beside it', () => {
    assert.match(page, /\{NO_OWNER_EMAIL_WARNING\}/);
    assert.match(page, /action=\{setProspectEmail\}/);
    assertBefore(page, '<OwnerEmailRow', '<LinkRow link={link} />', 'the warning sits above the sign link');
    assert.equal(NO_OWNER_EMAIL_WARNING.includes('will not email'), true);
  });
});
