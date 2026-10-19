/**
 * View as staff: an owner walks Helm as a staff login sees it.
 *
 * The switch is one httpOnly cookie that can only take an owner DOWN. This
 * checks the four things that keep it that way:
 *
 *   1. the resolver (`effectiveRole` in helm-access.ts) never elevates: a
 *      staff login with any cookie is staff, and a missing or garbled cookie
 *      leaves the real role
 *   2. every gate and every piece of chrome reads the resolver, not the
 *      login's own role: the proxy's page and API gates, sessionRole /
 *      isOwnerSession / requireOwnerEmail, Ask Helm's tool set, the client
 *      role hook (fed by the root layout). One direct roleForEmail() left
 *      in a page or action is a door an owner in staff view would walk
 *      through that a staff login could not, and the walk would lie
 *   3. the cookie is written only by the owner-checked action, and no
 *      URL can read or set it
 *   4. the way back works from any page, /not-available included
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  effectiveRole,
  helmView,
  ownerViewReturnPath,
  roleForEmail,
  STAFF_VIEW,
  VIEW_AS_COOKIE,
  VIEW_AS_STAFF,
} from '../helm-access.ts';
import { TEAM_MEMBERS } from '../team.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** Every .ts/.tsx under src outside the tests, as repo paths. */
const SOURCES: string[] = (readdirSync(new URL('../../', import.meta.url), { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__'))
  .map((f) => `src/${f}`);

function filesMatching(re: RegExp): string[] {
  return SOURCES.filter((f) => re.test(read(f))).sort();
}

/** The body of an exported function, up to the next export. */
function body(src: string, name: string): string {
  const m = src.match(new RegExp(`export (?:async )?function ${name}\\b[\\s\\S]*?(?=\\nexport |$)`));
  assert.ok(m, `${name} not found`);
  return m![0];
}

const OWNERS = TEAM_MEMBERS.filter((m) => m.access === 'owner').map((m) => m.email);
const STAFF_LOGINS = [
  ...TEAM_MEMBERS.filter((m) => m.access !== 'owner').map((m) => m.email),
  'someone-new@risingtidestr.com',
  '',
  null,
  undefined,
];
const COOKIES = [VIEW_AS_STAFF, 'owner', 'OWNER', 'STAFF', ' staff', 'staff ', 'admin', '1', 'true', '', '%73taff', '{"role":"owner"}', null, undefined];

describe('the resolver only ever takes an owner down', () => {
  test('a staff login is staff whatever the cookie says', () => {
    for (const email of STAFF_LOGINS) {
      for (const c of COOKIES) {
        assert.equal(effectiveRole(email, c), 'staff', `${email} with ${JSON.stringify(c)}`);
        const v = helmView(email, c);
        assert.deepEqual(v, STAFF_VIEW, `${email} gets no switch with ${JSON.stringify(c)}`);
      }
    }
  });

  test('an owner with the switch on is staff; a missing or garbled cookie is the real role', () => {
    assert.ok(OWNERS.length > 0);
    for (const email of OWNERS) {
      assert.equal(effectiveRole(email, VIEW_AS_STAFF), 'staff');
      assert.deepEqual(helmView(email, VIEW_AS_STAFF), { role: 'staff', viewingAsStaff: true, mayViewAsStaff: false });
      for (const c of COOKIES.filter((x) => x !== VIEW_AS_STAFF)) {
        assert.equal(effectiveRole(email, c), 'owner', `${email} with ${JSON.stringify(c)}`);
        assert.deepEqual(helmView(email, c), { role: 'owner', viewingAsStaff: false, mayViewAsStaff: true });
      }
    }
  });

  test('the resolver never returns more than the login has', () => {
    for (const email of [...OWNERS, ...STAFF_LOGINS]) {
      for (const c of COOKIES) {
        if (roleForEmail(email) === 'staff') assert.equal(effectiveRole(email, c), 'staff');
      }
    }
  });
});

describe('every gate and every piece of chrome reads the resolver', () => {
  test("nothing outside the resolver and the switch reads a login's own role", () => {
    // roleForEmail / isOwnerEmail are the login's role. The resolver is
    // built on them and the switch must check the login (an owner in staff
    // view is still allowed to flip back on); everything else asks
    // sessionRole(), isOwnerSession(), requireOwnerEmail(), useHelmRole()
    // or, in the proxy, effectiveRole().
    assert.deepEqual(filesMatching(/\b(roleForEmail|isOwnerEmail)\(/), ['src/app/view-as-actions.ts', 'src/lib/helm-access.ts']);
    assert.deepEqual(filesMatching(/getTeamMember\([^)]*\)\??\.access/), ['src/lib/helm-access.ts']);
  });

  test("the proxy's page and API gates both consult the resolver with the cookie", () => {
    const proxy = read('src/proxy.ts');
    const resolved = 'effectiveRole(req.auth.user?.email, req.cookies.get(VIEW_AS_COOKIE)?.value) !== "owner"';
    assert.ok(proxy.includes(`apiRequiresOwner(pathname) && ${resolved}`), 'the /api gate must use the resolver');
    assert.ok(proxy.includes(`pathRequiresOwner(pathname) && ${resolved}`), 'the page gate must use the resolver');
  });

  test('sessionRole, isOwnerSession and requireOwnerEmail refuse an owner in staff view as they refuse staff', () => {
    const src = read('src/lib/helm-access-server.ts');
    assert.ok(body(src, 'sessionRole').includes('return effectiveRole(email, await viewAsCookie());'));
    assert.ok(body(src, 'isOwnerSession').includes("return (await sessionRole()) === 'owner';"));
    assert.ok(body(src, 'requireOwnerEmail').includes("if (effectiveRole(email, await viewAsCookie()) !== 'owner') throw new Error('Owners only');"));
    assert.ok(body(src, 'sessionView').includes('return helmView(session?.user?.email, await viewAsCookie());'));
  });

  test("Ask Helm builds its tool set from the session's effective role", () => {
    const route = read('src/app/api/ask/route.ts');
    assert.ok(route.includes("const role = (await sessionRole()) ?? 'staff';"));
    assert.ok(route.includes('createAskTools({ role })'));
  });

  test('the client role comes from the root layout, not from the session in the browser', () => {
    const layout = read('src/app/layout.tsx');
    assert.ok(layout.includes('const [session, view] = await Promise.all([auth(), sessionView()]);'));
    assert.ok(layout.includes('<Providers session={session} view={view}>'));
    const providers = read('src/components/Providers.tsx');
    assert.ok(providers.includes('<HelmViewProvider view={view ?? STAFF_VIEW}>'));
    const hook = read('src/components/useHelmRole.ts');
    assert.ok(hook.includes('return useHelmView().role;'));
    assert.ok(!hook.includes('useSession'), 'the hook must not work the role out from the session email');
  });

  test("the home feed hides an owner's own mailbox in staff view, as it is hidden from staff", () => {
    const feed = read('src/components/ForMeFeed.tsx');
    assert.ok(feed.includes('canOpen: !view.viewingAsStaff && canOpenMailbox(email, gmailMailbox)'));
    assert.ok(feed.includes('const role = view.role;'));
  });
});

describe('the cookie is written only by the owner-checked action', () => {
  test('only the switch writes it, and only these files name it', () => {
    assert.equal(VIEW_AS_COOKIE, 'helm_view_as');
    assert.deepEqual(filesMatching(/['"]helm_view_as['"]/), ['src/lib/helm-access.ts'], 'the name is defined once');
    assert.deepEqual(
      filesMatching(/\bVIEW_AS_COOKIE\b/),
      ['src/app/view-as-actions.ts', 'src/lib/helm-access-server.ts', 'src/lib/helm-access.ts', 'src/proxy.ts'],
    );
    assert.deepEqual(filesMatching(/\.set\(\s*VIEW_AS_COOKIE/), ['src/app/view-as-actions.ts']);
  });

  test('turning it on checks the login is an owner before the cookie is set', () => {
    const src = read('src/app/view-as-actions.ts');
    assert.ok(src.startsWith("'use server';"), 'a server action, so the browser never holds the write');
    const on = body(src, 'viewAsStaff');
    const check = on.indexOf("if (roleForEmail(session?.user?.email) !== 'owner') return { ok: false, error: 'Owners only' };");
    const set = on.indexOf('.set(VIEW_AS_COOKIE, VIEW_AS_STAFF,');
    assert.ok(check > 0 && set > check, 'the owner check must come before the write');
    assert.ok(on.includes('httpOnly: true,') && on.includes("sameSite: 'lax',") && on.includes("path: '/',"));
    assert.ok(!/maxAge|expires/.test(on), 'a session cookie: it ends with the browser session');
    // Back to owner view only ever removes it.
    const off = body(src, 'backToOwnerView');
    assert.ok(off.includes('.delete(VIEW_AS_COOKIE)') && !off.includes('.set('));
  });

  test('no URL reads or sets the switch', () => {
    // These are the only files that mention the switch at all. None reads
    // a query string or a path for it: a page or route that grew a
    // ?viewAs= would have to be added here, and should not be.
    assert.deepEqual(filesMatching(/view[_-]?as/i), [
      'src/app/view-as-actions.ts',
      'src/components/HelmMasthead.tsx',
      'src/components/UserMenu.tsx',
      'src/components/ViewAsStaffBanner.tsx',
      'src/components/useViewAsSwitch.ts',
      'src/lib/helm-access-server.ts',
      'src/lib/helm-access.ts',
      'src/proxy.ts',
    ]);
    for (const f of filesMatching(/view[_-]?as/i)) {
      assert.ok(!/searchParams[\s\S]{0,80}view[_-]?as/i.test(read(f)), `${f} must not read the switch from a URL`);
    }
  });
});

describe('the way back works from any page', () => {
  test('the masthead carries the banner, and /not-available renders the masthead', () => {
    assert.ok(read('src/components/HelmMasthead.tsx').includes('<ViewAsStaffBanner />'));
    assert.ok(read('src/app/not-available/page.tsx').includes('<HelmMasthead />'));
    const banner = read('src/components/ViewAsStaffBanner.tsx');
    assert.ok(banner.includes('Viewing Helm as staff.') && banner.includes("'Back to owner view.'"));
    assert.ok(banner.includes('if (!view.viewingAsStaff) return null;'));
  });

  test('the menu offers the switch to an owner login only', () => {
    const menu = read('src/components/UserMenu.tsx');
    assert.ok(menu.includes('{view.mayViewAsStaff && ('), 'View as staff shows for an owner in owner view');
    assert.ok(menu.includes('{view.viewingAsStaff && ('), 'Back to owner view shows in staff view');
    assert.ok(menu.includes("signOut({ callbackUrl: '/auth/signin' })"), 'Sign out stays');
  });

  test('the actions are not behind a gate: no route, no owner prefix', () => {
    // A server action posts to the page it was clicked on. Every page that
    // renders the masthead is one the current view may open, so Back always
    // reaches the action; a /api route for it would have to stay out of
    // OWNER_API_PREFIXES, so there is none.
    assert.ok(!SOURCES.some((f) => /\/api\/view-as/.test(f)));
  });

  test('Back from /not-available returns to the page that was turned away, same origin only', () => {
    const o = 'https://helm.risingtidestr.com';
    assert.equal(ownerViewReturnPath('/turnovers', '', o), null, 'elsewhere the same page loads again');
    assert.equal(ownerViewReturnPath('/not-available', '?from=%2Fstatements', o), '/statements');
    assert.equal(ownerViewReturnPath('/not-available', '?from=/statements/close?month=2026-09', o), '/statements/close?month=2026-09');
    assert.equal(ownerViewReturnPath('/not-available', '', o), '/');
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example/statements', 'javascript:alert(1)']) {
      assert.equal(ownerViewReturnPath('/not-available', `?from=${encodeURIComponent(bad)}`, o), '/', bad);
    }
  });
});
