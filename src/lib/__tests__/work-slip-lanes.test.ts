import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  groupSlipsByLane,
  isSupplySlip,
  laneCounts,
  slipDetailLine,
  slipDisplayTitle,
  slipLane,
  slipSourceLabel,
} from '../work-slip-lanes.ts';

const base = {
  category: 'maintenance' as const,
  title: 'Spray Nozzle Loose',
  run_scope: null,
  owner_action_required: false,
  from_supply_key: null,
  from_guest_request_key: null,
};

test('the owner flag wins over everything, and so does the Owner category', () => {
  assert.equal(slipLane({ ...base, owner_action_required: true }), 'owner');
  assert.equal(slipLane({ ...base, category: 'inventory', owner_action_required: true }), 'owner');
  assert.equal(slipLane({ ...base, category: 'owner' }), 'owner');
  assert.equal(slipLane({ ...base, category: 'owner', run_scope: 'pro' }), 'owner');
});

test('supplies: the inventory category, a supplies-check key, or a legacy "Restock:" title', () => {
  assert.equal(slipLane({ ...base, category: 'inventory' }), 'supply');
  assert.equal(slipLane({ ...base, from_supply_key: 'paper_towels', category: 'rising_tide' }), 'supply');
  assert.equal(slipLane({ ...base, category: 'rising_tide', title: 'Restock: Coffee pods' }), 'supply');
  assert.equal(isSupplySlip({ ...base, category: 'rising_tide', title: 'New towel sets' }), false);
});

test('maintenance follows the run triage; untriaged rides the routine visit', () => {
  assert.equal(slipLane({ ...base, run_scope: 'inspector' }), 'visit');
  assert.equal(slipLane({ ...base, run_scope: null }), 'visit');
  assert.equal(slipLane({ ...base, run_scope: 'handyman' }), 'handyman');
  assert.equal(slipLane({ ...base, run_scope: 'pro' }), 'pro');
  assert.equal(slipLane({ ...base, category: 'vendor' }), 'pro');
});

test("the concierge's gear and stay notes are for the visit; its desk rails and the office's own slips are office", () => {
  assert.equal(slipLane({ ...base, category: 'other', from_guest_request_key: 'gear:abc' }), 'visit');
  assert.equal(slipLane({ ...base, category: 'other', from_guest_request_key: 'staycontact:abc:arrives-6pm' }), 'visit');
  assert.equal(slipLane({ ...base, category: 'other', from_guest_request_key: 'ffhold:abc' }), 'office');
  assert.equal(slipLane({ ...base, category: 'other', from_guest_request_key: 'prerelease-paylink:abc' }), 'office');
  assert.equal(slipLane({ ...base, category: 'rising_tide', title: 'CREATE MESSAGE AUTOMATION' }), 'office');
  assert.equal(slipLane({ ...base, category: 'ad_hoc', title: 'One-off job' }), 'office');
});

test('a leading home name is stripped from a title only when a separator follows it', () => {
  assert.equal(slipDisplayTitle('73 Rocky Neck: Fix the back deck door lock', '73 Rocky Neck'), 'Fix the back deck door lock');
  assert.equal(slipDisplayTitle('73 Rocky Neck - Fix the lock', '73 Rocky Neck'), 'Fix the lock');
  assert.equal(slipDisplayTitle('73 Rocky Neck Ave gutter', '73 Rocky Neck'), '73 Rocky Neck Ave gutter');
  assert.equal(slipDisplayTitle('Window Screen', '73 Rocky Neck'), 'Window Screen');
  assert.equal(slipDisplayTitle('73 Rocky Neck: Fix the lock', null), '73 Rocky Neck: Fix the lock');
});

test('the detail line prefers a summary that says more than the title, else the description collapsed', () => {
  // A guest-message slip carries its title as its action summary: no echo.
  const echo = {
    title: '73 Rocky Neck: Fix back deck door lock mechanism',
    action_summary: 'Fix back deck door lock mechanism',
    description: 'Back deck doors will not lock and were unlocked upon guest arrival.\n\nFrom guest messages: a guest (2026-09-27 to 2026-09-30, SMS)',
  };
  assert.equal(
    slipDetailLine(echo, '73 Rocky Neck'),
    'Back deck doors will not lock and were unlocked upon guest arrival. · From guest messages: a guest (2026-09-27 to 2026-09-30, SMS)',
  );
  // A synthesized summary wins over a pasted review.
  const review = {
    title: '73 Rocky Neck: Repair or replace broken hardware items reported by guest',
    action_summary: 'Replace the broken towel bar and the loose cabinet pull in the main bath (Oct 11 review).',
    description: 'Repair or replace broken hardware items reported by guest\n\nFrom a guest review:\n5★ overall\nPublic review:\nWe loved it ... '.repeat(4),
  };
  assert.equal(slipDetailLine(review, '73 Rocky Neck'), review.action_summary);
  // A multi-line field note keeps its items apart.
  assert.equal(slipDetailLine({ title: 'Suggested Owner Purchases', action_summary: null, description: 'Pot Holders\nRecycling Bin for the kitchen' }, null), 'Pot Holders · Recycling Bin for the kitchen');
  // Nothing to say: null, never an empty string or the title again.
  assert.equal(slipDetailLine({ title: 'Window Screen', action_summary: null, description: null }, null), null);
  assert.equal(slipDetailLine({ title: 'Window Screen', action_summary: 'Window screen', description: null }, null), null);
});

