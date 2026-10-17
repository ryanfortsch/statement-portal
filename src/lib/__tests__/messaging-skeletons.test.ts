/**
 * A loading skeleton draws no chrome its page does not (2026-10-17). The
 * guest and owner skeletons used to render a HelmHero ("Module 08 ·
 * Messaging / Guest replies, one tap to ship.") and a footer naming the
 * model ("drafts via Opus 4.7") while the pages render neither, so every
 * navigation shifted layout the moment the page streamed in. Reads the
 * sources: each is one import that comes back silently.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** An imported or rendered hero, not the word in a comment. */
const drawsHero = (src: string) => /from '@\/components\/HelmHero'|<HelmHero/.test(src);

const PAIRS: [string, string][] = [
  ['src/app/messaging/loading.tsx', 'src/app/messaging/page.tsx'],
  ['src/app/owner-messaging/loading.tsx', 'src/app/owner-messaging/page.tsx'],
  ['src/app/cleaner-messaging/loading.tsx', 'src/app/cleaner-messaging/page.tsx'],
  ['src/app/contractor-messaging/loading.tsx', 'src/app/contractor-messaging/page.tsx'],
  ['src/app/messaging/send/loading.tsx', 'src/app/messaging/send/page.tsx'],
  ['src/app/messaging/quality/loading.tsx', 'src/app/messaging/quality/page.tsx'],
];

describe('messaging skeletons match their pages', () => {
  test('no hero, no model name, the same footer as the page', () => {
    for (const [loading, page] of PAIRS) {
      const skeleton = read(loading);
      const live = read(page);
      assert.ok(!drawsHero(skeleton), `${loading} draws a hero its page does not`);
      assert.ok(!/Opus|Sonnet|Claude/.test(skeleton), `${loading} names the model`);
      assert.ok(skeleton.includes('<MessagingFooter />'), `${loading} lacks the messaging footer`);
      assert.ok(live.includes('<MessagingFooter />'), `${page} lacks the messaging footer`);
      assert.ok(!drawsHero(live), `${page} renders a hero (then its skeleton must too)`);
    }
  });

  test('the queue placeholder is titled like the live queue', () => {
    const skeleton = read('src/components/QueueSkeleton.tsx');
    assert.ok(skeleton.includes("title = 'Needs review'"), 'the default title must match "Needs review (N)"');
    assert.ok(!skeleton.includes('"Pending"'), 'no stray Pending title');
    for (const queue of ['src/app/messaging/MessagingQueue.tsx', 'src/app/owner-messaging/OwnerMessagingQueue.tsx']) {
      assert.ok(read(queue).includes('`Needs review (${'), `${queue} no longer titles the queue Needs review`);
    }
  });
});
