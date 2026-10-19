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

  test('the card opens on the newest three numbers; the rest wait behind Show all', () => {
    const card = read('src/components/messaging/NumberTriage.tsx');
    assert.ok(card.includes('const RECENT_SHOWN = 3;'));
    assert.ok(card.includes('visibleUnknowns.slice(0, RECENT_SHOWN)'), 'a backlog never fills the inbox');
    assert.ok(card.includes('Show all {recentCount}'));
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

describe('the CRM list and the contact page', () => {
  test('one Refresh replaces the three sync buttons', () => {
    const list = read('src/app/crm/CrmListClient.tsx');
    assert.ok(list.includes('<RefreshCrmButton />'));
    for (const old of ['SyncGmailButton', 'SyncQuoButton', 'SyncQuoContactsButton']) assert.ok(!list.includes(old), `${old} is still on the list`);
    const button = read('src/app/crm/RefreshCrmButton.tsx');
    for (const url of ['/api/cron/sync-gmail-replies?hours=24', '/api/sync-quo', '/api/sync-quo-contacts']) assert.ok(button.includes(url), `Refresh runs ${url}`);
    assert.ok(button.includes('combineManualSyncs(await Promise.all(SOURCES.map(runOne)))'), 'one line for all three');
  });

  test('New contact starts as a Vendor, or as the type pill that is on', () => {
    assert.ok(read('src/app/crm/NewContactModal.tsx').includes("useState<ContactType>(initialType ?? 'vendor')"));
    assert.ok(read('src/app/crm/CrmListClient.tsx').includes("initialType={filter === 'all' ? undefined : filter}"));
  });

  test('linked properties are checkboxes, with no Mac-only hint', () => {
    for (const f of ['src/app/crm/NewContactModal.tsx', 'src/app/crm/[id]/ContactDetail.tsx']) {
      const src = read(f);
      assert.ok(src.includes('<PropertyCheckboxes properties={properties} value={linkedPropertyIds} onChange={setLinkedPropertyIds} />'), `${f} uses checkboxes`);
      assert.ok(!src.includes('multiple') && !src.includes('Hold ⌘'), `${f} still has the multi-select`);
    }
  });

  test('Touches is Activity everywhere it is read', () => {
    const detail = read('src/app/crm/[id]/ContactDetail.tsx');
    assert.ok(detail.includes('>\n            Activity\n          </h2>') && detail.includes("'Log activity'"));
    for (const [f, old] of [
      ['src/app/crm/[id]/ContactDetail.tsx', '>\n            Touches\n'],
      ['src/app/crm/[id]/ContactDetail.tsx', 'Log Touch'],
      ['src/app/crm/[id]/ContactDetail.tsx', 'No touches'],
      ['src/app/properties/[id]/PropertyCrmSection.tsx', 'Recent touches'],
      ['src/app/properties/[id]/PropertyCrmSection.tsx', 'No touches'],
      ['src/app/properties/[id]/PropertyActivity.tsx', "'Contact touch'"],
      ['src/lib/manual-sync-result.ts', 'new touches'],
    ] as const) {
      assert.ok(!read(f).includes(old), `${f} still says ${old}`);
    }
  });
});
