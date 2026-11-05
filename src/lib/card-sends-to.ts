/**
 * Where an approved guest card sends, when that is NOT the platform thread.
 *
 * Two card kinds leave the thread, and both were approved blind:
 *   - a guest-SMS card texts a number the guest gave us (`sms_to`)
 *   - a relay card emails a third party the BOOKER named (`guest_email` on a
 *     card whose guesty_message_id starts `relay_email:`), with an access
 *     code for somebody who is not on the reservation
 *
 * The concierge has sent `sms_to` since 2026-09-25 so the operator could see
 * the number before approving a text (stay-concierge api_approvals), and
 * `sms_also` since 2026-11-05 for the rest of a household's numbers. The relay
 * check reads the same prefix the concierge reads to pick the send path at
 * approve time (guest_relay.is_relay_approval).
 *
 * Returns '' for an ordinary OTA card, whose reply goes back up the thread it
 * came from. Deliberately narrow: a 2027 or Stay Cape Ann email card also
 * carries `guest_email`, but that is the guest's own thread, and a confident
 * wrong destination is worse than none.
 */
import { formatUsPhone } from './phone.ts';

const RELAY_PREFIX = 'relay_email:';

export function sendsTo(approval: {
  guesty_message_id?: string | null;
  sms_to?: string | null;
  sms_also?: string[] | null;
  guest_email?: string | null;
}): string {
  const phone = (approval.sms_to || '').trim();
  if (phone) {
    // A household text card reaches every number on it (concierge #155).
    const numbers = [phone, ...(approval.sms_also ?? []).map((p) => (p || '').trim())]
      .filter((p, i, all) => p && all.indexOf(p) === i)
      .map(formatUsPhone);
    const last = numbers.pop();
    return `Texts ${numbers.length ? `${numbers.join(', ')} and ${last}` : last}`;
  }
  const relay = (approval.guesty_message_id || '').startsWith(RELAY_PREFIX);
  const email = (approval.guest_email || '').trim();
  if (relay && email) return `Emails ${email}`;
  return '';
}
