import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleGuestInbox, guestInboxHref, inboxListingMap, inboxWindow, loadGuestInboxFromSources, resolveInboxBooking, type GuestInboxSources, type InboxBooking, type InboxProperty, type NativeInboxThread } from '../guest-inbox-core.ts';
import type { ConversationSummary, ThreadMessage } from '../stay-concierge.ts';

const now = '2026-09-30T12:00:00Z';
const property = (id = 'home-a', changes: Partial<InboxProperty> = {}): InboxProperty => ({ id, name: `Synthetic ${id}`, address: null, guesty_listing_id: `listing-${id}`, former_guesty_listing_id: null, ...changes });
const booking = (changes: Partial<InboxBooking> = {}): InboxBooking => ({ id: 'booking-a', property_id: 'home-a', source: 'guesty_legacy', channel: 'airbnb', external_booking_id: 'reservation-a', external_confirmation_code: 'SYNTHETIC', check_in: '2026-09-29', check_out: '2026-10-02', status: 'confirmed', num_guests: 2, duplicate_of: null, ...changes });
const conversation = (changes: Partial<ConversationSummary> = {}): ConversationSummary => ({ conversation_id: 'conversation-a', reservation_id: 'reservation-a', listing_id: 'listing-home-a', property_name: 'Synthetic source name', guest_full: 'Synthetic Guest', guest_first: 'Synthetic', check_in: '2026-09-29', check_out: '2026-10-02', stay_status: 'in_house', module: 'airbnb', channel: 'Airbnb', last_activity_at: now, last_who: 'guest', last_preview: 'Synthetic preview', pending_count: 0, ...changes });
const native = (changes: Partial<NativeInboxThread> = {}): NativeInboxThread => ({ id: 'native-a', property_id: 'home-a', booking_id: 'booking-a', channel: 'sms', guest_name: 'Synthetic Guest', last_preview: 'Synthetic text', updated_at: now, last_guest_at: now, last_host_at: null, ...changes });
const message: ThreadMessage = { id: 'message-a', body: 'Synthetic content', at: now, who: 'guest', via: '', sender_name: 'Synthetic Guest' };

function fixture(overrides: Partial<GuestInboxSources> = {}) {
  const reads: string[] = [];
  const sources: GuestInboxSources = {
    properties: async () => [property(), property('home-b')],
    listings: async () => [],
    guesty: async () => [conversation(), conversation({ conversation_id: 'conversation-b', listing_id: 'listing-home-b', reservation_id: 'reservation-b' })],
    native: async () => [native()],
    bookings: async () => [booking()],
    guestyThread: async id => { reads.push(`guesty:${id}`); return [message]; },
    nativeThread: async id => { reads.push(`helm:${id}`); return [message]; },
    ...overrides,
  };
  return { sources, reads };
}

test('listing mappings use current, former and synced IDs; ambiguous IDs remain unassigned', () => {
  const map = inboxListingMap([property('home-a', { former_guesty_listing_id: 'old' }), property('home-b')], [
    { listing_id: 'synced', property_id: 'home-a' },
    { listing_id: 'listing-home-a', property_id: 'home-b' },
    { listing_id: 'unknown', property_id: 'missing-property' },
  ]);
  assert.equal(map.get('old'), 'home-a');
  assert.equal(map.get('synced'), 'home-a');
  assert.equal(map.get('listing-home-b'), 'home-b');
  assert.equal(map.has('listing-home-a'), false);
  assert.equal(map.has('unknown'), false);
});

test('same reservation IDs at different properties and property-local aliases stay separate', () => {
  const rows = [booking({ duplicate_of: 'canonical' }), booking({ id: 'canonical', source: 'ical_import', external_booking_id: null }), booking({ id: 'foreign', property_id: 'home-b' })];
  assert.equal(resolveInboxBooking(rows, 'home-a', 'reservation-a', 'guesty')?.id, 'canonical');
  assert.equal(resolveInboxBooking(rows, 'home-b', 'reservation-a', 'guesty')?.id, 'foreign');
  assert.equal(resolveInboxBooking(rows, 'home-a', 'foreign', 'helm'), null);
  assert.equal(resolveInboxBooking(rows, null, 'reservation-a', 'guesty'), null);
});

test('broken, cross-property, cyclic and ambiguous booking aliases never borrow stay details', () => {
  for (const rows of [
    [booking({ duplicate_of: 'missing' })],
    [booking({ duplicate_of: 'foreign' }), booking({ id: 'foreign', property_id: 'home-b' })],
    [booking({ duplicate_of: 'booking-a' })],
    [booking(), booking({ id: 'another' })],
  ]) assert.equal(resolveInboxBooking(rows, 'home-a', 'reservation-a', 'guesty'), null);
});

test('all properties includes unmapped histories without guessing a registry match from its name', () => {
  const rows = assembleGuestInbox([conversation({ listing_id: 'unknown', property_name: property().name }), conversation({ conversation_id: 'helm:spoof' })], [native()], [property()], [], [booking()], now);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r.source === 'guesty')?.property_id, null);
  assert.equal(rows.find(r => r.source === 'guesty')?.booking, null);
  assert.equal(rows.find(r => r.source === 'helm')?.booking?.id, 'booking-a');
});

