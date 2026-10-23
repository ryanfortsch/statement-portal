import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decideVerdict,
  EMPTY_FACTS,
  isRenterMail,
  isReplyNudgeTemplate,
  leadKey,
  listingFor,
  normalizeZillowAddress,
  parseZillowMail,
  rawReply,
  scamSigns,
  screeningMessage,
  seriousQueueText,
  shouldSendScreening,
  type LeadFacts,
  type LeaseListing,
  type ScreeningLead,
} from '../lease-leads-core.ts';

// Zillow's inquiry mail as Gmail's plain text renders it (synthetic renter).
const inquiryBody = (name: string, addr: string, words: string, id = '2804565708186711267') => `| |

| New message |

| ${addr}[](https://zillow.com/rental-manager/properties/1df9a0f6mk3bv/find-tenants?nid=abc&ref=inquiry&utm_campaign=unified). |
| ${name} says: |
| ${words} |

| |
| Reply to ${name.split(' ')[0]}[](https://zillow.com/rental-manager/inbox/1df9a0f6mk3bv/47107?byProperty=true&nid=abc&ref=inquiry&utm_source=inquiry&utm_term=replyLink) |

| |
| Send application[](https://zillow.com/rental-manager/applications/?leadId=${id}&nid=abc&propertyId=1df9a0f6mk3bv&ref=inquiry&utm_term=sendApplicationLink) |

| Is this inquiry spam? Report spam[](https://www.zillow.com/rental-manager/inquiry-contact?inquiryId=${id}&name=x) |
`;

const listings: LeaseListing[] = [
  { zillow_address: '17 beach rd #1', property_id: '17_beach_front', label: '17 Beach main house', monthly_rent: 5000, lease_start: '2027-01-05', lease_end: '2027-04-30' },
  { zillow_address: '17 beach rd #2', property_id: '17_beach_back', label: '17 Beach guest house', monthly_rent: 2500, lease_start: '2027-01-05', lease_end: '2027-04-30' },
];
const guestHouse = listings[1];
const facts = (over: Partial<LeadFacts>): LeadFacts => ({ ...EMPTY_FACTS, ...over });

describe('reading Zillow mail', () => {
  test('an inquiry gives the renter, the listing, their words, the stable id and clean links', () => {
    const p = parseZillowMail(
      'Pat is requesting information about 17 Beach Rd #1, Gloucester, MA, 01930',
      inquiryBody('Pat Example', '17 Beach Rd #1, Gloucester, MA, 01930', 'I am interested in this rental and would like to schedule a viewing.'),
    );
    assert.equal(p.kind, 'inquiry');
    assert.equal(p.renterName, 'Pat Example');
    assert.equal(p.zillowAddress, '17 beach rd #1');
    assert.match(p.message ?? '', /schedule a viewing/);
    assert.equal(p.inquiryId, '2804565708186711267');
    assert.ok(p.replyUrl?.startsWith('https://zillow.com/rental-manager/inbox/'));
    assert.ok(!/utm_|nid=|ref=/.test(p.replyUrl ?? ''), 'tracking stripped');
    assert.ok(p.applicationUrl?.includes('leadId='));
    assert.equal(listingFor(p.zillowAddress, listings)?.property_id, '17_beach_front');
    assert.equal(leadKey(p, null), 'zillow:2804565708186711267');
  });

  test('an application subject is kind application', () => {
    const p = parseZillowMail('Pat Example submitted an application for 17 Beach Rd #2, Gloucester, MA, 01930', 'no body');
    assert.equal(p.kind, 'application');
    assert.equal(p.renterName, 'Pat Example');
    assert.equal(p.zillowAddress, '17 beach rd #2');
  });

  test('only renter mail is read; listing notices, receipts and promotions are not', () => {
    assert.equal(isRenterMail('2u6r9ujys8@convo.zillow.com', 'Pat is requesting information about 17 Beach Rd #1'), true);
    assert.equal(isRenterMail('no-reply@comet.zillow.com', 'Listing for 17 Beach Rd #1 has been published!'), false);
    assert.equal(isRenterMail('no-reply@comet.zillow.com', 'Receipt from Zillow: 17 Beach Rd #2'), false);
    assert.equal(isRenterMail('recommendations@mail.zillow.com', 'Price cut on a Gloucester rental'), false);
    assert.equal(isRenterMail('no-reply@comet.zillow.com', 'Pat submitted an application for 17 Beach Rd #2'), true);
    assert.equal(isRenterMail('someone@gmail.com', 'application'), false);
  });

  test('addresses normalize to street and unit', () => {
    assert.equal(normalizeZillowAddress('17 Beach Rd #2, Gloucester, MA, 01930'), '17 beach rd #2');
    assert.equal(normalizeZillowAddress(null), null);
  });
});

