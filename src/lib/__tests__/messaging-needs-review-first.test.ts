/**
 * Needs review comes first on every inbox page (2026-10-18, Dotti: "I want
 * the needs review section ... front and center"). Above the queue only what
 * could change what is in it: the AI-down banner, a delivery problem, and on
 * guests the concierge's alerts. Search, the routine Delivery & sync row,
 * Proactive messages and history sit below. Reads the page sources.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** The JSX of the page's default export, where the order is decided. */
const body = (src: string) => src.slice(src.indexOf('export default'));

const PAGES: [string, string, string[]][] = [
  ['src/app/messaging/page.tsx', '<QueueSection />', ['<RecentDecisionsSection />', '<ConversationsSection', '<RecentMessageOutcomesSection', '<InboxBottomTools />']],
  ['src/app/owner-messaging/page.tsx', '<OwnerQueueSection />', ['<RecentMessageOutcomesSection', '<OwnerDetailSection />', '<OwnerProactive />', '<InboxBottomTools />']],
  // The Team inbox (cleaners and contractors, 2026-10-18).
  ['src/app/messaging/team/page.tsx', '<QueueSection audience={audience} />', ['<OwnerHoldSection', '<ScheduleDigestSection', '<RecentMessageOutcomesSection', '<CleanerProactive', '<ContractorProactive', '<InboxBottomTools />']],
];

describe('needs review first', () => {
  test('on every inbox page the queue precedes every other section', () => {
    for (const [page, queue, after] of PAGES) {
      const src = body(read(page));
      const at = src.lastIndexOf(queue);
      assert.ok(at > 0, `${page} does not mount its queue`);
      for (const part of after) {
        const i = src.lastIndexOf(part);
        assert.ok(i > at, `${page}: ${part} renders above the queue`);
      }
    }
  });

  test('the tab strip draws no search or status row; problems only above the queue', () => {
    const tabs = read('src/components/MessagingTabs.tsx');
    assert.ok(!tabs.includes('<InboxSearch') && !tabs.includes('<InboxHealth'), 'search and status left the tab strip');
    const health = read('src/components/InboxHealth.tsx');
    assert.ok(health.includes("if (!diagnostics && (placement === 'top') !== status.attention) return null;"), 'top renders only on attention, bottom only otherwise');
    assert.ok(health.includes('const loadStatus = cache('), 'two placements share one read');
    for (const [page] of PAGES) assert.ok(read(page).includes('<InboxHealth placement="top" />'), `${page} lost the problem row above the queue`);
  });

  test('the owner page sheds the Last 24 hours strip and the AI rules editor', () => {
    const owner = read('src/app/owner-messaging/page.tsx');
    assert.ok(!owner.includes('OwnerRecentStrip') && !owner.includes('OwnerFactsEditor'));
    assert.ok(!existsSync(new URL('../../app/owner-messaging/OwnerRecentStrip.tsx', import.meta.url)));
    const quality = read('src/app/messaging/quality/page.tsx');
    assert.ok(quality.includes('<OwnerFactsSection />') && quality.includes("if ((await sessionRole()) !== 'owner') return null;"), 'the owner rules live on the Quality lens, owners only');
    assert.ok(read('src/app/owner-messaging/actions.ts').includes('await requireOwnerEmail();'), 'saving the owner rules is owners only');
  });
});
