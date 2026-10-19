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
 *   5. the feed cards and inline links on the pages staff keep, which must
 *      ask the same question before rendering an owner href
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
      // Growth's owner chores: the AirDNA upload and the competitor
      // roster with its owner-of-record research.
      '/marketing/airdna',
      '/competitors',
      '/competitors/atlantic-vacation-homes',
    ]) {
      assert.ok(pathRequiresOwner(p), `${p} should be owners-only`);
    }
  });

  test('the operations pages stay open to staff', () => {
    for (const p of [
      '/',
      '/turnovers',
      '/turnovers/schedule',
      '/turnovers/settings',
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
      '/messaging/team',
      '/cleaner-messaging',
      '/contractor-messaging',
      '/channels',
      '/crm',
      '/playbook',
      '/guests',
      '/guests/agreements',
      '/guests/contacts',
      '/marketing',
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
      '/api/airdna/ingest',
      '/api/sync-competitors',
    ]) {
      assert.ok(apiRequiresOwner(p), `${p} should be owners-only`);
    }
    // The public market pages read the AirDNA aggregates, and the weekly
    // competitor sync runs through the cron route.
    for (const p of ['/api/markets/airdna/gloucester', '/api/cron/sync-competitors', '/api/cron/airdna-reminder']) {
      assert.equal(apiRequiresOwner(p), false, `${p} should stay open`);
    }
    // What staff keep: the company-card upload route (its page, Forecast's Actuals, is owner-only), the
    // crons, uploads, search. The launch checklist's Stripe account check is owners only since 2026-10-18.
    assert.ok(apiRequiresOwner('/api/stripe-account-check'), 'the Stripe account check is owners only');
    for (const p of ['/api/ingest-overhead', '/api/cron/sync-guesty', '/api/upload', '/api/search', '/api/ask', '/api/work']) {
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

  test('Growth is a masthead tab for owners and a More entry for staff, with nothing gated', () => {
    const growth = HELM_MODULES.find((m) => m.id === 'marketing');
    assert.equal(growth?.masthead, 'owner');
    assert.notEqual(growth?.access, 'owner', 'demoting the tab must not gate the route');
    assert.equal(pathRequiresOwner('/marketing'), false);
    assert.equal(pathRequiresOwner('/guests'), false);
    assert.ok(primaryModulesFor('owner').some((m) => m.id === 'marketing'), 'owners keep the Growth tab');
    assert.ok(!primaryModulesFor('staff').some((m) => m.id === 'marketing'), 'staff lose the Growth tab');
    assert.ok(getOverflowModulesFlat('staff').some((m) => m.id === 'marketing'), 'staff find Growth in More');
    assert.ok(!getOverflowModulesFlat('owner').some((m) => m.id === 'marketing'), 'owners do not see it twice');
    // The flag only means something on a primary module, and never on one
    // that is already owner-gated (that one is hidden from staff outright).
    for (const m of HELM_MODULES.filter((x) => x.masthead === 'owner')) {
      assert.ok(m.primary, `${m.id}: masthead 'owner' on a module that is not a masthead tab`);
      assert.notEqual(m.access, 'owner', `${m.id}: masthead 'owner' and access 'owner' together`);
    }
    // Every role sees each module once, on the masthead or in More.
    for (const role of ['owner', 'staff'] as const) {
      const ids = [...primaryModulesFor(role), ...getOverflowModulesFlat(role)].map((m) => m.id);
      assert.equal(new Set(ids).size, ids.length, `${role}: a module is listed twice`);
    }
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
      'finalizePacketPayout', 'markContractorPaid', 'markPacketPaid', 'approvePacket',
      'rotateContractorToken', 'setContractorW9', 'setContractorEmployment',
      'homeReceiptOnPacket', 'unhomeReceiptFromPacket',
    ],
    'src/app/fieldwork/roster/rate-card-actions.ts': ['saveRateCardAction', 'resetRateCardAction'],
    // All five creative pay actions: the base pay and the qualifying call,
    // plus the three that pay or re-price a top-up (found on staffEmail()
    // by the 2026-10-17 audit).
    'src/app/fieldwork/shoots/actions.ts': ['payDeliveryBase', 'setAssetQualifies', 'payAssetTopup', 'setAssetTopupOverride', 'setShootPaidAdjustment'],
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

  test('staff run the contractor lifecycle, never the pay (Dotti, 2026-10-19)', () => {
    const staffOpen: Record<string, string[]> = {
      'src/app/fieldwork/packets/actions.ts': ['requestChanges', 'inviteContractor', 'setContractorStatus', 'resendInvite', 'setContractorBackgroundCheck', 'setContractorWorkBoard'],
      'src/app/fieldwork/hiring/actions.ts': ['inviteApplicant', 'declineApplicant', 'reopenApplicant'],
    };
    for (const [file, names] of Object.entries(staffOpen)) {
      const src = read(file);
      for (const name of names) {
        const m = src.match(new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport async function |$)`));
        assert.ok(m && m[0].includes('staffEmail()'), `${file}: ${name} must still require a signed-in login`);
      }
    }
    const status = read('src/app/fieldwork/packets/actions.ts').match(/export async function setContractorStatus[\s\S]*?(?=\nexport async function |$)/)![0];
    assert.ok(status.includes("if (status === 'archived') await ownerEmail();"), 'retiring a contractor stays with the owners');
    assert.ok(/=== 'archived'\) await ownerEmail\(\);\s*\}/.test(status), 'and so does bringing a retired one back');
  });

  test('owner money on the pages staff keep renders for owners only', () => {
    // The home payout tile, the fee on the properties list, and the fee /
    // bank / owner emails / payouts / contract on a property page.
    const home = read('src/app/(home)/page.tsx');
    assert.ok(home.includes('const [owner, sp] = await Promise.all([isOwnerSession(), searchParams]);'), 'home page must know the role');
    assert.ok(home.includes('<HomeSignals owner={owner} />'), 'and hands it to the signals');
    const signals = read('src/components/HomeSignals.tsx');
    assert.ok(signals.includes('`repeat(${owner ? 3 : 2}, 1fr)`'), 'the signals strip drops the payout tile for staff');
    assert.ok(signals.includes("owner ? getCurrentMonthActualPayout() : Promise.resolve<CurrentPayout>({ status: 'unconfigured' })"), 'a staff page never reads the payout');
    const list = read('src/app/properties/page.tsx');
    assert.ok(list.includes("owner ? `${p.management_fee_pct}% →` : 'Managed →'"), 'the properties list hides the fee from staff');
    const page = read('src/app/properties/[id]/page.tsx');
    assert.ok(page.includes('const owner = await isOwnerSession();'));
    assert.ok(page.includes('{owner && <Stat label="Mgmt Fee"'), 'the Mgmt Fee stat is owners only');
    assert.ok(/\{owner && \(\n\s*<CollapsibleSection title="Recent Statements"/.test(page), 'the statements section is owners only');
    assert.ok(page.includes('{owner && (activeContract ? ('), 'the contract section is owners only');
    assert.ok(page.includes("ownerEmail={owner ? (p.owner_emails?.[0] ?? null) : null}"));
    const edit = read('src/app/properties/[id]/edit/page.tsx');
    assert.ok(/\{owner && \(\n\s*<Field name="owner_emails"/.test(edit), 'the send list field is owners only');
    assert.ok(/\{owner && \(\n\s*<Field\n\s*name="bank_last4"/.test(edit), 'the bank field is owners only');
    const actions = read('src/app/properties/actions.ts');
    assert.ok(actions.includes('if (!opts.owner) {'), 'a staff save must not touch the owner columns');
    assert.ok(actions.includes('performPropertyUpdate(id, formData, { owner: await isOwnerSession() })'));
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
    // Statements' href is built by statementsHref() to carry the month, so
    // it is not a literal; the other four are.
    'src/components/FinancialsTabs.tsx': 4,
    'src/components/GrowthTabs.tsx': 2,
    'src/components/WorkTabs.tsx': 0,
    'src/components/TurnoverTabs.tsx': 0,
    'src/app/properties/PropertiesTabBar.tsx': 2,
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

describe('no card or link on a staff page lands on /not-available', () => {
  test('the home feed loads no owner queue for staff and filters every card through the gate', () => {
    const src = read('src/components/ForMeFeed.tsx');
    assert.ok(src.includes('owner ? loadCreativeQueue() : null'), 'the creative pay card is owners only');
    assert.ok(src.includes('owner ? loadStatementQueue() : null'), 'the statements card is owners only');
    assert.ok(src.includes('owner ? loadPacketQueue() : []'), 'the packet approve cards are owners only: approving is an owner action on a page staff can open');
    assert.ok(src.includes('.filter((c) => roleMayOpen(role, c.href))'), 'every queue card is checked against the gate');
  });

  test('/today is retired into the home: it redirects, and nothing links to it', () => {
    const config = read('next.config.ts');
    assert.ok(/source: '\/today',\n\s*destination: '\/',/.test(config), '/today redirects home');
    assert.ok(!read('src/components/ForMeFeed.tsx').includes('"/today"'), 'the feed links nowhere to /today');
    assert.ok(!read('src/lib/helm-modules.ts').includes("href: '/today'"), 'no registry entry');
  });

  test('the concierge alerts drop the owner-line alerts for staff', () => {
    const src = read('src/components/ConciergeAlerts.tsx');
    assert.ok(src.includes("const items = conciergeAlertsFor(role ?? 'staff', res.data.items);"));
  });

  test('the guest queue offers Send a price, the quote links and See all to owners only', () => {
    // The guest card and its Also on approve lines (guest-card-blocks.tsx).
    const src = read('src/app/messaging/MessagingQueue.tsx') + read('src/app/messaging/guest-card-blocks.tsx');
    assert.ok(src.includes("const canPrice = role === 'owner';"), 'the card must know the role');
    // Every Send a price link is behind canPrice, as a ternary with the
    // staff note or as a guard on the email card's secondary link.
    const primary = [...src.matchAll(/<PrimaryLink href=\{quoteHref\}/g)];
    // Queued, the 2027 footer (one for both its states since the one card,
    // 2026-10-18) and Set a price on an inquiry.
    assert.ok(primary.length >= 3, 'the Send a price primaries and Set a price should still exist');
    for (const m of primary) {
      assert.ok(src.slice(Math.max(0, m.index! - 80), m.index!).includes('canPrice ?'), 'a Send a price primary without canPrice');
    }
    const secondary = [...src.matchAll(/<SecondaryLink\s*\n?\s*href=\{quoteHref\}/g)];
    assert.ok(secondary.length >= 2, 'the two Send a price secondaries should still exist');
    for (const m of secondary) {
      assert.ok(src.slice(Math.max(0, m.index! - 80), m.index!).includes('canPrice &&'), 'a Send a price secondary without canPrice');
    }
    assert.ok(src.includes('Ask Ryan or Dotti to price this'), 'staff are told who prices');
    assert.ok(src.includes('<QuoteRow key={q.id} href={`/guests/quotes/${q.id}`} linked={canPrice}>'), 'quote rows link for owners only');
    assert.ok(src.includes('{canPrice && quotes.total > quotes.quotes.length && ('), 'See all in Quotes is owners only');
    assert.ok(src.includes("{roleMayOpen(role, HANDOFF_HREF[handoff.audience] ?? '/messaging') ? ("), 'the handoff surface links only where the role may go');
  });

  test('the owner inbox link in Delivery & sync and the roster pay ledger link are owners only', () => {
    const followups = read('src/components/WorkFollowups.tsx');
    assert.ok(followups.includes('{owner && <Link href="/owner-messaging"'));
    const health = read('src/components/InboxHealth.tsx');
    assert.ok(health.includes('<WorkFollowupsContent result={followups} owner={owner} />'));
    const roster = read('src/app/fieldwork/roster/page.tsx');
    assert.ok(roster.includes("{trade === 'creative' && owner && ("), 'Shoots & pay is owners only');
    assert.ok(roster.includes(": 'Everyone who shoots for us. To send someone to a home, ask Ryan or Dotti.'"), 'the staff sentence must not send them to Shoots & pay');
  });

  test('/not-available names every area the gate list covers', () => {
    const src = read('src/app/not-available/page.tsx').toLowerCase();
    for (const word of ['statements', 'revenue', 'forecast', 'cost analysis', 'books', 'payments', 'contracts', 'prospects', 'projections', 'owner messaging', 'quotes', 'airdna', 'competitors', 'creative pay', 'rate card']) {
      assert.ok(src.includes(word), `/not-available should mention ${word}`);
    }
  });
});

describe('every Gmail link carries its mailbox and renders for that mailbox only', () => {
  // No surface may build a first-signed-in-account link any more; the
  // mailbox comes from gmailMailbox() and the link from gmailUrl().
  const GMAIL_SURFACES = [
    'src/components/ForMeFeed.tsx',
    'src/app/api/work/draft-owner-email/route.ts',
    'src/app/api/draft-email/route.ts',
    'src/app/api/draft-onboarding-email/route.ts',
    'src/app/api/crm/draft-contact-email/route.ts',
    'src/lib/gmail-draft.ts',
    'src/app/work/RunsRail.tsx',
    'src/app/work/[id]/SlipOwnerActionEditor.tsx',
    'src/app/statements/page.tsx',
    'src/lib/use-owner-email-draft.ts',
    'src/app/properties/[id]/PropertyOnboardingLink.tsx',
    'src/components/InboxHealth.tsx',
  ];
  for (const file of GMAIL_SURFACES) {
    test(`${file} builds no /u/0/ link`, () => {
      assert.ok(!read(file).includes('mail.google.com/mail/u/0/'), `${file} still links the first signed-in account`);
    });
  }

  test('the draft routes name the mailbox and the helper asks Gmail whose it is', () => {
    // The owner-email route drafts in the sender's own Gmail through the
    // helper instead (work-drafts-own-mailbox.test.ts).
    for (const file of ['src/app/api/draft-email/route.ts', 'src/app/api/draft-onboarding-email/route.ts', 'src/app/api/crm/draft-contact-email/route.ts']) {
      const src = read(file);
      assert.ok(src.includes("const mailbox = await gmailMailbox('shared');"), `${file} must resolve the mailbox`);
      assert.ok(src.includes('const draftUrl = gmailUrl(mailbox, `drafts/${draft.id}`);'), `${file} must build the link with the mailbox`);
      assert.ok(src.includes('      mailbox,'), `${file} must return the mailbox`);
    }
    const helper = read('src/lib/gmail-draft.ts');
    assert.ok(helper.includes("fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile'"), 'the mailbox is asked of Gmail, never assumed');
    assert.ok(helper.includes('draftUrl: gmailUrl(mailboxAddress, `drafts/${draft.id}`),'));
  });

  test('the feed links into the inbox for its owner only', () => {
    const feed = read('src/components/ForMeFeed.tsx');
    assert.ok(feed.includes('const mail = { mailbox: gmailMailbox, canOpen: !view.viewingAsStaff && canOpenMailbox(email, gmailMailbox) };'));
    assert.ok(feed.includes('{mail.canOpen ? (\n            <a href={gmailUrl(mail.mailbox, `inbox/${e.threadId}`)}'), 'the sender links only when the session owns the mailbox');
    assert.ok(feed.includes('{e.draftId && mail.canOpen && ('), 'Reply drafted links only when the session owns the mailbox');
  });

  test('a draft made from a page opens and links only for the mailbox owner, and says where it went otherwise', () => {
    const hook = read('src/lib/use-owner-email-draft.ts');
    assert.ok(hook.includes('const canOpen = made && canOpenMailbox(sessionEmail, result.mailbox);'));
    assert.ok(hook.includes('if (canOpenMailbox(sessionEmail, mailbox)) open(data.draft_url);'));
    assert.ok(hook.includes('const savedIn = made && !canOpen ? draftSavedNotice(result.mailbox) : \'\';'));
    for (const file of ['src/app/properties/[id]/PropertyDraftOwnerEmailButton.tsx', 'src/app/crm/[id]/ContactDraftEmailButton.tsx', 'src/app/work/QueueClient.tsx']) {
      assert.ok(/savedIn/.test(read(file)), `${file} must say where the draft went`);
    }
    const editor = read('src/app/work/[id]/SlipOwnerActionEditor.tsx');
    assert.ok(editor.includes('if (data?.draft_url && canOpenMailbox(sessionEmail, mailbox)) {'));
    const rail = read('src/app/work/RunsRail.tsx');
    assert.ok(rail.includes("if (canOpenMailbox(sessionEmail, res.mailboxAddress)) window.open(res.draftUrl, '_blank', 'noopener');"));
    // After a copy the rail shows the copy notice first; a draft's link still
    // renders only for its mailbox's owner.
    assert.ok(rail.includes('canOpenMailbox(sessionEmail, done.mailboxAddress) ? ('));
    const onboarding = read('src/app/properties/[id]/PropertyOnboardingLink.tsx');
    assert.ok(onboarding.includes('{canOpenMailbox(sessionEmail, draftMailbox) && ('));
    const statements = read('src/app/statements/page.tsx');
    assert.ok(statements.includes('{canOpenMailbox(sessionEmail, draftResult.mailbox) ? ('));
    assert.ok(statements.includes('{bulkDraftResult.drafted > 0 && canOpenMailbox(sessionEmail, draftMailbox) && ('));
  });

  test('Delivery & sync opens an email in the concierge mailbox for its owner only', () => {
    // The emails behind a delayed import or a held pitch live in the
    // concierge's Gmail account, a token Helm cannot ask, so the concierge
    // names the mailbox on /api/inbox-health and Helm never assumes it.
    const health = read('src/components/InboxHealth.tsx');
    assert.ok(health.includes('const mailbox = health?.mailbox ?? null;'), 'the mailbox comes from the concierge');
    assert.ok(health.includes('const canOpen = canOpenMailbox(email, mailbox);'), 'the session is compared to the concierge mailbox');
    const link = 'href={gmailUrl(mailbox, `all/${encodeURIComponent(item.source_id)}`)}';
    assert.equal(health.split(link).length - 1, 2, 'both Open email links carry the concierge mailbox');
    assert.ok(health.includes(`{item.channel === 'email' && canOpen && <> · <a target="_blank" rel="noreferrer" ${link}`), 'a delayed import links only for the mailbox owner');
    assert.ok(health.includes(`{canOpen && <> · <a target="_blank" rel="noreferrer" ${link}`), 'a held pitch links only for the mailbox owner');
    assert.ok(read('src/lib/stay-concierge.ts').includes('  mailbox?: string | null;\n};\n\nexport function getInboxHealth() {'), 'the inbox-health response type carries the mailbox');
  });
});

describe('owner money on the pages staff keep renders for owners only (part two)', () => {
  // The first part of this list lives in "the money server actions refuse
  // a staff session" above (home payout tile, fee on the list, fee / bank /
  // statements / contract on a property page). These are the surfaces the
  // 2026-10-17 audit found still printing money to staff.
  test('the calendar hover card drops the payout on the server', () => {
    const src = read('src/components/OccupancyCalendar.tsx');
    assert.ok(src.includes('const owner = await isOwnerSession();'), 'the calendar must know the role');
    assert.ok(src.includes('hostPayout: owner ? r.host_payout : null,'), 'the payout must be nulled before it reaches the browser');
  });

  test('the property page keeps the multi-month section, the contract alerts, the executed contract and the prospect chips from staff', () => {
    const src = read('src/app/properties/[id]/page.tsx');
    assert.ok(src.includes('{owner && <MultiMonthBookingsSection propertyId={p.id} />}'));
    assert.ok(src.includes('if (owner && !activeContract && !p.is_rising_tide_owned && p.is_active) {'));
    assert.ok(src.includes("if (owner && activeContractAttention?.kind === 'notice_window') {"));
    assert.ok(src.includes("const visibleDocuments = owner ? documents : documents.filter((d) => d.source !== 'contract-auto');"));
    assert.ok(src.includes('<DocumentsPanel propertyId={p.id} documents={visibleDocuments} />'));
    assert.ok(src.includes('{owner && ownerPortfolio.prospects.map((op) => ('));
  });

  test('a roster card shows staff no pay, no Books YTD, no W-9 details and no payment method', () => {
    const src = read('src/app/fieldwork/roster/page.tsx');
    // The collapsed summary carries standing, the next or last visit and the
    // W-9 state: no dollars at all, for anyone (Roster merge, 2026-10-18).
    const at = src.indexOf('<summary className="rt-fold-summary"');
    const summary = at < 0 ? '' : src.slice(at, src.indexOf('</summary>', at));
    assert.ok(summary.length > 0, 'the card summary is found');
    assert.doesNotMatch(summary, /dollars\(/, 'the collapsed card prints no pay');
    assert.ok(/\{owner && \(\n\s*<RecordRow label="Earnings">/.test(src), 'the Earnings line of the Record is owners only');
    assert.ok(/\{owner && \(\n\s*<RecordRow label="Books YTD">/.test(src), 'the Books YTD line of the Record is owners only');
    assert.ok(src.includes('{owner && w9 && ('), 'the W-9 summary line is owners only');
    assert.ok(src.includes('{owner && pm && ('), 'the payment method line is owners only');
    assert.ok(src.includes('{owner && Math.abs(gap) > 5000 && ('), 'the pay-versus-books gap is owners only');
  });

  test('the Field board rows and the channels bookings pages print payouts to owners only', () => {
    const board = read('src/app/fieldwork/packets/page.tsx');
    assert.ok(board.includes('{owner && <span>{dollars(totalPayoutCents(p))}</span>}'));
    const list = read('src/app/channels/bookings/page.tsx');
    assert.ok(list.includes("{owner && <div style={{ textAlign: 'right' }}>Payout</div>}"), 'the Payout column header is owners only');
    assert.ok(list.includes("{owner && <span className=\"tabular-nums\" style={{ fontSize: 12, textAlign: 'right', color: 'var(--ink-3)' }}>{b.payout"), 'the Payout cell is owners only');
    const record = read('src/app/channels/bookings/[id]/page.tsx');
    assert.ok(record.includes('const owner = await isOwnerSession();'));
    assert.ok(/\{owner && \(\n\s*<>\n\s*<div className="eyebrow" style=\{\{ marginTop: 4 \}\}>Money on the booking row<\/div>/.test(record), 'the money inputs are owners only');
    assert.ok(record.includes('{!owner ? ('), 'the booking_finance sub-record is owners only');
  });

  test('AirDNA and Competitors are gated, flagged, and linked for owners only', () => {
    for (const id of ['airdna', 'competitors']) {
      assert.equal(HELM_MODULES.find((m) => m.id === id)?.access, 'owner', `${id} must be flagged`);
    }
    const marketing = read('src/app/marketing/page.tsx');
    const at = marketing.indexOf('href="/marketing/airdna"');
    assert.ok(at > 0, 'the AirDNA link is found');
    assert.ok(marketing.slice(Math.max(0, at - 200), at).includes('{owner && ('), 'the AirDNA link on Marketing renders for owners only');
    const actions = read('src/app/competitors/actions.ts');
    for (const name of ['setListingAddress', 'clearListingAddress']) {
      const m = actions.match(new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport async function |$)`));
      assert.ok(m && m[0].includes('await requireOwnerEmail()'), `${name} must require an owner`);
    }
  });

  test('/cost-analysis is retired: out of the atlas and the strip, landing on Actuals', () => {
    // Its redirect target is owner-gated, so the old route needs no gate of its own.
    assert.ok(!OWNER_PATH_PREFIXES.includes('/cost-analysis'));
    assert.equal(HELM_MODULES.find((m) => m.id === 'cost-analysis'), undefined, 'no atlas entry, so nav and search never offer it');
    assert.ok(!read('src/components/FinancialsTabs.tsx').includes("'/cost-analysis'"), 'no Money strip tab');
    assert.ok(read('src/app/cost-analysis/page.tsx').includes("redirect('/forecast#actuals')"), 'old links land on Actuals');
    // Its three parts each have a home.
    assert.ok(read('src/app/forecast/page.tsx').includes('<ActualsSection'), 'the upload and ledger are on Forecast');
    assert.ok(read('src/app/books/[entity_id]/page.tsx').includes('<Vendor1099Section'), 'the 1099 table is on the Rising Tide ledger');
    const property = read('src/app/properties/[id]/page.tsx');
    const at = property.indexOf('<CostToTurnSection');
    assert.ok(at > 0 && property.slice(Math.max(0, at - 200), at).includes('{owner && ('), 'cost to turn is on the property page, owners only');
  });
});

describe('the data behind the page gate refuses a staff session', () => {
  // A page the proxy bounces is not enough when its feed is a shared /api
  // route or a server action reachable from a page staff keep.
  test('the owner messaging feed, its count and the search panel refuse the owners audience for staff', () => {
    const queue = read('src/app/api/messaging/queue/route.ts');
    assert.ok(queue.includes("if ((await sessionRole()) !== 'owner') {"), 'the queue must check the role for the owners audience');
    assert.ok(queue.includes("return NextResponse.json({ error: 'Owners only' }, { status: 403 });"));
    const count = read('src/app/api/messaging/pending-count/route.ts');
    assert.ok(count.includes("owner ? listOwnerApprovals() : Promise.resolve(null),"), 'the owner feed is not read for staff');
    assert.ok(count.includes('const owners = !owner ? 0 :'), 'the owners count is zero for staff');
    const search = read('src/app/api/messaging/search/route.ts');
    assert.ok(search.includes("const audiences = inboxAudiencesFor((await sessionRole()) ?? 'staff');"));
    assert.ok(search.includes('loadInboxSearch(listInboxSearchApprovals, audiences)'));
  });

  test('countersigning an agreement and sending a campaign are owner acts', () => {
    const agreements = read('src/app/guests/agreements/actions.ts');
    const countersign = agreements.match(/export async function countersignAgreement[\s\S]*?(?=\nexport async function |$)/);
    assert.ok(countersign && countersign[0].includes('await requireOwnerEmail();'), 'countersignAgreement must require an owner');
    const page = read('src/app/guests/agreements/[id]/page.tsx');
    assert.ok(page.includes('const owner = await isOwnerSession();'), 'the agreement page reads the role');
    assert.ok(/!a\.voided_at && \(owner \? \(\s*<form action=\{countersignAgreement\}>/.test(page), 'staff get no Countersign button that would fail');
    const campaigns = read('src/app/guests/campaigns/actions.ts');
    const send = campaigns.match(/export async function sendCampaign\(formData[\s\S]*?(?=\nexport async function |$)/);
    assert.ok(send && send[0].includes('await requireOwnerEmail();'), 'sendCampaign must require an owner');
    const test_ = campaigns.match(/export async function sendCampaignTest[\s\S]*?(?=\nexport async function |$)/);
    assert.ok(test_ && !test_[0].includes('requireOwnerEmail'), 'the test send stays open to staff');
  });

  test('the installment actions require an owner', () => {
    const src = read('src/app/properties/[id]/installment-actions.ts');
    for (const name of ['loadMultiMonthData', 'dismissInstallmentSuggestion', 'restoreInstallmentSuggestion']) {
      const m = src.match(new RegExp(`export async function ${name}\\b[\\s\\S]*?(?=\\nexport async function |$)`));
      assert.ok(m && m[0].includes('await requireOwnerEmail();'), `${name} must require an owner`);
    }
  });
});
