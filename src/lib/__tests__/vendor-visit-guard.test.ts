/**
 * Never write before approve (docs/vendor-visit-holds.md). Dotti, 2026-10-18:
 * "schedule block should be for my approval."
 *
 * A vendor's text files a proposal and NOTHING else: no Guesty hold, no
 * bookings row, no calendar day, no slip. Only the operator's approve, from a
 * signed-in session, reaches the one writer, and the writer claims the card
 * and re-reads the calendar before it writes. These checks run the ingest
 * against a recording fake database, then read the source for the rest,
 * because each link is one line that deletes cleanly.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { proposeVendorVisit } from '../vendor-visits.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const code = (repoPath: string): string => read(repoPath).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

type Write = { table: string; op: string; payload: unknown };

/** A Supabase stand-in: every read answers with the table's canned rows,
 *  every write is recorded. Filters are accepted and ignored. */
function fakeDb(tables: Record<string, unknown[]>) {
  const writes: Write[] = [];
  const db = {
    from(table: string) {
      let op = 'select';
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'is', 'in', 'gt', 'gte', 'lt', 'lte', 'like', 'or', 'order', 'limit', 'range', 'maybeSingle']) {
        builder[m] = () => builder;
      }
      for (const m of ['insert', 'update', 'upsert', 'delete']) {
        builder[m] = (payload?: unknown) => {
          op = m;
          writes.push({ table, op: m, payload });
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const data = op === 'upsert' || op === 'insert' ? [{ id: 'new-proposal' }] : op === 'select' ? tables[table] ?? [] : [];
        return Promise.resolve({ data, error: null, count: 0 }).then(resolve, reject);
      };
      return builder;
    },
  };
  return { db: db as never, writes };
}

const TOM = { id: 'tv-1', name: 'Tom Mackey Plumbing', category: 'plumbing', phone: '978-767-5409', after_hours_phone: null, property_ids: [] };
const ROSTER = [
  { id: '73_rocky_neck', name: '73 Rocky Neck', listing_match: null },
  { id: '21_horton', name: '21 Horton', listing_match: null },
];
const OFFER_EVENT = {
  payload: {
    data: {
      object: {
        body: 'Hi Tom, 73 Rocky Neck is open Wed 10/21 after 11 AM to Thu 10/22 by 3 PM; Mon 10/26 to Thu 10/29; or Mon 11/2 to Thu 11/12.',
        createdAt: '2026-10-18T15:00:00Z',
        to: ['+19787675409'],
      },
    },
  },
  received_at: '2026-10-18T15:00:01Z',
};
const NOW = new Date('2026-10-18T20:00:00Z');

