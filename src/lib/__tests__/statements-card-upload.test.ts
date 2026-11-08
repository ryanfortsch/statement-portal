/**
 * One door each on a statement card (UX audit 2026-11-07, findings 3 and 5).
 *
 * Re-upload data opens the upload form inside the card, the same component
 * /statements/upload renders, so the ingest it sends is one request in one
 * file. A receipt is filed on /statements/receipts (the strip's Add
 * receipt), and a long stay's installment splitter is its own row's link.
 * Reads the source, so the second door cannot come back by accident.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const page = code(read('src/app/statements/page.tsx'));
const form = code(read('src/app/statements/upload/StatementUploadForm.tsx'));
const uploadPage = code(read('src/app/statements/upload/page.tsx'));

test('the card opens the shared upload form in place, with the card month and home', () => {
  assert.match(page, /import \{ StatementUploadForm, type IngestResult \} from '\.\/upload\/StatementUploadForm';/);
  assert.match(page, /<StatementUploadForm\s+initialMonth=\{month\}\s+initialPropertyId=\{prop\.property_id\}\s+embed=\{\{/);
  assert.ok(!page.includes('statementsUploadHref(month, prop.property_id)'), 'the card links away to the upload page again');
  // The route still renders the same form, for old links and a month with no card.
  assert.match(uploadPage, /<StatementUploadForm\s/);
});

test('both hosts send the one ingest request from the one file', () => {
  assert.equal(form.split("formWithFreezeRetry('/api/ingest', formData, ask)").length - 1, 1);
  for (const field of ["'month', month", "'property_id', propertyId", "'guesty_pdf', guestyPDF", "'platform_csv', platformCSV", "'bank_csv', bankCSV"]) {
    assert.ok(form.includes(`formData.append(${field})`), `the form no longer sends ${field}`);
  }
  assert.ok(!page.includes("'/api/ingest'"), 'the dashboard posts an ingest of its own');
  assert.ok(!uploadPage.includes("'/api/ingest'"), 'the upload page posts an ingest of its own');
});

test('a receipt has one door and the splitter one link per stay', () => {
  assert.ok(!page.includes('<ReceiptCapture'), 'the card carries an inline receipt form again');
  assert.match(page, /statementsReceiptsHref\(missingMonth \|\| selectedMonth\)/, 'the strip lost Add receipt');
  assert.ok(!page.includes('Multi-month bookings'), 'the card carries the Multi-month button again');
  assert.match(page, /installment splitter →/, 'the per-row installment link is gone');
});

test('the page keeps no button kit of its own', () => {
  assert.ok(!page.includes('function EditorialButton'), 'the local EditorialButton is back');
  assert.ok(!page.includes('<EditorialButton'), 'a local EditorialButton is rendered again');
});
