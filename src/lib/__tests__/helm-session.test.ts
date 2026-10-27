import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { hasHelmSession } from '../helm-session.ts';
import * as access from '../helm-access.ts';

// Execute the real proxy with Auth.js and HTTP response boundaries isolated.
const output = ts.transpileModule(readFileSync(new URL('../../proxy.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const compiled = { exports: {} as { default?: (req: unknown) => Response | undefined } };
const mocks: Record<string, unknown> = {
  '@/auth': { auth: (fn: unknown) => fn },
  '@/lib/helm-session': { hasHelmSession },
  '@/lib/helm-access': access,
  'next/server': { NextResponse: { json: Response.json, redirect: (url: URL, status = 307) => Response.redirect(url, status) } },
};
new Function('require', 'module', 'exports', output)((name: string) => {
  if (!(name in mocks)) throw new Error(`Unmocked import ${name}`);
  return mocks[name];
}, compiled, compiled.exports);
const request = (path: string, auth: unknown) => {
  const url = new URL(path, 'https://helm.risingtidestr.com');
  return { auth, cookies: { get: () => undefined }, nextUrl: Object.assign(url, { clone: () => new URL(url) }) };
};

test('truthy auth errors and malformed identities cannot open pages or APIs', () => {
  for (const value of [null, {}, { error: 'Configuration' }, { user: {} }, { user: { email: '' } }, { user: { email: 'external@example.com' } }, { user: { email: 123 } }, { error: 'Configuration', user: { email: 'staff@risingtidestr.com' } }]) {
    assert.equal(hasHelmSession(value), false);
    const page = compiled.exports.default!(request('/work', value));
    assert.equal(page?.status, 307);
    assert.match(page!.headers.get('location')!, /auth\/signin/);
    assert.equal(compiled.exports.default!(request('/api/team-activity', value))?.status, 401);
  }
});

test('valid staff sessions retain operations access and remain barred from owner money', () => {
  const session = { user: { email: 'staff@risingtidestr.com' } };
  assert.equal(compiled.exports.default!(request('/work', session)), undefined);
  assert.equal(compiled.exports.default!(request('/api/team-activity', session)), undefined);
  assert.equal(compiled.exports.default!(request('/api/statement-pdf', session))?.status, 403);
});
