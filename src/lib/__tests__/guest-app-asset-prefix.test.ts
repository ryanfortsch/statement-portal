import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * staycapeann.com serves the guest app by forwarding /h/* and /helm-assets/*
 * to Helm (its next.config.js). That only works while three things here
 * agree on the prefix Helm's JS and CSS load from:
 *
 *   - next.config.ts sets it as assetPrefix;
 *   - src/proxy.ts keeps the sign-in gate off it, or every page (the sign-in
 *     page included) loads its stylesheet through a redirect;
 *   - the guest app's service worker caches files under it, or the offline
 *     copy of a guide has no styles.
 */
const root = join(import.meta.dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const config = read('next.config.ts');
const prefix = /assetPrefix:\s*'([^']+)'/.exec(config)?.[1];

test('next.config.ts sets a path-only asset prefix', () => {
  assert.ok(prefix, 'assetPrefix is set');
  assert.match(prefix!, /^\/[a-z-]+$/, 'a path on the same host, so staycapeann.com can forward it');
});

test('the proxy never gates the prefixed static files', () => {
  const proxy = read('src/proxy.ts');
  const matcher = /matcher:\s*\[\s*"([^"]+)"/.exec(proxy)?.[1] ?? '';
  assert.ok(matcher.includes(`${prefix!.slice(1)}/_next/static`), matcher);
  assert.ok(matcher.includes('(?!_next/static'), 'the unprefixed path stays excluded for old tabs');
});

test('the guest app service worker caches the prefixed static files', () => {
  const sw = read('src/app/h/sw.js/route.ts');
  assert.ok(sw.includes(`url.pathname.startsWith('${prefix}/_next/static/')`), 'isStatic covers the prefix');
});
