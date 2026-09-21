import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachesTo,
  buildQuoteFilter,
  collectQuoteKeys,
  groupQuotesByApproval,
  quoteForFilter,
  toCardQuote,
  PER_CARD_LIMIT,
  type QuoteRow,
} from '../guest-quote-context-core.ts';

/**
 * A messaging card has to show the guest's existing quotes, and it has to show
 * only THEIR quotes, and it has to be honest about what is still owed and
 * about what it is not showing. Abha Singhal is the case that drove this: a
 * 2027 form request for one house, then an email thread about a different
 * house and different dates, with two quotes drafted off the second, and her
 * follow-up arriving on a card with no property attached at all (2026-09-21).
 */

const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';
const NOW = new Date('2026-09-21T12:00:00.000Z');

function row(over: Partial<QuoteRow> = {}): QuoteRow {
  return {
    id: 'q1',
    status: 'draft',
    property_internal_name: '16 Waterman',
    check_in: '2027-07-10',
    check_out: '2027-07-24',
    nights: 14,
    total_cents: 1891384,
    payment_plan: 'split',
    deposit_cents: 945692,
    balance_cents: 945692,
    balance_due_on: '2027-05-11',
    deposit_paid_at: null,
    balance_paid_at: null,
    sent_at: null,
    expires_at: FUTURE,
    accepted_at: null,
    declined_at: null,
    voided_at: null,
    guest_email: 'abha@example.com',
    source_ref: null,
    ...over,
  };
}

const card = (over: Record<string, string> = {}) => ({
  id: 'card',
  guest_email: 'abha@example.com',
  ...over,
});

// ── key collection ──────────────────────────────────────────────────────────

test('collects and dedupes the keys a queue can join on', () => {
  const { emails, refs } = collectQuoteKeys([
    { id: 'a', guest_email: 'Abha@Example.com', guesty_message_id: 'sca_email:1' },
    { id: 'b', guest_email: '  abha@example.com ', guesty_message_id: 'sca_email:1' },
    { id: 'c', guest_email: '', guesty_message_id: '' },
  ]);
  assert.deepEqual(emails, ['abha@example.com'], 'case and whitespace fold to one key');
  assert.deepEqual(refs, ['sca_email:1']);
});

test('an all-OTA queue yields no filter, so it costs no query', () => {
  const { emails, refs } = collectQuoteKeys([{ id: 'a' }, { id: 'b' }]);
  assert.equal(buildQuoteFilter(emails, refs), '');
});

// ── the filter that goes on the wire ────────────────────────────────────────

test('a comma in an address cannot widen the filter', () => {
  // PostgREST splits in.(...) on commas. Unquoted, this would ask for
  // everyone@else.com's quotes as well.
  const filter = buildQuoteFilter(['a@b.com,everyone@else.com'], []);
  assert.equal(filter, `guest_email.in.("a@b.com,everyone@else.com")`);
});

test('quotes and backslashes in a value are escaped, not dropped', () => {
  assert.equal(quoteForFilter('a"b'), '"a\\"b"');
  assert.equal(quoteForFilter('a\\b'), '"a\\\\b"');
});

test('both keys ride one filter when both are present', () => {
  assert.equal(
    buildQuoteFilter(['a@b.com'], ['sca_email:1']),
    'guest_email.in.("a@b.com"),source_ref.in.("sca_email:1")',
  );
});

// ── matching ────────────────────────────────────────────────────────────────

test('a quote reaches its guest by email, whatever card they are on now', () => {
  const out = groupQuotesByApproval(
    [row({ id: 'q1' }), row({ id: 'q2', check_in: '2027-08-28', check_out: '2027-09-04' })],
    [{ id: 'card-today', guest_email: 'ABHA@example.com', guesty_message_id: 'sca_email:new' }],
    NOW,
  );
  assert.equal(out['card-today'].quotes.length, 2, 'a new card with a new message id still matches');
  assert.deepEqual(out['card-today'].quotes.map((q) => q.id), ['q1', 'q2'], 'soonest stay leads');
});

test('source_ref still binds a quote whose email side is blank', () => {
  const out = groupQuotesByApproval(
    [row({ id: 'q1', guest_email: null, source_ref: 'sca_email:abc' })],
    [{ id: 'card', guest_email: '', guesty_message_id: 'sca_email:abc' }],
    NOW,
  );
  assert.deepEqual(out['card'].quotes.map((q) => q.id), ['q1']);
});

test("a stale source_ref never overrules a DISAGREEING address", () => {
  // The quote was made from this card, then re-addressed in the composer (or
  // duplicated, which copies source_ref). The ref is stale; the address is
  // the truth, and showing a stranger's quote here is a privacy leak.
  const out = groupQuotesByApproval(
    [row({ id: 'theirs', guest_email: 'someone@else.com', source_ref: 'sca_email:abc' })],
    [{ id: 'card', guest_email: 'abha@example.com', guesty_message_id: 'sca_email:abc' }],
    NOW,
  );
  assert.equal(out['card'], undefined);
});

test('attachesTo states the rule directly', () => {
  const r = row({ guest_email: 'a@b.com', source_ref: 'ref1' });
  assert.equal(attachesTo(r, 'a@b.com', 'other'), true, 'matching address wins over a mismatched ref');
  assert.equal(attachesTo(r, 'z@z.com', 'ref1'), false, 'a ref cannot rescue a disagreeing address');
  assert.equal(attachesTo(r, '', 'ref1'), true, 'the ref is the fallback when the card has no address');
  assert.equal(
    attachesTo(row({ guest_email: null, source_ref: 'ref1' }), 'a@b.com', 'ref1'),
    true,
    'and when the quote has no address',
  );
});

