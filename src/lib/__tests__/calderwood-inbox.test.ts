import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePilotBooking, scopeGuestyConversations, selectPilotConversation } from '../calderwood-inbox-core.ts';
import type { WorkspaceBooking } from '../calderwood-workspace.ts';
import type { ConversationSummary } from '../stay-concierge.ts';
const booking = (changes: Partial<WorkspaceBooking> = {}): WorkspaceBooking => ({ id: 'b1', property_id: '65_calderwood', channel: 'airbnb', source: 'guesty_legacy', external_booking_id: 'r1', external_confirmation_code: 'C1', check_in: '2026-09-29', check_out: '2026-10-01', status: 'confirmed', guest_name: 'Synthetic Guest', num_guests: 2, gross_amount: null, cleaning_fee: null, taxes: null, payout: null, currency: null, duplicate_of: null, updated_at: '', last_seen_at: '', ...changes });
const conversation = (changes: Partial<ConversationSummary> = {}): ConversationSummary => ({ conversation_id: 'c1', reservation_id: 'r1', listing_id: 'listing1', property_name: '65 Calderwood', guest_full: 'Synthetic Guest', guest_first: 'Synthetic', check_in: '2026-09-29', check_out: '2026-10-01', stay_status: 'in_house', module: 'airbnb', channel: 'Airbnb', last_activity_at: '', last_who: 'guest', last_preview: '', pending_count: 0, ...changes });
test('property scope uses exact listing IDs, never matching names or dates', () => {
 const rows = [conversation(), conversation({ conversation_id: 'foreign', listing_id: 'another' }), conversation({ conversation_id: 'blank', listing_id: '' })];
 assert.deepEqual(scopeGuestyConversations(rows, ['listing1', ''], []).map(r => r.conversation_id), ['c1']);
 assert.deepEqual(scopeGuestyConversations(rows, [], []), []);
 assert.deepEqual(scopeGuestyConversations([conversation({ conversation_id: 'helm:spoof' })], ['listing1'], []), []);
});
test('current and former listing mappings both work', () => {
 assert.equal(scopeGuestyConversations([conversation({ listing_id: 'former' })], ['current', 'former'], []).length, 1);
});
test('reservation linkage follows only property-local aliases', () => {
 const rows = [booking({ id: 'alias', duplicate_of: 'canonical' }), booking({ id: 'canonical', source: 'ical_import', external_booking_id: null })];
 assert.equal(resolvePilotBooking(rows, 'r1', 'guesty')?.id, 'canonical');
 assert.equal(resolvePilotBooking(rows, 'alias', 'helm')?.id, 'canonical');
 assert.equal(resolvePilotBooking([booking({ property_id: 'foreign' })], 'r1', 'guesty'), null);
 assert.equal(resolvePilotBooking([booking({ external_booking_id: 'other' })], 'r1', 'guesty'), null);
});
test('broken, cyclic and ambiguous links are never guessed', () => {
 assert.equal(resolvePilotBooking([booking({ duplicate_of: 'missing' })], 'r1', 'guesty'), null);
 assert.equal(resolvePilotBooking([booking({ duplicate_of: 'b1' })], 'r1', 'guesty'), null);
 assert.equal(resolvePilotBooking([booking(), booking({ id: 'b2' })], 'r1', 'guesty'), null);
 assert.equal(resolvePilotBooking([booking()], '', 'guesty'), null);
});
test('an arbitrary URL ID cannot select a conversation outside the scoped list', () => {
 const rows = scopeGuestyConversations([conversation()], ['listing1'], [booking()]);
 assert.equal(selectPilotConversation(rows, 'foreign'), null);
 assert.equal(selectPilotConversation(rows, 'c1', 'other-booking'), null);
 assert.equal(selectPilotConversation(rows, undefined, 'b1')?.conversation_id, 'c1');
 assert.equal(selectPilotConversation(rows, 'c1')?.booking?.id, 'b1');
});
