import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createPropertyDocumentToken,
  verifyPropertyDocumentToken,
  isProtectedPropertyDocument,
} from '../property-document-token.ts';

const secret = 'synthetic-test-secret-not-a-production-credential';
const now = Date.UTC(2026, 8, 27, 12);
const token = createPropertyDocumentToken('test-house', 'wifi-placard', secret, now);

describe('property document render authorization', () => {
  test('authorizes the requested document within its two-minute lifetime', () => {
    assert.equal(verifyPropertyDocumentToken(token, 'test-house', 'wifi-placard', secret, now), true);
    assert.equal(verifyPropertyDocumentToken(token, 'test-house', 'wifi-placard', secret, now + 119_000), true);
  });

  test('cannot authorize another property or document', () => {
    assert.equal(verifyPropertyDocumentToken(token, 'other-house', 'wifi-placard', secret, now), false);
    assert.equal(verifyPropertyDocumentToken(token, 'test-house', 'home-guide', secret, now), false);
    const guide = createPropertyDocumentToken('test-house', 'home-guide', secret, now);
    assert.equal(verifyPropertyDocumentToken(guide, 'test-house', 'home-guide', secret, now), true);
  });

  test('rejects expiration and a token issued in the future', () => {
    assert.equal(verifyPropertyDocumentToken(token, 'test-house', 'wifi-placard', secret, now + 120_000), false);
    assert.equal(verifyPropertyDocumentToken(token, 'test-house', 'wifi-placard', secret, now - 1_000), false);
  });

  test('rejects forged signatures, extended expiry, and another signing key', () => {
    const [expires, signature] = token.split('.');
    const changed = `${expires}.${signature[0] === '0' ? '1' : '0'}${signature.slice(1)}`;
    assert.equal(verifyPropertyDocumentToken(changed, 'test-house', 'wifi-placard', secret, now), false);
    assert.equal(verifyPropertyDocumentToken(`${Number(expires) + 1}.${signature}`, 'test-house', 'wifi-placard', secret, now + 1_000), false);
    assert.equal(verifyPropertyDocumentToken(token, 'test-house', 'wifi-placard', 'wrong-key', now), false);
  });

  test('missing or malformed tokens fail closed without throwing', () => {
    for (const bad of [null, undefined, '', 'anything', token + '.extra', token.slice(0, -1), token.toUpperCase(), '9'.repeat(5000)]) {
      assert.equal(verifyPropertyDocumentToken(bad, 'test-house', 'wifi-placard', secret, now), false);
    }
  });

  test('missing signing configuration never mints or accepts access', () => {
    assert.throws(() => createPropertyDocumentToken('test-house', 'wifi-placard', undefined, now), /AUTH_SECRET/);
    assert.equal(verifyPropertyDocumentToken(token, 'test-house', 'wifi-placard', undefined, now), false);
  });

  test('only the two credential-bearing document types use this access grant', () => {
    assert.equal(isProtectedPropertyDocument('wifi-placard'), true);
    assert.equal(isProtectedPropertyDocument('home-guide'), true);
    for (const type of ['notice', 'welcome-card', 'info-note', 'wifi-placard/edit', '']) {
      assert.equal(isProtectedPropertyDocument(type), false);
    }
  });
});

// Protect the call sites as well as the token implementation. These pages are
// deliberately allowed through proxy.ts; deleting their guard reopens the leak.
describe('credential-bearing pages guard before data access', () => {
  for (const type of ['wifi-placard', 'home-guide']) {
    test(`${type} authorizes before reading property credentials`, () => {
      const source = readFileSync(new URL(`../../app/properties/[id]/${type}/page.tsx`, import.meta.url), 'utf8');
      const guard = source.indexOf(`await requirePropertyDocumentAccess(id, '${type}')`);
      const read = source.indexOf('await getProperty(id)');
      assert.ok(guard >= 0 && read > guard);
      assert.ok(source.includes(`data-property-document="${type}"`));
    });
  }

  test('PDF downloads require staff before invoking the privileged renderer', () => {
    const source = readFileSync(new URL('../../app/api/property-pdf/route.ts', import.meta.url), 'utf8');
    const guard = source.indexOf('if (!(await auth())?.user)');
    assert.ok(guard >= 0 && source.indexOf('await renderPropertyPdf(') > guard);
    assert.match(source.slice(guard, source.indexOf('try {', guard)), /status: 401/);
  });
});
