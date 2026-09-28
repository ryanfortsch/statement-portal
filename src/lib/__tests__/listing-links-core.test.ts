import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  contiguousRuns,
  desiredBlocks,
  diffBlocks,
  helmLinkNote,
  isReservedEvent,
  linkedIcal,
  linkedOverlaps,
  mayReopenDay,
  nightsOf,
  type ExistingBlock,
  type LinkMember,
} from '../listing-links-core.ts';

const M = (member_key: string, role: 'whole' | 'unit', guesty: string | null): LinkMember => ({ group_key: '17_beach', member_key, label: member_key, role, guesty_listing_id: guesty, ical_url: guesty ? null : 'https://x' });
const members = [M('whole', 'whole', 'g1'), M('front', 'unit', 'g2'), M('back', 'unit', null)];
const bk = (member_key: string, source_key: string, check_in: string, check_out: string) => ({ member_key, source_key, check_in, check_out });

describe('linked listings: who closes whom', () => {
  test('a whole-house booking closes both units; a unit booking closes only the whole house', () => {
    const whole = desiredBlocks(members, [bk('whole', 'guesty:r1', '2027-01-05', '2027-01-12')]);
    assert.deepEqual(whole.map((b) => b.target_member).sort(), ['back', 'front']);
    const back = desiredBlocks(members, [bk('back', 'ical:u1', '2027-01-05', '2027-01-26')]);
    assert.deepEqual(back.map((b) => b.target_member), ['whole'], 'the front unit stays open for shorter stays');
    const front = desiredBlocks(members, [bk('front', 'guesty:r2', '2027-02-01', '2027-02-22')]);
    assert.deepEqual(front.map((b) => b.target_member), ['whole']);
    assert.equal(desiredBlocks(members, [bk('back', 'x', '2027-01-05', '2027-01-05')]).length, 0, 'no nights, no block');
    assert.equal(desiredBlocks(members, [bk('elsewhere', 'x', '2027-01-05', '2027-01-06')]).length, 0);
  });

  test('the diff places new blocks, reopens gone ones, moves moved ones and retries failures', () => {
    const want = desiredBlocks(members, [bk('back', 'ical:u1', '2027-01-05', '2027-01-26')]);
    const ex = (over: Partial<ExistingBlock>): ExistingBlock => ({ id: 'e', group_key: '17_beach', target_member: 'whole', source_member: 'back', source_key: 'ical:u1', check_in: '2027-01-05', check_out: '2027-01-26', status: 'active', ...over });
    assert.equal(diffBlocks(want, []).create.length, 1);
    assert.equal(diffBlocks(want, [ex({})]).unchanged, 1);
    const moved = diffBlocks(want, [ex({ check_out: '2027-01-19' })]);
    assert.equal(moved.remove.length, 1);
    assert.equal(moved.create.length, 1);
    assert.equal(diffBlocks([], [ex({})]).remove.length, 1, 'the booking went away');
    assert.equal(diffBlocks(want, [ex({ status: 'failed' })]).create.length, 1, 'a failed placement is retried');
    assert.equal(diffBlocks([], [ex({ status: 'failed' })]).remove.length, 0, 'a failed placement is never reopened');
  });
});

describe('linked listings: reopening is only ever Helm\'s own block', () => {
  const note = helmLinkNote('ical:u1');
  test('a day whose only block is Helm\'s note reopens; anything else stays closed', () => {
    assert.equal(mayReopenDay({ date: 'd', status: 'unavailable', blockRefs: [{ type: 'm', note }] }, note), true);
    assert.equal(mayReopenDay({ date: 'd', status: 'unavailable', blockRefs: [{ type: 'm', note }, { type: 'o', note: 'Owner' }] }, note), false, 'an owner hold too');
    assert.equal(mayReopenDay({ date: 'd', status: 'unavailable', blockRefs: [{ type: 'm', note: 'typed by Allie' }] }, note), false);
    assert.equal(mayReopenDay({ date: 'd', status: 'unavailable', blockRefs: [{ type: 'm', note: helmLinkNote('ical:other') }] }, note), false, 'another booking\'s block');
    assert.equal(mayReopenDay({ date: 'd', status: 'booked', blockRefs: [] }, note), false, 'a reservation');
    assert.equal(mayReopenDay({ date: 'd', status: 'unavailable', note, blockRefs: [] }, note), true);
    assert.equal(mayReopenDay({ date: 'd', status: 'unavailable', note: null, blockRefs: [] }, note), false);
  });
  test('days are written in contiguous runs', () => {
    assert.deepEqual(contiguousRuns(['2027-01-07', '2027-01-05', '2027-01-06', '2027-01-09']), [
      { start: '2027-01-05', end: '2027-01-07' },
      { start: '2027-01-09', end: '2027-01-09' },
    ]);
    assert.deepEqual(nightsOf('2027-01-30', '2027-02-02'), ['2027-01-30', '2027-01-31', '2027-02-01']);
  });
});

describe('linked listings: the back unit\'s feeds', () => {
  test('only Airbnb "Reserved" events are bookings; its own imported closures are not', () => {
    assert.equal(isReservedEvent('Reserved'), true);
    assert.equal(isReservedEvent('Airbnb (Not available)'), false);
    assert.equal(isReservedEvent('Not available'), false);
  });
  test('the feed Helm serves carries dates only', () => {
    const ics = linkedIcal('Guest House', [{ source_key: 'guesty:r1', check_in: '2027-01-05', check_out: '2027-01-12' }], new Date('2026-09-28T12:00:00Z'));
    assert.match(ics, /DTSTART;VALUE=DATE:20270105/);
    assert.match(ics, /DTEND;VALUE=DATE:20270112/);
    assert.match(ics, /SUMMARY:Not available/);
    assert.doesNotMatch(ics, /Robert|confirmation|r1@/i);
  });
  test('an empty read never publishes an empty calendar', () => {
    const route = readFileSync(new URL('../../app/api/channels/ical/linked/[token]/route.ts', import.meta.url), 'utf8');
    assert.ok(route.includes("return new NextResponse('unavailable', { status: 503 });"));
  });
});

describe('linked listings: a double sale is said out loud', () => {
  test('whole overlapping a unit is a double booking; two units are not', () => {
    const o = linkedOverlaps(members, [bk('whole', 'a', '2027-01-05', '2027-01-10'), bk('back', 'b', '2027-01-09', '2027-01-30'), bk('front', 'c', '2027-01-09', '2027-01-12')]);
    assert.equal(o.length, 2);
    assert.equal(linkedOverlaps(members, [bk('front', 'a', '2027-01-05', '2027-01-10'), bk('back', 'b', '2027-01-05', '2027-01-10')]).length, 0);
    assert.equal(linkedOverlaps(members, [bk('whole', 'a', '2027-01-05', '2027-01-10'), bk('back', 'b', '2027-01-10', '2027-01-30')]).length, 0, 'back to back is fine');
  });
});

test('a failed member read stops the group (absence is not a fact)', () => {
  const src = readFileSync(new URL('../listing-links.ts', import.meta.url), 'utf8');
  const run = src.slice(src.indexOf('export async function runListingLinks('));
  const read = run.indexOf('bookings.push(...(await');
  const diff = run.indexOf('const diff = diffBlocks(');
  assert.ok(read > 0 && diff > read, 'reads first');
  assert.ok(run.indexOf("} catch (err) {\n      g.error =") > diff, 'a read error lands in the group error, before any write');
});
