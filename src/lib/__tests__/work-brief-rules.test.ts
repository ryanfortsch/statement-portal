import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ageDays, ageWords, briefFingerprint, briefIsStale, trimHeadline } from '../work-brief-rules.ts';
import { supplyChipLabel } from '../work-slip-lanes.ts';
import { suppliesLabel } from '../inspection-supplies.ts';

const slip = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Slip ${id}`,
  status: 'open' as const,
  priority: 'normal' as const,
  category: 'maintenance' as const,
  scheduled_date: null,
  assigned_to_email: null,
  assigned_to_label: null,
  run_scope: 'inspector' as const,
  owner_action_required: false,
  owner_status: null,
  organize_group: null,
  action_summary: null,
  ...extra,
});

test('the fingerprint ignores row order and changes when the sentences would', () => {
  const a = [slip('1'), slip('2', { run_scope: 'handyman' })];
  const b = [slip('2', { run_scope: 'handyman' }), slip('1')];
  assert.equal(briefFingerprint(a), briefFingerprint(b));
  assert.notEqual(briefFingerprint(a), briefFingerprint([slip('1')]));
  assert.notEqual(briefFingerprint(a), briefFingerprint([slip('1', { status: 'in_progress' }), slip('2', { run_scope: 'handyman' })]));
  assert.notEqual(briefFingerprint(a), briefFingerprint([slip('1'), slip('2', { run_scope: 'pro' })]));
  assert.notEqual(briefFingerprint(a), briefFingerprint([slip('1', { organize_group: 'sink' }), slip('2', { run_scope: 'handyman' })]));
  assert.notEqual(briefFingerprint(a), briefFingerprint([slip('1', { action_summary: 'Replace it' }), slip('2', { run_scope: 'handyman' })]));
  assert.notEqual(briefFingerprint(a), briefFingerprint([slip('1', { owner_action_required: true, owner_status: 'approved' }), slip('2', { run_scope: 'handyman' })]));
  // The title is not in the fingerprint on purpose: a retitle does not
  // change what the work is, and the nightly rewrite would churn on it.
  assert.equal(briefFingerprint(a), briefFingerprint([slip('1', { title: 'Renamed' }), slip('2', { run_scope: 'handyman' })]));
});

test('a brief is stale when its slip set moved, and a home with no brief and no slips is not', () => {
  const slips = [slip('1')];
  const fresh = { slip_fingerprint: briefFingerprint(slips) };
  assert.equal(briefIsStale(fresh, slips), false);
  assert.equal(briefIsStale(fresh, [slip('1'), slip('2')]), true);
  assert.equal(briefIsStale(null, slips), true);
  assert.equal(briefIsStale(null, []), false);
});

test('a supply is named by the supplies check when it filed it, else by its bare title', () => {
  assert.equal(supplyChipLabel({ title: 'Restock: Toilet paper', from_supply_key: 'toilet_paper' }), suppliesLabel('toilet_paper'));
  assert.notEqual(suppliesLabel('toilet_paper'), 'Restock: Toilet paper');
  assert.equal(supplyChipLabel({ title: 'Restock: Coffee pods', from_supply_key: null }), 'Coffee pods');
  assert.equal(supplyChipLabel({ title: '17 Beach: Restock plunger', from_supply_key: null }, '17 Beach'), 'Restock plunger');
  assert.equal(supplyChipLabel({ title: 'Pillow and insert', from_supply_key: null }, '17 Beach'), 'Pillow and insert');
});

test('age is whole days, never negative', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  assert.equal(ageDays('2026-10-15T08:00:00Z', now), 0);
  assert.equal(ageDays('2026-10-01T08:00:00Z', now), 14);
  assert.equal(ageDays('2026-10-16T08:00:00Z', now), 0);
});

test('the property page, the print sheet and the board all carry the brief', () => {
  const page = readFileSync(new URL('../../app/properties/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /getWorkBrief\(p\.id\)/);
  assert.match(page, /<OpenWorkSection /);
  const section = readFileSync(new URL('../../app/properties/[id]/OpenWorkSection.tsx', import.meta.url), 'utf8');
  assert.match(section, /groupSlipsByLane\(slips\)/);
  assert.match(section, /briefIsStale\(brief, slips\)/);
  assert.doesNotMatch(section, /Unclaimed/);
  const sheet = readFileSync(new URL('../../app/properties/[id]/work-slips/print/page.tsx', import.meta.url), 'utf8');
  assert.match(sheet, /loadWorkBrief\(supabase, id\)/);
  assert.match(sheet, /brief\.brief/);
  const board = readFileSync(new URL('../../app/work/page.tsx', import.meta.url), 'utf8');
  assert.match(board, /loadWorkBriefHeadlines\(supabase\)/);
  // The nightly route exists and rewrites only homes whose slip set moved.
  const lib = readFileSync(new URL('../work-briefs.ts', import.meta.url), 'utf8');
  assert.match(lib, /current\.slip_fingerprint === fingerprint && current\.brief/);
  assert.match(lib, /Never a guest's name/);
});

test('a long headline is cut at a clause boundary, never mid-word', () => {
  const long = 'Plumber for the kitchen sink leak; window contractor for four second-floor failures; handyman for bathroom blind and guest-house counter';
  assert.equal(trimHeadline(long), 'Plumber for the kitchen sink leak; window contractor for four second-floor failures');
  assert.equal(trimHeadline('Short and fine.'), 'Short and fine');
  const oneClause = 'A single clause that runs on and on about the thermostat, the toilet, the bathtub, the sunroom window and the gutter';
  const cut = trimHeadline(oneClause, 60);
  assert.ok(cut.length <= 61 && cut.endsWith('…'), cut);
  // The stem is a prefix of the original that ends on a word boundary.
  const stem = cut.slice(0, -1);
  assert.ok(oneClause.startsWith(stem), cut);
  assert.match(oneClause.charAt(stem.length), /[\s,;]/);
});

test('age words: fresh items say so, mid-age items say nothing, old items name the month', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  assert.equal(ageWords('2026-10-15T08:00:00Z', now), 'opened today');
  assert.equal(ageWords('2026-10-14T08:00:00Z', now), 'opened yesterday');
  assert.equal(ageWords('2026-10-01T08:00:00Z', now), null);
  assert.equal(ageWords('2026-07-26T08:00:00Z', now), 'waiting since July');
});

test("the brief never reads a concierge gear or stay-note slip's text, only its title", () => {
  const lib = readFileSync(new URL('../work-briefs.ts', import.meta.url), 'utf8');
  assert.match(lib, /namesAGuest\(s\)\s*\?\s*null/);
  assert.match(lib, /key\.startsWith\('gear:'\) \|\| key\.startsWith\('staycontact:'\)/);
  // The two rails whose titles name the guest are read as generic lines.
  assert.match(lib, /key\.startsWith\('prerelease-paylink:'\)/);
  assert.match(lib, /key\.startsWith\('ffhold:'\)/);
  // The print sheet never prints an office item's title.
  const sheet = readFileSync(new URL('../../app/properties/[id]/work-slips/print/page.tsx', import.meta.url), 'utf8');
  const office = sheet.slice(sheet.indexOf("lane === 'office' && ("), sheet.indexOf("lane !== 'supply' && lane !== 'office'"));
  assert.doesNotMatch(office, /slip\.title/);
});

