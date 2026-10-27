import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createStatementRenderToken, verifyStatementRenderToken } from '../statement-render-token.ts';
import * as tokens from '../statement-render-token.ts';
import { createPropertyDocumentToken } from '../property-document-token.ts';

const secret = 'synthetic-statement-test-secret';
const now = Date.UTC(2026, 9, 26);
const token = createStatementRenderToken('fixture-property', '2026-09', secret, now);

test('statement access is bound to one property, month, purpose and two-minute lifetime', () => {
  const verify = (value: string | null | undefined, id = 'fixture-property', month = '2026-09', time = now) =>
    verifyStatementRenderToken(value, id, month, secret, time);
  assert.equal(verify(token), true);
  assert.equal(verify(token, undefined, undefined, now + 119_000), true);
  assert.equal(verify(token, 'another-property'), false);
  assert.equal(verify(token, undefined, '2026-10'), false);
  assert.equal(verify(token, undefined, undefined, now + 120_000), false);
  assert.equal(verify(token, undefined, undefined, now - 1_000), false);
  assert.equal(verify(createPropertyDocumentToken('fixture-property', 'wifi-placard', secret, now), undefined, 'wifi-placard'), false);
  assert.equal(verifyStatementRenderToken(token, 'fixture-property', '2026-09', 'other-secret', now), false);
});

test('missing configuration, malformed tokens and tampered signatures fail closed', () => {
  const [expires, signature] = token.split('.');
  const forged = `${expires}.${signature[0] === '0' ? '1' : '0'}${signature.slice(1)}`;
  for (const value of [null, undefined, '', 'bad', forged, token + '.extra', token.slice(0, -1), '9'.repeat(5000), `${Number(expires) + 1}.${signature}`]) {
    assert.equal(verifyStatementRenderToken(value, 'fixture-property', '2026-09', secret, now), false);
  }
  assert.throws(() => createStatementRenderToken('id', '2026-09', undefined), /AUTH_SECRET/);
  assert.equal(verifyStatementRenderToken(token, 'fixture-property', '2026-09', undefined, now), false);
});

test('the public render route checks authorization before its first data read', () => {
  const source = readFileSync(new URL('../../app/statements/render/page.tsx', import.meta.url), 'utf8');
  const guard = source.indexOf('await requireStatementRenderAccess(id, month)');
  assert.ok(guard >= 0 && source.indexOf('await supabase.from(') > guard);
  assert.match(source, /data-statement-document="statement"/);
  const auth = readFileSync(new URL('../statement-render-auth.ts', import.meta.url), 'utf8');
  assert.match(auth, /await isOwnerSession\(\)/);
  assert.match(auth, /verifyStatementRenderToken\(token, id, month, process.env.AUTH_SECRET\)/);
  assert.match(auth, /notFound\(\)/);
});

test('the actual render guard admits owners or the exact token and rejects unprivileged requests', async () => {
  const source = readFileSync(new URL('../statement-render-auth.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  let owner = false;
  let header: string | null = null;
  const mocks: Record<string, unknown> = {
    'server-only': {},
    'next/headers': { headers: async () => new Headers(header ? { [tokens.STATEMENT_RENDER_HEADER]: header } : {}) },
    'next/navigation': { notFound: () => { throw new Error('NOT_FOUND'); } },
    './helm-access-server': { isOwnerSession: async () => owner },
    './statement-render-token': tokens,
  };
  const compiled = { exports: {} as { requireStatementRenderAccess?: (id: string, month: string) => Promise<void> } };
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (!(name in mocks)) throw new Error(`Unmocked import ${name}`);
    return mocks[name];
  }, compiled, compiled.exports);
  const guard = () => compiled.exports.requireStatementRenderAccess!('fixture-property', '2026-09');
  const oldSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = secret;
  try {
    await assert.rejects(guard(), /NOT_FOUND/);
    owner = true;
    await guard();
    owner = false;
    header = createStatementRenderToken('fixture-property', '2026-09', secret);
    await guard();
    header = createStatementRenderToken('fixture-property', '2026-10', secret);
    await assert.rejects(guard(), /NOT_FOUND/);
    header = createStatementRenderToken('fixture-property', '2026-09', secret, Date.now() - 120_000);
    await assert.rejects(guard(), /NOT_FOUND/);
    header = 'arbitrary-uuid';
    await assert.rejects(guard(), /NOT_FOUND/);
  } finally {
    if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret;
  }
});
