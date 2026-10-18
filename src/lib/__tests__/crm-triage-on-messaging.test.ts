/**
 * The number triage lives where the texts are answered.
 *
 * Until 2026-10-18 the unknown Quo numbers and the Quo address-book
 * suggestions were two boxes at the top of /crm, with two verb sets for one
 * decision (Attach / Add as new / Dismiss, Add to Helm / Skip). They are one
 * card on /messaging now, with one verb set, and /crm opens straight on the
 * list.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('one card on /messaging', () => {
  test('the Inbox renders the card in its own boundary, after the queue', () => {
    const page = read('src/app/messaging/page.tsx');
    assert.ok(page.includes('<Suspense fallback={null}>\n        <NumberTriageSection />\n      </Suspense>'));
    assert.ok(page.indexOf('<NumberTriageSection />') > page.indexOf('<QueueSection />'), 'the queue comes first');
    assert.ok(page.includes('if (!triage || triageIsEmpty(triage)) return null;'), 'an empty card renders nothing');
  });

  test('one verb set on every row: Attach, New contact, Not ours', () => {
    const card = read('src/components/messaging/NumberTriage.tsx');
    for (const verb of ["'Attach'", '>\n            New contact\n', "'Not ours'", "isNew ? 'New contact' : 'Attach'", '>\n            Not ours\n']) {
      assert.ok(card.includes(verb), `the card is missing ${verb}`);
    }
    for (const old of ['Dismiss', 'Skip', 'Add as new', 'Add to Helm', 'Add email', 'Add org']) {
      assert.ok(!new RegExp(`>\\s*${old}\\s*<|'${old}'`).test(card), `the card still says ${old}`);
    }
    assert.ok(card.includes('id="new-numbers"'), 'the alert link lands on the card');
  });

  test('the concierge alert for an unknown Owners-line texter opens the card', () => {
    assert.ok(read('src/lib/concierge-alerts.ts').includes("{ label: 'Open New numbers', href: '/messaging#new-numbers' }"));
  });
});

describe('/crm opens on the list', () => {
  test('no triage and no hero on /crm', () => {
    const page = read('src/app/crm/page.tsx');
    const list = read('src/app/crm/CrmListClient.tsx');
    assert.ok(!page.includes('HelmHero'), 'the hero goes');
    for (const src of [page, list]) {
      for (const gone of ['quo_unknown_numbers', 'contact_reconcile_suggestions', 'unknownNumbers', 'dismissUnknownNumber', 'acceptContactSuggestion']) {
        assert.ok(!src.includes(gone), `/crm still carries ${gone}`);
      }
    }
  });

  test('the 60-day touch read pages past 1,000 rows', () => {
    const page = read('src/app/crm/page.tsx');
    const at = page.indexOf(".from('contact_touches')");
    assert.ok(at > 0);
    assert.ok(page.slice(Math.max(0, at - 400), at).includes('selectAllPaged<'), 'contact_touches is read through selectAllPaged');
    assert.ok(page.slice(at, at + 300).includes('.range(from, to)'));
  });
});
