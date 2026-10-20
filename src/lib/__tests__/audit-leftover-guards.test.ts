/**
 * Leftovers from the 2026-10-17 audit's bug list, fixed 2026-10-19: a
 * one-tap delete with no way back, and contractor buttons that could spin
 * forever on a lost response. Read from the source so the guard cannot be
 * dropped quietly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('deleting a logged activity and cancelling a meeting ask first', () => {
  const detail = read('src/app/crm/[id]/ContactDetail.tsx');
  const del = detail.slice(detail.indexOf('async function removeTouch('), detail.indexOf('deleteContactTouch('));
  assert.ok(del.includes("title: 'Delete this activity?'"), 'removeTouch asks before deleting');
  const meetings = read('src/app/crm/[id]/ContactMeetings.tsx');
  const cancel = meetings.slice(meetings.indexOf('async function cancel('), meetings.indexOf('cancelContactMeeting('));
  assert.ok(cancel.includes("title: 'Cancel this meeting?'"), 'cancel asks before cancelling');
});

test('the contractor Mark done and Start inspection buttons cannot spin forever', () => {
  for (const file of ['src/app/field/property-work/BoardControls.tsx', 'src/app/field/packet/[packetId]/StartStop.tsx']) {
    assert.ok(read(file).includes('usePendingWatchdog(pending);'), `${file} has no watchdog`);
  }
});

test('no cleaner mapped never links to a page that cannot map one', () => {
  const masthead = read('src/app/properties/[id]/PropertyMasthead.tsx');
  const cell = masthead.slice(masthead.indexOf('label="Cleaner"'), masthead.indexOf('label="Owner"'));
  assert.ok(!cell.includes('fixHref'), 'the Cleaner tile links somewhere');
  const page = read('src/app/properties/[id]/page.tsx');
  const crew = page.slice(page.indexOf('title="Who serves this house"'), page.indexOf('title="Who serves this house"') + 1200);
  assert.ok(!crew.includes('schedule-recipients'), 'the crew section links to the schedule recipients');
  assert.ok(crew.includes('Ask Ryan: no cleaner is mapped to'));
});

test('a staff login wears no badge it cannot clear', () => {
  const route = read('src/app/api/nav-counts/route.ts');
  assert.ok(route.includes("if ((await sessionRole()) !== 'owner') {"), 'nav counts are owner asks and must be zero for staff');
  assert.ok(route.indexOf("!== 'owner'") < route.indexOf('loadFieldReview()'), 'the role check runs before any count is read');
});

test('the onboarding board and every Launch page lead to the Playbook entry', () => {
  for (const f of ['src/app/properties/ComingOnline.tsx', 'src/app/properties/[id]/launch/page.tsx']) {
    assert.ok(read(f).includes('href="/playbook/onboard-a-new-property"'), `${f} links how we bring a home online`);
  }
});
