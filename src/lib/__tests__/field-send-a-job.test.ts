import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JOB_KIND_LABEL, jobKindsFor, jobTrade, parseJobKind } from '../field-job-kinds.ts';

// One "Send a job" form replaced the one-off and setup pages (audit Phase 3,
// Field). These guard the merge: one create door on the board, the old routes
// as redirects, the lit trade carried through to the roster that gets the job.

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('the kinds are the packet page words, and handymen are never sent a full inspection', () => {
  assert.deepEqual(JOB_KIND_LABEL, { inspection: 'Full inspection', adhoc: 'One-off job', setup: 'Property setup' });
  assert.deepEqual(jobKindsFor('inspection'), ['inspection', 'adhoc', 'setup']);
  assert.deepEqual(jobKindsFor('maintenance'), ['adhoc', 'setup']);
  assert.equal(parseJobKind('inspection', 'maintenance'), 'adhoc');
  assert.equal(parseJobKind('setup', 'maintenance'), 'setup');
  assert.equal(parseJobKind('nonsense', 'inspection'), 'adhoc');
  assert.equal(parseJobKind(undefined, 'inspection'), 'adhoc');
});

test('a job lands on a board that exists', () => {
  assert.equal(jobTrade('maintenance'), 'maintenance');
  for (const t of ['inspection', 'creative', 'cleaning', '', null, undefined]) assert.equal(jobTrade(t), 'inspection');
});

test('the board has one create door, and the old pages redirect to it', () => {
  const board = read('src/app/fieldwork/packets/page.tsx');
  assert.ok(board.includes('href={`/fieldwork/packets/new?trade=${trade}`}'), 'the board links the Send a job form with its trade');
  assert.doesNotMatch(board, /packets\/(adhoc|setup)/, 'no second create link');
  for (const [route, kind] of [['adhoc', 'adhoc'], ['setup', 'setup']] as const) {
    const src = read(`src/app/fieldwork/packets/${route}/page.tsx`);
    assert.ok(src.includes(`new URLSearchParams({ kind: '${kind}' })`), `${route} redirects with its kind`);
    assert.ok(src.includes("if (trade) q.set('trade', trade);"), `${route} keeps the lit trade`);
    assert.ok(src.includes('redirect(`/fieldwork/packets/new?${q}`)'));
  }
  const add = read('src/app/fieldwork/packets/[id]/page.tsx');
  assert.ok(add.includes('<option key={k} value={k}>{JOB_KIND_LABEL[k]}</option>'), "Add a stop reads the same words");
});

test('the trade rides from the form to the packet row and the offer check', () => {
  const actions = read('src/app/fieldwork/packets/actions.ts');
  const send = actions.match(/export async function sendJobAction[\s\S]*?\n}\n/)?.[0] ?? '';
  assert.ok(send.includes('await dispatchEmail()'), 'the dispatcher is required (team.ts, the dispatch duty)');
  assert.ok(send.includes("raw === 'inspection' && trade !== 'inspection'"), 'an inspection aimed at the handymen is refused, not converted');
  assert.ok(actions.includes('c.trade === trade'), 'an Offer to pick must be on the trade that gets the job');
  assert.doesNotMatch(actions, /c\.trade === 'inspection'\)\.map\(\(c\) => c\.id\)/, 'no create path pins the offer to the inspectors');
  const lib = read('src/lib/field-packets.ts');
  assert.equal((lib.match(/trade: args\.trade \?\? 'inspection',/g) ?? []).length, 2, 'setup and one-off packets take the trade');
});

test('the maintenance bundler is the Handymen board planner, and its send lands there', () => {
  const retired = read('src/app/fieldwork/packets/maintenance/page.tsx');
  assert.ok(retired.includes("redirect('/fieldwork/packets?trade=maintenance#maintenance-jobs')"));
  const board = read('src/app/fieldwork/packets/page.tsx');
  assert.ok(board.includes("trade === 'maintenance' && focus === 'all' && openMaintenance &&"), 'rendered in the planner slot on the Handymen board');
  const actions = read('src/app/fieldwork/packets/actions.ts');
  const bundle = actions.match(/export async function bundleMaintenance[\s\S]*?\n}\n/)?.[0] ?? '';
  assert.ok(bundle.includes("new URLSearchParams({ trade: 'maintenance', sent: '1' })"), 'a sent bundle lands on the Handymen board');
  assert.ok(bundle.includes("c.trade === 'maintenance'"), 'Show to picks are handymen');
  assert.ok(bundle.includes('if (draft) redirect(`/fieldwork/packets/${packetId}`)'), 'Save as draft opens the draft');
  assert.doesNotMatch(bundle, /redirect\('\/fieldwork\/packets\/maintenance/, 'no failure rides a URL to the retired page');
});
