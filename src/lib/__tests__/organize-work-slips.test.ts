import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planOrganizeWrites, resolveGroups, sanitizeGroupKey, wantsSummary, type OrganizeSlip } from '../organize-work-slips-rules.ts';

const NOW = '2026-10-14T05:00:00.000Z';
const client = { name: '73 Rocky Neck', isRisingTideOwned: false };
const risingTide = { name: '3 Locust', isRisingTideOwned: true };

function slip(extra: Partial<OrganizeSlip> = {}): OrganizeSlip {
  return {
    id: 'slip-1',
    property_id: '73_rocky_neck',
    title: 'Suggested Owner Purchases',
    description: 'Pot Holders\nRecycling Bin for the kitchen',
    action_summary: null,
    location: null,
    category: 'maintenance',
    priority: 'normal',
    status: 'open',
    run_scope: null,
    run_scope_note: null,
    owner_action_required: false,
    owner_action_type: null,
    owner_status: null,
    from_review_id: null,
    from_guest_message_key: null,
    from_guest_request_key: null,
    from_supply_key: null,
    from_quo_message_id: null,
    from_gmail_message_id: null,
    inspection_id: null,
    reported_by_contractor_id: 'contractor-1',
    last_verified_open_at: null,
    scheduled_date: null,
    created_by_email: 'inspector@example.test',
    created_at: '2026-08-10T12:00:00Z',
    organize_group: null,
    organize_group_label: null,
    ...extra,
  };
}

const decide = (lane: 'visit' | 'handyman' | 'pro' | 'owner' | 'supply' | 'office', extra: Partial<{ ownerAsk: 'purchase' | 'approve' | 'decide' | 'schedule' | null; summary: string; note: string }> = {}) => ({
  lane,
  ownerAsk: extra.ownerAsk ?? null,
  summary: extra.summary ?? '',
  note: extra.note ?? 'because',
});

test('an owner purchase filed as maintenance moves to the owner lane and arms the owner rail', () => {
  const { patch, lane } = planOrganizeWrites(slip(), decide('owner', { ownerAsk: 'purchase', note: 'Housewares the owner buys' }), client, NOW);
  assert.equal(lane, 'owner');
  assert.equal(patch.category, 'owner');
  assert.equal(patch.owner_action_required, true);
  assert.equal(patch.owner_action_type, 'purchase');
  assert.equal(patch.owner_status, 'not_sent');
  assert.equal(patch.organized_at, NOW);
  assert.equal(patch.organize_note, 'Housewares the owner buys');
  assert.equal('title' in patch, false);
  assert.equal('description' in patch, false);
});

test('a Rising Tide-owned home has no owner: its purchases become supplies', () => {
  const { patch, lane } = planOrganizeWrites(slip({ property_id: '3_locust' }), decide('owner', { ownerAsk: 'purchase' }), risingTide, NOW);
  assert.equal(lane, 'supply');
  assert.equal(patch.category, 'inventory');
  assert.equal('owner_action_required' in patch, false);
});

test("an operator's owner flag beats the model, whatever lane it picked", () => {
  const flagged = slip({ owner_action_required: true, owner_action_type: 'approve', owner_status: 'sent' });
  const { patch, lane } = planOrganizeWrites(flagged, decide('visit'), client, NOW);
  assert.equal(lane, 'owner');
  assert.equal(patch.category, 'owner');
  // Their ask and where it stands are untouched.
  assert.equal('owner_action_type' in patch, false);
  assert.equal('owner_status' in patch, false);
});

test('an internal or packet-backing slip never enters a maintenance lane by robot', () => {
  const setup = slip({ category: 'rising_tide', title: 'Set up 7 Sumac for launch', description: 'Stage the home.' });
  for (const want of ['visit', 'handyman', 'pro'] as const) {
    const { patch, lane } = planOrganizeWrites(setup, decide(want), client, NOW);
    assert.equal(lane, 'office');
    assert.equal('category' in patch, false);
    assert.equal('run_scope' in patch, false);
  }
  // It may still be re-filed as a supply or an owner purchase.
  const towels = slip({ category: 'rising_tide', title: 'New towel sets', description: null });
  assert.equal(planOrganizeWrites(towels, decide('owner', { ownerAsk: 'purchase' }), client, NOW).patch.category, 'owner');
  assert.equal(planOrganizeWrites(slip({ category: 'rising_tide', title: 'Hand soap bottle', description: null }), decide('supply'), client, NOW).patch.category, 'inventory');
});

test('run_scope is written only when the slip is untriaged; an existing triage decides the lane', () => {
  const fresh = planOrganizeWrites(slip({ title: 'Window Screen', description: 'Torn' }), decide('handyman', { note: 'Measure and install' }), client, NOW);
  assert.equal(fresh.lane, 'handyman');
  assert.equal(fresh.patch.run_scope, 'handyman');
  assert.equal(fresh.patch.run_scope_note, 'Measure and install');
  assert.equal('category' in fresh.patch, false);

  const triaged = planOrganizeWrites(slip({ title: 'Window Screen', description: 'Torn', run_scope: 'handyman', run_scope_note: 'Replace screen' }), decide('visit'), client, NOW);
  assert.equal(triaged.lane, 'handyman');
  assert.equal('run_scope' in triaged.patch, false);
  assert.equal('run_scope_note' in triaged.patch, false);

  const visit = planOrganizeWrites(slip({ title: 'Light Plate', description: 'We need a light plate in the entrance way.' }), decide('visit'), client, NOW);
  assert.equal(visit.patch.run_scope, 'inspector');
});