test('a quote matching on BOTH keys appears once', () => {
  const out = groupQuotesByApproval(
    [row({ id: 'q1', source_ref: 'sca_email:abc' })],
    [{ id: 'card', guest_email: 'abha@example.com', guesty_message_id: 'sca_email:abc' }],
    NOW,
  );
  assert.equal(out['card'].quotes.length, 1);
});

test("another guest's quotes never reach this card", () => {
  const out = groupQuotesByApproval([row({ id: 'theirs', guest_email: 'someone@else.com' })], [card()], NOW);
  assert.equal(out['card'], undefined, 'a card with no quotes is absent, not empty');
});

test('a card with no keys matches nothing', () => {
  assert.deepEqual(groupQuotesByApproval([row()], [{ id: 'card' }], NOW), {});
});

test('voided quotes are dropped by timestamp or by column', () => {
  const out = groupQuotesByApproval(
    [row({ id: 'byStamp', voided_at: PAST }), row({ id: 'byColumn', status: 'voided' }), row({ id: 'live' })],
    [card()],
    NOW,
  );
  assert.deepEqual(out['card'].quotes.map((q) => q.id), ['live']);
});

test('malformed rows and cards are skipped, never thrown on', () => {
  const out = groupQuotesByApproval(
    [row({ id: '' }), row({ id: 'ok' })],
    [{ id: '', guest_email: 'abha@example.com' }, card()],
    NOW,
  );
  assert.deepEqual(Object.keys(out), ['card']);
  assert.deepEqual(out['card'].quotes.map((q) => q.id), ['ok']);
});

// ── truncation, which must never read as a complete history ─────────────────

test('a capped block reports the TRUE total, not what it is showing', () => {
  const many = Array.from({ length: PER_CARD_LIMIT + 3 }, (_, i) =>
    row({ id: `q${i}`, check_in: `2027-0${i + 1}-01` }),
  );
  const block = groupQuotesByApproval(many, [card()], NOW)['card'];
  assert.equal(block.quotes.length, PER_CARD_LIMIT, 'the block stays a pointer, not a history');
  assert.equal(block.total, PER_CARD_LIMIT + 3, 'and it knows what it left out');
});

test('a live quote is never pushed off the card by settled history', () => {
  // The repeat guest: four finished 2026 stays and one live 2027 draft. Sorted
  // by date alone the 2026 rows fill every slot and the draft vanishes, which
  // is how a guest gets quoted twice for the same dates.
  const settled = Array.from({ length: 4 }, (_, i) =>
    row({
      id: `old${i}`,
      status: 'accepted',
      accepted_at: PAST,
      payment_plan: 'full',
      balance_cents: null,
      check_in: `2026-0${i + 5}-01`,
    }),
  );
  const block = groupQuotesByApproval([...settled, row({ id: 'live2027' })], [card()], NOW)['card'];
  assert.equal(block.quotes[0].id, 'live2027', 'the one still needing something leads');
  assert.equal(block.total, 5);
});

// ── status and money, derived rather than read off the column ───────────────

test('an expired draft reads expired before any cron touches it', () => {
  const block = groupQuotesByApproval([row({ status: 'draft', expires_at: PAST })], [card()], NOW)['card'];
  assert.equal(block.quotes[0].status, 'expired');
});

test('accepted and declined beat whatever the column says', () => {
  assert.equal(toCardQuote(row({ status: 'sent', accepted_at: PAST }), NOW).status, 'accepted');
  assert.equal(toCardQuote(row({ status: 'sent', declined_at: PAST }), NOW).status, 'declined');
});

test('an accepted SPLIT quote still says a balance is owed', () => {
  // deriveQuoteStatus flips to 'accepted' the moment the deposit lands. A card
  // showing only the total reads as paid in full while thousands are open.
  const q = toCardQuote(
    row({ status: 'accepted', accepted_at: PAST, deposit_paid_at: PAST, balance_paid_at: null }),
    NOW,
  );
  assert.equal(q.status, 'accepted');
  assert.equal(q.leg_due, 'balance');
  assert.equal(q.amount_due_cents, 945692);
  assert.equal(q.balance_due_on, '2027-05-11');
});

test('a fully paid quote owes nothing', () => {
  const q = toCardQuote(
    row({ status: 'accepted', accepted_at: PAST, deposit_paid_at: PAST, balance_paid_at: PAST }),
    NOW,
  );
  assert.equal(q.leg_due, null);
  assert.equal(q.amount_due_cents, 0);
});

test('a sent quote owes its deposit on a split plan and its total on a full one', () => {
  const split = toCardQuote(row({ status: 'sent', sent_at: PAST }), NOW);
  assert.equal(split.leg_due, 'deposit');
  assert.equal(split.amount_due_cents, 945692);
  const full = toCardQuote(
    row({ status: 'sent', sent_at: PAST, payment_plan: 'full', deposit_cents: null, balance_cents: null }),
    NOW,
  );
  assert.equal(full.leg_due, 'full');
  assert.equal(full.amount_due_cents, 1891384);
});

test("the quote carries its OWN address, so a card can say when it differs", () => {
  assert.equal(toCardQuote(row({ guest_email: 'Someone@Else.com' }), NOW).guest_email, 'someone@else.com');
});

test('missing numbers render as zero rather than NaN on the card', () => {
  const q = toCardQuote(row({ nights: null, total_cents: null, property_internal_name: null }), NOW);
  assert.equal(q.nights, 0);
  assert.equal(q.total_cents, 0);
  assert.equal(q.property_internal_name, '');
});
