import 'server-only';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
import { parseRequestNotification, conflictProperties, type RequestReview, type RequestNotification } from './airbnb-request-notifications';

export async function loadRequestQueue() {
  // A bounded, read-only projection of existing signed events. No webhook changes.
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const result = await db.from('quo_events').select('payload, received_at')
    .eq('signature_valid', true).eq('event_type', 'message.received')
    .gte('received_at', cutoff).order('received_at', { ascending: false }).limit(1000);
  if (result.error) throw new Error('Quo notifications could not be loaded.');
  const seen = new Set<string>();
  const items: RequestNotification[] = [];
  for (const row of result.data ?? []) {
    const item = parseRequestNotification(row.payload, row.received_at);
    if (item && !seen.has(item.messageId)) { seen.add(item.messageId); items.push(item); }
  }
  const reviews = items.length ? await db.from('airbnb_request_reviews').select('*').in('message_id', items.map(i => i.messageId)) : { data: [], error: null };
  return { items, reviews: (reviews.data ?? []) as RequestReview[], reviewsReady: !reviews.error, truncated: result.data?.length === 1000 };
}
export async function findRequest(messageId: string) {
  const { data, error } = await db.from('quo_events').select('payload, received_at')
    .eq('signature_valid', true).eq('event_type', 'message.received')
    .eq('payload->data->object->>id', messageId).limit(1).maybeSingle();
  if (error || !data) throw new Error('The signed source notification is unavailable.');
  const item = parseRequestNotification(data.payload, data.received_at);
  if (!item) throw new Error('This notification is not a supported Airbnb request.');
  return item;
}
export async function requestConflicts(review: RequestReview) {
  if (review.property_id === 'other') return { count: null, label: 'Outside Beach pilot' };
  const { count, error } = await db.from('bookings').select('id', { count: 'exact', head: true })
    .in('property_id', conflictProperties(review.property_id)).is('duplicate_of', null)
    .in('status', ['confirmed', 'completed', 'block'])
    .lt('check_in', review.check_out).gt('check_out', review.check_in);
  if (error) return { count: null, label: 'Calendar check unavailable' };
  return { count, label: count ? `${count} recorded overlap${count === 1 ? '' : 's'}` : 'No recorded overlap · verify live calendars' };
}
