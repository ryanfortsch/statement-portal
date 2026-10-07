/**
 * The weekly reflection pass must keep a reader: the wiring audit.
 *
 * stay-concierge's reflection pass reads the coaching log and the
 * AI-drafted-vs-human-sent diffs, finds the rules being taught over and over
 * that the canon never absorbed, and writes them to
 * prompts/reference/reflection_report.md. It deliberately never applies them
 * itself. That was correct, and for five weekly runs it also meant nothing
 * applied them at all: the report had no reader on either side of the bridge
 * and api_attention hid the alert, so 25 proposals accumulated with no path
 * to a decision.
 *
 * What that cost, concretely. On 2026-09-15 the pass filed "Default to K-cup
 * coffee makers across all properties" at [high], citing two coachings by
 * name. Eleven days later it still had not shipped and the same correction
 * had been given four more times. Across the whole log it had been coached
 * 39 times on 12 different properties and generalized zero times.
 *
 * Every link in the chain that fixes this is one line that deletes cleanly
 * and silently: an import, a `<ReflectionSection />` in the page tree, an
 * actor header, a scope default. Losing any one of them puts the report back
 * in the drawer, and nothing else would go red. So this reads the source and
 * asserts each link is still attached.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('the reflection report has a reader', () => {
  test('the bridge client can list, promote and dismiss', () => {
    const src = read('src/lib/stay-concierge.ts');
    for (const fn of [
      'listReflectionProposals',
      'promoteReflectionProposal',
      'dismissReflectionProposal',
    ]) {
      assert.ok(src.includes(`export async function ${fn}`), `bridge client lost ${fn}`);
    }
    assert.ok(
      src.includes("'/api/reflection/proposals'"),
      'the list call no longer points at the reflection route',
    );
  });

  test('a decision names the operator, so the concierge log says who', () => {
    const src = read('src/lib/stay-concierge.ts');
    const promote = src.slice(src.indexOf('export async function promoteReflectionProposal'));
    assert.ok(
      /\bactor\b/.test(promote.slice(0, 600)),
      'promote no longer forwards the actor; the decision log would read "helm-dashboard"',
    );
    const actions = read('src/app/messaging/reflection-actions.ts');
    assert.ok(
      actions.includes('session?.user?.email') && actions.includes('email,'),
      'the server action no longer passes the signed-in email through',
    );
  });

  test('/messaging actually renders the section', () => {
    const page = read('src/app/messaging/page.tsx');
    assert.ok(
      page.includes("from './ReflectionProposals'"),
      '/messaging no longer imports the proposals card',
    );
    assert.ok(
      page.includes('listReflectionProposals'),
      '/messaging no longer fetches the proposals',
    );
    assert.ok(
      page.includes('<ReflectionSection />'),
      'the proposals section is defined but never mounted in the page tree',
    );
  });

  test('promoting defaults to fleet scope, which is the whole point', () => {
    // A proposal reaches this card because the same correction landed on many
    // properties. Filing it back under one property would recreate the bug it
    // exists to end.
    const actions = read('src/app/messaging/reflection-actions.ts');
    assert.ok(
      actions.includes("'all properties'"),
      'the promote action no longer defaults to fleet scope',
    );
    const panel = read('src/app/messaging/ReflectionProposals.tsx');
    assert.ok(
      panel.includes("useState('all properties')"),
      'the scope field no longer starts fleet-wide',
    );
  });

  test('the rule is editable before it becomes canon', () => {
    // Whatever is promoted outranks the property KB and the raw coaching log
    // on every future draft. That text should be text a person chose.
    const panel = read('src/app/messaging/ReflectionProposals.tsx');
    assert.ok(
      panel.includes('<textarea') && panel.includes('setRule'),
      'the proposed rule is no longer editable in the card',
    );
    const actions = read('src/app/messaging/reflection-actions.ts');
    assert.ok(
      actions.includes('The rule cannot be empty'),
      'an empty rule could be promoted into canon',
    );
  });

  test('a decision made in another tab is explained, not swallowed', () => {
    const actions = read('src/app/messaging/reflection-actions.ts');
    const conflicts = actions.match(/status === 409/g) ?? [];
    assert.equal(
      conflicts.length,
      2,
      'promote and dismiss must both explain a 409 rather than show a raw error',
    );
  });
});
