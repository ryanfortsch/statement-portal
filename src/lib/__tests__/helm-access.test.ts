/**
 * The staff gate: operations, not money.
 *
 * Helm had one kind of login until the first employee. This checks the
 * three places that have to agree about what a staff login may reach, and
 * reads the source for the guards that are one line each and easy to lose:
 *
 *   1. the role rule (helm-access.ts): owners are the explicit list, every
 *      other email is staff, so a new seat fails closed
 *   2. the path lists the proxy enforces, and that every owner-flagged
 *      module in the atlas sits behind one of them (a module hidden from
 *      the nav but still reachable by URL would be a gate with no door)
 *   3. the money server actions, which must call ownerEmail() because a
 *      server action posts to whatever page rendered it and the path gate
 *      cannot cover an action shared across pages
 *   4. the section strips, which must never offer a staff login a tab the
 *      proxy would bounce to /not-available
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  roleForEmail,
  pathRequiresOwner,
  apiRequiresOwner,
  roleMayOpen,
  OWNER_PATH_PREFIXES,
  OWNER_API_PREFIXES,
  OWNER_ONLY_ASK_TOOLS,
} from '../helm-access.ts';
import { HELM_MODULES, moduleVisibleTo, primaryModulesFor, getOverflowModulesFlat } from '../helm-modules.ts';
import { TEAM_MEMBERS } from '../team.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('who is an owner', () => {
  test('the three principals are owners and nobody else is', () => {
    const owners = TEAM_MEMBERS.filter((m) => m.access === 'owner');
    assert.deepEqual(
      owners.map((m) => m.email).sort(),
      ['allie@risingtidestr.com', 'dotti@risingtidestr.com', 'ryan@risingtidestr.com'],
    );
    for (const m of owners) {
      assert.equal(roleForEmail(m.email), 'owner');
      assert.equal(roleForEmail(m.email.toUpperCase()), 'owner', 'email matching is case-insensitive');
    }
    for (const m of TEAM_MEMBERS.filter((t) => t.access !== 'owner')) {
      assert.equal(roleForEmail(m.email), 'staff', `${m.email} is on the team list but not an owner`);
    }
  });

  test('a staff or unknown Workspace address is staff, so a new seat fails closed', () => {
    assert.equal(roleForEmail('delaney@risingtidestr.com'), 'staff');
    assert.equal(roleForEmail('someone-new@risingtidestr.com'), 'staff');
    assert.equal(roleForEmail(''), 'staff');
    assert.equal(roleForEmail(null), 'staff');
    assert.equal(roleForEmail(undefined), 'staff');
  });
});

describe('what a staff login may open', () => {
  test('the money and owner-relationship pages are owners-only', () => {
    for (const p of [
      '/statements',
      '/statements/close',
      '/books',
      '/forecast',
      '/revenue',
      '/payments',
      '/properties/contracts',
      '/properties/prospects',
      '/prospects/abc',
      '/projections/abc',
      '/owner-messaging',
      '/guests/quotes/new',
      '/fieldwork/shoots',
      '/fieldwork/rate-card',
      '/fieldwork/packets/test',
    ]) {
      assert.ok(pathRequiresOwner(p), `${p} should be owners-only`);
    }
  });

  test('the operations pages stay open to staff', () => {
    for (const p of [
      '/',
      '/turnovers',
      '/turnovers/schedule',
      '/inspections',
      '/fieldwork/packets',
      '/fieldwork/packets/abc',
      '/fieldwork/roster',
      '/fieldwork/trades',
      '/work',
      '/properties',
      '/properties/21_horton',
      '/properties/onboarding',
      '/messaging',
      '/cleaner-messaging',
      '/contractor-messaging',
      '/channels',
      '/crm',
      '/playbook',
      '/cost-analysis',
      '/guests',
      '/guests/agreements',
      // Prefix matching is by whole segment: a sibling that merely starts
      // with the same letters is not caught.
      '/statements-archive',
      '/revenue-notes',
    ]) {
      assert.equal(pathRequiresOwner(p), false, `${p} should stay open to staff`);
    }
  });

  test('every owner-flagged module in the atlas sits behind a gated path', () => {
    const flagged = HELM_MODULES.filter((m) => m.access === 'owner');
    assert.ok(flagged.length >= 10, 'the owner modules should be flagged');
    for (const m of flagged) {
      const href = m.href.split(/[?#]/)[0];
      assert.ok(pathRequiresOwner(href), `${m.id} is hidden from staff but ${href} is not gated by the proxy`);
      for (const prefix of m.routePrefixes ?? []) {
        assert.ok(pathRequiresOwner(prefix), `${m.id}: route prefix ${prefix} is not gated by the proxy`);
      }
    }
  });

  test('the gated page list only names routes the atlas or the field module owns', () => {
    // Guards a typo in OWNER_PATH_PREFIXES: a prefix that matches nothing
    // real would silently gate nothing.
    const known = new Set(HELM_MODULES.flatMap((m) => [m.href.split(/[?#]/)[0], ...(m.routePrefixes ?? [])]));
    const fieldOnly = new Set(['/fieldwork/rate-card', '/fieldwork/packets/test']);
    for (const p of OWNER_PATH_PREFIXES) {
      assert.ok(known.has(p) || fieldOnly.has(p), `${p} is in OWNER_PATH_PREFIXES but no module declares it`);
    }
  });

  test('the statement pipeline and the other payout writers are owners-only /api', () => {
    for (const p of [
      '/api/ingest',
      '/api/refresh-statement',
      '/api/fill-gap',
      '/api/resolve-gap',
      '/api/reservations/remove',
      '/api/bank-deposits/abc',
      '/api/receipts',
      '/api/receipts/abc',
      '/api/cleaning-events/abc',
      '/api/reconcile-emails',
      '/api/property-statements/abc/reserve',
      '/api/sync-stripe',
      '/api/books',
      '/api/vendor-w9',
    ]) {
      assert.ok(apiRequiresOwner(p), `${p} should be owners-only`);
    }
    // What staff keep: the company-card upload on /cost-analysis, the
    // launch checklist's Stripe wiring check, the crons, uploads, search.
    for (const p of ['/api/ingest-overhead', '/api/stripe-account-check', '/api/cron/sync-guesty', '/api/upload', '/api/search', '/api/ask', '/api/work']) {
      assert.equal(apiRequiresOwner(p), false, `${p} should stay open to staff`);
    }
    assert.ok(OWNER_API_PREFIXES.includes('/api/ingest'));
  });
});

describe('what a staff login sees', () => {
  test('staff get no Money tab and no owner modules in the Library', () => {
    const staffPrimary = primaryModulesFor('staff').map((m) => m.id);
    assert.ok(!staffPrimary.includes('financials'), 'the Money tab must not render for staff');
    assert.ok(staffPrimary.includes('work') && staffPrimary.includes('operations') && staffPrimary.includes('field'));
    const ownerPrimary = primaryModulesFor('owner').map((m) => m.id);
    assert.ok(ownerPrimary.includes('financials'));
    for (const m of getOverflowModulesFlat('staff')) {
      assert.notEqual(m.access, 'owner', `${m.id} should not reach the staff Library`);
    }
    assert.equal(moduleVisibleTo({ access: 'owner' } as never, 'owner'), true);
    assert.equal(moduleVisibleTo({ access: 'owner' } as never, 'staff'), false);
    assert.equal(moduleVisibleTo({} as never, 'staff'), true);
  });

  test('Ask Helm keeps the statement and prospect tools from staff', () => {
    assert.ok(OWNER_ONLY_ASK_TOOLS.has('get_statements'));
    assert.ok(OWNER_ONLY_ASK_TOOLS.has('list_prospects'));
    // The tool factory filters by that set and the route passes the role.
    const tools = read('src/lib/ask/tools.ts');
    assert.ok(tools.includes('OWNER_ONLY_ASK_TOOLS.has(name)'), 'createAskTools must filter the owner-only tools');
    const route = read('src/app/api/ask/route.ts');
    assert.ok(route.includes('createAskTools({ role })'), '/api/ask must pass the session role');
  });
});

describe('the money server actions refuse a staff session', () => {
  // Each of these pays, prices, approves or reveals a contractor's details.
  // One missed ownerEmail() is a self-pay button on the roster.
  const gated: Record<string, string[]> = {
    'src/app/fieldwork/packets/actions.ts': [
      'revealW9', 'revealPay', 'setPacketPrice', 'raisePacketEstimate', 'setPacketBonus',
      'finalizePacketPayout', 'markContractorPaid', 'markPacketPaid', 'approvePacket', 'requestChanges',
      'inviteContractor', 'setContractorStatus', 'rotateContractorToken', 'resendInvite',
      'setContractorBackgroundCheck', 'setContractorWorkBoard', 'setContractorW9', 'setContractorEmployment',
      'homeReceiptOnPacket', 'unhomeReceiptFromPacket',
    ],
    'src/app/fieldwork/hiring/actions.ts': ['inviteApplicant', 'declineApplicant', 'reopenApplicant'],
    'src/app/fieldwork/roster/rate-card-actions.ts': ['saveRateCardAction', 'resetRateCardAction'],
    'src/app/fieldwork/shoots/actions.ts': ['payDeliveryBase', 'setAssetQualifies'],
  };

  for (const [file, names] of Object.entries(gated)) {
    test(file, () => {
      const src = read(file);
      assert.ok(src.includes("from '@/lib/helm-access-server'"), `${file} must import requireOwnerEmail`);
      assert.ok(/async function ownerEmail\(\)[\s\S]*?requireOwnerEmail\(\)/.test(src), `${file}: ownerEmail() must delegate to requireOwnerEmail()`);
      for (const name of names) {
        const m = src.match(new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport async function |$)`));
        assert.ok(m, `${file}: ${name} not found`);
        assert.ok(m![0].includes('ownerEmail()'), `${file}: ${name} must call ownerEmail()`);
      }
    });
  }

  test('owner money on the pages staff keep renders for owners only', () => {
    // The home payout tile, the fee on the properties list, and the fee /
    // bank / owner emails / payouts / contract on a property page.
    const home = read('src/app/page.tsx');
    assert.ok(home.includes('const owner = await isOwnerSession();'), 'home page must know the role');
    assert.ok(home.includes('`repeat(${owner ? 4 : 3}, 1fr)`'), 'the signals strip drops the payout tile for staff');
    const list = read('src/app/properties/page.tsx');
    assert.ok(list.includes("owner ? `${p.management_fee_pct}% →` : 'Managed →'"), 'the properties list hides the fee from staff');
    const page = read('src/app/properties/[id]/page.tsx');
    assert.ok(page.includes("const owner = roleForEmail(session?.user?.email) === 'owner';"));
    assert.ok(page.includes('{owner && <Stat label="Mgmt Fee"'), 'the Mgmt Fee stat is owners only');
    assert.ok(/\{owner && \(\n\s*<CollapsibleSection title="Recent Statements"/.test(page), 'the statements section is owners only');
    assert.ok(page.includes('{owner && (activeContract ? ('), 'the contract section is owners only');
    assert.ok(page.includes("ownerEmail={owner ? (p.owner_emails?.[0] ?? null) : null}"));
    const edit = read('src/app/properties/[id]/edit/page.tsx');
    assert.ok(/\{owner && \(\n\s*<Field name="owner_emails"/.test(edit), 'the send list field is owners only');
    assert.ok(/\{owner && \(\n\s*<Field\n\s*name="bank_last4"/.test(edit), 'the bank field is owners only');
    const actions = read('src/app/properties/actions.ts');
    assert.ok(actions.includes('if (!opts.owner) {'), 'a staff save must not touch the owner columns');
    assert.ok(actions.includes("performPropertyUpdate(id, formData, { owner: roleForEmail(session.user.email) === 'owner' })"));
  });

  test('the pure helper never pulls Auth.js into the proxy or client bundles', () => {
    const src = read('src/lib/helm-access.ts');
    assert.ok(!src.includes("from '@/auth'"), 'helm-access.ts must stay pure');
    assert.ok(!src.includes('next-auth'), 'helm-access.ts must stay pure');
    const proxy = read('src/proxy.ts');
    assert.ok(proxy.includes('pathRequiresOwner(pathname)'), 'the proxy must gate owner pages');
    assert.ok(proxy.includes('apiRequiresOwner(pathname)'), 'the proxy must gate owner /api routes');
  });
});

describe('the section strips never offer a tab the proxy would bounce', () => {
  test('roleMayOpen: owners open everything, staff only the ungated pages, query and hash ignored', () => {
    for (const href of [
      '/statements',
      '/fieldwork/shoots?trade=creative',
      '/guests/quotes',
      '/owner-messaging',
      '/properties/prospects',
      '/properties/contracts',
      '/fieldwork/rate-card#card',
    ]) {
      assert.equal(roleMayOpen('owner', href), true, `an owner may open ${href}`);
      assert.equal(roleMayOpen('staff', href), false, `staff must not be offered ${href}`);
    }
    for (const href of [
      '/fieldwork/roster?trade=creative',
      '/fieldwork/packets?trade=inspection&focus=review#needs-review',
      '/messaging',
      '/properties/onboarding',
      'https://mail.google.com/mail/u/0/#inbox',
      'mailto:ryan@risingtidestr.com',
    ]) {
      assert.equal(roleMayOpen('staff', href), true, `staff may open ${href}`);
    }
  });

  test('SectionTabs filters every strip it renders through the gate list', () => {
    const src = read('src/components/SectionTabs.tsx');
    assert.ok(src.includes('const role = useHelmRole();'), 'SectionTabs must read the role');
    assert.ok(
      src.includes('const visible = tabs.filter((t) => roleMayOpen(role, t.href));'),
      'SectionTabs must drop the tabs the proxy would bounce',
    );
    assert.ok(src.includes('{visible.map((t) => {'), 'SectionTabs must render the filtered list, not the one it was handed');
    assert.ok(!src.includes('{tabs.map((t) => {'), 'SectionTabs must not render the unfiltered list');
  });

  // Every strip, with how many owner-gated hrefs each is expected to list.
  // A gated href is fine when it reaches the page through SectionTabs'
  // `tabs` (filtered above); a strip that prints links of its own has to
  // read the role itself. The expected counts keep the scan honest: if the
  // literal scan stopped finding hrefs, the test would pass for nothing.
  const STRIPS: Record<string, number> = {
    'src/components/MessagingTabs.tsx': 1,
    'src/components/FieldTabs.tsx': 1,
    'src/components/FinancialsTabs.tsx': 5,
    'src/components/MarketingTabs.tsx': 0,
    'src/components/WorkTabs.tsx': 0,
    'src/components/TurnoverTabs.tsx': 0,
    'src/app/properties/PropertiesTabBar.tsx': 2,
    'src/app/guests/GuestsTabBar.tsx': 1,
  };

  /** Character ranges of every `tabs={[ ... ]}` literal handed to SectionTabs. */
  function sectionTabsRanges(src: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    const marker = 'tabs={[';
    let at = src.indexOf(marker);
    while (at !== -1) {
      const open = at + marker.length - 1;
      let depth = 0;
      let i = open;
      for (; i < src.length; i++) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']') {
          depth--;
          if (depth === 0) break;
        }
      }
      ranges.push([open, i]);
      at = src.indexOf(marker, i);
    }
    return ranges;
  }

  /** The source with its comments blanked out: a path named in a docblock
   *  is prose, not a link, and must neither count nor be checked. */
  function withoutComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/^\s*\/\/.*$/gm, (m) => ' '.repeat(m.length));
  }

  for (const [file, expected] of Object.entries(STRIPS)) {
    test(`${file} lists no owner page without a role check`, () => {
      const src = withoutComments(read(file));
      const readsRole = src.includes('useHelmRole()') || src.includes('await sessionRole()');
      const ranges = sectionTabsRanges(src);
      const literal = /['"`](\/[^'"`\s$]*)['"`]/g;
      let gated = 0;
      for (let m = literal.exec(src); m; m = literal.exec(src)) {
        const index = m.index;
        if (!pathRequiresOwner(m[1].split(/[?#]/)[0])) continue;
        gated++;
        const throughSectionTabs = ranges.some(([a, b]) => index > a && index < b);
        assert.ok(
          throughSectionTabs || readsRole,
          `${file} lists ${m[1]} without a role check: hand it to SectionTabs' tabs, or read useHelmRole() / sessionRole() and filter with roleMayOpen`,
        );
      }
      assert.equal(gated, expected, `${file}: expected ${expected} owner-gated href(s) in the source, found ${gated}; update the count if the strip changed on purpose`);
    });
  }

  test('FieldTabs lands staff on the Roster for creative and never offers Shoots & Pay', () => {
    const src = read('src/components/FieldTabs.tsx');
    assert.ok(src.startsWith("'use client';"), 'FieldTabs reads the role on the client');
    assert.ok(src.includes("const owner = useHelmRole() === 'owner';"));
    assert.ok(src.includes('const hasShoots = (t: ContractorTrade) => TRADE_META[t].hasShoots && owner;'));
    assert.ok(
      src.includes("TRADE_META[t].hasPackets ? 'packets' : hasShoots(t) ? 'shoots' : 'contractors'"),
      'the creative home lens must consult the role',
    );
    assert.ok(src.includes("hasShoots(trade) ? { id: 'shoots', label: 'Shoots & Pay' } : null"), 'the Shoots & Pay lens must consult the role');
    assert.ok(!src.includes("TRADE_META[t].hasShoots ? 'shoots'"), 'no path to the pay ledger may skip the role');
  });

  test('PropertiesTabBar reads the session and drops Prospects and Contracts for staff', () => {
    const src = read('src/app/properties/PropertiesTabBar.tsx');
    assert.ok(src.includes("const role = (await sessionRole()) ?? 'staff';"), 'the bar reads the session itself');
    assert.ok(src.includes('].filter((t) => roleMayOpen(role, t.href));'), 'the bar filters through the gate list');
  });
});
