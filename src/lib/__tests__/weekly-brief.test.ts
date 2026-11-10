import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PAGE_BUDGET_PX,
  pageCost,
  briefWindow,
  buildFeedbackPage,
  buildWeeklyBrief,
  easternMidnightIso,
  feedbackPageCost,
  feedbackWindow,
  FEEDBACK_BUDGET_PX,
  starWords,
  type BriefReview,
  groupCheckIns,
  compareHomeNames,
  isPastAppointment,
  isSendHour,
  rankSlips,
  rowMeta,
  type BriefHome,
  type BriefSlip,
  type BriefStay,
} from '../weekly-brief.ts';
import { weeklyBriefHtml } from '../weekly-brief-html.ts';
import { TEAM_MEMBERS } from '../team.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

const TODAY = '2026-11-10'; // a Tuesday

let seq = 0;
function slip(over: Partial<BriefSlip> = {}): BriefSlip {
  seq += 1;
  return {
    id: `s${String(seq).padStart(3, '0')}`,
    property_id: 'h1',
    title: `Slip ${seq}`,
    description: null,
    action_summary: null,
    category: 'maintenance',
    priority: 'normal',
    status: 'open',
    scheduled_date: null,
    follow_up_date: null,
    created_at: '2026-10-01T12:00:00Z',
    location: null,
    assigned_to_label: null,
    ...over,
  };
}

function stay(over: Partial<BriefStay> = {}): BriefStay {
  return { property_id: 'h1', check_in: TODAY, check_out: '2026-11-13', guest_name: 'Pat Lee', num_guests: 4, channel: 'airbnb', ...over };
}

const HOMES: BriefHome[] = [
  { id: 'h1', name: '20 Hammond', address: '20 Hammond Street', owner_last: 'Ramsey' },
  { id: 'h2', name: '17 Beach', address: '17 Beach Road', owner_last: 'Nolan' },
  { id: 'h3', name: '3 Windward', address: null, owner_last: null },
];
const HOME_MAP = new Map(HOMES.map((h) => [h.id, h]));

describe('the Tuesday brief: work in priority order', () => {
  test('high first, then overdue, then this week, then started, then oldest', () => {
    const oldNormal = slip({ title: 'old normal', created_at: '2026-08-01T00:00:00Z' });
    const newNormal = slip({ title: 'new normal', created_at: '2026-11-01T00:00:00Z' });
    const overdue = slip({ title: 'overdue', scheduled_date: '2026-11-02', created_at: '2026-11-05T00:00:00Z' });
    const thisWeek = slip({ title: 'this week', follow_up_date: '2026-11-14' });
    const nextMonth = slip({ title: 'next month', scheduled_date: '2026-12-10' });
    const started = slip({ title: 'started', status: 'in_progress', created_at: '2026-11-08T00:00:00Z' });
    const high = slip({ title: 'high', priority: 'high', created_at: '2026-11-09T00:00:00Z' });
    const low = slip({ title: 'low', priority: 'low', scheduled_date: '2026-11-01' });
    const order = rankSlips([low, oldNormal, nextMonth, started, newNormal, thisWeek, high, overdue], TODAY).map((s) => s.title);
    assert.deepEqual(order, ['high', 'overdue', 'this week', 'started', 'old normal', 'next month', 'new normal', 'low']);
  });

  test('a date outside the week does not jump the queue; a low slip never outranks a normal one', () => {
    const later = slip({ title: 'later', scheduled_date: '2026-11-17' });
    const plain = slip({ title: 'plain', created_at: '2026-07-01T00:00:00Z' });
    assert.deepEqual(rankSlips([later, plain], TODAY).map((s) => s.title), ['plain', 'later']);
    assert.equal(briefWindow(TODAY).to, '2026-11-16', 'the week is Tuesday through Monday');
  });

  test('the meta line says the clock, the hands and the age', () => {
    const meta = rowMeta(slip({ scheduled_date: '2026-11-03', assigned_to_label: 'A-1 Plumbing', created_at: '2026-11-01T09:00:00Z' }), TODAY);
    assert.equal(meta, 'overdue since Nov 3 · A-1 Plumbing · open 9 days');
    assert.match(rowMeta(slip({ owner_action_required: true, owner_status: 'not_sent' }), TODAY), /owner not asked yet/);
    assert.match(rowMeta(slip({ follow_up_date: '2026-11-12' }), TODAY), /^follow up Thu, Nov 12/);
  });
});