describe('a vendor text files a proposal and nothing else', () => {
  test('"Tuesday 10/27 at 1 works" on the Owners line: one proposal row, no hold, no slip', async () => {
    const { db, writes } = fakeDb({ trade_vendors: [TOM], properties: ROSTER, quo_events: [OFFER_EVENT], vendor_visit_proposals: [] });
    const res = await proposeVendorVisit(
      db,
      { messageId: 'msg-1', from: '+19787675409', body: 'Tuesday 10/27 at 1 works', at: '2026-10-18T19:00:00Z', line: 'owners' },
      NOW,
    );
    assert.deepEqual(res, { id: 'new-proposal', status: 'pending' });
    const tables = new Set(writes.map((w) => w.table));
    assert.deepEqual([...tables], ['vendor_visit_proposals'], 'the only table written is the proposals table');
    const filed = writes.find((w) => w.op === 'upsert')?.payload as Record<string, unknown>;
    assert.equal(filed.visit_date, '2026-10-27');
    assert.equal(filed.start_time, '13:00');
    assert.equal(filed.property_id, '73_rocky_neck', 'the home comes from our offer, not from "10/21" read as 21 Horton');
    assert.equal(filed.property_basis, 'offer');
    assert.equal(filed.quo_line, 'owners');
    assert.equal(filed.status, 'pending');
  });

  test('the 24/7 line files the same card', async () => {
    const { db, writes } = fakeDb({ trade_vendors: [TOM], properties: ROSTER, quo_events: [OFFER_EVENT], vendor_visit_proposals: [] });
    await proposeVendorVisit(db, { messageId: 'msg-2', from: '9787675409', body: 'Tuesday 10/27 at 1 works', at: '2026-10-18T19:00:00Z', line: 'ops' }, NOW);
    const filed = writes.find((w) => w.op === 'upsert')?.payload as Record<string, unknown>;
    assert.equal(filed.quo_line, 'ops');
    assert.equal(filed.visit_date, '2026-10-27');
  });

  test('an unclear day files a question, with no day on it', async () => {
    const { db, writes } = fakeDb({ trade_vendors: [TOM], properties: ROSTER, quo_events: [OFFER_EVENT], vendor_visit_proposals: [] });
    await proposeVendorVisit(db, { messageId: 'msg-3', from: '+19787675409', body: 'Tuesday works', at: '2026-10-18T19:00:00Z', line: 'ops' }, NOW);
    const filed = writes.find((w) => w.op === 'upsert')?.payload as Record<string, unknown>;
    assert.equal(filed.visit_date, null);
    assert.ok(String(filed.ask_reason).length > 0);
    assert.deepEqual(filed.date_candidates, ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10']);
  });

  test('a number that is not a trade vendor writes nothing', async () => {
    const { db, writes } = fakeDb({ trade_vendors: [TOM], properties: ROSTER, quo_events: [OFFER_EVENT], vendor_visit_proposals: [] });
    assert.equal(await proposeVendorVisit(db, { messageId: 'msg-4', from: '+15550100', body: 'Tuesday 10/27 at 1 works', at: '2026-10-18T19:00:00Z', line: 'ops' }, NOW), null);
    assert.deepEqual(writes, []);
  });

  test('a replayed old text about a visit already past writes nothing', async () => {
    const { db, writes } = fakeDb({ trade_vendors: [TOM], properties: ROSTER, quo_events: [], vendor_visit_proposals: [] });
    const later = new Date('2026-11-05T12:00:00Z');
    assert.equal(await proposeVendorVisit(db, { messageId: 'msg-5', from: '+19787675409', body: 'Tuesday 10/27 at 1 works', at: '2026-10-18T19:00:00Z', line: 'ops' }, later), null);
    assert.deepEqual(writes, []);
  });

  test('a dateless "sounds good" never replaces a card that has a day', async () => {
    const { db, writes } = fakeDb({ trade_vendors: [TOM], properties: ROSTER, quo_events: [OFFER_EVENT], vendor_visit_proposals: [{ id: 'existing' }] });
    assert.equal(await proposeVendorVisit(db, { messageId: 'msg-6', from: '+19787675409', body: 'Sounds good, see you then', at: '2026-10-18T19:30:00Z', line: 'ops' }, NOW), null);
    assert.deepEqual(writes, []);
  });
});

describe('the detection module cannot reach a writer', () => {
  const detect = code('src/lib/vendor-visits.ts');

  test('it reads four tables and writes one', () => {
    const tables = new Set([...detect.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]));
    assert.deepEqual([...tables].sort(), ['properties', 'quo_events', 'trade_vendors', 'vendor_visit_proposals']);
  });

  test('it imports nothing that holds a calendar or touches a slip', () => {
    for (const forbidden of ['guestyWrite', 'createBlock', 'syncCalendarDays', 'writeHelmCalendarMirror', 'vendor-visit-approve', 'work_slips', 'bookings', 'property_calendar_days', 'supabase-admin']) {
      assert.ok(!detect.includes(forbidden), `vendor-visits.ts mentions ${forbidden}`);
    }
  });

  test('the Quo ingest calls detection, fail-soft, and nothing of the approve', () => {
    const ingest = code('src/lib/quo-ingest.ts');
    assert.ok(ingest.includes("import { proposeVendorVisit } from '@/lib/vendor-visits';"));
    assert.ok(!ingest.includes('vendor-visit-approve'));
    assert.ok(/try \{\s*await proposeVendorVisit\(/.test(ingest), 'a failure never costs the webhook the rest of its work');
  });
});

/** Every .ts/.tsx file under src. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      out.push(...sources(p));
    } else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('only a signed-in approve reaches the writer', () => {
  test('the writer is imported by the Team inbox actions and nothing else', () => {
    const root = new URL('../../', import.meta.url).pathname;
    const importers = sources(root)
      .filter((f) => /from '@\/lib\/vendor-visit-approve'|from '\.\/vendor-visit-approve(\.ts)?'/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length));
    assert.deepEqual(importers, ['app/messaging/team/vendor-visit-actions.ts']);
  });

  test('every action asks who is signed in before it calls the writer', () => {
    const actions = code('src/app/messaging/team/vendor-visit-actions.ts');
    assert.ok(actions.startsWith("\n'use server'") || actions.trimStart().startsWith("'use server'"));
    const fns = [...actions.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)];
    assert.equal(fns.length, 4);
    for (const [, name, body] of fns) {
      const who = body.indexOf('await operator()');
      const call = body.search(/await (approveVendorVisit|editVendorVisit|markVendorVisitHandled|undoVendorVisitHandled)\(/);
      assert.ok(who >= 0 && call > who, `${name} checks the session first`);
      assert.ok(body.includes("if (!who) return { ok: false, error: 'Not signed in' };"), `${name} refuses a missing session`);
    }
  });

  test('approve claims the card and re-reads the calendar before any write', () => {
    const w = code('src/lib/vendor-visit-approve.ts');
    const body = w.slice(w.indexOf('export async function approveVendorVisit'));
    const claim = body.indexOf('claimForApproval(');
    const reread = body.indexOf('loadNightFacts(');
    const firstWrite = Math.min(
      ...['holdInGuesty(', 'holdInHelm(', ".from('work_slips')"].map((s) => body.indexOf(s)).filter((i) => i >= 0),
    );
    assert.ok(claim > 0 && reread > claim && firstWrite > reread, 'claim, then re-read, then write');
    assert.ok(/\.eq\('status', 'approving'\)/.test(body), 'the finish only lands on the row this approve claimed');
  });

  test('the claim takes only a pending card (or an approve that died)', () => {
    const w = code('src/lib/vendor-visit-approve.ts');
    assert.ok(w.includes(".or(`status.eq.pending,and(status.eq.approving,claimed_at.lt.${staleBefore})`)"));
  });

  test('in Guesty, every listing is read live before anything is written, and a booked night stops it', () => {
    const w = code('src/lib/vendor-visit-approve.ts');
    const fn = w.slice(w.indexOf('async function holdInGuesty'), w.indexOf('async function holdInHelm'));
    assert.ok(fn.indexOf('guestyGet<') < fn.indexOf('guestyWrite('), 'reads before writes');
    assert.ok(/GUESTY_BOOKED\.has\(status\)\) throw new NothingWritten/.test(fn), 'a booked night throws before the write loop');
    assert.ok(fn.indexOf('throw new NothingWritten(`Guesty shows') < fn.indexOf('for (const [listing, open] of toPlace)'));
  });

  test('on a Helm-run home the hold goes through the overlap-refusing writer', () => {
    const w = code('src/lib/vendor-visit-approve.ts');
    assert.ok(w.includes("createBlock({ propertyId, checkIn: run.start, checkOut: addDays(run.end, 1), holdKind: 'maintenance', note, createdBy: actor })"));
  });

  test('the card wires approve to the action, and nothing else on it writes', () => {
    const card = code('src/app/messaging/team/VendorVisitCard.tsx');
    assert.equal((card.match(/approveVendorVisitAction\(/g) ?? []).length, 1);
    assert.ok(/approve: \(\) =>\s*approveVendorVisitAction\(/.test(card));
    assert.ok(card.includes('<ApprovalCard'), 'the one card');
  });

  test('no team text or email goes out from this rail', () => {
    for (const f of ['src/lib/vendor-visits.ts', 'src/lib/vendor-visit-approve.ts', 'src/lib/vendor-visit-cards.ts', 'src/app/messaging/team/vendor-visit-actions.ts']) {
      const c = code(f);
      for (const sender of ['sendMessage', 'sendEmail', 'resend', 'quoFromNumber', 'officeNotice']) assert.ok(!c.includes(sender), `${f} uses ${sender}`);
    }
  });
});

describe('the card is on the Team inbox, counted with the contractors', () => {
  test('a Vendor card under the Contractors filter, on the one queue', () => {
    const queue = code('src/app/messaging/team/TeamInboxQueue.tsx');
    assert.ok(queue.includes("kind: 'vendor_visit' as const, card: c"));
    assert.ok(queue.includes("r.kind !== 'cleaner'"), 'Contractors shows contractor texts and vendor visits');
    assert.ok(queue.includes("kind === 'vendor_visit' ? undoVendorVisitAction(id)"), 'Mark handled has Undo, as on every card');
    assert.ok(queue.includes('<Pill label="Vendor"'));
  });

  test('the Team pill and the kinds line count it', async () => {
    const route = code('src/app/api/messaging/pending-count/route.ts');
    assert.ok(route.includes('.filter(notScheduled).length + vendorVisits'));
    const { cleanerKindsLine } = await import('../cleaner-queue-kinds.ts');
    assert.deepEqual(
      cleanerKindsLine({ texts: 0, contractorTexts: 1, vendorVisits: 2, schedules: 0, questions: 0 }).map((k) => k.label),
      ['1 contractor text', '2 vendor visits'],
    );
  });

  test('the page still shows vendor cards when the concierge is down', () => {
    const page = code('src/app/messaging/team/page.tsx');
    assert.ok(/<NotReachable message=\{explainError\(cleaners\.error\)\} retry \/>[\s\S]{0,200}vendor\.cards\.length > 0/.test(page));
  });
});