describe('vetting', () => {
  test('the template that hit 17 Beach the hour it listed is spam, before any model reads it', () => {
    const signs = scamSigns('17 Beach Rd #2, we are awaiting your reply Ryan Fortsch');
    assert.equal(signs.length, 1);
    assert.equal(decideVerdict(EMPTY_FACTS, guestHouse, { hasApplication: false, scamSigns: signs }).verdict, 'spam');
    assert.equal(scamSigns('Please send a cashiers check, I am overseas').length, 2);
    assert.deepEqual(scamSigns('Is this still available for January?'), []);
  });

  test('the reply-nudge template that hit 4 Middle the hour it listed is spam', () => {
    for (const bot of [
      '4 Middle Rd #1, awaiting reply Ryan Fortsch',
      'Ryan Fortsch, 4 Middle Rd #1 - looking forward to your response.',
      '17 Beach Rd #2, we are awaiting your reply Ryan Fortsch',
      'Ryan Fortsch, 17 Beach Rd #2 - hoping to hear from you soon',
    ]) {
      assert.equal(isReplyNudgeTemplate(bot), true, bot);
      assert.equal(scamSigns(bot).length, 1, bot);
    }
    for (const real of [
      'I am interested in this rental and would like to schedule a viewing. Please let me know when this would be possible.',
      'Hi Ryan Fortsch, I am a travel nurse starting at Addison Gilbert January 4 through April 20. Looking forward to your response.',
      'Is 4 Middle Rd #1 still available for January? Two of us, no pets.',
      'Looking forward to your reply about the dates',
    ]) {
      assert.equal(isReplyNudgeTemplate(real), false, real);
    }
  });

  test('a submitted Zillow application is serious', () => {
    assert.equal(decideVerdict(EMPTY_FACTS, guestHouse, { hasApplication: true, scamSigns: [] }).verdict, 'serious');
  });

  test('every criterion answered and met is serious', () => {
    const r = decideVerdict(
      facts({ moveIn: '2027-01-05', moveOut: '2027-04-25', exitReason: 'travel nurse contract ends April 24', monthlyIncome: 9000, occupants: 1, pets: 'none' }),
      guestHouse,
      { hasApplication: false, scamSigns: [] },
    );
    assert.equal(r.verdict, 'serious');
    assert.ok(r.reasons.some((x) => /exit/.test(x)));
  });

  test('stated work stands in for income only when no figure was given', () => {
    const base = { moveIn: '2027-01-05', moveOut: '2027-04-30', exitReason: 'house closes in May' };
    assert.equal(decideVerdict(facts({ ...base, work: 'contract engineer' }), guestHouse, { hasApplication: false, scamSigns: [] }).verdict, 'serious');
    const short = decideVerdict(facts({ ...base, monthlyIncome: 6000, work: 'contract engineer' }), guestHouse, { hasApplication: false, scamSigns: [] });
    assert.equal(short.verdict, 'needs_answers', '6000 is under 3 x 2500');
    assert.ok(short.missing.some((m) => /3x the rent/.test(m)));
  });

  test('a viewing request with nothing else asks the five questions', () => {
    const r = decideVerdict(facts({ wantsViewing: true }), listings[0], { hasApplication: false, scamSigns: [] });
    assert.equal(r.verdict, 'needs_answers');
    assert.deepEqual(r.missing, ['the dates they need', 'who is moving in', 'why the stay ends in April', 'household income', 'pets']);
  });

  test('a term the lease cannot be is not a fit', () => {
    const v = (f: Partial<LeadFacts>) => decideVerdict(facts(f), guestHouse, { hasApplication: false, scamSigns: [] }).verdict;
    assert.equal(v({ wantsMonthToMonth: true }), 'not_a_fit');
    assert.equal(v({ wantsYearLease: true }), 'not_a_fit');
    assert.equal(v({ moveIn: '2027-01-05', moveOut: '2027-06-30' }), 'not_a_fit');
    assert.equal(v({ moveIn: '2027-01-05', moveOut: '2027-05-15' }), 'needs_answers', 'May 15 is the stop rule, inclusive');
    assert.equal(v({ moveIn: '2027-03-15', moveOut: '2027-04-30' }), 'not_a_fit');
  });

  test('the feed line names one applicant, or counts several', () => {
    assert.equal(seriousQueueText([]), null);
    assert.equal(seriousQueueText([{ renter_name: 'Pat', label: '17 Beach guest house' }]), 'Leases: Pat is a serious applicant for 17 Beach guest house');
    assert.match(seriousQueueText([{ renter_name: 'Pat', label: 'A' }, { renter_name: 'Sam', label: 'B' }]) ?? '', /2 serious applicants \(A, B\)/);
  });
});