describe("the Tuesday brief: the week's check-ins", () => {
  test('seven days, every one listed, empty ones too', () => {
    const days = groupCheckIns({ today: TODAY, arrivals: [stay()], departures: [], homes: HOME_MAP });
    assert.equal(days.length, 7);
    assert.equal(days[0].date, TODAY);
    assert.equal(days[6].date, '2026-11-16');
    assert.equal(days[0].checkIns.length, 1);
    assert.equal(days[0].checkIns[0].nights, 3);
    assert.equal(days[0].checkIns[0].channel, 'Airbnb');
    assert.equal(days.slice(1).every((d) => d.checkIns.length === 0), true);
  });

  test('a same-day turn is marked; a stay carrying on is not an arrival', () => {
    const days = groupCheckIns({
      today: TODAY,
      arrivals: [stay(), stay({ property_id: 'h2', guest_name: 'Sam Roe', check_in: '2026-11-12', check_out: '2026-11-19' })],
      departures: [
        stay({ guest_name: 'Earlier Guest', check_in: '2026-11-06', check_out: TODAY }),
        stay({ property_id: 'h2', guest_name: 'Sam Roe', check_in: '2026-11-08', check_out: '2026-11-12' }),
      ],
      homes: HOME_MAP,
    });
    assert.equal(days[0].checkIns[0].sameDayTurn, true);
    assert.equal(days[2].checkIns.length, 0, 'Sam Roe out and back in at 17 Beach is one stay');
  });

  test('the same stay under two sources prints once; a home off the roster prints never', () => {
    const days = groupCheckIns({
      today: TODAY,
      arrivals: [stay(), stay({ channel: 'guesty' }), stay({ property_id: 'gone' })],
      departures: [],
      homes: HOME_MAP,
    });
    assert.equal(days[0].checkIns.length, 1);
  });
});

