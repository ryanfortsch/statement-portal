import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeVisits } from '../field-roster-visits.ts';

// Hiring folded into Roster (audit Phase 3, Field): the applicants sit at the
// top of each trade's roster with one invite door, and a roster card's
// summary carries standing, the next or last visit and the W-9 state.

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('next and last visit: claimed work is to come, submitted work happened, an offer is never work', () => {
  const today = '2026-10-18';
  const v = summarizeVisits(
    [
      { awarded_contractor_id: 'a', visit_date: '2026-10-24', status: 'claimed' },
      { awarded_contractor_id: 'a', visit_date: '2026-10-21', status: 'claimed' },
      { awarded_contractor_id: 'a', visit_date: '2026-10-02', status: 'approved' },
      { awarded_contractor_id: 'a', visit_date: '2026-10-09', status: 'submitted' },
      { awarded_contractor_id: 'b', visit_date: '2026-10-18', status: 'in_progress' },
      { awarded_contractor_id: 'c', visit_date: '2026-10-11', status: 'claimed' }, // a lapsed claim is neither
      { awarded_contractor_id: null, visit_date: '2026-10-20', status: 'claimed' },
    ],
    [
      { contractor_id: 'd', shoot_date: '2026-10-30', status: 'offered' },
      { contractor_id: 'd', shoot_date: '2026-10-19', status: 'declined' },
      { contractor_id: 'd', shoot_date: '2026-10-25', status: 'cancelled' },
      { contractor_id: 'e', shoot_date: '2026-10-28', status: 'scheduled' },
      { contractor_id: 'e', shoot_date: '2026-10-01', status: 'settled' },
    ],
    today,
  );
  assert.deepEqual(v.get('a'), { next: '2026-10-21', last: '2026-10-09' });
  assert.deepEqual(v.get('b'), { next: today, last: today });
  assert.deepEqual(v.get('c'), { next: null, last: null });
  assert.deepEqual(v.get('d'), { next: null, last: null }, 'offers, passes and cancellations are not visits');
  assert.deepEqual(v.get('e'), { next: '2026-10-28', last: '2026-10-01' });
});

test('the applicants lead each roster, with the one invite door', () => {
  const roster = read('src/app/fieldwork/roster/page.tsx');
  const at = roster.indexOf('<Applicants apps={applications} trade={trade} base={base} />');
  assert.ok(at > 0, 'the roster renders the Applicants section');
  assert.ok(at < roster.indexOf('working.map((c) => ('), 'above the people');
  assert.doesNotMatch(roster, /fieldwork\/hiring/, 'no link to the retired page');
  assert.doesNotMatch(roster, /action=\{inviteContractor\}/, 'the roster has no second invite form');
  const section = read('src/app/fieldwork/roster/Applicants.tsx');
  assert.equal((section.match(/action=\{inviteContractor\}/g) ?? []).length, 1, 'one direct invite form');
  assert.ok(section.includes('action={inviteApplicant}'));
  // Staff invite too since 2026-10-19 (the hiring lifecycle is theirs; pay is not).
  assert.match(section, /<details>\n\s*<summary style=\{foldSummary\}>\+ Invite/, 'the direct invite door is there');
  assert.ok(!/\bowner\b/.test(section.replace(/\/\*[\s\S]*?\*\//g, '')), 'no owner gate left on the applicant controls');
  assert.ok(section.includes('id="applicants"'), 'the anchor the redirect and the email land on');
});

test('the old page, the strip, the atlas and the email all point at the roster', () => {
  const hiring = read('src/app/fieldwork/hiring/page.tsx');
  assert.ok(hiring.includes("redirect(`/fieldwork/roster${trade ? `?trade=${encodeURIComponent(trade)}` : ''}#applicants`)"));
  const tabs = read('src/components/FieldTabs.tsx');
  assert.doesNotMatch(tabs, /'hiring'/, 'no Hiring lens');
  const atlas = read('src/lib/helm-modules.ts');
  assert.ok(atlas.includes("href: '/fieldwork/roster#applicants',"), 'search still finds Hiring');
  const notify = read('src/lib/field-notify.ts');
  assert.ok(notify.includes('/fieldwork/roster?trade=${encodeURIComponent(app.trade ||'));
  assert.ok(read('src/app/field/apply/actions.ts').includes('sendNewApplicantEmail({ full_name, email, phone, area, has_transport, source, trade })'));
  const actions = read('src/app/fieldwork/hiring/actions.ts');
  assert.doesNotMatch(actions, /revalidatePath\('\/fieldwork\/hiring'\)/);
});

test('the card summary is standing, the calendar and the W-9; the scores fold into the Record', () => {
  const roster = read('src/app/fieldwork/roster/page.tsx');
  const at = roster.indexOf('<summary className="rt-fold-summary"');
  const summary = roster.slice(at, roster.indexOf('</summary>', at));
  assert.ok(summary.includes('<Pill label={standing.label} color={standing.color} />'));
  assert.ok(summary.includes('{visitLine &&'));
  assert.ok(summary.includes('W-9 needed') && summary.includes('W-9 on file'));
  for (const gone of ['TIER_LABEL', 'rating.avg', 'Check:']) assert.ok(!summary.includes(gone), `${gone} left the summary`);
  for (const row of ['label="Reliability"', 'label="Guest reviews"', 'label="Earnings"', 'label="Books YTD"']) {
    assert.ok(roster.includes(`<RecordRow ${row}>`), `${row} is a line of the Record`);
  }
});
