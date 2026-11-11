/**
 * Every signed-in page is reachable from the atlas (the 2026-11-07 audit).
 *
 * `src/lib/helm-modules.ts` is the one list the masthead, the More menu and
 * Cmd+K read. A page whose route no module's href covers (by path prefix)
 * can be reached only by a link someone remembered to write, which is how
 * the three /appointments pages went two weeks with no way in but Home.
 * This walks every static `page.tsx` under src/app and asserts a module
 * href, or a `routePrefixes` entry, is a prefix of its route. Hidden modules
 * count: hidden means off the menus, not off the map.
 *
 * Scope: the signed-in app. The token-guarded public surfaces, auth, the
 * API, the puppeteer-rendered deliverables and the redirect-only pages are
 * listed below and left out on purpose.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { HELM_MODULES } from '../helm-modules.ts';

const root = new URL('../../../', import.meta.url);
const read = (repoPath: string): string => readFileSync(new URL(repoPath, root), 'utf8');

/** Every page.tsx under a folder, as repo paths. */
export function listPages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(new URL(dir + '/', root))) {
    const path = `${dir}/${name}`;
    if (statSync(new URL(path, root)).isDirectory()) out.push(...listPages(path));
    else if (name === 'page.tsx') out.push(path);
  }
  return out;
}

/** The URL path a page.tsx serves: route groups "(home)" drop out. */
export function routeOf(page: string): string {
  const route = page
    .replace(/^src\/app/, '')
    .replace(/\/page\.tsx$/, '')
    .split('/')
    .filter((seg) => seg && !/^\(.*\)$/.test(seg))
    .join('/');
  return `/${route}`;
}

/**
 * Outside the signed-in app, so outside this test. Each is a route prefix.
 *
 *  - token-guarded public surfaces: an owner, a guest, a cleaner or a
 *    contractor opens these from a link carrying its own token
 *  - auth and the API: no page a person browses to
 *  - puppeteer-rendered deliverables: a PDF's HTML, never navigated to
 *  - /not-available: where the proxy sends a staff login turned away
 */
export const OUTSIDE_THE_SHELL: string[] = [
  '/onboarding',      // owner intake forms, token in the URL
  '/contract',        // management contract signing, token in the URL
  '/agreement',       // guest rental agreement signing, token in the URL
  '/sign',            // staff document signing, token in the URL
  '/c',               // the cleaner schedule (Rosa's page), token in the URL; /clean redirects here from next.config.ts, no page
  '/b',               // shoot briefs, token in the URL
  '/field',           // the contractor portal, its own session cookie
  '/book',            // the guest booking pages
  '/not-available',   // the proxy's landing for a gated route
  '/auth',            // sign-in
  '/api',             // route handlers
  '/statements/render', // the statement sheet puppeteer prints
  '/projections',     // the prospect deliverables puppeteer prints (/projections itself redirects to /prospects)
];

/** A page that only redirects: it imports redirect() and renders no JSX. */
export function isRedirectOnly(src: string): boolean {
  return /\b(permanentRedirect|redirect)\(/.test(src) && !/<\/|\/>/.test(src);
}

/** Static routes only: a dynamic segment is reached from its parent list. */
export function isStatic(route: string): boolean {
  return !route.includes('[');
}

export function inScope(page: string): boolean {
  const route = routeOf(page);
  if (!isStatic(route)) return false;
  if (OUTSIDE_THE_SHELL.some((p) => route === p || route.startsWith(`${p}/`))) return false;
  if (isRedirectOnly(read(page))) return false;
  return true;
}

/** The path prefixes the atlas claims: each href's path, plus routePrefixes. */
export function atlasPrefixes(): string[] {
  const out = new Set<string>();
  for (const m of HELM_MODULES) {
    if (m.external || m.status === 'soon') continue;
    out.add(m.href.split('?')[0].split('#')[0]);
    for (const p of m.routePrefixes ?? []) out.add(p);
  }
  return [...out];
}

export function covered(route: string, prefixes: string[]): boolean {
  // The home page is the shell's own front door, not a module.
  if (route === '/') return true;
  return prefixes.some((p) => p !== '/' && (route === p || route.startsWith(`${p}/`)));
}

test('every signed-in static page sits under a module href in helm-modules.ts', () => {
  const prefixes = atlasPrefixes();
  const orphans = listPages('src/app')
    .filter(inScope)
    .map(routeOf)
    .filter((route) => !covered(route, prefixes))
    .sort();
  assert.deepEqual(orphans, [], `routes no module reaches: ${orphans.join(', ')}. Add an entry to src/lib/helm-modules.ts (hidden: true keeps it off the menus) or list the route in OUTSIDE_THE_SHELL with a reason.`);
});

test('the exclusions name real routes, so a retired one is noticed', () => {
  // A folder, not a page: /b and /api are route handlers.
  for (const p of OUTSIDE_THE_SHELL) {
    assert.ok(statSync(new URL(`src/app${p}`, root)).isDirectory(), `${p} is excluded but src/app${p} is gone`);
  }
});

test('the appointments pages are on the map', () => {
  const prefixes = atlasPrefixes();
  for (const route of ['/appointments', '/appointments/new']) {
    assert.ok(covered(route, prefixes), `${route} is not covered`);
  }
});
