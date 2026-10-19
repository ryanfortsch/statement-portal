/**
 * Guest & listing gives each section one job, top to bottom: what a guest
 * sees (the listing, the printed documents), then what they pay, then what
 * Helm sends them (UI/UX audit 2026-10-17, appendix 04 problem 5).
 *
 * Nothing in the type system holds that order or keeps the listing out of a
 * closed fold, and the listing editor's blocks save through one action, where
 * a block that posted every column would blank the others. So this reads the
 * page and the panel and asserts the shape.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const PAGE = 'src/app/properties/[id]/page.tsx';
const PANEL = 'src/app/properties/[id]/ListingPanel.tsx';
const ACTIONS = 'src/app/properties/[id]/listing-actions.ts';

function guestTab(): string {
  const src = read(PAGE);
  const start = src.indexOf('<TabSection tab="guest">');
  assert.ok(start > 0, 'no Guest & listing tab');
  return src.slice(start, src.indexOf('</PropertyTabs>', start));
}

describe('Guest & listing', () => {
  test('reads in order: Stay Cape Ann, the listing, the guest documents, what they pay, what Helm sends', () => {
    const tab = guestTab();
    const order = ['<ScaStatusLine', 'id="listing"', 'id="guest-documents"', 'id="rates"', 'id="automations"'];
    let at = -1;
    for (const mark of order) {
      const i = tab.indexOf(mark);
      assert.ok(i > at, `${mark} is missing or out of order`);
      at = i;
    }
  });

  test('the listing and the guest documents are open sections, not folds', () => {
    const tab = guestTab();
    assert.ok(/<GuestSection\s+id="listing"/.test(tab), 'the listing is not an open section');
    assert.ok(/<GuestSection\s+id="guest-documents"/.test(tab), 'the guest documents are not an open section');
    assert.ok(!/<CollapsibleSection\s+id="(listing|guest-documents|how-we-sell-it)"/.test(tab), 'a guest-facing section is folded again');
    // The launcher tiles became one status line and a Tools line.
    assert.ok(!tab.includes('<GrowthTile'), 'the launcher tiles are back');
  });

  test('the listing opens read-only and the amenity catalog edits in a drawer', () => {
    const panel = read(PANEL);
    // Every copy field renders as a hidden input until its block is opened.
    assert.ok(panel.includes('const hidden = (b: CopyBlockId) => BLOCK_FIELDS[b].map((f) => <input key={f} type="hidden" name={f} value={values[f]} />);'));
    const drawer = panel.indexOf('<Drawer title="Amenities"');
    const checkbox = panel.indexOf('name="amenities"');
    assert.ok(drawer > 0 && checkbox > drawer, 'the amenity checkboxes render outside the drawer');
  });

  test('each listing block saves only its own columns', () => {
    const panel = read(PANEL);
    for (const part of ['copy', 'basics', 'amenities']) {
      assert.ok(panel.includes(`<input type="hidden" name="part" value="${part}" />`), `no ${part} form`);
    }
    const action = read(ACTIONS);
    const fn = action.slice(action.indexOf('export async function saveListingContentAction'), action.indexOf('// ── Photos'));
    assert.ok(fn.includes("const patch: ListingContentPatch = { property_id: propertyId, source: 'helm' };"), 'the patch starts with every column again');
    for (const [part, column] of [['copy', 'patch.summary'], ['basics', 'patch.bedrooms'], ['amenities', 'patch.amenities']] as const) {
      const guard = fn.indexOf(`if (parts.has('${part}')) {`);
      const write = fn.indexOf(column);
      assert.ok(guard > 0 && write > guard, `${column} is written outside its ${part} guard`);
    }
  });

  test('the listing speaks to the operator, not the developer', () => {
    const panel = read(PANEL);
    // Comments may name the machinery; what renders may not.
    const ui = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['seed script', 'Vercel Blob', 'consumed by', 'listings/{', 'push layer']) {
      assert.ok(!ui.includes(word), `the Listing section says "${word}"`);
    }
  });

  test('Automations opens on what sends next; the rules wait in a drawer', () => {
    const tab = guestTab();
    assert.ok(/<GuestSection\s+id="automations"/.test(tab), 'Automations is not an open section');
    const panel = read('src/app/properties/[id]/AutomationsPanel.tsx');
    const body = panel.slice(panel.indexOf('export function AutomationsPanel'), panel.indexOf('// ── Pieces'));
    const waiting = body.indexOf('Waiting for approval');
    const next = body.indexOf('Next to send');
    const drawer = body.indexOf('<Drawer title="Rules for this home"');
    const card = body.indexOf('<RuleCard');
    assert.ok(waiting > 0 && next > waiting && drawer > next, 'the sends no longer lead the section');
    assert.ok(card > drawer, 'a rule card renders outside the Edit rules drawer');
  });

  test('a rule card is its name, trigger and state, two verbs, and More', () => {
    const panel = read('src/app/properties/[id]/AutomationsPanel.tsx');
    const card = panel.slice(panel.indexOf('function RuleCard('), panel.indexOf('type MenuItem'));
    assert.equal(card.split('<button').length - 1, 2, 'a rule card shows more than two verbs');
    assert.ok(card.includes('<MoreMenu'), 'the rest of the verbs left the menu');
    for (const verb of ['Require approval', 'Mark configured in Airbnb', 'Send a test', 'Remove override']) {
      assert.ok(card.includes(verb), `${verb} is gone`);
    }
  });
});
