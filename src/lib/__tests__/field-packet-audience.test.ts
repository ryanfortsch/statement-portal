/**
 * The office packet page, split by audience (audit Phase 3, Field).
 *
 * Staff (the operations manager) hold the trip: assign, move, release,
 * cancel, submit-for, and they read the tracker and the stops. The review,
 * the payout, the bonus, the receipts and the activity log are the owners'.
 * Before the split those sections rendered for everyone and then said
 * "Ryan reviews and approves the pay" to staff. This reads the page source
 * and fails if an owner section loses its gate or a line addressed to
 * someone else comes back, and checks the owner's decision sits first.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../../../src/app/fieldwork/packets/[id]/page.tsx', import.meta.url), 'utf8');
/** Comments blanked, so a docblock that quotes an old line is neither a hit nor a pass. */
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/^\s*\/\/.*$/gm, (m) => ' '.repeat(m.length));

test('owner sections are gated where they render', () => {
  for (const gate of [
    '{owner && review.length > 0 && (',
    '{owner && (homedReceipts.length > 0 || openReceipts.length > 0) && (',
    '{owner && events.length > 0 && (',
    "{owner && packet.status === 'approved' && packet.paid_at && (",
  ]) assert.ok(src.includes(gate), `missing gate: ${gate}`);
  assert.match(src, /const finalizing = owner && \(/, 'the approve and pay decision is owners only');
  assert.ok(src.includes('{finalizing && ('), 'and renders only when finalizing');
  // The header's pay figure: the gate opens before the dollars print.
  const header = src.slice(src.indexOf('<PacketStatusStrip'), src.indexOf('{finalizing && ('));
  assert.ok(header.indexOf('{owner && (') > -1 && header.indexOf('{owner && (') < header.indexOf('dollars(effectiveBaseCents(packet))'), 'the header pay is owners only');
});

test('owner data is not even loaded for staff', () => {
  assert.ok(src.includes("owner && (packet.status === 'submitted' || packet.status === 'approved')\n      ? loadPacketReview(id)"));
  assert.match(src, /owner\n\s+\? fieldDb\(\)\n\s+\.from\('packet_events'\)/);
  assert.ok(src.includes('owner && packet.awarded_contractor_id\n      ? loadPaymentSummaries()'));
  assert.match(src, /owner\n\s+\? loadPacketReceipts\(id\)/);
  assert.ok(src.includes('owner && receiptsOpen\n      ? loadOpenReceipts'));
});

test('no rendered line is addressed to someone else', () => {
  assert.doesNotMatch(src, /Ryan/, 'staff read the strip, not a note saying Ryan does this');
  assert.doesNotMatch(src, /Posted at/, 'the posted price is pay, shown to owners beside Update price');
});

test("the owner's decision comes before what they found, the utilities and the stops", () => {
  const decision = src.indexOf('{finalizing && (');
  // The owners' approve form inside the decision card (staff have their own,
  // without the pay fields, above it).
  const approve = src.indexOf('<form action={approvePacket}', decision);
  const paid = src.indexOf('<form action={markPacketPaid}');
  assert.ok(decision > -1 && approve > decision && paid > decision);
  for (const later of ['Inspection summary', '{owner && (homedReceipts.length', 'Preview as contractor', 'When ▾', '<StopList']) {
    const at = src.indexOf(later);
    assert.ok(at > approve && at > paid, `${later} must follow the decision`);
  }
});

test('the levers staff hold stay theirs', () => {
  // These render for any signed-in session; the gates on the actions are
  // unchanged (which lifecycle actions the operations manager gets is an
  // open decision, not this page's).
  for (const lever of ['action={assignPacket}', 'action={setPacketVisitDate}', 'action={releasePacket}', 'action={cancelPacket}', 'action={submitPacketForContractor}', 'action={publishPacket}', 'action={addPacketStop}']) {
    assert.ok(src.includes(lever), `missing ${lever}`);
  }
  assert.match(src, /\{owner && \(packet\.status === 'claimed' \|\| packet\.status === 'in_progress'\) && \(\s*<details[\s\S]{0,900}?action=\{raisePacketEstimate\}/, 'Raise pay stays owners only');
});

test('the levers sit in two menus, and the one loud verb stays outside them', () => {
  // UX audit, 2026-11-07: Change the job (when, pay, stops, windows, the
  // cleaner's order) and Hand it off (assign, unpublish, release, cancel).
  const change = src.indexOf('Change the job ▾');
  const hand = src.indexOf('Hand it off ▾');
  assert.ok(change > 0 && hand > change, 'both menus render, Change the job first');
  for (const lever of ['action={setPacketVisitDate}', 'action={raisePacketEstimate}', 'action={addPacketStop}', 'action={syncPacketWindows}', 'action={orderStopsByCleaningTime}']) {
    const at = src.indexOf(lever);
    assert.ok(at > change && at < hand, `${lever} is in Change the job`);
  }
  for (const lever of ['action={assignPacket}', 'action={unpublishPacket}', 'action={releasePacket}', 'action={cancelPacket}']) {
    assert.ok(src.indexOf(lever) > hand, `${lever} is in Hand it off`);
  }
  for (const verb of ['action={publishPacket}', 'action={submitPacketForContractor}']) {
    assert.ok(src.indexOf(verb) < change, `${verb} stays a button outside the menus`);
  }
  // The tier key prints once: inside Assign when it is offered.
  assert.ok(src.includes('{eligible.length > 0 && !canAssign && <div'), 'the coverage line drops the key when Assign carries it');
});
