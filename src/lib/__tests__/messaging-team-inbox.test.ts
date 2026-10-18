/**
 * One Team inbox for the cleaners and the contractors (2026-10-18).
 *
 * The two queues differed by one option group and one warning, and a new
 * hire learned one page and was wrong on the other. Now /messaging/team is
 * one list with an audience chip on each card and an All / Cleaners /
 * Contractors filter; the old routes redirect there with the filter set, and
 * every link Helm prints points at the new home.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseTeamAudience, showsCleaners, showsContractors, teamHref } from '../team-inbox.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('the Team inbox', () => {
  test('the filter reads the URL, and the cleaners own their sections', () => {
    assert.equal(parseTeamAudience(undefined), 'all');
    assert.equal(parseTeamAudience('cleaners'), 'cleaners');
    assert.equal(parseTeamAudience(['contractors']), 'contractors');
    assert.equal(parseTeamAudience('owners'), 'all', 'anything else is All');
    assert.equal(teamHref('all'), '/messaging/team');
    assert.equal(teamHref('cleaners', '#schedule-digest'), '/messaging/team?audience=cleaners#schedule-digest');
    assert.ok(showsCleaners('all') && showsCleaners('cleaners') && !showsCleaners('contractors'));
    assert.ok(showsContractors('all') && showsContractors('contractors') && !showsContractors('cleaners'));
  });

  test('the old routes redirect with the filter set, and their pages are gone', () => {
    const config = read('next.config.ts');
    assert.match(config, /source: '\/cleaner-messaging',\s*destination: '\/messaging\/team\?audience=cleaners'/);
    assert.match(config, /source: '\/contractor-messaging',\s*destination: '\/messaging\/team\?audience=contractors'/);
    for (const page of ['cleaner-messaging', 'contractor-messaging']) {
      assert.ok(!existsSync(new URL(`../../app/${page}/page.tsx`, import.meta.url)), `${page}/page.tsx would shadow nothing but confuse`);
    }
  });

  test('three tabs: Guests, Owners for owners, Team', () => {
    const tabs = read('src/components/MessagingTabs.tsx');
    assert.ok(tabs.includes("{ id: 'team', label: 'Team', href: '/messaging/team', badge: <MessagingTabCount category=\"team\" /> }"));
    assert.ok(!tabs.includes("id: 'cleaners'") && !tabs.includes("id: 'contractors'"), 'no separate crew tabs');
    const count = read('src/components/MessagingTabCount.tsx');
    assert.ok(count.includes('data.cleaners + data.contractors'), 'the Team pill is both queues');
    const atlas = read('src/lib/helm-modules.ts');
    assert.ok(atlas.includes("id: 'messaging-team'") && atlas.includes("href: '/messaging/team'"));
    assert.ok(!atlas.includes("href: '/cleaner-messaging'") && !atlas.includes("href: '/contractor-messaging'"));
  });

  test('every link Helm prints lands on the Team inbox', () => {
    for (const file of [
      'src/components/ForMeFeed.tsx',
      'src/app/turnovers/schedule/page.tsx',
      'src/app/turnovers/schedule/actions.ts',
      'src/lib/inbox-search.ts',
      'src/lib/concierge-alerts.ts',
      'src/lib/message-outcomes.ts',
      'src/app/messaging/guest-card-blocks.tsx',
      'src/app/cleaner-messaging/actions.ts',
      'src/app/contractor-messaging/actions.ts',
      'src/app/cleaner-messaging/reminders-actions.ts',
      'src/app/contractor-messaging/reminders-actions.ts',
      'src/app/owner-messaging/proposed-updates-actions.ts',
      'src/app/api/turnover-notes/route.ts',
    ]) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      assert.ok(!/['"`]\/(cleaner|contractor)-messaging/.test(code), `${file} still links the old route`);
    }
  });

  test('each card says whose it is, and the cleaners keep their asks', () => {
    const queue = read('src/app/messaging/team/TeamInboxQueue.tsx');
    assert.ok(queue.includes("<Pill label={row.kind === 'cleaner' ? 'Cleaner' : 'Contractor'}"), 'an audience chip on every card');
    assert.ok(queue.includes('toolbar={<TeamFilter audience={audience} counts={counts} />}'), 'the filter row');
    const page = read('src/app/messaging/team/page.tsx');
    assert.ok(/\{cleaners && \(\s*<>\s*<Suspense fallback=\{null\}>\s*<OwnerHoldSection/.test(page), 'clean after? shows with the cleaners');
    assert.ok(page.includes('<ScheduleDigestSection searchParams={searchParams} />'), 'the schedule text stays a section');
    // One Proactive messages panel, with a Cleaners / Contractors pick on All.
    assert.ok(page.includes('<TeamProactiveSection audience={audience} />'));
    assert.equal((page.match(/<ProactiveRemindersPanel /g) ?? []).length, 2, 'one panel per single-audience filter');
    assert.ok(read('src/app/messaging/team/TeamProactive.tsx').includes('aria-label="Proactive messages for"'), 'the pick on All');
  });
});
