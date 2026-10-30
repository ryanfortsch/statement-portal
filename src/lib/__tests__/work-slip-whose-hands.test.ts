/**
 * Whose hands: one question on the slip page about who does the work.
 *
 * The UI/UX audit of 2026-10-17 found two chip rows on one slip that both
 * moved it between lanes: "Lane" (the category, in five words) and "Who
 * does this · Run triage" (the run scope, in three). Phase 3 made them one
 * choice with the six lane words. The lane is never stored
 * (lib/work-slip-lanes.ts derives it from category, run_scope and the owner
 * flag), so each choice has to write exactly the columns the derivation
 * reads back as that same lane, or the board would file the slip somewhere
 * the person did not pick.
 *
 * The pure half: every choice, from every kind of starting slip, round-trips
 * through slipLane() to itself, and an ordinary slip is offered all six.
 * The source half: the slip page, its editor and the server action are
 * wired to those functions and stamp organized_at.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  LANE_CHOICE_LABELS,
  LANE_ORDER,
  laneChoicePatch,
  laneChoicesFor,
  slipLane,
  type LaneChoiceSlip,
  type WorkLane,
} from '../work-slip-lanes.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const exists = (repoPath: string): boolean => existsSync(new URL(`../../../${repoPath}`, import.meta.url));

/** One of every shape a slip arrives in: hand-filed, triaged, organized,
 *  flagged for the owner, concierge-filed, packet-filed, supplies check. */
const STARTS: Record<string, LaneChoiceSlip> = {
  'untriaged maintenance': { category: 'maintenance', title: 'Loose stair rail' },
  'inspector maintenance': { category: 'maintenance', title: 'Swap a bulb', run_scope: 'inspector' },
  'handyman maintenance': { category: 'maintenance', title: 'Rehang the screen door', run_scope: 'handyman' },
  'pro maintenance': { category: 'maintenance', title: 'Boiler service', run_scope: 'pro' },
  'flagged maintenance': { category: 'maintenance', title: 'New grill', run_scope: 'handyman', owner_action_required: true, owner_action_type: 'approve' },
  'owner category': { category: 'owner', title: 'Replace the sofa', owner_action_required: true, owner_action_type: 'decide' },
  'owner category, flag off': { category: 'owner', title: 'Paint the deck' },
  supply: { category: 'inventory', title: 'Paper towels' },
  office: { category: 'rising_tide', title: 'Update the listing text' },
  'legacy restock under office': { category: 'rising_tide', title: 'Restock: dish soap' },
  other: { category: 'other', title: 'Hold for far-future stay' },
  'concierge gear': { category: 'other', title: 'Pack n play for the Smiths', from_guest_request_key: 'gear:abc' },
  'concierge stay note': { category: 'other', title: 'Late arrival', from_guest_request_key: 'staycontact:abc' },
  vendor: { category: 'vendor', title: 'Chimney sweep' },
  'packet one-off': { category: 'ad_hoc', title: 'Haul the old mattress' },
};

/** Supplies-check slips are a supply by provenance (from_supply_key), which
 *  no write clears: Supply and Owner are the only lanes open to them. */
const SUPPLY_KEYED: Record<string, LaneChoiceSlip> = {
  'supplies check': { category: 'inventory', title: 'Restock: paper towels', from_supply_key: 'paper_towels' },
  'supplies check, flagged': { category: 'owner', title: 'Restock: paper towels', from_supply_key: 'paper_towels', owner_action_required: true },
};

describe('every Whose hands choice reads back as itself', () => {
  for (const [name, start] of Object.entries({ ...STARTS, ...SUPPLY_KEYED })) {
    test(`from ${name}`, () => {
      for (const lane of LANE_ORDER) {
        const patch = laneChoicePatch(lane, start);
        if (!patch) continue;
        assert.equal(slipLane({ ...start, ...patch }), lane, `${name} -> ${lane} writes ${JSON.stringify(patch)}`);
      }
    });
  }

  test('an ordinary slip is offered all six lanes, in walk order', () => {
    for (const [name, start] of Object.entries(STARTS)) {
      assert.deepEqual(laneChoicesFor(start), LANE_ORDER, `${name} is missing a lane`);
    }
  });

  test('a supplies-check slip is offered Supply and Owner only', () => {
    for (const [name, start] of Object.entries(SUPPLY_KEYED)) {
      assert.deepEqual(laneChoicesFor(start), ['supply', 'owner'], name);
    }
  });

  test('the six choices carry the lane words', () => {
    assert.deepEqual(LANE_ORDER.map((l) => LANE_CHOICE_LABELS[l]), ['Supply', 'This visit', 'Handyman', 'Pro or vendor', 'Owner', 'Office']);
  });
});