describe('the Tuesday brief: one page per home', () => {
  test('a home earns a page with open work or a flagged issue; the rest are named once', () => {
    const b = buildWeeklyBrief({
      today: TODAY,
      scorecard: null,
      homes: HOMES,
      slips: [slip({ property_id: 'h1' })],
      notes: [{ id: 'n1', property_id: 'h3', title: 'Deck board loose', body: 'By the grill', created_at: '2026-11-01T00:00:00Z' }],
      arrivals: [],
      departures: [],
      headlines: { h1: 'Gutter and the outdoor shower' },
    });
    assert.deepEqual(b.pages.map((p) => p.home.name), ['20 Hammond', '3 Windward']);
    assert.deepEqual(b.quietHomes, ['17 Beach']);
    assert.equal(b.pages[0].headline, 'Gutter and the outdoor shower');
  });

  test('homes with a check-in this week come first, in arrival order; the rest follow by street', () => {
    const homes: BriefHome[] = [
      ...HOMES,
      { id: 'h4', name: '4 Atlantic', address: null, owner_last: null },
      { id: 'h5', name: '9 Zephyr', address: null, owner_last: null },
    ];
    const b = buildWeeklyBrief({
      today: TODAY,
      scorecard: null,
      homes,
      slips: ['h1', 'h2', 'h3', 'h4', 'h5'].map((id) => slip({ property_id: id })),
      notes: [],
      arrivals: [
        stay({ property_id: 'h3', check_in: '2026-11-13', check_out: '2026-11-15' }),
        stay({ property_id: 'h5', check_in: '2026-11-11', check_out: '2026-11-14' }),
      ],
      departures: [],
      headlines: {},
    });
    assert.deepEqual(b.pages.map((p) => p.home.name), ['9 Zephyr', '3 Windward', '4 Atlantic', '17 Beach', '20 Hammond']);
    assert.equal(b.arrivingPages, 2);
    const html = weeklyBriefHtml(b);
    assert.ok(html.indexOf('Check-ins this week') < html.indexOf('The rest of the homes'));
    assert.match(html, /9 Zephyr<\/span><span class="ix-counts">[^<]*p\.3</);
    assert.match(html, /20 Hammond<\/span><span class="ix-counts">[^<]*p\.7</);
  });

  test('an appointment whose day has passed closes out at the foot, not as overdue work', () => {
    assert.equal(isPastAppointment({ title: 'Cover city Building/Fire inspection', scheduled_date: '2026-11-06', follow_up_date: null }, TODAY), true);
    assert.equal(isPastAppointment({ title: 'Attend insurance inspection at 73 Rocky Neck', scheduled_date: '2026-11-03', follow_up_date: null }, TODAY), true);
    assert.equal(isPastAppointment({ title: 'Cover city Building/Fire inspection', scheduled_date: TODAY, follow_up_date: null }, TODAY), false, 'today is still ahead');
    assert.equal(isPastAppointment({ title: 'Schedule the chimney inspection', scheduled_date: '2026-11-06', follow_up_date: null }, TODAY), false, 'booking one is work');
    assert.equal(isPastAppointment({ title: 'Change thermostat batteries', scheduled_date: '2026-11-06', follow_up_date: null }, TODAY), false, 'overdue work stays work');
    const page = buildWeeklyBrief({
      today: TODAY, scorecard: null, homes: HOMES, notes: [], arrivals: [], departures: [], headlines: {},
      slips: [
        slip({ title: 'City of Gloucester safety inspection', priority: 'high', scheduled_date: '2026-11-06' }),
        slip({ title: 'Change thermostat batteries', scheduled_date: '2026-11-06' }),
      ],
    }).pages[0];
    assert.deepEqual(page.rows.map((r) => r.title), ['Change thermostat batteries']);
    assert.deepEqual(page.pastAppointments.map((a) => [a.title, a.date]), [['City of Gloucester safety inspection', 'Nov 6']]);
    assert.equal(page.openCount, 2, 'still counted as open until it is closed');
    assert.match(weeklyBriefHtml(buildWeeklyBrief({
      today: TODAY, scorecard: null, homes: HOMES, notes: [], arrivals: [], departures: [], headlines: {},
      slips: [slip({ title: 'City of Gloucester safety inspection', scheduled_date: '2026-11-06' })],
    })), /Past dates, to close out/);
  });

  test('homes file by street, the number aside', () => {
    const names = ['84 Thatcher', '17 Beach', '53 Rocky Neck, Downstairs', '53 Rocky Neck', '3 South'];
    assert.deepEqual([...names].sort(compareHomeNames), [
      '17 Beach', '53 Rocky Neck', '53 Rocky Neck, Downstairs', '3 South', '84 Thatcher',
    ]);
  });

  test('supplies are one Bring line, not numbered work; a long list stops at the page and is counted', () => {
    const many = Array.from({ length: 60 }, () => slip({ property_id: 'h1', description: 'A long description that wraps onto a second line on the printed page, as a pasted guest message would.'.repeat(2) }));
    const b = buildWeeklyBrief({
      today: TODAY,
      scorecard: null,
      homes: HOMES,
      slips: [...many, slip({ property_id: 'h1', category: 'inventory', title: 'Restock: paper towels' })],
      notes: [],
      arrivals: [],
      departures: [],
      headlines: {},
    });
    const page = b.pages[0];
    assert.ok(page.rows.length >= 10 && page.rows.length < 60, `${page.rows.length} rows`);
    assert.equal(page.rows.length + page.moreRows, 60, 'every slip is listed or counted');
    assert.ok(pageCost(page) <= PAGE_BUDGET_PX, 'the page stays one sheet');
    assert.ok(page.rows.slice(12).every((r) => r.detail === null), 'past the first twelve, rows print compact');
    const short = buildWeeklyBrief({
      today: TODAY, scorecard: null, homes: HOMES, notes: [], arrivals: [], departures: [], headlines: {},
      slips: Array.from({ length: 40 }, () => slip({ property_id: 'h1' })),
    }).pages[0];
    assert.ok(short.rows.length >= 20, `one-line slips fill the page: ${short.rows.length}`);
    assert.ok(pageCost(short) <= PAGE_BUDGET_PX);
    assert.deepEqual(page.bring, ['paper towels']);
    assert.equal(page.rows[0].number, 1);
  });
});

