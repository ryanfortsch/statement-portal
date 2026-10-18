import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { FEED_NAMES, agoWords, feedLine, plainDates } from '../sync-feed-words.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const exists = (repoPath: string): boolean => existsSync(new URL(`../../../${repoPath}`, import.meta.url));

describe('/today is retired into the home', () => {
  test('the page, its Mark handled and its loader are gone; the route redirects home', () => {
    for (const f of ['src/app/today/page.tsx', 'src/app/today/actions.ts', 'src/app/today/MarkHandledButton.tsx']) {
      assert.ok(!exists(f), `${f} should be gone`);
    }
    assert.ok(/source: '\/today',\n\s*destination: '\/',/.test(read('next.config.ts')));
  });

  test('today at the houses is a home section under the feed', () => {
    const feed = read('src/components/ForMeFeed.tsx');
    assert.ok(feed.includes('<TodayAtTheHousesSection houses={houses} />'));
    assert.ok(feed.indexOf('<TodayAtTheHousesSection') > feed.indexOf('shown.map((key) => ('), 'it renders after the feed');
    assert.ok(!feed.includes('Open full brief'), 'no link promises a fuller page');
    assert.ok(!feed.includes('MarkHandled'), 'the × is the email\'s one verb');
  });

  test('the brief loader carries only what the home reads, on the Eastern day', () => {
    const brief = read('src/lib/daily-brief.ts');
    for (const gone of ['listApprovals(', "from('projections')", "from('data_gaps')", 'channelsAttention: await', 'export function briefHeadline']) {
      assert.ok(!brief.includes(gone), `loadDailyBrief still does ${gone}`);
    }
    assert.ok(brief.includes('return operatingDate();'), 'today is Gloucester\'s day, not UTC\'s');
  });

  test('sync health lives on Delivery & sync', () => {
    const status = read('src/app/messaging/status/page.tsx');
    assert.ok(status.includes('<SyncFeedsSection />') && status.includes('<HelmRunHomesSection />'));
  });
});

describe('sync feeds read in operator words', () => {
  test('every watched feed has a name', () => {
    const brief = read('src/lib/daily-brief.ts');
    const watched = [...brief.matchAll(/\{ source: '([a-z-]+)',/g)].map((m) => m[1]);
    assert.ok(watched.length >= 10, 'the watchdog table was found');
    for (const s of watched) assert.ok(FEED_NAMES[s], `no name for ${s}`);
  });

  test('a row says Broken or Delayed and when it last worked, never the raw error', () => {
    const now = Date.parse('2026-10-18T15:00:00Z');
    const broken = feedLine({ source: 'ical', status: 'error', lastAttemptedAt: '2026-10-18T14:00:00Z', lastSyncedAt: '2026-10-18T11:00:00Z', errorCount: 3 }, now);
    assert.deepEqual(broken, { name: 'Channel calendars', word: 'Broken', detail: 'failed 3 times in a row; last worked 4 hours ago' });
    const stale = feedLine({ source: 'quo', status: 'stale', lastAttemptedAt: null, lastSyncedAt: '2026-10-16T15:00:00Z', errorCount: 0 }, now);
    assert.deepEqual(stale, { name: 'Texts and calls from Quo', word: 'Delayed', detail: 'last ran 2 days ago' });
    assert.equal(agoWords('2026-10-18T14:59:30Z', now), 'just now');
  });

  test('Helm-run home notes print plain dates', () => {
    assert.equal(plainDates('3 closures (first 2026-11-03): check'), '3 closures (first Tue, Nov 3): check');
  });
});
