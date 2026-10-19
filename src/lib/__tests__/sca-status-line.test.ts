/**
 * The Stay Cape Ann line on the property page's Guest & listing tab, and the
 * one live-on-site check it shares with the launcher.
 *
 * 10/19: 21 Horton is on staycapeann.com with no launch record in Helm, and
 * the tab told staff to "Launch it" while the launcher said it was already
 * on the site. The tab read the launch record; the launcher read the site's
 * registry. Now both read the registry through src/lib/sca-live.ts.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scaStatusLine } from '../sca-status-line.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const ENTRY = { publicName: 'Synthetic Cove' };
const launch = (over: Record<string, unknown> = {}) => ({ status: 'live', live_url: null, payment_verify_signal: 'ok', snapshot_refresh_error: null, ...over });

describe('the Stay Cape Ann line', () => {
  test('a home on the site with no launch record reads Live and links to the listing', () => {
    const line = scaStatusLine(null, { known: true, entry: ENTRY }, '65f0synthetic');
    assert.equal(line.text, 'Live on staycapeann.com');
    assert.equal(line.verb, 'Open the launcher');
    assert.equal(line.listingUrl, 'https://www.staycapeann.com/stays/65f0synthetic');
    // A draft never launched is the same home: still live on the site.
    assert.equal(scaStatusLine(launch({ status: 'draft' }), { known: true, entry: ENTRY }, 'x').text, 'Live on staycapeann.com');
  });

  test('a home not on the site says so, and offers the launch', () => {
    const line = scaStatusLine(null, { known: true, entry: null }, 'x');
    assert.equal(line.text, 'Not on staycapeann.com yet');
    assert.equal(line.verb, 'Launch it');
    assert.equal(line.listingUrl, null);
  });

  test('an unreadable registry never claims the home is not listed', () => {
    const line = scaStatusLine(null, { known: false, entry: null }, 'x');
    assert.equal(line.text, 'Could not check staycapeann.com');
    assert.equal(line.verb, 'Open the launcher');
    // A launch record that says live still reads live when the site cannot be read.
    assert.equal(scaStatusLine(launch(), { known: false, entry: null }, 'x').text, 'Live on staycapeann.com');
  });

  test('demo mode and a stale refresh never read as a plain Live', () => {
    assert.match(scaStatusLine(launch({ payment_verify_signal: 'demo_mode' }), { known: true, entry: ENTRY }, 'x').text, /collect nothing/);
    assert.equal(scaStatusLine(launch({ payment_verify_signal: 'demo_mode' }), { known: true, entry: ENTRY }, 'x').tone, 'negative');
    assert.match(scaStatusLine(launch({ snapshot_refresh_error: 'boom' }), { known: true, entry: ENTRY }, 'x').text, /may be stale/);
    assert.equal(scaStatusLine(launch({ live_url: 'https://www.staycapeann.com/stays/own' }), { known: true, entry: ENTRY }, 'x').listingUrl, 'https://www.staycapeann.com/stays/own');
  });

  test('a launch in review is not live until the site lists it', () => {
    assert.equal(scaStatusLine(launch({ status: 'pr_open' }), { known: true, entry: null }, 'x').text, 'Launch in review');
  });

  test('the tab and the launcher make the same check', () => {
    const page = read('src/app/properties/[id]/page.tsx');
    assert.ok(page.includes('scaLiveEntry(scaListingId, { maxAgeMs: 120_000 })'), 'the property page stopped reading the site registry');
    assert.ok(page.includes('const line = scaStatusLine(launch, live, listingId);'));
    const launcher = read('src/app/properties/[id]/stay-cape-ann/page.tsx');
    assert.ok(launcher.includes('const live = await scaLiveEntry(listingId);'), 'the launcher reads the registry some other way');
    assert.ok(!launcher.includes('gh.getFile('), 'the launcher reads the registry itself again');
  });
});