let rseq = 0;
function review(over: Partial<BriefReview> = {}): BriefReview {
  rseq += 1;
  return {
    id: `r${String(rseq).padStart(3, '0')}`,
    property_id: 'h1',
    guest_name: `Guest ${rseq}`,
    channel: 'airbnb2',
    overall_rating: 5,
    public_review: 'Lovely stay.',
    private_feedback: null,
    review_created_at: '2026-11-06T15:00:00Z',
    ...over,
  };
}

describe('the Tuesday brief: page two, what guests told us', () => {
  test('the seven days before the send, midnight to midnight Eastern', () => {
    assert.deepEqual(feedbackWindow(TODAY), { from: '2026-11-03', to: '2026-11-09' });
    assert.equal(easternMidnightIso('2026-11-03'), '2026-11-03T05:00:00.000Z', 'EST');
    assert.equal(easternMidnightIso('2027-06-01'), '2027-06-01T04:00:00.000Z', 'EDT');
    assert.equal(easternMidnightIso('2026-11-01'), '2026-11-01T04:00:00.000Z', 'the morning daylight saving ends');
  });

  test('below five leads, lowest first; five stars print only with a note to us', () => {
    const p = buildFeedbackPage({
      ...feedbackWindow(TODAY),
      homes: HOME_MAP,
      reviews: [
        review({ overall_rating: 4, guest_name: 'Four', slip_status: 'open' }),
        review({ overall_rating: 3, guest_name: 'Three', private_feedback: 'The hot water ran out.' }),
        review({ overall_rating: 5, guest_name: 'Thanks', private_feedback: 'Thank you, Allie!' }),
        review({ overall_rating: 5, guest_name: 'Clean four', category_cleanliness: 4 }),
        review({ overall_rating: 5, guest_name: 'Plain five' }),
        review({ overall_rating: 2, property_id: 'gone', guest_name: 'Not ours' }),
      ],
    });
    assert.deepEqual(p.belowFive.map((i) => i.guest), ['Three', 'Four']);
    assert.equal(p.belowFive[0].privateText, 'The hot water ran out.');
    assert.equal(p.belowFive[1].slip, 'on the Work board');
    assert.deepEqual(p.notes.map((i) => i.guest).sort(), ['Clean four', 'Thanks']);
    assert.deepEqual(p.notes.find((i) => i.guest === 'Clean four')?.lowCategories, ['Cleanliness 4']);
    assert.equal(p.total, 5, 'a home off the roster is not counted');
    assert.equal(p.fiveStar, 3);
    assert.equal(starWords(4.5), '4.5 stars');
  });

  test('a failed read says so; a long week stays one sheet and counts the rest', () => {
    const failed = buildFeedbackPage({ ...feedbackWindow(TODAY), homes: HOME_MAP, reviews: null });
    assert.equal(failed.unreadable, true);
    const long = 'The listing said the deck had a view of the harbor and it did, but the stairs were loose and nobody answered for an hour. '.repeat(5);
    const p = buildFeedbackPage({
      ...feedbackWindow(TODAY),
      homes: HOME_MAP,
      reviews: [
        ...Array.from({ length: 15 }, () => review({ overall_rating: 3, public_review: long, private_feedback: long })),
        ...Array.from({ length: 10 }, () => review({ private_feedback: long })),
      ],
    });
    assert.ok(p.belowFive.length >= 4, 'the first few below five always print');
    assert.equal(p.belowFive.length + p.moreBelowFive, 15);
    assert.equal(p.notes.length + p.moreNotes, 10);
    assert.ok(feedbackPageCost(p) <= FEEDBACK_BUDGET_PX, `${feedbackPageCost(p)}`);
    assert.ok(p.belowFive[0].publicText!.length <= 421, 'a review is clipped, the rest is on the Reviews tab');
  });
});

