import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as access from '../helm-access.ts';
import { hasHelmSession } from '../helm-session.ts';
import * as authResume from '../auth-resume.ts';
import {
  RESUME_COOLDOWN_MS,
  clientKind,
  describeSignInRequest,
  isWorkspaceEmail,
  safeCallbackPath,
  shouldResumeSignIn,
} from '../auth-resume.ts';

const src = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-10T15:00:00Z');

test('resumes only for a Workspace address, with no error and no recent attempt', () => {
  const base = { hint: 'delaney@risingtidestr.com', error: null, lastAttemptAt: null, now: NOW };
  assert.equal(shouldResumeSignIn(base), true);
  assert.equal(shouldResumeSignIn({ ...base, hint: null }), false);
  assert.equal(shouldResumeSignIn({ ...base, hint: 'someone@gmail.com' }), false);
  assert.equal(shouldResumeSignIn({ ...base, hint: 'x@risingtidestr.com.evil.com' }), false);
  // Google said no: the page shows the button, never a second silent try.
  assert.equal(shouldResumeSignIn({ ...base, error: 'OAuthCallbackError' }), false);
  assert.equal(shouldResumeSignIn({ ...base, error: 'AccessDenied' }), false);
  assert.equal(shouldResumeSignIn({ ...base, lastAttemptAt: NOW - 1000 }), false);
  assert.equal(shouldResumeSignIn({ ...base, lastAttemptAt: NOW - RESUME_COOLDOWN_MS - 1 }), true);
  // A clock that moved backwards does not lock the person out of resuming.
  assert.equal(shouldResumeSignIn({ ...base, lastAttemptAt: NOW + 60_000 }), true);
  assert.equal(shouldResumeSignIn({ ...base, lastAttemptAt: Number.NaN }), true);
});

test('isWorkspaceEmail matches the proxy session rule', () => {
  for (const v of ['ryan@risingtidestr.com', 'Delaney@RisingTideSTR.com']) assert.equal(isWorkspaceEmail(v), true);
  for (const v of ['', 'risingtidestr.com', 'a b@risingtidestr.com', 'x@example.com', 42, null]) assert.equal(isWorkspaceEmail(v), false);
  for (const email of ['ryan@risingtidestr.com', 'x@example.com']) {
    assert.equal(isWorkspaceEmail(email), hasHelmSession({ user: { email } }));
  }
});

test('the landing path stays on Helm', () => {
  assert.equal(safeCallbackPath('/work?mine=1'), '/work?mine=1');
  for (const v of [undefined, '', 'https://evil.example/', '//evil.example', '/\\evil.example', '/auth/signin', '/api/auth/signout']) {
    assert.equal(safeCallbackPath(v), '/');
  }
});

test('client kind tells Safari from the home-screen app', () => {
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
  const homeScreen = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  assert.equal(clientKind(safari), 'ios-safari');
  assert.equal(clientKind(homeScreen), 'ios-home-screen-or-in-app');
  assert.equal(clientKind(safari.replace('Version/18.1', 'CriOS/131.0')), 'ios-chrome');
  assert.equal(clientKind('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36'), 'android-chrome');
  assert.equal(clientKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15'), 'desktop');
  assert.equal(clientKind(null), 'unknown');
});

test('sign-in evidence carries cookie names, never values', () => {
  const evidence = describeSignInRequest(['__Host-authjs.csrf-token', 'helm_view_as'], null);
  assert.deepEqual(evidence, { session_cookie: false, csrf_cookie: true, callback_cookie: false, cookie_count: 2, client: 'unknown' });
  assert.equal(describeSignInRequest(['__Secure-authjs.session-token'], '').session_cookie, true);
});

// Run the real proxy, as helm-session.test.ts does, and capture what it logs.
const output = ts.transpileModule(src('../../proxy.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const compiled = { exports: {} as { default?: (req: unknown) => Response | undefined } };
const mocks: Record<string, unknown> = {
  '@/auth': { auth: (fn: unknown) => fn },
  '@/lib/helm-session': { hasHelmSession },
  '@/lib/auth-resume': authResume,
  '@/lib/helm-access': access,
  'next/server': { NextResponse: { json: Response.json, redirect: (url: URL, status = 307) => Response.redirect(url, status) } },
};
new Function('require', 'module', 'exports', output)((name: string) => {
  if (!(name in mocks)) throw new Error(`Unmocked import ${name}`);
  return mocks[name];
}, compiled, compiled.exports);

function run(path: string, cookies: Record<string, string>, headers: Record<string, string> = {}) {
  const url = new URL(path, 'https://helm.risingtidestr.com');
  const req = {
    auth: null,
    headers: new Headers(headers),
    cookies: { get: (n: string) => (n in cookies ? { name: n, value: cookies[n] } : undefined), getAll: () => Object.entries(cookies).map(([name, value]) => ({ name, value })) },
    nextUrl: Object.assign(url, { clone: () => new URL(url) }),
  };
  const lines: string[] = [];
  const info = console.info;
  console.info = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    return { res: compiled.exports.default!(req), lines };
  } finally {
    console.info = info;
  }
}

test('a forced sign-in logs what the browser carried, without a cookie value', () => {
  const secret = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0.SECRETVALUE';
  const { res, lines } = run('/work', { '__Host-authjs.csrf-token': secret, other: secret }, { 'user-agent': 'Mozilla/5.0 (iPhone) AppleWebKit Mobile/15E148' });
  assert.equal(res?.status, 307);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[auth\] sign-in required /);
  assert.match(lines[0], /"session_cookie":false/);
  assert.match(lines[0], /"csrf_cookie":true/);
  assert.match(lines[0], /ios-home-screen-or-in-app/);
  assert.doesNotMatch(lines[0], /SECRETVALUE/);
});

test('prefetches are not logged, and the Google callback passes through with its own line', () => {
  assert.equal(run('/work', {}, { 'next-router-prefetch': '1' }).lines.length, 0);
  const cb = run('/api/auth/callback/google', { '__Secure-authjs.session-token': 'v' });
  assert.equal(cb.res, undefined);
  assert.equal(cb.lines.length, 1);
  assert.match(cb.lines[0], /^\[auth\] google callback .*"session_cookie":true/);
});

test('sign out forgets the remembered address before signing out', () => {
  const menu = src('../../components/UserMenu.tsx');
  const fn = menu.slice(menu.indexOf('function signOutHere'));
  assert.ok(fn.indexOf('removeItem(LAST_SIGN_IN_KEY)') > 0, 'UserMenu sign out must clear LAST_SIGN_IN_KEY');
  assert.ok(fn.indexOf('removeItem(LAST_SIGN_IN_KEY)') < fn.indexOf('signOut('), 'clear it before signOut navigates away');
  // Every sign-out in the app goes through that one function.
  assert.equal((menu.match(/signOut\(/g) ?? []).length, 1);
});

test('the silent attempt asks Google with prompt=none and the remembered address', () => {
  const action = src('../../app/auth/signin/actions.ts');
  assert.match(action, /prompt: 'none', login_hint: hint/);
  assert.match(action, /isWorkspaceEmail\(hint\)/);
  assert.match(action, /safeCallbackPath\(/);
  const resume = src('../../app/auth/signin/ResumeSignIn.tsx');
  assert.match(resume, /shouldResumeSignIn\(/);
  assert.match(resume, /setItem\(RESUME_ATTEMPT_KEY/);
});
