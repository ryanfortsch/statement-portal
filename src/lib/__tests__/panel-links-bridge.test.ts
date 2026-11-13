import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * A stay change charged on the Send lens's panel reaches the concierge
 * (2026-11-13). Before this, only links the concierge minted itself ran its
 * paid sweep, so an extra night charged here stayed on sale, Guesty's checkout
 * notice named the old day and no corrected one was queued. The concierge
 * reads ?panel_links=1 (stay-concierge panel_links.py); these keep the read
 * to the panel's own live links, behind the bridge header.
 */

const lib = readFileSync(new URL('../payment-links.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../app/api/payment-links/route.ts', import.meta.url), 'utf8');

const reader = lib.slice(lib.indexOf('export async function listPanelLinks'));
const body = reader.slice(0, reader.indexOf('\n}\n'));

test('the read is the panel\'s own live links', () => {
  assert.match(body, /\.eq\('source', 'helm'\)/);
  assert.match(body, /\.is\('deactivated_at', null\)/);
  assert.match(body, /\.gte\('created_at', cutoff\)/);
  assert.match(body, /\.order\('created_at'/, 'a bare select caps silently and an offset needs an order');
});

test('a failed read is null, never an empty list', () => {
  assert.match(body, /if \(error\) return null;/);
  assert.match(body, /catch \{\s*return null;/);
});

test('the bridge answers it only behind the concierge header', () => {
  const header = route.indexOf("req.headers.get('x-stay-concierge-key') !== expected");
  const branch = route.indexOf("searchParams.get('panel_links')");
  assert.ok(header > 0 && branch > header, 'the panel_links branch sits behind the header check');
  assert.ok(!/searchParams\.get\('key'\)/.test(route), 'never a secret in the query string');
});
