/**
 * The prospect funnel has one meaning of prospect and one verb for parking
 * a deal.
 *
 * - "Prospect" on /properties/prospects is a deal (a projections row).
 *   Adding a home we may sign makes a properties row, so it lives on
 *   /properties, beside the roster the home will join.
 * - Parking a dead deal is "Mark inactive", with a reason, on the list row
 *   and in the workroom alike. The list row's reasonless one-tap "Demote"
 *   is gone, and the Promoted group is not also called "archived".
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

test('adding a home we may sign is on /properties, not on the funnel', () => {
  const funnel = read('src/app/properties/prospects/page.tsx');
  assert.doesNotMatch(funnel, /AddProspect/);
  const roster = read('src/app/properties/page.tsx');
  assert.match(roster, /<AddProspectHomeForm \/>/);
  const form = read('src/app/properties/AddProspectHomeForm.tsx');
  assert.match(form, /\+ Add a home we may sign/);
  assert.match(form, /from '\.\/actions'/);
  assert.match(form, /createProspectProperty/);
});

test('one verb, with a reason, in both places', () => {
  const controls = read('src/components/projections/ProspectInactiveControls.tsx');
  assert.doesNotMatch(controls, /Demot/);
  assert.match(controls, /export const MARK_INACTIVE = 'Mark inactive'/);
  // Both the list row and the workroom panel mark through the reason line.
  assert.match(controls, /markProspectInactive\(projectionId, reason\)/);
  assert.equal((controls.match(/<ReasonLine /g) ?? []).length, 2);
  assert.doesNotMatch(controls, /markProspectInactive\(projectionId\)\)/, 'no reasonless mark');
});

test('the funnel row offers it outside the row link, and Promoted is not "archived"', () => {
  const panel = read('src/components/projections/ProspectsPanel.tsx');
  assert.match(panel, /mode=\{isInactive \? 'reactivate' : 'inactive'\}/);
  const link = panel.slice(panel.indexOf('<Link href={`/prospects/${p.id}`}'), panel.indexOf('</Link>', panel.indexOf('<Link href={`/prospects/${p.id}`}')));
  assert.doesNotMatch(link, /InactiveQuickAction/, 'a reason typed in a link would navigate');
  assert.doesNotMatch(panel, /archived<|\{archived\.length\} archived/);
});