describe('what each choice writes', () => {
  test('This visit, Handyman and Pro file as maintenance with the scope, which the run planner pools read', () => {
    const scopes: Partial<Record<WorkLane, string>> = { visit: 'inspector', handyman: 'handyman', pro: 'pro' };
    for (const [lane, scope] of Object.entries(scopes)) {
      const patch = laneChoicePatch(lane as WorkLane, STARTS['supply'])!;
      assert.equal(patch.category, 'maintenance');
      assert.equal(patch.run_scope, scope);
      assert.equal(patch.owner_action_required, false);
    }
  });

  test('Owner arms the ask (Purchase unless one is set) and leaving it withdraws the ask', () => {
    assert.deepEqual(laneChoicePatch('owner', STARTS['untriaged maintenance']), { category: 'owner', owner_action_required: true, owner_action_type: 'purchase' });
    assert.equal(laneChoicePatch('owner', STARTS['flagged maintenance'])!.owner_action_type, 'approve');
    const leave = laneChoicePatch('handyman', STARTS['owner category'])!;
    assert.equal(leave.owner_action_required, false);
    assert.equal(leave.owner_action_type, null);
    assert.equal(leave.owner_action_notes, null);
    assert.equal(leave.owner_status, 'not_sent');
  });

  test('Office desk work titled "Restock:" files as Other, so it does not read as a supply', () => {
    assert.equal(laneChoicePatch('office', { category: 'maintenance', title: 'Restock: order more bins' })!.category, 'other');
    assert.equal(laneChoicePatch('office', STARTS['untriaged maintenance'])!.category, 'rising_tide');
  });
});

describe('the slip page asks one question', () => {
  const page = read('src/app/work/[id]/page.tsx');
  const editor = read('src/app/work/[id]/SlipLaneEditor.tsx');
  const actions = read('src/app/work/actions.ts');

  test('one work type section, separate from coordination and fed by laneChoicesFor', () => {
    assert.ok(page.includes('title="Work type"'));
    assert.ok(page.includes('choices={laneChoicesFor(slip)}'));
    assert.ok(!page.includes('title="Lane"'), 'a second Lane section is back');
    assert.ok(!page.includes('title="Who does this"'), 'a second Who does this section is back');
    assert.ok(!exists('src/app/work/[id]/SlipCategoryEditor.tsx'), 'the category chips are back');
    assert.ok(!exists('src/app/work/[id]/SlipScopeEditor.tsx'), 'the scope chips are back');
  });

  test('the editor renders the offered lanes by their lane words and saves through updateWorkSlipLane', () => {
    assert.ok(editor.includes('choices.map'));
    assert.ok(editor.includes('LANE_CHOICE_LABELS[choice]'));
    assert.ok(editor.includes('updateWorkSlipLane({ id: slipId, lane: target, propertyId })'));
  });

  test('the server writes laneChoicePatch and stamps organized_at like every operator lane edit', () => {
    const fn = actions.slice(actions.indexOf('export async function updateWorkSlipLane('), actions.indexOf('const OWNER_ACTION_TYPES'));
    assert.ok(fn.length > 0, 'updateWorkSlipLane is where it was');
    assert.ok(fn.includes('laneChoicePatch(args.lane, row)'), 'the write is the derivation-checked patch');
    assert.ok(fn.includes('laneSetBy(session.user.email)'), 'the choice stamps organized_at');
    assert.ok(/\.\.\.stamp,?\s*\n\s*\};/.test(fn) || fn.includes('patch = stamp;'), 'the stamp rides every write');
    assert.ok(!/export async function updateWorkSlip(Category|Scope)\(/.test(actions), 'a second lane writer is back');
  });
});

describe('Organize says what it did', () => {
  test('the board reports the slips it filed into lanes, never "check back"', () => {
    const board = read('src/app/work/QueueClient.tsx');
    const button = board.slice(board.indexOf('function OrganizeButton('), board.indexOf('function OrganizeButton(') + 4000);
    assert.ok(button.includes('`Filed ${plural(filed)} into lanes.`'), 'the finished pass names what it filed');
    assert.ok(!/check back/i.test(button.replace(/\/\*[\s\S]*?\*\//g, '')), 'the button tells the operator to check back');
  });
});
