/**
 * The Quality lens (2026-10-17): everything analytical and every "teach the
 * AI" surface lives at /messaging/quality, off the working page. The Inbox
 * ends at Conversations with one line, "N property facts to file", and the
 * owner, cleaner and contractor pages keep the same line. Reads the sources,
 * since each move is one import that comes back silently.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HELM_MODULES } from '../helm-modules.ts';
import { factSourcesFor, factsToFileLabel, sumPendingFacts } from '../property-facts-to-file.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('the Quality lens', () => {
  test('nothing on the Inbox is analytics or AI training', () => {
    const inbox = read('src/app/messaging/page.tsx');
    for (const gone of ['PerformanceDropdown', 'TriagedPropertyUpdates', 'ReflectionProposals', 'getStats', 'getFacts', 'listProposedPropertyUpdates']) {
      assert.ok(!inbox.includes(gone), `the Inbox still carries ${gone}`);
    }
    assert.ok(inbox.includes('<PropertyFactsToFile />'), 'the Inbox keeps the one-line count');
  });

  test('the sibling queues keep the count line and lose the card', () => {
    for (const page of ['src/app/owner-messaging/page.tsx', 'src/app/messaging/team/page.tsx']) {
      const src = read(page);
      assert.ok(!src.includes('ProposedPropertyUpdatesCard'), `${page} still mounts the card`);
      assert.ok(src.includes('<PropertyFactsToFile />'), `${page} lost the count line`);
    }
  });

  test('the lens mounts all of it, and the owner slice only for an owner', () => {
    const page = read('src/app/messaging/quality/page.tsx');
    for (const part of ['<TriagedPropertyUpdates', '<ProposedPropertyUpdatesCard', '<ReflectionSection />', '<AnalyticsSection />', '<PerformanceDropdown']) {
      assert.ok(page.includes(part), `the Quality lens does not mount ${part}`);
    }
    assert.ok(page.includes("if (source === 'owner' && (await sessionRole()) !== 'owner') return null;"), 'a staff login must not read owner-sourced facts');
    assert.deepEqual(factSourcesFor('staff'), ['guest', 'cleaner', 'contractor']);
    assert.deepEqual(factSourcesFor('owner'), ['guest', 'cleaner', 'contractor', 'owner']);
    assert.equal(factsToFileLabel(1), '1 property fact to file');
    assert.equal(factsToFileLabel(3), '3 property facts to file');
    // A partial read counts what it got; no read at all keeps the line off the page.
    assert.equal(sumPendingFacts([{ ok: true, data: { updates: [{ status: 'pending' }, { status: 'applied' }, {}] } }, { ok: false }, null]), 2);
    assert.equal(sumPendingFacts([{ ok: false }, null]), null);
    assert.equal(sumPendingFacts([{ ok: true, data: { updates: [] } }]), 0);
  });

  test('the atlas knows the Quality and Saved replies lenses, and the strip offers Quality', () => {
    for (const [id, href] of [['messaging-quality', '/messaging/quality'], ['messaging-blurbs', '/messaging/blurbs']]) {
      const mod = HELM_MODULES.find((m) => m.id === id);
      assert.ok(mod, `${id} is missing from the atlas`);
      assert.equal(mod.href, href);
      assert.equal(mod.hidden, true);
      assert.equal(mod.section, 'messaging');
      assert.notEqual(mod.access, 'owner', `${id} must stay open to staff`);
    }
    const tabs = read('src/components/MessagingTabs.tsx');
    assert.ok(tabs.includes("{ id: 'quality', label: 'Quality', href: '/messaging/quality' }"));
  });

  test('a decision on the lens revalidates the lens', () => {
    for (const actions of ['src/app/messaging/facts-actions.ts', 'src/app/messaging/reflection-actions.ts', 'src/app/messaging/fact-audit-actions.ts', 'src/app/owner-messaging/proposed-updates-actions.ts']) {
      assert.ok(read(actions).includes("revalidatePath('/messaging/quality')"), `${actions} does not revalidate the Quality lens`);
    }
  });
});
