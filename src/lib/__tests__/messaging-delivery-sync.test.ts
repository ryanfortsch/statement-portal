/**
 * Delivery & sync wears the messaging shell and says Working / Delayed /
 * Broken per channel (2026-10-17), with the service's own label in a title.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { channelWord } from '../inbox-status.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('Delivery & sync', () => {
  test('three plain words per channel, the raw label kept for a title', () => {
    assert.deepEqual(['ok', 'checking'].map((s) => channelWord(s).word), ['Working', 'Working']);
    assert.deepEqual(['partial', 'stale', 'unverified', 'something_new'].map((s) => channelWord(s).word), ['Delayed', 'Delayed', 'Delayed', 'Delayed']);
    assert.equal(channelWord('failed').word, 'Broken');
    assert.equal(channelWord('disabled').word, 'Off');
    assert.equal(channelWord('stale').raw, 'Check overdue');
    assert.equal(channelWord('unverified').raw, 'Not verified');
    const health = read('src/components/InboxHealth.tsx');
    assert.ok(health.includes('title={channelWord(channel.status).raw}'), 'the raw label rides in a title');
    assert.ok(!health.includes("ok: 'Checked'"), 'no second label map');
  });

  test('the page has the messaging shell: tabs and footer, no back link', () => {
    const page = read('src/app/messaging/status/page.tsx');
    assert.ok(page.includes('<MessagingTabs current="none" />'));
    assert.ok(page.includes('<MessagingFooter />'));
    assert.ok(!page.includes('← Messaging'));
    // The disclosure at the foot of each inbox page is the one door to
    // Delivery & sync; the footer carries no link (UX audit 2026-11-07).
    const footer = read('src/components/MessagingFooter.tsx');
    assert.ok(!footer.includes('/messaging/status'), 'the footer links nowhere');
    assert.ok(!footer.includes('self'), 'no self flag is left');
  });
});
