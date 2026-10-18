/**
 * Channels on a home Guesty runs cannot be mistaken for a live channel
 * manager.
 *
 * Zero Cape Ann homes are Helm-run (calendar_authority is guesty for every
 * one). On those homes a hold, a stay or a price written in Channels stays
 * in Helm and never reaches Airbnb, VRBO or Booking.com, and the audit
 * (2026-10-17, appendix 11) found that said only in footnotes after the
 * click. This checks the sentence, that every Channels page says it once at
 * the top, that the hub collapses to a read surface with the cutover runbook
 * behind Prepare cutover (owners), and that the calendar drawer opens on the
 * block form with no hand-entered "Channel block".
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { guestyWritesSentence, GUESTY_HOME_SENTENCE } from '../guesty-writes.ts';

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

describe('the sentence', () => {
  test('a home Guesty runs: nothing reaches the OTAs', () => {
    assert.equal(guestyWritesSentence({ kind: 'home', guestyRun: true, otaReadsHelm: false }), GUESTY_HOME_SENTENCE);
    assert.match(GUESTY_HOME_SENTENCE, /never reaches Airbnb, VRBO or Booking\.com/);
  });
  test('a Helm-run home says nothing', () => {
    assert.equal(guestyWritesSentence({ kind: 'home', guestyRun: false, otaReadsHelm: true }), null);
  });
  test('a home mid-cutover says which OTA does see it', () => {
    const s = guestyWritesSentence({ kind: 'home', guestyRun: true, otaReadsHelm: true });
    assert.ok(s && /Only an OTA that already imports Helm's export/.test(s) && !/never reaches/.test(s));
  });
  test('the fleet counts the homes no OTA reads Helm for', () => {
    assert.equal(guestyWritesSentence({ kind: 'fleet', total: 18, unreached: 0 }), null);
    assert.match(guestyWritesSentence({ kind: 'fleet', total: 18, unreached: 18 })!, /^Guesty runs every home here\./);
    assert.match(guestyWritesSentence({ kind: 'fleet', total: 18, unreached: 17 })!, /^Guesty runs 17 of 18 homes\./);
  });
  test('a failed read still warns, and never says Helm runs it', () => {
    const s = guestyWritesSentence({ kind: 'unknown' });
    assert.ok(s && /nothing written in Helm reaches Airbnb, VRBO or Booking\.com/.test(s));
  });
  test('no em dashes', () => {
    assert.ok(!read('src/lib/guesty-writes.ts').includes('—'));
  });
});

describe('every Channels page says it once, at the top', () => {
  // The pilot workspace and the request desk are being deleted (their own
  // skins, one home each); every other Channels page carries the notice.
  const retiring = ['src/app/channels/pilot', 'src/app/channels/requests'];
  const pages = pagesUnder('src/app/channels').filter((p) => !retiring.some((r) => p.startsWith(r + '/')));
  test('the Channels pages were found', () => assert.ok(pages.length >= 7, `only ${pages.length}`));
  for (const page of pages) {
    test(page, () => {
      const src = read(page);
      assert.equal(src.split('<GuestyWritesNotice scope=').length - 1, 1, `${page} must render the notice exactly once`);
      const masthead = src.indexOf('<HelmMasthead />\n      <GuestyWritesNotice');
      assert.ok(masthead > 0, `${page}: the notice sits directly under the masthead`);
    });
  }
});

describe('the hub on a Guesty-run home', () => {
  const hub = read('src/app/channels/[propertyId]/page.tsx');
  test('the runbook opens behind Prepare cutover, for owners', () => {
    assert.ok(hub.includes('const owner = await isOwnerSession();'));
    assert.ok(hub.includes('const runbook = helmRun || (owner && (prepare || cutoverUnderway));'));
    assert.ok(/\{!helmRun && owner && !runbook && \(\n\s*<Link href=\{`\/channels\/\$\{propertyId\}\?prepare=1#cutover`\}/.test(hub), 'Prepare cutover is an owner link');
  });
  test('the cutover panel, the attention panel and the full-view sections all wait on the runbook', () => {
    assert.ok(/\{runbook && \(\n\s*<section id="cutover"/.test(hub), 'the cutover panel');
    assert.ok(hub.includes('{runbook && carry && (helmRun || cutoverUnderway) && <AttentionPanel'), 'the attention panel');
    assert.ok(hub.includes('{runbook && recent.length > 0 && ('), 'recent stays');
    assert.ok(/\{runbook && <section className="max-w-\[1100px\] mx-auto px-10" style=\{\{ width: '100%', paddingBottom: 40 \}\}>/.test(hub), 'the stat strip');
  });
  test('the feed rows, the export links and upcoming stays are always there', () => {
    const feeds = hub.indexOf('{orderedFeeds(feeds).map(');
    const before = hub.slice(Math.max(0, hub.lastIndexOf('{/* ── Feed health', feeds)), feeds);
    assert.ok(feeds > 0 && !before.includes('runbook'), 'feed rows are not gated');
    assert.ok(/\n      \{exportUrl && \(/.test(hub), 'export links are not gated');
    assert.ok(hub.includes('Upcoming · {upcoming.length} stay'), 'upcoming stays');
  });
});

describe('the calendar drawer and hand-entered holds', () => {
  const grid = read('src/app/channels/calendar/MultiCalendarGrid.tsx');
  test('a Guesty-run home opens on Block these nights, with no tabs, under the sentence', () => {
    assert.ok(grid.includes("useState<'price' | 'block' | 'quote'>(!p.helmRun ? 'block' :"));
    assert.ok(/\{p\.helmRun && \(\n\s*<div style=\{\{ display: 'flex', gap: 0, borderBottom/.test(grid), 'the tab row renders only on a Helm-run home');
    assert.ok(grid.includes('{GUESTY_HOME_SENTENCE}'));
  });
  test('"Channel block" is not a hand-entry hold kind', () => {
    for (const file of ['src/app/channels/calendar/MultiCalendarGrid.tsx', 'src/app/channels/bookings/new/page.tsx']) {
      const src = read(file);
      assert.ok(!src.includes('<option value="ota">'), `${file} still offers Channel block`);
    }
    assert.ok(read('src/app/channels/calendar/calendar-actions.ts').includes("const HOLD_KINDS = new Set(['owner', 'maintenance', 'other']);"));
    assert.ok(read('src/app/channels/bookings/new/actions.ts').includes("const HOLD_KINDS = ['owner', 'maintenance', 'other'] as const;"));
  });
});
