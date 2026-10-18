/**
 * One status vocabulary across the four queues (2026-10-17): the same status
 * reads the same way on every strip, a benign state is never in the error
 * colour, provenance is claimed only where it is true, a configured hour is
 * printed rather than a hardcoded one, and the Cleaners pill's one number is
 * explained by a line naming its kinds. Reads the sources; each is one line.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanerKindsLine } from '../cleaner-queue-kinds.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('status words agree', () => {
  test('manual_sent reads Replied manually on the activity strip', () => {
    for (const strip of ['src/app/messaging/RecentStrip.tsx']) {
      assert.ok(/manual_sent: 'Replied manually'/.test(read(strip)), `${strip} calls manual_sent something else`);
      assert.ok(!/manual_sent: 'Sent via Quo'/.test(read(strip)), `${strip} still labels manual_sent Sent via Quo`);
    }
  });

  test('the owner card colours the follow-up line only for a real error', () => {
    const src = read('src/app/owner-messaging/OwnerMessagingQueue.tsx');
    assert.ok(src.includes("color: approval.followup_status.error ? 'var(--signal)' : 'var(--ink-3)'"), 'checking is benign');
  });

  test('the thread claims Guesty only on a Guesty thread', () => {
    const thread = read('src/app/messaging/Thread.tsx');
    assert.ok(thread.includes("const fromGuesty = !conversationId.startsWith('helm:');"));
    assert.ok(thread.includes("fromGuesty ? 'Live from Guesty' : 'Live from Helm'"));
    assert.ok(thread.includes("fromGuesty ? 'Loading the conversation from Guesty…' : 'Loading the conversation…'"));
    assert.ok(!/^\s*Loading the conversation from Guesty…$/m.test(thread), 'no unconditional Guesty claim');
    const card = read('src/app/messaging/MessagingQueue.tsx');
    assert.ok(card.includes("approval.conversation_id.startsWith('helm:') ? 'The full conversation history, live from Helm'"));
  });

  test('the digest card prints the configured send hour', () => {
    const src = read('src/app/cleaner-messaging/ScheduleDigestCard.tsx');
    assert.ok(!src.includes('Send automatically at 6 PM'), 'the hour is a setting, not a literal');
    assert.ok(src.includes('`Send automatically at ${formatTime12(`${String(settings.send_hour_et)'), 'the button reads send_hour_et');
  });

  test('the Cleaners pill is one number and the title row names the kinds', () => {
    assert.deepEqual(
      cleanerKindsLine({ texts: 1, schedules: 1, questions: 1 }).map((k) => k.label),
      ['1 text', '1 schedule', '1 question'],
    );
    assert.deepEqual(
      cleanerKindsLine({ texts: 2, schedules: 0, questions: null }).map((k) => k.label),
      ['2 texts'],
    );
    assert.deepEqual(cleanerKindsLine({ texts: 0, schedules: 0, questions: 0 }), []);
    assert.deepEqual(cleanerKindsLine({ texts: 0, schedules: 1, questions: 3 }).map((k) => k.href), ['#schedule-digest', '#owner-holds']);
    assert.ok(read('src/app/cleaner-messaging/page.tsx').includes('<CleanerQueueSummary />'), 'the cleaner page mounts the kinds row');
    for (const [file, id] of [['src/app/cleaner-messaging/ScheduleDigestCard.tsx', 'schedule-digest'], ['src/app/cleaner-messaging/OwnerHoldQuestionsCard.tsx', 'owner-holds'], ['src/app/cleaner-messaging/CleanerMessagingQueue.tsx', 'needs-review']]) {
      assert.ok(read(file).includes(`id="${id}"`), `${file} lost the ${id} anchor the row links to`);
    }
  });

  test('the Performance tiles use the strip words', () => {
    const src = read('src/app/messaging/PerformanceDropdown.tsx');
    assert.ok(src.includes('label="Replied manually"'));
    assert.ok(!src.includes('label="Handled in Guesty"') && !src.includes('label="Rejected"'));
  });
});
