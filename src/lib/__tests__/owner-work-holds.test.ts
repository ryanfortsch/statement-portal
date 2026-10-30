// Work an owner told us about becomes a hold card (2026-10-23).
//
// Claudia Kittredge, 21 Horton: "Plan to have roof done next week (mon -
// thurs)." Nothing checked the calendar, so Monday to Wednesday nights stayed
// on sale. Dotti: "why can't this check for a block and create one if she
// doesn't?" The report files the same card a vendor's text does; only that
// card's Approve holds the calendar.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkOwnerWorkReport, ownerWorkKey, ownerWorkRow, type OwnerWorkReport } from '../owner-work-holds-core.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const code = (repoPath: string): string => read(repoPath).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

const CLAUDIA: OwnerWorkReport = {
  cardId: 'card-claudia',
  propertyId: '21_horton',
  start: '2026-10-26',
  end: '2026-10-29',
  startTime: null,
  endTime: null,
  who: "Claudia's roofer",
  what: 'roof work',
  ownerName: 'Claudia Kittredge',
  ownerContact: '+19192599238',
  channel: 'sms',
  message: "Good morning Allie & Ryan! Plan to have roof done next week (mon - thurs). Copying Will in case you have questions. I'll be traveling in India Sat to Fri. Thanks!",
  messageAt: '2026-10-23T12:51:00Z',
};

describe('what a report must carry', () => {
  test('Claudia\'s report is complete', () => {
    assert.equal(checkOwnerWorkReport(CLAUDIA), null);
  });

  test('a report missing its home, its days or its words is refused', () => {
    assert.match(checkOwnerWorkReport({ ...CLAUDIA, propertyId: '' })!, /property_id/);
    assert.match(checkOwnerWorkReport({ ...CLAUDIA, start: 'next week' })!, /YYYY-MM-DD/);
    assert.match(checkOwnerWorkReport({ ...CLAUDIA, end: '2026-10-25' })!, /before start/);
    assert.match(checkOwnerWorkReport({ ...CLAUDIA, startTime: '8am' })!, /HH:MM/);
    assert.match(checkOwnerWorkReport({ ...CLAUDIA, who: ' ' })!, /who/);
    assert.match(checkOwnerWorkReport({ ...CLAUDIA, message: '' })!, /message/);
  });
});

describe('the card it becomes', () => {
  test('Claudia\'s roof: the owner wrote it, her roofer does it, no vendor on file', () => {
    const row = ownerWorkRow(CLAUDIA, CLAUDIA.start, null);
    assert.equal(row.source, 'owner');
    assert.equal(row.trade_vendor_id, null);
    assert.equal(row.vendor_name, "Claudia's roofer");
    assert.equal(row.reported_by, 'Claudia Kittredge');
    assert.equal(row.owner_card_id, 'card-claudia');
    assert.equal(row.quo_line, 'owners');
    assert.equal(row.quo_message_id, 'owner:card-claudia:2026-10-26');
    assert.equal(row.property_id, '21_horton');
    assert.equal(row.property_basis, 'owner');
    assert.equal(row.visit_date, '2026-10-26');
    assert.equal(row.visit_end_date, '2026-10-29');
    assert.equal(row.date_basis, "from Claudia's message");
    assert.equal(row.ask_reason, null);
    assert.equal(row.status, 'pending');
  });

  test('work already begun holds from today, and the key does not move', () => {
    const row = ownerWorkRow(CLAUDIA, '2026-10-27', null);
    assert.equal(row.visit_date, '2026-10-27');
    assert.equal(row.quo_message_id, ownerWorkKey('card-claudia', '2026-10-26'));
  });

  test('longer than one hold covers is a question, never a hold Approve would refuse', () => {
    const row = ownerWorkRow({ ...CLAUDIA, end: '2026-11-06' }, CLAUDIA.start, null);
    assert.equal(row.visit_date, null);
    assert.equal(row.visit_end_date, null);
    assert.match(String(row.ask_reason), /12 days, longer than one hold covers \(7\)/);
    assert.deepEqual(row.date_candidates, []);
  });

  test('an emailed report names no Quo line', () => {
    assert.equal(ownerWorkRow({ ...CLAUDIA, channel: 'email' }, CLAUDIA.start, null).quo_line, null);
  });
});

describe('filing a report can never hold the calendar', () => {
  const filer = code('src/lib/owner-work-holds.ts');
  const route = code('src/app/api/owner-work-holds/route.ts');

  test('the filer writes one table and reads one', () => {
    const tables = new Set([...filer.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]));
    assert.deepEqual([...tables].sort(), ['properties', 'vendor_visit_proposals']);
    assert.ok(/\.upsert\(row, \{ onConflict: 'quo_message_id', ignoreDuplicates: true \}\)/.test(filer), 'one card per report, whoever files it');
  });

  test('neither the filer nor the route reaches a writer', () => {
    for (const src of [filer, route]) {
      for (const forbidden of ['guestyWrite', 'createBlock', 'syncCalendarDays', 'writeHelmCalendarMirror', 'vendor-visit-approve', 'work_slips', "from('bookings')", 'property_calendar_days']) {
        assert.ok(!src.includes(forbidden), `mentions ${forbidden}`);
      }
    }
  });

  test('the route is the concierge\'s, header-authorized and allowlisted', () => {
    assert.ok(route.includes('authorizeStayConcierge(req)'));
    assert.ok(route.indexOf('authorizeStayConcierge(req)') < route.indexOf('fileOwnerWorkHold('));
    assert.ok(read('src/proxy.ts').includes('"/api/owner-work-holds",'));
  });

  test('the Team inbox shows an owner\'s report as theirs, with no slips to schedule', () => {
    const cards = code('src/lib/vendor-visit-cards.ts');
    assert.ok(code('src/lib/vendor-visit-queue.ts').includes('r.trade_vendor_id ? [r.trade_vendor_id] : []'), 'an owner row has no vendor id to look up');
    assert.ok(/slips: home && !fromOwner \?/.test(cards));
    const card = code('src/app/messaging/team/VendorVisitCard.tsx');
    assert.ok(card.includes('label: `${card.writer || vendor} wrote`'));
  });
});
