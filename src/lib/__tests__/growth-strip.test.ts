/**
 * The one Growth strip.
 *
 * Growth used to stack the masthead, a Growth strip, a hero and a Guests
 * strip, each rendered by the page, so the second strip appeared on four of
 * eighteen routes and jumped between siblings. Now the three Growth layouts
 * render one strip and no page draws chrome of its own. This checks the
 * tab each path lights, that the layouts own the chrome, and that no page
 * brings it back.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { growthTabFor } from '../growth-tabs.ts';

const root = new URL('../../../', import.meta.url);
const read = (repoPath: string): string => readFileSync(new URL(repoPath, root), 'utf8');

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(new URL(rel, root))) {
      const child = `${rel}/${name}`;
      if (statSync(new URL(child, root)).isDirectory()) walk(child);
      else if (name === 'page.tsx') out.push(child);
    }
  };
  walk(dir);
  return out;
}

describe('which tab a Growth path lights', () => {
  const cases: Array<[string, ReturnType<typeof growthTabFor>]> = [
    ['/marketing', 'marketing'],
    ['/marketing/airdna', 'marketing'],
    ['/guests', 'reviews'],
    ['/guests/', 'reviews'],
    ['/guests/contacts', 'contacts'],
    ['/guests/0b9c3e7a-uuid', 'contacts'],
    ['/guests/campaigns', 'contacts'],
    ['/guests/campaigns/new', 'contacts'],
    ['/guests/agreements', 'agreements'],
    ['/guests/agreements/new', 'agreements'],
    ['/guests/agreements/abc', 'agreements'],
    ['/guests/agreements/abc/edit', 'agreements'],
    ['/guests/quotes', 'quotes'],
    ['/guests/quotes/abc/edit', 'quotes'],
    ['/competitors', 'competitors'],
    ['/competitors/atlantic-vacation-homes', 'competitors'],
    // The document preview prints as the guest's PDF: no chrome at all.
    ['/guests/agreements/abc/doc', null],
  ];
  for (const [path, tab] of cases) {
    test(`${path} -> ${tab}`, () => assert.equal(growthTabFor(path), tab));
  }
  test('Reviews lights only on the bare /guests, never on a guest record', () => {
    assert.notEqual(growthTabFor('/guests/abc'), 'reviews');
  });
});

describe('the Growth layouts own the chrome', () => {
  test('one strip, six tabs, in reading order, Quotes handed to SectionTabs', () => {
    const src = read('src/components/GrowthTabs.tsx');
    const labels = [...src.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(labels, ['Marketing', 'Reviews', 'Contacts', 'Agreements', 'Quotes', 'Competitors']);
    assert.ok(src.includes('<SectionTabs'), 'the strip is a SectionTabs wrapper, so the role filter applies');
    assert.ok(!src.includes("label: 'Guests'"), 'no tab is called Guests');
  });

  for (const dir of ['guests', 'marketing', 'competitors']) {
    test(`src/app/${dir}/layout.tsx renders the Growth frame`, () => {
      const src = read(`src/app/${dir}/layout.tsx`);
      assert.ok(src.includes('<GrowthFrame masthead={<HelmMasthead />}>{children}</GrowthFrame>'));
    });
  }

  test('the old per-page strips are gone', () => {
    assert.ok(!existsSync(new URL('src/components/MarketingTabs.tsx', root)));
    assert.ok(!existsSync(new URL('src/app/guests/GuestsTabBar.tsx', root)));
  });

  const pages = ['src/app/guests', 'src/app/marketing', 'src/app/competitors'].flatMap(pagesUnder);
  test('the Growth pages were found', () => assert.ok(pages.length >= 15, `only ${pages.length} pages`));
  for (const page of pages) {
    test(`${page} draws no chrome of its own`, () => {
      const src = read(page);
      for (const chrome of ['HelmMasthead', 'MarketingTabs', 'GuestsTabBar', 'min-h-screen']) {
        assert.ok(!src.includes(chrome), `${page} still renders ${chrome}; the Growth layout owns it`);
      }
    });
  }

  test('Contacts, Agreements and Quotes open on their lists, with no hero', () => {
    for (const page of ['src/app/guests/contacts/page.tsx', 'src/app/guests/agreements/page.tsx', 'src/app/guests/quotes/page.tsx', 'src/app/guests/page.tsx']) {
      const src = read(page);
      assert.ok(!src.includes('HelmHero') && !src.includes('<h1'), `${page} still has a hero`);
    }
  });

  test('Reviews opens on 30 days, the window the Marketing five-star tile reads', () => {
    const src = read('src/app/guests/ReviewsTab.tsx');
    assert.ok(src.includes('const DEFAULT_WINDOW: WindowDays = 30;'));
    assert.ok(src.includes(': DEFAULT_WINDOW;'));
  });
});

describe('Contacts: two verbs and one menu', () => {
  test('the toolbar is Add contact, New campaign and Manage list, and nothing else', () => {
    const page = read('src/app/guests/contacts/page.tsx');
    assert.ok(page.includes('<AddGuestContactForm />'));
    assert.ok(page.includes('New campaign'));
    assert.ok(page.includes('<ManageListMenu lastGuestySync={lastGuestySyncRel} />'));
    for (const gone of ['/guests/import', '/guests/segments', 'Recent Campaigns', 'listCampaigns', 'listSegments', 'Import CSV', 'imported=']) {
      assert.ok(!page.includes(gone), `Contacts should no longer carry ${gone}`);
    }
    assert.ok(read('src/app/guests/contacts/AddGuestContactForm.tsx').includes('Add contact'));
  });

  test('the menu holds the campaigns archive, the CSV file input and the Guesty sync', () => {
    const menu = read('src/app/guests/contacts/ManageListMenu.tsx');
    assert.ok(menu.includes('href="/guests/campaigns"'));
    assert.ok(menu.includes('type="file"') && menu.includes('importContactsFromCsv(data)'), 'the import is a file input in the menu');
    assert.ok(menu.includes('action={syncFromGuesty}'));
    assert.ok(menu.includes('Helm also runs it every morning.'), 'the sync says the schedule already does it');
    assert.ok(menu.includes('/playbook/import-guest-contacts-from-a-csv'), 'the column map is in the Playbook');
  });

  test('the import answers inline instead of throwing or redirecting', () => {
    const actions = read('src/app/guests/actions.ts');
    const m = actions.match(/export async function importContactsFromCsv[\s\S]*?(?=\nexport async function |$)/);
    assert.ok(m, 'importContactsFromCsv is found');
    assert.ok(m![0].includes('Promise<ImportOutcome>'));
    assert.ok(!m![0].includes('redirect('), 'no redirect flash in the URL');
    assert.ok(!/throw new Error\('(No file|Empty file|File too large|No valid)/.test(m![0]), 'a bad file is an inline answer');
  });

  test('Segments and Import are not pages; their URLs redirect', () => {
    assert.ok(!existsSync(new URL('src/app/guests/segments/page.tsx', root)));
    assert.ok(!existsSync(new URL('src/app/guests/import/page.tsx', root)));
    const config = read('next.config.ts');
    assert.ok(/source: '\/guests\/segments',\n\s*destination: '\/guests\/campaigns\/new',/.test(config));
    assert.ok(/source: '\/guests\/import',\n\s*destination: '\/guests\/contacts',/.test(config));
  });

  test('the new-campaign Audience select carries each segment with who it reaches', () => {
    const form = read('src/app/guests/campaigns/new/CampaignCreationForms.tsx');
    assert.ok(form.includes('Audience'));
    assert.ok(!form.includes('Send to'), 'Send to is the send page\'s word, not the draft page\'s');
    assert.ok(form.includes("{s.name}{s.count != null ? ` · ${s.count.toLocaleString('en-US')}"));
    const page = read('src/app/guests/campaigns/new/page.tsx');
    assert.ok(page.includes('countSegmentRecipients(s)'));
    const count = read('src/lib/guests-campaigns.ts');
    assert.ok(count.includes(".select('id', { count: 'exact', head: true })"), 'a head count, so it reads past 1,000 rows');
  });

  test('the column map is a Playbook entry', () => {
    const sql = read('supabase/migrations/20261018190000_playbook_guest_list_import.sql');
    assert.ok(sql.includes("'import-guest-contacts-from-a-csv'"));
    for (const column of ['Email', 'First Name', 'Subscriber Since', 'Subscriber Source', 'Mailing Lists', 'Accepts Marketing']) {
      assert.ok(sql.includes(`**${column}`), `the entry names ${column}`);
    }
    assert.ok(sql.includes('on conflict (slug) do nothing'), 'additive and idempotent');
    assert.ok(!sql.includes('—'), 'no em dashes');
  });
});

describe('Marketing Memory lives on the property page as How we sell it', () => {
  test('the Growth route is gone and redirects; nothing links to it', () => {
    assert.ok(!existsSync(new URL('src/app/guests/marketing', root)));
    assert.ok(/source: '\/guests\/marketing',\n\s*destination: '\/properties',/.test(read('next.config.ts')));
    assert.ok(!read('src/app/guests/contacts/ManageListMenu.tsx').includes('/guests/marketing'));
  });

  test('the Guest & listing tab carries the block, for Cape Ann homes, with a retry on a failed read', () => {
    const page = read('src/app/properties/[id]/page.tsx');
    // A block of the Listing section since 2026-10-19: read here, Edit opens the editor.
    const guestTab = page.slice(page.indexOf('<TabSection tab="guest">'));
    assert.ok(guestTab.includes('sellIt={isCapeAnnOps({ region: pmsRegion }) ? howWeSellIt : null}'), 'the block sits on the Guest & listing tab, Cape Ann homes only');
    const panel = read('src/app/properties/[id]/ListingPanel.tsx');
    assert.ok(panel.includes('id="how-we-sell-it"') && panel.includes('title="How we sell it"'));
    assert.ok(panel.includes('<HowWeSellIt propertyId={propertyId} row={row} onSaved={() => setEditing(false)} />'));
    assert.ok(panel.includes('This could not be loaded. Nothing you saved has changed.'));
  });

  test('the editor has no sleeps or bedrooms, and the table is service-role only', () => {
    const editor = read('src/app/properties/[id]/HowWeSellIt.tsx');
    assert.ok(!editor.includes('name="sleeps"') && !editor.includes('name="bedrooms"'));
    const sql = read('supabase/migrations/20261018191000_property_marketing_service_role.sql');
    assert.ok(sql.includes('enable row level security'));
    assert.ok(!/create policy/i.test(sql), 'no anon policies: the anon key is public');
    assert.ok(!/^\s*(sleeps|bedrooms) integer/m.test(sql), 'the new table keeps no sleeps or bedrooms column');
  });
});