test('the screening text is fixed in code and only goes to Zillow relays', () => {
  const io = readFileSync(new URL('../lease-leads.ts', import.meta.url), 'utf8');
  assert.match(io, /screeningMessage\(/, 'the IO half sends the fixed text');
  assert.match(io, /shouldSendScreening\(/, 'and asks the rule first');
  assert.match(io, /to: c\.relay_address/, 'the mail goes to the relay address');
});

test('the verdict is decided in code, never by the model, and the model is told to leave protected traits out', () => {
  const io = readFileSync(new URL('../lease-leads.ts', import.meta.url), 'utf8');
  assert.match(io, /decideVerdict\(/, 'the IO half calls the pure decision');
  assert.ok(!/verdict:\s*z\./.test(io), 'the model schema has no verdict field');
  for (const word of ['race', 'religion', 'national origin', 'children', 'disability', 'age', 'source of income']) {
    assert.ok(io.toLowerCase().includes(word), `the extraction prompt names ${word}`);
  }
});

describe('the screening message', () => {
  const lead = (over: Partial<ScreeningLead> = {}): ScreeningLead => ({
    verdict: 'needs_answers',
    relay_address: 'abc123@convo.zillow.com',
    first_seen_at: '2026-10-16T17:22:10Z',
    screening_sent_at: null,
    screening_attempts: 0,
    dismissed_at: null,
    has_application: false,
    ...over,
  });
  const now = new Date('2026-10-21T20:00:00Z');

  test('the same five questions for everyone, the listing facts, no model', () => {
    const m = screeningMessage('pat example', guestHouse, 'Pat is requesting information about 17 Beach Rd #2, Gloucester, MA, 01930');
    assert.equal(m.subject, 'Re: Pat is requesting information about 17 Beach Rd #2, Gloucester, MA, 01930');
    assert.match(m.body, /^Hi Pat,/);
    assert.match(m.body, /January 5 to April 30, 2027, at \$2,500 a month/);
    assert.match(screeningMessage('Pat', { ...guestHouse, monthly_rent: 12500 }, null).body, /\$12,500 a month/);
    for (const n of ['1. The dates you need', '2. How many people', '3. Your plans after April', '4. Your household', '5. Whether you will have any pets']) assert.ok(m.body.includes(n), n);
    assert.ok(!/children|kids|family|married|age\b|where are you from/i.test(m.body), 'nothing that asks after a protected trait');
    assert.ok(!m.body.includes('—'), 'no em dash');
    assert.match(screeningMessage(null, guestHouse, null).body, /^Hi,/);
    assert.match(screeningMessage('???', guestHouse, null).body, /^Hi,/);
  });

  test('sent once, only through the Zillow relay, only to a fresh lead that needs answers', () => {
    assert.equal(shouldSendScreening(lead(), guestHouse, now), true);
    assert.equal(shouldSendScreening(lead({ screening_sent_at: '2026-10-21T00:00:00Z' }), guestHouse, now), false, 'once');
    assert.equal(shouldSendScreening(lead({ verdict: 'spam' }), guestHouse, now), false);
    assert.equal(shouldSendScreening(lead({ verdict: 'serious' }), guestHouse, now), false);
    assert.equal(shouldSendScreening(lead({ has_application: true }), guestHouse, now), false);
    assert.equal(shouldSendScreening(lead({ dismissed_at: '2026-10-20T00:00:00Z' }), guestHouse, now), false);
    assert.equal(shouldSendScreening(lead({ relay_address: 'renter@gmail.com' }), guestHouse, now), false, 'never a renter address');
    assert.equal(shouldSendScreening(lead({ relay_address: null }), guestHouse, now), false);
    assert.equal(shouldSendScreening(lead({ first_seen_at: '2026-10-01T00:00:00Z' }), guestHouse, now), false, 'older than 14 days');
    assert.equal(shouldSendScreening(lead({ screening_attempts: 3 }), guestHouse, now), false);
    assert.equal(shouldSendScreening(lead(), { ...guestHouse, screening_autosend: false }, now), false);
    assert.equal(shouldSendScreening(lead(), null, now), false);
  });

  test('the raw reply threads under the original and decodes back', () => {
    const raw = rawReply({ from: 'ryan@risingtidestr.com', to: 'abc123@convo.zillow.com', subject: 'Re: x', body: 'Hi,\nThanks', inReplyTo: '<m1@zillow.com>' });
    const text = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    assert.match(text, /^From: ryan@risingtidestr\.com\r\nTo: abc123@convo\.zillow\.com\r\nSubject: Re: x\r\nIn-Reply-To: <m1@zillow\.com>\r\nReferences: <m1@zillow\.com>/);
    assert.match(text, /\r\n\r\nHi,\r\nThanks\r\n$/);
  });
});
