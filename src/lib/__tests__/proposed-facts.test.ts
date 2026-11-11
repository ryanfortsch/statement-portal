/**
 * One proposed-facts list on the Quality lens (UX audit 2026-11-07, slice 3).
 * The two designs merged; the two filing paths did not. A triaged guest
 * statement files through fileTriagedGroup(s), every other row through the
 * one-at-a-time parse + apply, each with the payload it always had. These
 * tests hold the split and read the components for the calls.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { audienceCounts, buildFactBlocks, isTriaged, listAudienceArg, type AudienceUpdate } from '../proposed-facts.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

function row(over: Partial<AudienceUpdate>): AudienceUpdate {
  return {
    id: 'c1',
    property_id: 'home-a',
    property_name: 'Home A',
    owner_name: '',
    category: 'parking',
    fact_text: 'Two parking spaces',
    raw_quote: '',
    confidence: 'high',
    source: 'guest',
    created_at: '2026-11-01T12:00:00Z',
    status: 'pending',
    triage: null,
    audience: 'guest',
    ...over,
  };
}

function triage(over: Record<string, unknown> = {}) {
  return {
    verdict: 'add',
    statement: 'Two parking spaces behind the house.',
    kb_section: 'Parking',
    evidence: '',
    reason: '',
    confidence: 'high',
    downgraded_from: '',
    needs_ruling: false,
    group_id: 'g1',
    group_size: 1,
    property_id: 'home-a',
    at: '2026-11-01T12:00:00Z',
    ...over,
  };
}

describe('the proposed-facts list', () => {
  test('only a guest row with a triaged statement takes the triaged path', () => {
    assert.equal(isTriaged(row({ triage: triage() })), true);
    assert.equal(isTriaged(row({ triage: null })), false);
    assert.equal(isTriaged(row({ triage: triage({ statement: '' }) })), false);
    // A cleaner, contractor or owner row never read triage before the merge.
    for (const audience of ['cleaner', 'contractor', 'owner'] as const) {
      assert.equal(isTriaged(row({ audience, triage: triage() })), false, audience);
    }
  });

  test('candidates sharing a group are one statement; the rest stay one at a time', () => {
    const blocks = buildFactBlocks([
      row({ id: 'c1', raw_quote: 'park two cars', triage: triage() }),
      row({ id: 'c2', raw_quote: 'two spots out back', triage: triage() }),
      row({ id: 'c3', audience: 'cleaner', triage: triage({ group_id: 'g9' }) }),
      row({ id: 'c4', triage: null }),
    ]);
    assert.equal(blocks.length, 1);
    const [b] = blocks;
    assert.equal(b.groups.length, 1);
    assert.deepEqual(b.groups[0].candidateIds, ['c1', 'c2']);
    assert.equal(b.groups[0].mined, 2);
    assert.deepEqual(b.groups[0].quotes, ['park two cars', 'two spots out back']);
    assert.deepEqual(b.candidates.map((c) => [c.id, c.audience]), [['c3', 'cleaner'], ['c4', 'guest']]);
  });

  test('a conflict, a flagged or a less-than-high statement needs a person, and its home leads', () => {
    const blocks = buildFactBlocks([
      row({ id: 'a1', property_id: 'big', property_name: 'Big', triage: triage({ group_id: 'b1', property_id: 'big' }) }),
      row({ id: 'a2', property_id: 'big', property_name: 'Big', triage: triage({ group_id: 'b2', property_id: 'big' }) }),
      row({ id: 'a3', property_id: 'big', property_name: 'Big', audience: 'owner' }),
      row({ id: 'r1', property_id: 'rule', property_name: 'Rule', triage: triage({ group_id: 'r', property_id: 'rule', confidence: 'medium' }) }),
    ]);
    assert.deepEqual(blocks.map((b) => b.propertyId), ['rule', 'big']);
    assert.equal(blocks[0].groups[0].needsRuling, true);
    assert.equal(buildFactBlocks([row({ triage: triage({ verdict: 'conflict' }) })])[0].groups[0].needsRuling, true);
    assert.equal(buildFactBlocks([row({ triage: triage({ needs_ruling: true }) })])[0].groups[0].needsRuling, true);
    assert.equal(buildFactBlocks([row({ triage: triage() })])[0].groups[0].needsRuling, false);
  });

  test('audience counts in house order, and the owner bucket is the no-audience read', () => {
    assert.deepEqual(
      audienceCounts([row({ audience: 'owner' }), row({ audience: 'guest' }), row({ audience: 'owner' })]),
      [{ audience: 'guest', count: 1 }, { audience: 'owner', count: 2 }],
    );
    assert.equal(listAudienceArg('owner'), undefined);
    assert.equal(listAudienceArg('guest'), 'guest');
    assert.equal(listAudienceArg('cleaner'), 'cleaner');
    assert.equal(listAudienceArg('contractor'), 'contractor');
  });

  test('every verb calls the server action it always did, with the same payload', () => {
    const list = read('src/app/messaging/ProposedFacts.tsx');
    assert.ok(list.includes('await fileTriagedGroup(g.candidateIds, propertyId, g.statement, g.category)'));
    assert.ok(list.includes('await dismissTriagedGroup(g.candidateIds)'));
    assert.ok(list.includes('batch.map((g) => ({ candidateIds: g.candidateIds, statement: g.statement, category: g.category }))'));
    const card = read('src/app/messaging/FactCandidateCard.tsx');
    assert.ok(card.includes('await parseProposedUpdate(propertyId, candidate.fact_text)'));
    assert.ok(card.includes('await applyProposedUpdate(candidate.id, propertyId, included, candidate.category)'));
    assert.ok(card.includes('await dismissProposedUpdate(candidate.id)'));
    for (const src of [list, card]) {
      assert.ok(src.includes("from '../owner-messaging/proposed-updates-actions'"), 'the one actions file');
    }
  });
});