test('desk work moves to the Rising Tide category and nothing else', () => {
  const email = slip({ title: '73 Rocky Neck: Follow-up on required maintenance items', description: 'Reported via email from the owner. '.repeat(10), from_gmail_message_id: 'g1', run_scope: 'handyman' });
  const { patch, lane } = planOrganizeWrites(email, decide('office', { summary: 'Reply to the owner about the handyman schedule for the September items.' }), client, NOW);
  assert.equal(lane, 'office');
  assert.equal(patch.category, 'rising_tide');
  assert.equal('run_scope' in patch, false);
  // A pasted email still earns its one-line synthesis.
  assert.equal(patch.action_summary, 'Reply to the owner about the handyman schedule for the September items.');
});

test('a synthesized line is written only into an empty action_summary, only for pasted or long text, never restating the title', () => {
  const review = slip({
    title: '73 Rocky Neck: Repair or replace broken hardware items reported by guest',
    description: 'Repair or replace broken hardware items reported by guest\n\nFrom a guest review:\n5★ overall\nPublic review: ' + 'We loved the place. '.repeat(20),
    from_review_id: 'r1',
    reported_by_contractor_id: null,
  });
  assert.equal(wantsSummary(review), true);
  const synth = 'Fix the loose towel bar and the cabinet pull in the main bath (Oct 11 review).';
  assert.equal(planOrganizeWrites(review, decide('handyman', { summary: synth }), client, NOW).patch.action_summary, synth);

  // Already has one: never overwritten.
  const kept = planOrganizeWrites(slip({ ...review, action_summary: 'Operator wrote this' }), decide('handyman', { summary: synth }), client, NOW);
  assert.equal('action_summary' in kept.patch, false);

  // A short field note needs no synthesis.
  const short = slip({ title: 'Window Screen', description: 'Torn' });
  assert.equal(wantsSummary(short), false);
  assert.equal('action_summary' in planOrganizeWrites(short, decide('handyman', { summary: 'Measure and install a new window screen' }), client, NOW).patch, false);

  // A long note earns one, but not a line that merely echoes the title.
  const long = slip({ title: 'Rug under dining room table', description: 'Cleaners find the rug folded over after guests. '.repeat(6) });
  assert.equal('action_summary' in planOrganizeWrites(long, decide('handyman', { summary: 'Rug under dining room table' }), client, NOW).patch, false);
  assert.equal(planOrganizeWrites(long, decide('handyman', { summary: 'Recenter the dining rug and tape the corners (two people).' }), client, NOW).patch.action_summary, 'Recenter the dining rug and tape the corners (two people).');
});

test('a cluster needs two members, counting slips already carrying the key, and keeps one label', () => {
  const groups = resolveGroups(
    [
      { slipId: 'a', key: 'Back Door Hardware', label: 'Back door hardware' },
      { slipId: 'b', key: 'back-door-hardware', label: '' },
      { slipId: 'c', key: 'lonely-screen', label: 'Screen' },
      { slipId: 'd', key: 'shower-upstairs', label: 'Upstairs shower' },
      { slipId: 'e', key: '', label: 'nothing' },
    ],
    [{ organize_group: 'shower-upstairs', organize_group_label: 'Main bath shower' }],
  );
  assert.deepEqual(groups.get('a'), { key: 'back-door-hardware', label: 'Back door hardware' });
  assert.deepEqual(groups.get('b'), { key: 'back-door-hardware', label: 'Back door hardware' });
  assert.equal(groups.has('c'), false);
  // An existing member's label is the cluster's label.
  assert.deepEqual(groups.get('d'), { key: 'shower-upstairs', label: 'Main bath shower' });
  assert.equal(groups.has('e'), false);
  assert.equal(sanitizeGroupKey('  Back Door / Lock & Handle!! '), 'back-door-lock-handle');
});

test('the sweep skips every slip another rail owns and never revisits one', () => {
  // Guards the eligibility filters in the real query, not a copy of them.
  const src = readFileSync(new URL('../organize-work-slips.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function applyEligibleFilters'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  for (const guard of [
    ".is('organized_at', null)",
    ".is('from_guest_request_key', null)",
    ".is('from_supply_key', null)",
    ".is('from_prep_rule_key', null)",
    ".neq('category', 'ad_hoc')",
  ]) {
    assert.ok(body.includes(guard), `missing eligibility guard ${guard}`);
  }
  // Packet-backing slips are dropped before the model sees them, and the
  // write itself re-checks the stamp so a human edit mid-run stands.
  assert.match(src, /packetBackedSlipIds\(/);
  assert.match(src, /\.update\(patch\)\s*\.eq\('id', slip\.id\)\s*\.is\('organized_at', null\)/);
  // Title and description are never written by the pass.
  const rules = readFileSync(new URL('../organize-work-slips-rules.ts', import.meta.url), 'utf8');
  const writes = rules.slice(rules.indexOf('export function planOrganizeWrites'), rules.indexOf('export type GroupProposal'));
  assert.ok(writes.length > 200, 'planOrganizeWrites body located');
  assert.doesNotMatch(writes, /patch\.title\b/);
  assert.doesNotMatch(writes, /patch\.description\b/);
});