describe('the Tuesday brief: the document', () => {
  test('page one plus a sheet per home, every value escaped', () => {
    const b = buildWeeklyBrief({
      today: TODAY,
      scorecard: [{ key: 'rating', label: 'Guest rating', value: '4.97', goal: 'goal 4.98', detail: '41 reviews, 90 days', state: 'off', href: '/guests' }],
      homes: HOMES,
      slips: [slip({ property_id: 'h1', title: 'Fix <script>alert(1)</script> latch' })],
      notes: [],
      arrivals: [stay({ guest_name: 'O\'Neil & Co' })],
      departures: [],
      headlines: {},
      reviews: [review({ overall_rating: 2, public_review: 'Dirty <b>sheets</b>' })],
    });
    const html = weeklyBriefHtml(b);
    assert.match(html, /Dirty &lt;b&gt;sheets/);
    assert.equal((html.match(/class="sheet"/g) ?? []).length, 2 + b.pages.length, 'page one, page two, then the homes');
    assert.match(html, /What guests told us/);
    assert.match(html, /20 Hammond<\/span><span class="ix-counts">1 open · p\.3/, 'the homes start on page three');
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /Fix &lt;script&gt;/);
    assert.match(html, /O&#39;Neil &amp; Co/);
    assert.match(html, /Operations goals/);
    assert.match(html, /4\.97/);
    assert.doesNotMatch(html, /—/, 'no em dashes');
  });
});

describe('the Tuesday brief: the send', () => {
  test('6 AM Eastern on a Tuesday, on either side of daylight saving', () => {
    assert.equal(isSendHour(new Date('2026-11-10T11:00:00Z')), true, '6 AM EST');
    assert.equal(isSendHour(new Date('2026-11-10T10:00:00Z')), false, '5 AM EST');
    assert.equal(isSendHour(new Date('2027-06-01T10:00:00Z')), true, '6 AM EDT');
    assert.equal(isSendHour(new Date('2027-06-01T11:00:00Z')), false, '7 AM EDT');
    assert.equal(isSendHour(new Date('2026-11-11T11:00:00Z')), false, 'a Wednesday');
  });

  test('vercel.json fires at both UTC hours on Tuesdays, and the route gates on the hour', () => {
    const crons = JSON.parse(read('vercel.json')).crons as Array<{ path: string; schedule: string }>;
    assert.deepEqual(crons.filter((c) => c.path === '/api/cron/weekly-brief').map((c) => c.schedule), ['0 10,11 * * 2']);
    const route = read('src/app/api/cron/weekly-brief/route.ts');
    assert.match(route, /isSendHour\(new Date\(\)\)/);
    assert.match(route, /authorizeCron\(request\)/);
    assert.match(route, /weeklyBriefEmails\(\)/, 'the recipient is a duty, never a named inbox');
  });

  test('someone holds the weekly_brief duty', () => {
    assert.ok(TEAM_MEMBERS.some((m) => m.active && m.duties?.includes('weekly_brief')));
  });

  test('the brief reads no money', () => {
    for (const f of ['src/lib/weekly-brief.ts', 'src/lib/weekly-brief-server.ts', 'src/lib/weekly-brief-html.ts', 'src/app/api/cron/weekly-brief/route.ts']) {
      assert.doesNotMatch(read(f), /owner_payout|management_fee|booking_finance|adjusted_revenue/, f);
    }
  });
});
