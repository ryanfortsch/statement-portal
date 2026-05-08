/**
 * Shared types for the Guests module.
 *
 * Guests = guest-facing subscriber list, segments, campaigns, events.
 * (Distinct from owner-facing CRM in module 07.)
 *
 * Note: the legacy "Audience" name lives on inside DB table prefixes
 * (audience_contacts, audience_segments, audience_campaigns,
 * audience_events). Renaming the tables is a separate migration; the
 * user-facing module is "Guests" everywhere else.
 */

export type GuestStatus =
  | 'subscribed'
  | 'unsubscribed'
  | 'bounced'
  | 'complained'
  | 'pending';

export type GuestSource =
  | 'squarespace_import'
  | 'staycapeann_signup'
  | 'guesty_post_stay'
  | 'manual';

export type GuestContact = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: GuestStatus;
  subscribed_at: string | null;
  unsubscribed_at: string | null;
  unsubscribe_reason: string | null;
  marketing_consent: boolean;
  source: GuestSource | null;
  source_detail: string | null;
  tags: string[];
  resend_contact_id: string | null;
  resend_synced_at: string | null;
  last_sent_at: string | null;
  last_opened_at: string | null;
  last_clicked_at: string | null;
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  total_bounced: number;
  created_at: string;
  updated_at: string;
};

export type GuestSegment = {
  id: string;
  name: string;
  description: string | null;
  required_tags: string[];
  excluded_tags: string[];
  status_in: GuestStatus[];
  cached_recipient_count: number | null;
  cached_at: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type GuestCampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'failed';

export type GuestCampaign = {
  id: string;
  name: string;
  subject: string | null;
  preheader: string | null;
  from_name: string | null;
  from_email: string | null;
  body_html: string | null;
  body_text: string | null;
  template_key: string | null;
  segment_id: string | null;
  recipient_count: number | null;
  status: GuestCampaignStatus;
  scheduled_for: string | null;
  sent_at: string | null;
  failed_reason: string | null;
  resend_broadcast_id: string | null;
  delivered_count: number;
  opened_count: number;
  clicked_count: number;
  bounced_count: number;
  complained_count: number;
  unsubscribed_count: number;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
};

export type GuestEventType =
  // Resend events
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | 'unsubscribed'
  | 'failed'
  // Internal events
  | 'subscribed'
  | 'imported'
  | 'manually_added'
  | 'resubscribed';

export type GuestEvent = {
  id: string;
  contact_id: string | null;
  campaign_id: string | null;
  event_type: GuestEventType;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Email-domain heuristics. Booking.com proxy emails and privaterelay.appleid.com
 * addresses are technically valid SMTP destinations but typically result in
 * silent drops or recurring bounces. We import them so the contact history is
 * preserved, but auto-tag them with `proxy_email` so default segments exclude
 * them and we don't burn deliverability sending to them.
 */
export const PROXY_EMAIL_DOMAINS = [
  'mchat.booking.com',          // Booking.com guest proxy
  'privaterelay.appleid.com',   // Apple Hide-My-Email
  'guest.airbnb.com',           // Airbnb guest proxy
  'guest.booking.com',          // Booking.com newer proxy format
];

export function isProxyEmail(email: string): boolean {
  const lower = email.toLowerCase().trim();
  return PROXY_EMAIL_DOMAINS.some((d) => lower.endsWith('@' + d));
}

/**
 * Title-case a name fragment, preserving common connectors lowercase
 * ("Mary van der Berg" → "Mary van der Berg") and respecting an existing
 * mixed-case typing ("McWethy", "O'Brien") so we don't normalize the
 * intentional capitals away.
 */
function titleCaseName(s: string): string {
  if (!s) return s;
  // If the string already has any uppercase letter mid-word, treat it as
  // intentionally cased and leave it alone (preserves McWethy, O'Brien).
  if (/[a-z][A-Z]/.test(s)) return s;
  const connectors = new Set(['van', 'von', 'de', 'del', 'della', 'di', 'da', 'la', 'le', 'el']);
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part, i) => {
      if (/^\s+$/.test(part) || part === '-') return part;
      if (i > 0 && connectors.has(part)) return part;
      return part.replace(/(^|[\p{L}'’]?)(\p{L})/u, (_, pre: string, ch: string) =>
        pre + ch.toUpperCase()
      );
    })
    .join('');
}

export function displayName(c: Pick<GuestContact, 'first_name' | 'last_name' | 'email'>): string {
  const first = titleCaseName((c.first_name || '').trim());
  const last = titleCaseName((c.last_name || '').trim());
  const full = [first, last].filter(Boolean).join(' ');
  return full || c.email;
}

/**
 * Pretty-print a tag for chip / filter display. Snake-case programmer
 * tags ("proxy_email") become title-cased phrases ("Proxy Email").
 * Place names (Gloucester, Black Rock) round-trip cleanly.
 */
export function formatTagLabel(tag: string): string {
  return tag
    .replace(/_/g, ' ')
    .replace(/(^|\s)(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toUpperCase());
}
