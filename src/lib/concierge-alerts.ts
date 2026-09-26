/**
 * Pure helpers for the "Concierge needs you" strip on the home page.
 *
 * Every alert the stay-concierge raises (a guest message that got no draft, a
 * reply the channel rejected, a payment link that never went out, a guest
 * emergency) was written for a team text list that has been empty since
 * 2026-08-20, and nothing in Helm read the attention items meant to replace
 * it. Sep 12-26 that was 19 guest messages with no draft and 12 emergency
 * alerts that reached nobody. The concierge now serves them at
 * /api/attention; this names and routes them.
 *
 * No imports on purpose, so `npm test` loads it without a database.
 */

export type ConciergeCritical = {
  item_key: string;
  summary: string;
  created_at: string;
  alert_count: number;
  conversation_id: string;
};

export type ConciergeAlert = {
  item_key: string;
  kind: string;
  summary: string;
  created_at: string;
};

export type ConciergeAttention = {
  generated_at: string;
  criticals: ConciergeCritical[];
  items: ConciergeAlert[];
};

const TITLES: Record<string, string> = {
  pipeline_failure: 'A guest message got no draft',
  send_delivery_failed: 'A reply never reached the guest',
  addon_sms_failed: 'A payment link did not go out',
  sca_email_empty: 'A Stay Cape Ann email could not be read',
  sca_email_needs_you: 'A Stay Cape Ann email needs you',
  far_future_hold_failed: 'A far-future booking step failed',
  far_future_slip_failed: 'A far-future booking step failed',
  owner_guest_notice_no_guest: "An owner's notice had no guest to go to",
  owner_guest_notice_no_property: "An owner's notice had no property on file",
  owner_guest_notice_no_date: "An owner's notice had no date",
  owner_guest_message_no_guest: "An owner's message had no guest to go to",
  owner_guest_message_no_property: "An owner's message had no property on file",
  unknown_owner_sms: 'Unknown number on the Owners line',
  owner_email_empty: 'An owner email could not be read',
};

/** A plain title for an alert kind. A kind nobody named yet still reads as
 *  words, never as a code, and still shows: unnamed is not the same as
 *  unimportant. */
export function conciergeAlertTitle(kind: string): string {
  if (TITLES[kind]) return TITLES[kind];
  const words = (kind || 'alert').replace(/[_:]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Where the operator goes to act on it. */
export function conciergeAlertHref(kind: string): string {
  if (kind === 'addon_sms_failed') return '/messaging/send#payment-links';
  if (kind === 'unknown_owner_sms' || kind.startsWith('owner_')) return '/owner-messaging';
  return '/messaging';
}

/** Collapse whitespace and cap a summary for a one-line row. */
export function alertSummary(text: string, max = 260): string {
  const flat = (text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