test('a long description is clipped at a word with an ellipsis, never a whole pasted review', () => {
  const words = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
  const line = slipDetailLine({ title: 'T', action_summary: null, description: words }, null, 100)!;
  assert.ok(line.length <= 101, `clipped to ${line.length}`);
  assert.ok(line.endsWith('…'));
  assert.ok(!line.includes('word120'));
  assert.match(line, /word\d+…$/);
});

test('lanes come out in walk order, high priority floats, and clustered slips stay adjacent', () => {
  const mk = (id: string, extra: Record<string, unknown>) => ({
    id,
    ...base,
    priority: 'normal' as const,
    created_at: '2026-09-01T00:00:00Z',
    organize_group: null as string | null,
    ...extra,
  });
  const slips = [
    mk('office', { category: 'rising_tide' as const, title: 'Note to guests' }),
    mk('lamp-owner', { category: 'owner' as const, created_at: '2026-09-05T00:00:00Z' }),
    mk('bulb', { run_scope: 'inspector' as const, created_at: '2026-09-03T00:00:00Z' }),
    mk('door-handle', { run_scope: 'handyman' as const, organize_group: 'back-door-hardware', created_at: '2026-10-12T00:00:00Z' }),
    mk('screen', { run_scope: 'handyman' as const, created_at: '2026-08-10T00:00:00Z' }),
    mk('door-lock', { run_scope: 'handyman' as const, organize_group: 'back-door-hardware', priority: 'high' as const, created_at: '2026-09-30T00:00:00Z' }),
    mk('pods', { category: 'inventory' as const, title: 'Restock: Coffee pods' }),
    mk('fireplace', { run_scope: 'pro' as const }),
  ];
  const groups = groupSlipsByLane(slips);
  assert.deepEqual(groups.map((g) => g.lane), ['supply', 'visit', 'handyman', 'pro', 'owner', 'office']);
  const handyman = groups.find((g) => g.lane === 'handyman')!.slips.map((s) => s.id);
  // The high-priority lock lifts its whole cluster above the older screen,
  // and the handle stays glued to the lock.
  assert.deepEqual(handyman, ['door-lock', 'door-handle', 'screen']);
  assert.deepEqual(laneCounts(slips), { supply: 1, visit: 1, handyman: 3, pro: 1, owner: 1, office: 1 });
});

test('a source label names where the slip came from without naming anyone', () => {
  assert.equal(slipSourceLabel({ from_review_id: 'r' }), 'a guest review');
  assert.equal(slipSourceLabel({ from_guest_message_key: 'guestmsg:c:slug' }), 'a guest message');
  assert.equal(slipSourceLabel({ from_gmail_message_id: 'g' }), 'an email');
  assert.equal(slipSourceLabel({ inspection_id: 'i' }), 'an inspection');
  assert.equal(slipSourceLabel({ reported_by_contractor_id: 'c' }), 'a field inspector');
  assert.equal(slipSourceLabel({ created_by_email: 'reviews@helm.system' }), 'Helm');
  assert.equal(slipSourceLabel({ created_by_email: 'ryan@risingtidestr.com' }), 'the office');
});

test('the board, the print sheet and the Field stop list all read the shared lane rule', () => {
  // Guards the wiring, not just the function: a surface that stops importing
  // the rule can drift back into its own copy.
  const board = readFileSync(new URL('../../app/work/QueueClient.tsx', import.meta.url), 'utf8');
  assert.match(board, /from '@\/lib\/work-slip-lanes'/);
  assert.match(board, /groupSlipsByLane\(/);
  assert.doesNotMatch(board, /\nfunction isSupplySlip\(/);
  const sheet = readFileSync(new URL('../../app/properties/[id]/work-slips/print/page.tsx', import.meta.url), 'utf8');
  assert.match(sheet, /groupSlipsByLane\(/);
  assert.match(sheet, /slipDetailLine\(/);
  const propertySection = readFileSync(new URL('../../app/properties/[id]/OpenWorkSection.tsx', import.meta.url), 'utf8');
  assert.match(propertySection, /groupSlipsByLane\(slips\)/);
  assert.match(propertySection, /slipDisplayTitle\(s\.title, property\.name\)/);
  const packets = readFileSync(new URL('../field-packets.ts', import.meta.url), 'utf8');
  const fn = packets.slice(packets.indexOf('export async function loadOpenSlipsForStops'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /owner_action_required \|\| w\.category === 'owner'/);
});
