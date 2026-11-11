/**
 * The Quality lens (2026-10-17): everything analytical and every "teach the
 * AI" surface lives at /messaging/quality, off the working page. The Inbox
 * ends at Conversations, and the count of property facts to file is the
 * pill on the Quality lens label, not a line of its own on the queue pages
 * (UX audit 2026-11-07). Reads the sources, since each move is one import
 * that comes back silently.
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
    assert.ok(!inbox.includes('PropertyFactsToFile'), 'the Inbox carries no facts line of its own');
  });

  test('the sibling queues carry neither the card nor the count line', () => {
    for (const page of ['src/app/owner-messaging/page.tsx', 'src/app/messaging/team/page.tsx']) {
      const src = read(page);
      assert.ok(!src.includes('ProposedPropertyUpdatesCard'), `${page} still mounts the card`);
      assert.ok(!src.includes('PropertyFactsToFile'), `${page} still carries the count line`);
    }
  });

  test('the count is the pill on the Quality lens label', () => {
    const tabs = read('src/components/MessagingTabs.tsx');
    assert.ok(tabs.includes(`{l.id === 'quality' && <Suspense fallback={null}><PropertyFactsToFile /></Suspense>}`), 'the Quality lens carries the facts pill');
    const pill = read('src/components/PropertyFactsToFile.tsx');
    assert.ok(pill.includes('if (!n) return null;'), 'nothing at zero');
    assert.ok(pill.includes('cache(async'), 'one concierge read per request');
  });

  test('the lens mounts all of it, and the owner slice only for an owner', () => {
    const page = read('src/app/messaging/quality/page.tsx');
    for (const part of ['<ProposedFacts', '<ReflectionSection />', '<AnalyticsSection />', '<PerformanceDropdown']) {
      assert.ok(page.includes(part), `the Quality lens does not mount ${part}`);
    }
    // One proposed-facts design (2026-11-08): the two older cards are gone.
    for (const gone of ['TriagedPropertyUpdates', 'ProposedPropertyUpdatesCard', 'SharedFactsSection']) {
      assert.ok(!page.includes(gone), `the Quality lens still mounts ${gone}`);
    }
    // The page reads exactly the sources the lens pill counts, and a staff
    // login never reads owner-sourced facts: both ask factSourcesFor(role).
    assert.ok(page.includes('const sources: FactAudience[] = factSourcesFor(await sessionRole());'), 'a staff login must not read owner-sourced facts');
    assert.ok(page.includes('sources.map((audience) => listProposedPropertyUpdates(listAudienceArg(audience)))'), 'the list reads each allowed source');
    assert.equal((page.match(/listProposedPropertyUpdates\(/g) ?? []).length, 1, 'one read per source, through factSourcesFor');
    assert.ok(read('src/components/PropertyFactsToFile.tsx').includes('factSourcesFor(role).map('), 'the pill counts the same sources');
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

  test('Performance is one number and its chart; the rest sits behind Learning', () => {
    const perf = read('src/app/messaging/PerformanceDropdown.tsx');
    assert.ok(!perf.includes('aria-label="Performance panels"') && !perf.includes('<TabBar'), 'the three tabs are gone');
    assert.ok(!perf.includes('const [open, setOpen] = useState(true);'), 'no fold around the whole block');
    const headline = perf.indexOf('<Headline');
    const chart = perf.indexOf('<TrendChart');
    const learning = perf.indexOf('<details className="rt-msg-learning"');
    const breakdown = perf.indexOf('<Breakdown');
    const recent = perf.indexOf('<RecentList');
    const facts = perf.indexOf('<LearningSection');
    assert.ok(headline > 0 && headline < chart && chart < learning, 'the number, then its chart, then Learning');
    for (const [name, at] of [['Breakdown', breakdown], ['RecentList', recent], ['LearningSection', facts]] as const) {
      assert.ok(at > learning, `${name} sits inside Learning`);
    }
    // The one number is still the substantive one-shot rate, falling back to
    // the overall rate on a concierge build that does not send it.
    assert.ok(perf.includes('const heroPct = sub ? subPct : oneShotPct;'));
  });

  test('a decision on the lens revalidates the lens', () => {
    for (const actions of ['src/app/messaging/facts-actions.ts', 'src/app/messaging/reflection-actions.ts', 'src/app/messaging/fact-audit-actions.ts', 'src/app/owner-messaging/proposed-updates-actions.ts']) {
      assert.ok(read(actions).includes("revalidatePath('/messaging/quality')"), `${actions} does not revalidate the Quality lens`);
    }
  });
});
