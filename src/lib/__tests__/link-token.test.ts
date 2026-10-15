import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanLinkToken } from '../link-token.ts';

const TOKEN = '70f913d30e679cf0197555a666999a16';

test('a clean token passes through unchanged', () => {
  assert.equal(cleanLinkToken(TOKEN), TOKEN);
});

test('punctuation glued on by a mail client is stripped', () => {
  // The 2026-10-15 case: Gmail linkified "<token>–" (en dash, no space).
  assert.equal(cleanLinkToken(`${TOKEN}–`), TOKEN);
  assert.equal(cleanLinkToken(`${TOKEN}%E2%80%93`), TOKEN);
  assert.equal(cleanLinkToken(`${TOKEN}—`), TOKEN);
  assert.equal(cleanLinkToken(`${TOKEN}-`), TOKEN);
  assert.equal(cleanLinkToken(`${TOKEN}.`), TOKEN);
  assert.equal(cleanLinkToken(`${TOKEN},`), TOKEN);
  assert.equal(cleanLinkToken(`${TOKEN})`), TOKEN);
  assert.equal(cleanLinkToken(`${TOKEN}%29`), TOKEN);
});

test('anything that is not a token up front is rejected', () => {
  assert.equal(cleanLinkToken(''), null);
  assert.equal(cleanLinkToken(null), null);
  assert.equal(cleanLinkToken(undefined), null);
  assert.equal(cleanLinkToken(TOKEN.slice(0, 31)), null);
  assert.equal(cleanLinkToken(`${TOKEN}a`), null, 'a 33rd hex digit is a different string, not glued punctuation');
  assert.equal(cleanLinkToken(TOKEN.toUpperCase()), null);
  assert.equal(cleanLinkToken(`-${TOKEN}`), null);
  assert.equal(cleanLinkToken('%'), null);
});

test('the contract and onboarding pages resolve their token through cleanLinkToken', () => {
  // Guard: the whole point is that BOTH hand-pasted owner links survive a
  // glued dash. A page that goes back to a bare regex test silently loses it.
  const root = join(import.meta.dirname, '..', '..');
  for (const page of ['app/contract/[token]/page.tsx', 'app/onboarding/[token]/page.tsx']) {
    const src = readFileSync(join(root, page), 'utf8');
    assert.match(src, /cleanLinkToken\(/, `${page} must resolve its token via cleanLinkToken`);
    assert.match(src, /redirect\(/, `${page} must redirect a glued token to the clean path`);
  }
});