test('native threads use exact booking fallback but never override an explicit conflicting property', () => {
  const rows = assembleGuestInbox([], [native({ property_id: null }), native({ id: 'conflict', property_id: 'home-b' })], [property(), property('home-b')], [], [booking()], now);
  assert.equal(rows[0].property_id, 'home-a');
  assert.equal(rows[0].stay_status, 'in_house');
  assert.equal(rows[1].property_id, 'home-b');
  assert.equal(rows[1].booking, null);
});

test('each source and each property keeps distinct conversation identities and activity ordering', () => {
  const rows = assembleGuestInbox([conversation({ last_activity_at: '2026-09-29T12:00:00Z' }), conversation({ conversation_id: 'quiet', last_activity_at: '' })], [native()], [property()], [], [booking()], now);
  assert.deepEqual(rows.map(r => r.conversation_id), ['helm:native-a', 'conversation-a', 'quiet']);
});

test('property selection is applied before any thread read, including URL tampering', async () => {
  for (const options of [{ conversation: 'not-in-list' }, { property: 'home-b', conversation: 'conversation-a' }, { property: 'invalid', conversation: 'helm:native-a' }]) {
    const f = fixture();
    const data = await loadGuestInboxFromSources(f.sources, options, now);
    assert.equal(data.selected, null);
    assert.equal(data.messages.length, 0);
    assert.ok(data.threadError);
    assert.deepEqual(f.reads, []);
  }
});

test('only the selected source is read and property options cover the unfiltered list', async () => {
  const f = fixture();
  const data = await loadGuestInboxFromSources(f.sources, { property: 'home-a', conversation: 'helm:native-a' }, now);
  assert.deepEqual(f.reads, ['helm:native-a']);
  assert.equal(data.conversations.length, 2);
  assert.equal(data.properties.length, 2);
  assert.equal(data.messages[0].body, message.body);
});

test('source outages are distinct from empty lists and preserve the available source', async () => {
  for (const source of ['guesty', 'native'] as const) {
    const f = fixture({ [source]: async () => { throw new Error('internal diagnostic must not leak'); } });
    const data = await loadGuestInboxFromSources(f.sources, {}, now);
    assert.ok(data.conversations.length);
    assert.ok(data.errors.length);
    assert.ok(data.messages.length);
    assert.equal(JSON.stringify(data).includes('internal diagnostic'), false);
  }
  const empty = fixture({ guesty: async () => [], native: async () => [] });
  const data = await loadGuestInboxFromSources(empty.sources, {}, now);
  assert.deepEqual(data.errors, []);
  assert.deepEqual(empty.reads, []);
});

test('property/booking lookup failures leave history readable without fabricated details', async () => {
  const f = fixture({ properties: async () => { throw new Error(); }, bookings: async () => { throw new Error(); } });
  const data = await loadGuestInboxFromSources(f.sources, { conversation: 'conversation-a' }, now);
  assert.equal(data.selected?.property_id, null);
  assert.equal(data.selected?.booking, null);
  assert.equal(data.messages.length, 1);
  assert.equal(data.errors.length, 2);
});

test('thread failure preserves selection and exposes a retryable error without other history', async () => {
  const f = fixture({ guestyThread: async () => { throw new Error('private upstream failure'); } });
  const data = await loadGuestInboxFromSources(f.sources, { conversation: 'conversation-a' }, now);
  assert.equal(data.selected?.conversation_id, 'conversation-a');
  assert.deepEqual(data.messages, []);
  assert.match(data.threadError!, /Refresh/);
  assert.equal(JSON.stringify(data).includes('private upstream'), false);
});

test('date windows are bounded and navigation retains encoded property and thread scope', () => {
  for (const value of [undefined, '', '-1', '5000', 'NaN', '30&x=1']) assert.equal(inboxWindow(value), 60);
  for (const value of ['30', '60', '120']) assert.equal(inboxWindow(value), Number(value));
  const href = guestInboxHref({ conversation: 'helm:abc&injected=x', property: 'home a', days: 120 });
  const url = new URL(href, 'https://synthetic.invalid');
  assert.equal(url.pathname, '/messaging/inbox');
  assert.equal(url.searchParams.get('conversation'), 'helm:abc&injected=x');
  assert.equal(url.searchParams.get('property'), 'home a');
  assert.equal(url.searchParams.get('days'), '120');
  assert.equal(url.searchParams.has('injected'), false);
});

test('preview boundary stays authenticated and its adapter has no message/calendar mutation path', () => {
  const page = readFileSync(new URL('../../app/messaging/inbox/page.tsx', import.meta.url), 'utf8');
  const adapter = readFileSync(new URL('../guest-inbox.server.ts', import.meta.url), 'utf8');
  const authIndex = page.indexOf('await auth()');
  assert.ok(authIndex >= 0 && authIndex < page.indexOf('await loadGuestInbox('));
  assert.match(page, /endsWith\('@risingtidestr\.com'\)/);
  assert.match(page, /redirect\(/);
  const mutation = /\.(insert|update|upsert|delete|rpc)\(/;
  assert.doesNotMatch(adapter, mutation);
  assert.throws(() => assert.doesNotMatch(adapter + '\nsb.from(\'guest_messages\').insert({});', mutation));
  assert.doesNotMatch(adapter, /sendConversationMessage|sendHelmThreadMessage|from ['"].*actions|from ['"].*helm-inbox['"]/);
  assert.match(adapter, /order\('sent_at', \{ ascending: false \}\)/);
});
