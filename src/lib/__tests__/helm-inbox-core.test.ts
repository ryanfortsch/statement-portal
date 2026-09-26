/**
 * The pure rules behind the Helm-native inbox: how a thread is keyed, which
 * stay a texting guest belongs to (in-house first), and how a thread maps
 * onto the concierge wire shapes the /messaging surfaces already render.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  HELM_SMS_MODULE,
  helmConversationId,
  helmThreadIdOf,
  isHelmConversationId,
  normalizeThreadKey,
  stayStatusOf,
  addDays,
  inContactWindow,
  pickBookingForContact,
  phoneMatchesE164,
  otaChannelOfBooking,
  otaThreadUrl,
  channelLabel,
  moduleOf,
  smsRailOf,
  summarizeThread,
  toThreadMessage,
  viaOf,
  toReservationPick,
  mergeConversationLists,
  statusAfterInbound,
  lastWhoOf,
  previewOf,
  type BookingCandidate,
  type ThreadLike,
  type MessageLike,
} from '../helm-inbox-core.ts';

const TODAY = '2026-09-26';

const booking = (over: Partial<BookingCandidate> & { id: string }): BookingCandidate => ({
  property_id: '21_horton',
  check_in: '2026-09-25',
  check_out: '2026-09-28',
  status: 'confirmed',
  duplicate_of: null,
  guest_phone: '+19785550100',
  guest_name: 'Jane Doe',
  channel: 'airbnb',
  ...over,
});

const thread = (over: Partial<ThreadLike> = {}): ThreadLike => ({
  id: 't1',
  property_id: '21_horton',
  booking_id: 'b1',
  guest_id: 'g1',
  channel: 'sms',
  external_thread_key: '+19785550100',
  external_thread_url: null,
  guest_name: 'Jane Doe',
  guest_phone: '+19785550100',
  guest_email: null,
  status: 'open',
  snoozed_until: null,
  last_guest_at: '2026-09-26T14:00:00Z',
  last_host_at: '2026-09-26T13:00:00Z',
  last_preview: 'Is early check-in ok?',
  created_at: '2026-09-25T00:00:00Z',
  updated_at: '2026-09-26T14:00:00Z',
  ...over,
});

describe('conversation ids', () => {
  test('helm rows carry the helm: prefix and round-trip to the thread id', () => {
    const cid = helmConversationId('abc-123');
    assert.equal(cid, 'helm:abc-123');
    assert.equal(isHelmConversationId(cid), true);
    assert.equal(helmThreadIdOf(cid), 'abc-123');
  });

  test('concierge ids are not helm rows', () => {
    assert.equal(isHelmConversationId('68ab3f...'), false);
    assert.equal(helmThreadIdOf('68ab3f...'), null);
    assert.equal(isHelmConversationId(''), false);
    assert.equal(helmThreadIdOf('helm:'), null);
  });
});

describe('thread keys', () => {
  test('sms keys are E.164 whatever the formatting', () => {
    assert.equal(normalizeThreadKey('sms', '(978) 555-0100'), '+19785550100');
    assert.equal(normalizeThreadKey('sms', '19785550100'), '+19785550100');
    assert.equal(normalizeThreadKey('sms', '+19785550100'), '+19785550100');
  });

  test('a seven-digit "phone" is not a key', () => {
    assert.equal(normalizeThreadKey('sms', '5550100'), null);
    assert.equal(normalizeThreadKey('sms', ''), null);
  });

  test('email keys are lower(trim)', () => {
    assert.equal(normalizeThreadKey('email', '  Jane.Doe@Example.com '), 'jane.doe@example.com');
    assert.equal(normalizeThreadKey('email', 'not an email'), null);
  });

  test('OTA keys are the trimmed confirmation code', () => {
    assert.equal(normalizeThreadKey('airbnb', ' HMABCDEF12 '), 'HMABCDEF12');
    assert.equal(normalizeThreadKey('airbnb', '   '), null);
  });
});

describe('stay status', () => {
  test('nights are [check_in, check_out): checkout morning is out', () => {
    assert.equal(stayStatusOf('2026-09-25', '2026-09-28', '2026-09-24'), 'upcoming');
    assert.equal(stayStatusOf('2026-09-25', '2026-09-28', '2026-09-25'), 'in_house');
    assert.equal(stayStatusOf('2026-09-25', '2026-09-28', '2026-09-27'), 'in_house');
    assert.equal(stayStatusOf('2026-09-25', '2026-09-28', '2026-09-28'), 'checked_out');
    assert.equal(stayStatusOf(null, '2026-09-28', TODAY), '');
  });

  test('addDays crosses month ends', () => {
    assert.equal(addDays('2026-09-26', 14), '2026-10-10');
    assert.equal(addDays('2026-09-26', -60), '2026-07-28');
  });
});

describe('booking preference for a contacting guest', () => {
  test('in-house wins over upcoming and past', () => {
    const past = booking({ id: 'past', check_in: '2026-09-15', check_out: '2026-09-20' });
    const here = booking({ id: 'here', check_in: '2026-09-25', check_out: '2026-09-28' });
    const soon = booking({ id: 'soon', check_in: '2026-09-29', check_out: '2026-10-02' });
    assert.equal(pickBookingForContact([soon, past, here], TODAY)?.id, 'here');
  });

  test('with nobody in house, the soonest arrival beats a recent checkout', () => {
    const past = booking({ id: 'past', check_in: '2026-09-15', check_out: '2026-09-20' });
    const later = booking({ id: 'later', check_in: '2026-10-10', check_out: '2026-10-12' });
    const soon = booking({ id: 'soon', check_in: '2026-09-29', check_out: '2026-10-02' });
    assert.equal(pickBookingForContact([later, past, soon], TODAY)?.id, 'soon');
  });

  test('only past stays: the most recent checkout', () => {
    const older = booking({ id: 'older', check_in: '2026-09-10', check_out: '2026-09-14' });
    const recent = booking({ id: 'recent', check_in: '2026-09-18', check_out: '2026-09-22' });
    assert.equal(pickBookingForContact([older, recent], TODAY)?.id, 'recent');
  });

  test('the window is -14 / +60 days and canonical confirmed or completed rows only', () => {
    assert.equal(inContactWindow(booking({ id: 'a', check_in: '2026-09-01', check_out: '2026-09-11' }), TODAY), false);
    assert.equal(inContactWindow(booking({ id: 'b', check_in: '2026-09-01', check_out: '2026-09-12' }), TODAY), true);
    assert.equal(inContactWindow(booking({ id: 'c', check_in: '2026-11-25', check_out: '2026-11-28' }), TODAY), true);
    assert.equal(inContactWindow(booking({ id: 'd', check_in: '2026-11-26', check_out: '2026-11-28' }), TODAY), false);
    assert.equal(inContactWindow(booking({ id: 'e', status: 'cancelled' }), TODAY), false);
    assert.equal(inContactWindow(booking({ id: 'f', status: 'inquiry' }), TODAY), false);
    assert.equal(inContactWindow(booking({ id: 'g', status: 'block' }), TODAY), false);
    assert.equal(inContactWindow(booking({ id: 'h', duplicate_of: 'x' }), TODAY), false);
    assert.equal(inContactWindow(booking({ id: 'i', status: 'completed', check_in: '2026-09-18', check_out: '2026-09-22' }), TODAY), true);
  });

  test('nothing in the window is null, not the nearest miss', () => {
    const far = booking({ id: 'far', check_in: '2027-06-01', check_out: '2027-06-08' });
    assert.equal(pickBookingForContact([far], TODAY), null);
  });

  test('stored phones match on digits, not formatting', () => {
    assert.equal(phoneMatchesE164('(978) 555-0100', '+19785550100'), true);
    assert.equal(phoneMatchesE164('978-555-0100', '+19785550100'), true);
    assert.equal(phoneMatchesE164('+19785550101', '+19785550100'), false);
    assert.equal(phoneMatchesE164(null, '+19785550100'), false);
  });
});

describe('OTA threads', () => {
  test('only the three OTAs get an OTA thread', () => {
    assert.equal(otaChannelOfBooking('airbnb'), 'airbnb');
    assert.equal(otaChannelOfBooking('vrbo'), 'vrbo');
    assert.equal(otaChannelOfBooking('booking_com'), 'booking_com');
    assert.equal(otaChannelOfBooking('direct'), null);
    assert.equal(otaChannelOfBooking('manual'), null);
    assert.equal(otaChannelOfBooking('guesty'), null);
    assert.equal(otaChannelOfBooking('block'), null);
  });

  test('airbnb deep link is the hosting reservation detail page for the code', () => {
    assert.equal(
      otaThreadUrl('airbnb', 'HMABCDEF12'),
      'https://www.airbnb.com/hosting/reservations/details/HMABCDEF12',
    );
  });

  test('without a code the airbnb link falls back to the host inbox; sms has no link', () => {
    assert.equal(otaThreadUrl('airbnb', null), 'https://www.airbnb.com/hosting/inbox');
    assert.equal(otaThreadUrl('sms', 'x'), null);
    assert.ok(otaThreadUrl('vrbo', 'x')?.startsWith('https://www.vrbo.com/'));
    assert.ok(otaThreadUrl('booking_com', 'x')?.startsWith('https://admin.booking.com/'));
  });

  test('channel badges use the labels the concierge already emits', () => {
    assert.equal(channelLabel('airbnb'), 'Airbnb');
    assert.equal(channelLabel('vrbo'), 'VRBO');
    assert.equal(channelLabel('booking_com'), 'Booking.com');
    assert.equal(channelLabel('sms'), 'SMS');
    assert.equal(channelLabel('email'), 'Email');
    assert.equal(channelLabel('direct'), 'Direct');
  });
});

describe('module and rail', () => {
  test('a thread with a phone gets helm_sms so the composer shows', () => {
    assert.equal(moduleOf(thread()), HELM_SMS_MODULE);
    assert.equal(smsRailOf(thread()), '+19785550100');
  });

  test('an OTA thread with no phone has an empty module so canSend hides the composer', () => {
    const t = thread({ channel: 'airbnb', external_thread_key: 'HMABC', guest_phone: null });
    assert.equal(moduleOf(t), '');
    assert.equal(smsRailOf(t), null);
  });

  test('an OTA thread that learned the phone can be texted', () => {
    const t = thread({ channel: 'airbnb', external_thread_key: 'HMABC', guest_phone: '978 555 0100' });
    assert.equal(moduleOf(t), HELM_SMS_MODULE);
    assert.equal(smsRailOf(t), '+19785550100');
  });

  test('an sms thread falls back to its key when guest_phone is blank', () => {
    const t = thread({ guest_phone: null });
    assert.equal(smsRailOf(t), '+19785550100');
  });
});

describe('summary mapping', () => {
  test('a Helm thread becomes a Conversations row with the helm: id and the stay context', () => {
    const b = booking({ id: 'b1' });
    const row = summarizeThread(thread(), { booking: b, propertyName: '21 Horton', pendingCount: 2, today: TODAY });
    assert.equal(row.conversation_id, 'helm:t1');
    assert.equal(row.reservation_id, 'b1');
    assert.equal(row.listing_id, '21_horton');
    assert.equal(row.property_name, '21 Horton');
    assert.equal(row.guest_full, 'Jane Doe');
    assert.equal(row.guest_first, 'Jane');
    assert.equal(row.check_in, '2026-09-25');
    assert.equal(row.check_out, '2026-09-28');
    assert.equal(row.stay_status, 'in_house');
    assert.equal(row.module, HELM_SMS_MODULE);
    assert.equal(row.channel, 'SMS');
    assert.equal(row.last_activity_at, '2026-09-26T14:00:00Z');
    assert.equal(row.last_who, 'guest');
    assert.equal(row.last_preview, 'Is early check-in ok?');
    assert.equal(row.pending_count, 2);
    assert.equal(row.external_thread_url, null);
  });

  test('an OTA thread carries the deep link and an empty module', () => {
    const t = thread({
      channel: 'airbnb',
      external_thread_key: 'HMABC',
      external_thread_url: 'https://www.airbnb.com/hosting/reservations/details/HMABC',
      guest_phone: null,
      last_guest_at: null,
      last_host_at: null,
    });
    const row = summarizeThread(t, { booking: booking({ id: 'b1' }), propertyName: null, pendingCount: 0, today: TODAY });
    assert.equal(row.module, '');
    assert.equal(row.channel, 'Airbnb');
    assert.equal(row.external_thread_url, 'https://www.airbnb.com/hosting/reservations/details/HMABC');
    assert.equal(row.last_who, '');
    assert.equal(row.last_activity_at, t.updated_at);
  });

  test('a thread with no stay yet still renders, with blank dates', () => {
    const row = summarizeThread(thread({ booking_id: null, property_id: null }), {
      booking: null,
      propertyName: null,
      pendingCount: 0,
      today: TODAY,
    });
    assert.equal(row.reservation_id, '');
    assert.equal(row.check_in, '');
    assert.equal(row.stay_status, '');
  });

  test('last_who follows the later timestamp', () => {
    assert.equal(lastWhoOf({ last_guest_at: '2026-09-26T14:00:00Z', last_host_at: '2026-09-26T15:00:00Z' }), 'host');
    assert.equal(lastWhoOf({ last_guest_at: null, last_host_at: '2026-09-26T15:00:00Z' }), 'host');
    assert.equal(lastWhoOf({ last_guest_at: '2026-09-26T14:00:00Z', last_host_at: null }), 'guest');
  });

  test('preview collapses whitespace and trims to the cap', () => {
    assert.equal(previewOf('  hello\n\nworld  '), 'hello world');
    assert.equal(previewOf('a'.repeat(200)).length, 140);
    assert.ok(previewOf('a'.repeat(200)).endsWith('...'));
  });
});

describe('message mapping', () => {
  const msg = (over: Partial<MessageLike> = {}): MessageLike => ({
    id: 'm1',
    thread_id: 't1',
    direction: 'inbound',
    sender_kind: 'guest',
    sender_label: 'Jane Doe',
    body: 'hi',
    sent_at: '2026-09-26T14:00:00Z',
    external_message_id: 'quo1',
    provider: 'quo',
    delivery_status: 'recorded',
    raw: null,
    ...over,
  });

  test('a guest message is who=guest with no via', () => {
    const m = toThreadMessage(msg());
    assert.equal(m.who, 'guest');
    assert.equal(m.via, '');
    assert.equal(m.body, 'hi');
    assert.equal(m.at, '2026-09-26T14:00:00Z');
  });

  test('a Helm composer send is the operator; a Quo-app reply is team', () => {
    assert.equal(viaOf(msg({ direction: 'outbound', sender_kind: 'host_human', raw: { source: 'helm' } })), 'operator');
    assert.equal(viaOf(msg({ direction: 'outbound', sender_kind: 'host_human', raw: { source: 'quo_app' } })), 'team');
    assert.equal(viaOf(msg({ direction: 'outbound', sender_kind: 'host_human', raw: null })), 'team');
  });

  test('AI is helm_ai; automation and OTA notices have no via but a label', () => {
    assert.equal(viaOf(msg({ direction: 'outbound', sender_kind: 'host_ai' })), 'helm_ai');
    const auto = toThreadMessage(msg({ direction: 'outbound', sender_kind: 'automation', sender_label: null }));
    assert.equal(auto.via, '');
    assert.equal(auto.sender_name, 'Helm automation');
    const ota = toThreadMessage(msg({ direction: 'outbound', sender_kind: 'ota_notice', sender_label: null }));
    assert.equal(ota.sender_name, 'OTA notice');
  });

  test('inbound never reads as a host send whatever the sender_kind says', () => {
    assert.equal(viaOf(msg({ direction: 'inbound', sender_kind: 'host_human', raw: { source: 'helm' } })), '');
  });
});

describe('reservation picks and list merging', () => {
  test('a stay with a phone becomes a pick; in-house starts today', () => {
    const row = summarizeThread(thread(), { booking: booking({ id: 'b1' }), propertyName: '21 Horton', pendingCount: 0, today: TODAY });
    const pick = toReservationPick(row, TODAY);
    assert.ok(pick);
    assert.equal(pick.in_house, true);
    assert.equal(pick.effective_start, TODAY);
    assert.equal(pick.module, HELM_SMS_MODULE);
  });

  test('an upcoming stay starts on its check-in; no stay means no pick', () => {
    const b = booking({ id: 'b2', check_in: '2026-10-05', check_out: '2026-10-08' });
    const row = summarizeThread(thread({ booking_id: 'b2' }), { booking: b, propertyName: null, pendingCount: 0, today: TODAY });
    assert.equal(toReservationPick(row, TODAY)?.effective_start, '2026-10-05');
    const none = summarizeThread(thread({ booking_id: null }), { booking: null, propertyName: null, pendingCount: 0, today: TODAY });
    assert.equal(toReservationPick(none, TODAY), null);
  });

  test('merge sorts by last activity, newest first, and sinks rows with none', () => {
    const rows = mergeConversationLists(
      [
        { conversation_id: 'c1', last_activity_at: '2026-09-26T10:00:00Z' },
        { conversation_id: 'c2', last_activity_at: '' },
      ],
      [
        { conversation_id: 'helm:a', last_activity_at: '2026-09-26T12:00:00Z' },
        { conversation_id: 'helm:b', last_activity_at: '2026-09-25T12:00:00Z' },
      ],
    );
    assert.deepEqual(
      rows.map((r) => r.conversation_id),
      ['helm:a', 'c1', 'helm:b', 'c2'],
    );
  });

  test('merge drops a duplicate conversation id, concierge copy first', () => {
    const rows = mergeConversationLists(
      [{ conversation_id: 'x', last_activity_at: '2026-09-26T10:00:00Z' }],
      [{ conversation_id: 'x', last_activity_at: '2026-09-26T12:00:00Z' }],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].last_activity_at, '2026-09-26T10:00:00Z');
  });
});

describe('thread state', () => {
  test('a new guest message reopens a done or snoozed thread but never an archived one', () => {
    assert.equal(statusAfterInbound('done'), 'open');
    assert.equal(statusAfterInbound('snoozed'), 'open');
    assert.equal(statusAfterInbound('open'), 'open');
    assert.equal(statusAfterInbound('archived'), 'archived');
  });
});

describe('guards on the wiring', () => {
  test('thread-actions branches on the helm: prefix and quo-ingest hooks both directions', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const here = path.dirname(new URL(import.meta.url).pathname);
    const actions = fs.readFileSync(path.join(here, '../../app/messaging/thread-actions.ts'), 'utf8');
    assert.ok(actions.includes('isHelmConversationId'), 'fetchThread / sendThreadMessage must branch on helm: ids');
    assert.ok(actions.includes('getHelmThread('), 'fetchThread must read the Helm thread');
    assert.ok(actions.includes('sendHelmThreadMessage('), 'sendThreadMessage must send on the Helm rail');
    const ingest = fs.readFileSync(path.join(here, '../quo-ingest.ts'), 'utf8');
    assert.ok(ingest.includes('recordInboundSms('), 'a GUESTS-line inbound must reach the Helm inbox');
    assert.ok(ingest.includes('recordOutboundSms('), 'a Quo-app reply must reach the Helm inbox');
    assert.ok(ingest.includes('captureUnknownInbound(fromPhone'), 'the unknown-number capture must survive');
    assert.ok(!ingest.includes("from '@supabase/supabase-js'"), 'quo-ingest must use supabaseAdmin, never a hand-rolled client');
  });
});
