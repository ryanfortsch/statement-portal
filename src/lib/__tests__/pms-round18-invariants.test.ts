/**
 * Round-18 guards in SQL and IO code, read from the source (the shape
 * shoot-offer-optin.test.ts uses). Break one and watch it fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ');

test('helm_move_booking pauses the messages of a stay moved off confirmed', () => {
  const sql = flat(read('supabase/migrations/20260926200000_helm_pms_plumbing.sql'));
  const fn = sql.slice(sql.indexOf('create or replace function public.helm_move_booking('), sql.indexOf('create or replace function public.helm_cancel_booking('));
  assert.ok(
    fn.includes("if v_before.status in ('confirmed','completed') and p_status not in ('confirmed','completed') then update public.automation_sends set status = 'cancelled', error = 'stay cancelled', updated_at = now() where booking_id = p_booking_id and status in ('scheduled','awaiting_approval'); end if;"),
  );
});

test('Delete acts only on the booking the page showed', () => {
  const page = read('src/app/channels/bookings/[id]/page.tsx');
  assert.ok(page.includes('<input type="hidden" name="rendered_status" value={booking.status} />'));
  const action = read('src/app/channels/bookings/[id]/actions.ts');
  assert.ok(action.includes('deleteOrCancelBooking(id, actor, { expectedStatus: rendered })'));
  const w = read('src/lib/bookings-write.ts');
  const body = w.slice(w.indexOf('export async function deleteOrCancelBooking('));
  const refuse = body.indexOf('if (opts.expectedStatus && opts.expectedStatus !== before.status) {');
  assert.ok(refuse > 0 && refuse < body.indexOf('await cancelBooking('), 'refused before any cancel or delete');
});

test("the echo replacement's preview update is keyed on the stored message's own time", () => {
  const src = read('src/lib/helm-inbox.ts');
  const ins = src.slice(src.indexOf('async function insertMessage('));
  assert.ok(ins.includes(".eq('last_message_at', isoInstant(hit.sent_at));"));
  assert.ok(!ins.slice(0, ins.indexOf("return { threadId: thread.id, messageId: id, duplicate: true };")).includes(".eq('last_message_at', isoInstant(m.at))"));
});
