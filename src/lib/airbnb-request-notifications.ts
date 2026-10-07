/** Notifications are leads, never reservations. No year/property inferred from SMS. */
export const REQUEST_PROPERTIES = {
  '17_beach_front': { name: '17 Beach · Front', listingId: '1600199579054946669' },
  '17_beach_back': { name: '17 Beach · Guest house', listingId: '1600199261450230737' },
} as const;
export type RequestProperty = keyof typeof REQUEST_PROPERTIES;
export type RequestNotification = {
  messageId: string; receivedAt: string; guest: string; datesText: string;
  amountText: string | null; url: string; body: string;
};
export type RequestReview = {
  message_id: string; property_id: RequestProperty | 'other'; check_in: string;
  check_out: string; evidence_url: string; reviewed_by: string; reviewed_at: string;
};
export function airbnbUrl(value: string): string | null {
  try {
    const url = new URL(value.startsWith('airbnb.com/') ? `https://${value}` : value);
    if (url.protocol !== 'https:' || !['airbnb.com', 'www.airbnb.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
    if (!/^\/(?:l\/[A-Za-z0-9_-]+|hosting\/stay\/[A-Za-z0-9_-]+|rooms\/\d+)\/?$/.test(url.pathname)) return null;
    return url.origin + url.pathname; // Do not retain tracking tokens or fragments.
  } catch { return null; }
}
export function parseRequestNotification(payload: unknown, receivedAt: string): RequestNotification | null {
  if (!payload || typeof payload !== 'object') return null;
  const ev = payload as { type?: unknown; data?: { object?: unknown } };
  if (ev.type !== 'message.received' || !ev.data?.object || typeof ev.data.object !== 'object') return null;
  const msg = ev.data.object as Record<string, unknown>;
  if (msg.direction === 'outgoing' || typeof msg.id !== 'string' || !msg.id || msg.id.length > 200) return null;
  const body = typeof msg.body === 'string' ? msg.body : typeof msg.text === 'string' ? msg.text : '';
  if (body.length > 8000) return null;
  const match = body.trim().match(/^Airbnb:\s+(.{1,120}?)\s+requests to stay\s+(.+?)\s+for\s+(\$[\d,.]+)\s+(\S+)\s*$/i);
  if (!match) return null;
  const url = airbnbUrl(match[4]);
  if (!url || !Number.isFinite(Date.parse(receivedAt))) return null;
  return { messageId: msg.id, receivedAt, guest: match[1], datesText: match[2], amountText: match[3], url, body };
}
export function validStay(start: string, end: string): boolean {
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  return valid(start) && valid(end) && start < end;
}
export function conflictProperties(property: RequestProperty): string[] {
  return [property, '17_beach_rd']; // The sibling may remain available.
}
export function overlaps(a: string, b: string, c: string, d: string): boolean {
  return a < d && c < b; // Checkout excluded.
}
export function validateReview(input: Record<string, string>): { property: RequestProperty | 'other'; evidence: string } {
  const property = input.property;
  if (!(Object.hasOwn(REQUEST_PROPERTIES, property)) && property !== 'other') throw new Error('Choose the property shown in Airbnb.');
  if (!validStay(input.start, input.end)) throw new Error('Enter valid arrival and departure dates, including the year.');
  const evidence = airbnbUrl(input.evidence);
  if (!evidence || !/^\/(hosting\/stay|rooms)\//.test(new URL(evidence).pathname)) throw new Error('Paste the opened Airbnb reservation or listing URL, not the short notification link.');
  const listing = new URL(evidence).pathname.match(/^\/rooms\/(\d+)/)?.[1];
  if (listing && property !== 'other' && listing !== REQUEST_PROPERTIES[property as RequestProperty].listingId) throw new Error('That listing URL does not match the selected Beach unit.');
  if (listing && property === 'other' && Object.values(REQUEST_PROPERTIES).some(p => p.listingId === listing)) throw new Error('That listing is a Beach unit. Select the matching unit.');
  if (input.verified !== 'yes') throw new Error('Verify the property and dates in Airbnb first.');
  return { property: property as RequestProperty | 'other', evidence };
}
