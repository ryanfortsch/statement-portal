/**
 * Staff documents: offer letters signed online (2026-10-20).
 *
 * The rules that make a signature mean something: the text is fingerprinted
 * when it is sent and the signer can only sign that text; a withdrawn,
 * unsent or already signed document cannot be signed; the typed name is a
 * full name; the letter renders as elements, never injected HTML; and every
 * owner action is an owner action. Same shape as the owner-contract flow.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decodeText,
  inlineRuns,
  isSigningToken,
  newSigningToken,
  normalizeBody,
  parseLetter,
  signatureRefusal,
  signingRefusal,
  staffDocumentDigest,
  staffDocumentFilename,
} from '../staff-documents.ts';
import { OWNER_PATH_PREFIXES, pathRequiresOwner } from '../helm-access.ts';
import { dutyEmails } from '../team-recipients.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

describe('the fingerprint is of the words, not the line endings', () => {
  test('CRLF, trailing space and outer blank lines do not change it', () => {
    const a = 'Dear Delaney,\n\nWe are delighted.';
    const b = '\r\nDear Delaney,  \r\n\r\nWe are delighted.\r\n\r\n';
    assert.equal(staffDocumentDigest(a), staffDocumentDigest(b));
    assert.equal(normalizeBody(b), a);
  });
  test('a changed word changes it', () => {
    assert.notEqual(staffDocumentDigest('$70,000 a year'), staffDocumentDigest('$72,000 a year'));
  });
});

describe('who may sign what', () => {
  const sent = { status: 'sent' as const, body_digest: 'abc' };
  test('a live document with the text the signer saw', () => {
    assert.equal(signingRefusal(sent, 'abc'), null);
  });
  test('the text changed while the page was open', () => {
    assert.match(signingRefusal(sent, 'old') ?? '', /changed/);
  });
  test('withdrawn, unsent and already signed documents cannot be signed', () => {
    assert.match(signingRefusal({ status: 'void', body_digest: 'abc' }, 'abc') ?? '', /withdrawn/);
    assert.match(signingRefusal({ status: 'draft', body_digest: 'abc' }, 'abc') ?? '', /not been sent/);
    assert.match(signingRefusal({ status: 'signed', body_digest: 'abc' }, 'abc') ?? '', /already signed/);
    assert.match(signingRefusal({ status: 'executed', body_digest: 'abc' }, 'abc') ?? '', /already signed/);
  });
  test('a signature is a full name and an agreement', () => {
    assert.equal(signatureRefusal('Delaney Jordan', true), null);
    assert.match(signatureRefusal('Delaney', true) ?? '', /full name/);
    assert.match(signatureRefusal('Delaney Jordan', false) ?? '', /agree/);
  });
});

describe('tokens and filenames', () => {
  test('a new token is 32 hex characters', () => {
    const t = newSigningToken();
    assert.ok(isSigningToken(t));
    assert.notEqual(t, newSigningToken());
    assert.equal(isSigningToken('../etc'), false);
  });
  test('the filename is filesystem-safe and dated once executed', () => {
    assert.equal(
      staffDocumentFilename({ title: 'Offer of Employment: Operations Manager', recipient_name: 'Delaney Jordan' }, '2026-10-27'),
      'Delaney Jordan - Offer of Employment Operations Manager - Executed 2026-10-27.pdf',
    );
  });
});

describe('the letter subset of Markdown', () => {
  const md = [
    '# Offer of Employment: Operations Manager',
    '',
    'Dear Delaney,',
    '',
    "We're delighted to offer you the position.",
    'It starts November 1.',
    '',
    '## Your role',
    '',
    '| | |',
    '| --- | --- |',
    '| **Salary** | $70,000 a year |',
    '| **Time off** | 12 PTO days |',
    '',
    '1. **A 4.98-star average** across our portfolio.',
    '2. Homes that get better.',
    '',
    '- Your phone hours are paid.',
  ].join('\n');
  const blocks = parseLetter(md);
  test('headings, paragraphs, a table, an ordered and a bullet list', () => {
    assert.deepEqual(blocks.map((b) => b.kind), ['heading', 'paragraph', 'paragraph', 'heading', 'table', 'list', 'list']);
  });
  test('wrapped lines join into one paragraph', () => {
    assert.equal((blocks[2] as { text: string }).text, "We're delighted to offer you the position. It starts November 1.");
  });
  test('a table keeps its rows and an empty header', () => {
    const t = blocks[4] as { kind: 'table'; header: string[]; rows: string[][] };
    assert.deepEqual(t.header, ['', '']);
    assert.deepEqual(t.rows[0], ['**Salary**', '$70,000 a year']);
  });
  test('bold runs', () => {
    assert.deepEqual(inlineRuns('**A 4.98-star average** across'), [
      { text: 'A 4.98-star average', bold: true },
      { text: ' across', bold: false },
    ]);
  });
  test('exporter escapes read as the characters they stand for', () => {
    assert.equal(decodeText('Cape Ann.&#32;'), 'Cape Ann. ');
    assert.equal(decodeText('Signature: \\_\\_ Date'), 'Signature: __ Date');
    assert.equal(decodeText('&#99999999;'), '&#99999999;');
  });
  test('text that is not markup stays text', () => {
    assert.deepEqual(parseLetter('<script>alert(1)</script>'), [{ kind: 'paragraph', text: '<script>alert(1)</script>' }]);
  });
});

describe('the gates', () => {
  test('the owner pages are owners only, and in the module atlas as owner', () => {
    assert.ok(OWNER_PATH_PREFIXES.includes('/staff-documents'));
    assert.ok(pathRequiresOwner('/staff-documents/abc'));
    const modules = read('src/lib/helm-modules.ts');
    assert.match(modules, /id: 'staff-documents',[\s\S]{0,700}?access: 'owner'/);
  });
  test('every owner action requires an owner session', () => {
    const src = read('src/app/staff-documents/actions.ts');
    for (const name of ['createStaffDocument', 'updateStaffDocument', 'sendStaffDocument', 'resendSigningLink', 'countersignStaffDocument', 'voidStaffDocument']) {
      const fn = src.match(new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport async function |$)`));
      assert.ok(fn, `${name} not found`);
      assert.ok(fn![0].includes('await requireOwnerEmail()'), `${name} must require an owner`);
    }
  });
  test('only the countersign duty countersigns, and only a signed document', () => {
    const fn = read('src/app/staff-documents/actions.ts').match(/export async function countersignStaffDocument[\s\S]*?(?=\nexport async function |$)/)![0];
    assert.ok(fn.includes("dutyEmails('countersign').includes(by.toLowerCase())"));
    assert.ok(fn.includes(".eq('status', 'signed')"));
    assert.ok(dutyEmails('countersign', '2026-11-01').length >= 1, 'someone holds the countersign duty');
  });
  test('the public sign action checks the token, the text and the status', () => {
    const src = read('src/app/sign/[token]/actions.ts');
    assert.ok(src.includes('isSigningToken(token)'));
    assert.ok(src.includes('signingRefusal(doc, shown)'));
    assert.ok(src.includes(".eq('status', 'sent')"), 'guarded so a double click cannot sign twice');
  });
  test('the signing page and its PDF are public by token; the PDF route checks one', () => {
    const proxy = read('src/proxy.ts');
    assert.ok(proxy.includes('"/sign/",'));
    assert.ok(proxy.includes('"/api/staff-document-pdf",'));
    const route = read('src/app/api/staff-document-pdf/route.ts');
    assert.ok(route.includes('if (!owner && !(token && token === doc.token))'));
  });
  test('the letter never injects HTML', () => {
    assert.ok(!read('src/components/staff-documents/LetterDocument.tsx').includes('dangerouslySetInnerHTML'));
  });
});

describe('the emails speak as the countersigner, whoever presses Send', () => {
  test('From, reply-to and copy all name the countersign duty holder', async () => {
    const { staffDocumentEnvelope } = await import('../staff-document-envelope.ts');
    const env = staffDocumentEnvelope('onboarding@risingtidestr.com');
    const by = dutyEmails('countersign')[0];
    assert.equal(env.replyTo, by);
    assert.deepEqual(env.cc, [by]);
    assert.match(env.fromName, /, Rising Tide$/);
    assert.equal(env.fromEmail, 'onboarding@risingtidestr.com');
  });
  test('the senders use the envelope, not the button presser', () => {
    const src = read('src/lib/staff-document-email.ts');
    assert.ok(!src.includes('senderEmail'), 'no email takes its identity from who pressed Send');
    assert.equal((src.match(/staffDocumentEnvelope\(FROM_EMAIL\)/g) ?? []).length, 2, 'the link and the signed copy both use it');
    const page = read('src/app/staff-documents/[id]/page.tsx');
    assert.ok(page.includes('signingEmailText(doc, signUrl, envelope.signOff)'), 'the page previews the exact words');
  });
});
