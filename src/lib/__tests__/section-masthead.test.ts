/**
 * Every page under a section the atlas names carries the Helm masthead
 * (the 2026-11-07 audit).
 *
 * The shell is one component, `HelmMasthead`. A section mounts it once in
 * its `layout.tsx` (Work, Growth, Appointments) or each page mounts it
 * itself (Home, the older sections). A page that does neither renders as a
 * bare document with no way back, which is how the three /appointments
 * pages shipped. This reads each in-scope page and the layouts above it and
 * asserts one of them names HelmMasthead. The root layout renders no
 * masthead on purpose (the public surfaces share it), so it does not count.
 *
 * Scope and exclusions are atlas-coverage.test.ts's (the signed-in app,
 * minus the token-guarded public surfaces, auth, the API, the deliverables
 * and the redirect-only pages), widened to dynamic routes: a home, a slip or
 * a contact is a page people read all day. Render and print routes under a
 * dynamic id are documents puppeteer prints and are left out. A page that
 * carries the shell some other way is allow-listed below with the reason,
 * not restyled to pass.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { atlasPrefixes, covered, isRedirectOnly, listPages, OUTSIDE_THE_SHELL, routeOf } from './atlas-coverage.test.ts';

const root = new URL('../../../', import.meta.url);
const read = (repoPath: string): string => readFileSync(new URL(repoPath, root), 'utf8');

/**
 * Pages that carry the shell without naming HelmMasthead themselves or in
 * a layout above them. Each line says how the shell gets there. Empty is
 * the goal; a line here is a known gap, not a licence.
 */
export const SHELL_BY_OTHER_MEANS: Record<string, string> = {};

/** The route with its dynamic tail cut off: /work/[id] reads as /work. */
function staticPrefix(route: string): string {
  return route.replace(/\/\[.*$/, '') || '/';
}

/**
 * Documents, not pages in the shell: what puppeteer renders to PDF or the
 * operator prints with Cmd+P. Each is a route with its dynamic segments as
 * written in src/app.
 */
export const PRINTED_DOCUMENTS: string[] = [
  // The guest deliverables a home prints (PROPERTY_DELIVERABLE_RE in
  // src/proxy.ts lets puppeteer through to them).
  '/properties/[id]/home-guide',
  '/properties/[id]/wifi-placard',
  '/properties/[id]/info-note',
  '/properties/[id]/welcome-card',
  '/properties/[id]/trash-notice',
  '/properties/[id]/notice/[noticeId]', // a bespoke 4 x 6 Stay Cape Ann notice
  '/properties/trash-notices',          // the fleet's fridge cards as one print stack
  '/fieldwork/rate-card',               // the Reel rate card one-pager, printed to PDF
  '/fieldwork/hiring-package',          // the contributor hiring package, a document sent out
];

/** A document puppeteer prints, not a page in the shell. */
function isDocument(route: string): boolean {
  return /\/(render|print)$/.test(route) || PRINTED_DOCUMENTS.includes(route);
}

export function inShellScope(page: string): boolean {
  const route = routeOf(page);
  const prefix = staticPrefix(route);
  if (OUTSIDE_THE_SHELL.some((p) => prefix === p || prefix.startsWith(`${p}/`))) return false;
  if (isDocument(route)) return false;
  if (isRedirectOnly(read(page))) return false;
  return covered(prefix, atlasPrefixes());
}

/** The layout.tsx files between src/app (exclusive) and the page's folder. */
export function layoutsAbove(page: string): string[] {
  const parts = page.split('/'); // src, app, <section>, ..., page.tsx
  const out: string[] = [];
  for (let depth = 3; depth < parts.length; depth++) {
    const layout = `${parts.slice(0, depth).join('/')}/layout.tsx`;
    if (existsSync(new URL(layout, root))) out.push(layout);
  }
  return out;
}

/** A JSX mount of the masthead, not just the name in an import or a comment. */
const MOUNTS = /<HelmMasthead\b/;

export function mountsMasthead(page: string): boolean {
  if (MOUNTS.test(read(page))) return true;
  return layoutsAbove(page).some((layout) => MOUNTS.test(read(layout)));
}

test('the root layout renders no masthead (the public surfaces share it)', () => {
  assert.ok(!read('src/app/layout.tsx').includes('HelmMasthead'));
});

test('every page under an atlas section mounts HelmMasthead, in a layout or itself', () => {
  const bare = listPages('src/app')
    .filter(inShellScope)
    .filter((page) => !mountsMasthead(page) && !(page in SHELL_BY_OTHER_MEANS))
    .sort();
  assert.deepEqual(bare, [], `pages with no masthead: ${bare.join(', ')}. Add a layout.tsx that mounts HelmMasthead (see src/app/work/layout.tsx), or list the page in SHELL_BY_OTHER_MEANS with how the shell gets there.`);
});

test('the allow-list names real pages that still lack a masthead of their own', () => {
  for (const page of Object.keys(SHELL_BY_OTHER_MEANS)) {
    assert.ok(existsSync(new URL(page, root)), `${page} is allow-listed but gone`);
    assert.ok(!mountsMasthead(page), `${page} mounts the masthead now; drop it from the allow-list`);
  }
});

test('the printed documents are real routes, so a retired one is noticed', () => {
  const routes = new Set(listPages('src/app').map(routeOf));
  for (const doc of PRINTED_DOCUMENTS) assert.ok(routes.has(doc), `${doc} is listed as a document but no page.tsx serves it`);
});

test('the appointments section mounts the masthead in its layout', () => {
  assert.ok(read('src/app/appointments/layout.tsx').includes('<HelmMasthead />'));
  for (const page of ['src/app/appointments/page.tsx', 'src/app/appointments/new/page.tsx', 'src/app/appointments/[id]/page.tsx']) {
    assert.ok(inShellScope(page), `${page} is in scope`);
    assert.ok(mountsMasthead(page), `${page} carries the shell`);
  }
});
