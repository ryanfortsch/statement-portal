/**
 * The guest documents share one screen-only header bar, and each property
 * tool has one name (UI/UX audit 2026-10-17, Properties Phase 3; appendix 05
 * structural problems 4 and 5).
 *
 * The bar has two rules a later edit can break without any test noticing:
 * it must never print (the Puppeteer PDF renders print media, and the posted
 * card carries nothing but itself), and on a self-guarded document it must
 * render only after the access check, so a denied request shows nothing.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const DOCUMENTS: Array<[string, string]> = [
  ['home-guide', 'Home guide'],
  ['welcome-card', 'Welcome card'],
  ['wifi-placard', 'Wi-Fi placard'],
  ['info-note', 'Information note'],
  ['trash-notice', 'Trash day notice'],
];

test('the bar never prints', () => {
  const bar = read('src/components/properties/GuestDocumentBar.tsx');
  assert.match(bar, /@media print \{\s*\.rt-doc-bar \{ display: none !important; \}/);
  assert.match(bar, /Back/);
  assert.match(bar, /<PrintDocumentButton \/>/);
  assert.match(bar, /label="Download PDF"/);
});

test('every guest document mounts the bar under one name, the tab title the same', () => {
  for (const [slug, name] of DOCUMENTS) {
    const src = read(`src/app/properties/[id]/${slug}/page.tsx`);
    assert.ok(src.includes(`documentName="${name}" type="${slug}"`), `${slug} does not mount the bar as "${name}"`);
    assert.ok(src.includes(`export const metadata = { title: '${name}' };`), `${slug} tab title is not "${name}"`);
  }
});

test('a self-guarded document mounts the bar only after its access check', () => {
  for (const slug of ['home-guide', 'wifi-placard']) {
    const src = read(`src/app/properties/[id]/${slug}/page.tsx`);
    const guard = src.indexOf(`await requirePropertyDocumentAccess(id, '${slug}')`);
    const bar = src.indexOf('<GuestDocumentBar');
    assert.ok(guard > 0 && bar > guard, `${slug}: the bar renders before the access check`);
  }
});

test('the PDF file, the tile and the bar share each document name', () => {
  const pdf = read('src/lib/property-pdf.ts');
  const page = read('src/app/properties/[id]/page.tsx');
  for (const [slug, name] of DOCUMENTS) {
    assert.ok(pdf.includes(`'${slug}': '${name}'`), `${slug} downloads under another name`);
    assert.ok(page.includes(`\n              ${name}\n            </h3>`) || page.includes(`\n                ${name}\n              </h3>`), `the ${name} tile is titled otherwise`);
  }
});

test('each tool has one name on its tile, breadcrumb and page title', () => {
  const page = read('src/app/properties/[id]/page.tsx');
  const tools: Array<[string, string, RegExp]> = [
    ['caption-photos', 'Photo captions', /Photo <em[^>]*>captions<\/em>/],
    ['sync-guesty', 'Guesty fields', /Guesty <em[^>]*>fields<\/em>/],
  ];
  for (const [slug, name, h1] of tools) {
    const src = read(`src/app/properties/[id]/${slug}/page.tsx`);
    assert.ok(page.includes(`title="${name}"`), `the ${slug} tile is not "${name}"`);
    assert.ok(src.includes(`{ label: '${name}' }`), `the ${slug} breadcrumb is not "${name}"`);
    assert.match(src, h1, `the ${slug} title is not "${name}"`);
  }
  // Guesty fields is one screen for both directions, and says so.
  assert.match(page, /eyebrow="Helm ⇄ Guesty"\s*\n\s*title="Guesty fields"/);
  assert.ok(page.includes('<ToolLink href={`/properties/${p.id}/sync-guesty`}>Guesty fields</ToolLink>'));
  // Launch is the 26-step list; the Stay Cape Ann tool is not also a launch.
  assert.ok(read('src/app/properties/[id]/stay-cape-ann/page.tsx').includes("{ label: 'Stay Cape Ann' }"));
});
