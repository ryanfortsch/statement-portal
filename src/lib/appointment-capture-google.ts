import { calendarCapture, messageCapture, schedulingSignal, type CalendarEvent, type Capture } from './appointment-capture.ts';
import { agendaWindow, sourceKeyFromUrl } from './appointment-agenda.ts';
import { addDays } from './home-week.ts';

type Fetch = typeof fetch;
export class CaptureAccessError extends Error { status: number; constructor(status: number) { super(`Provider read failed (${status}).`); this.status = status; } }
async function read<T>(url: string | URL, token: string, get: Fetch): Promise<T> {
  const response = await get(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!response.ok) throw new CaptureAccessError(response.status);
  return response.json() as Promise<T>;
}
/** Full bounded window every run, plus individually re-read tracked events.
 * Missing IDs are never inferred cancelled from pagination or window absence. */
export async function captureCalendar(token: string, email: string, trackedKeys: string[], now: Date, get: Fetch = fetch): Promise<Capture[]> {
  const window = agendaWindow(now), events = new Map<string, CalendarEvent>();
  let page: string | undefined;
  const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  do {
    const url = new URL(base);
    // UTC padding covers both Eastern offsets at the edges; UI filters local dates.
    url.searchParams.set('timeMin', `${window.today}T00:00:00Z`);
    url.searchParams.set('timeMax', `${addDays(window.through, 2)}T00:00:00Z`);
    url.searchParams.set('singleEvents', 'true'); url.searchParams.set('showDeleted', 'true');
    url.searchParams.set('maxResults', '250'); url.searchParams.set('timeZone', 'America/New_York');
    url.searchParams.set('fields', 'items(id,status,summary,htmlLink,updated,location,start,end,eventType,attendees(self,responseStatus),recurringEventId),nextPageToken');
    if (page) url.searchParams.set('pageToken', page);
    const data = await read<{ items?: CalendarEvent[]; nextPageToken?: string }>(url, token, get);
    for (const event of data.items || []) events.set(event.id, event);
    page = data.nextPageToken;
    if (events.size > 2000) throw Error('Calendar window exceeded the capture limit; no complete check recorded.');
  } while (page);
  const prefix = `gcal:${email}:`;
  const ids = [...new Set(trackedKeys.filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)))];
  if (ids.length > 500) throw Error('Tracked calendar events exceed the capture limit; narrow the retained window.');
  for (const id of ids) {
    if (events.has(id)) continue;
    try { events.set(id, await read<CalendarEvent>(`${base}/${encodeURIComponent(id)}`, token, get)); }
    catch (error) {
      if (!(error instanceof CaptureAccessError) || ![404, 410].includes(error.status)) throw error;
      // Access to the primary calendar succeeded above. Still do not turn a
      // vanished item into an authoritative cancellation: review it explicitly.
      const missing = calendarCapture({ id, status: 'tentative', summary: 'Calendar event unavailable' }, email, now);
      missing.details.reviewReason = 'A previously tracked event is no longer readable. Verify whether it was cancelled or moved.';
      missing.details.status = 'needs_scheduling';
      events.set(id, { id, status: 'tentative', summary: missing.details.title });
    }
  }
  return [...events.values()].filter(e => (!e.eventType || ['default', 'fromGmail'].includes(e.eventType)) &&
    !/^guest check[ -]?(?:out|in)\b/i.test(e.summary || '')).map(e => calendarCapture(e, email, now))
    .filter(c => !c.details.date || c.details.date >= window.today || trackedKeys.includes(c.source_key));
}

type Payload = { mimeType?: string; headers?: Array<{ name: string; value: string }>; body?: { data?: string }; parts?: Payload[] };
type Message = { id: string; internalDate?: string; payload?: Payload };
type Thread = { id: string; messages?: Message[] };
function content(payload?: Payload): string {
  if (!payload) return '';
  return [payload.body?.data ? Buffer.from(payload.body.data, 'base64url').toString('utf8') : '', ...(payload.parts || []).map(content)].join('\n');
}
const SIGNAL_QUERY = '{appointment inspection inspector meeting walkthrough "walk through" tour photoshoot "photo shoot" schedule reschedule zoom "video call" "introductory call"}';
/** Search all folders except spam/trash (including sent and read messages), then
 * fetch complete threads so short follow-ups and quoted earlier dates can be
 * reviewed together. Only identities/hashes/links persist; bodies stay in memory. */
export async function captureGmail(token: string, email: string, trackedKeys: string[], since: Date, now: Date, get: Fetch = fetch): Promise<Capture[]> {
  const ids = new Set<string>(); let page: string | undefined;
  do {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/threads');
    url.searchParams.set('q', `after:${Math.floor(since.getTime() / 1000)} ${SIGNAL_QUERY}`);
    url.searchParams.set('maxResults', '100');
    if (page) url.searchParams.set('pageToken', page);
    const data = await read<{ threads?: Array<{ id: string }>; nextPageToken?: string }>(url, token, get);
    for (const t of data.threads || []) ids.add(t.id);
    page = data.nextPageToken;
    if (ids.size > 500) throw Error('Mail capture exceeds 500 conversations; no complete check recorded.');
  } while (page);
  const prefix = `gmail:${email}:thread:`;
  for (const key of trackedKeys) if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
  if (ids.size > 700) throw Error('Tracked conversations exceed the capture limit.');
  const captures: Capture[] = [];
  for (const id of ids) {
    const t = await read<Thread>(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}?format=full`, token, get);
    const messages = [...(t.messages || [])].sort((a, b) => Number(a.internalDate) - Number(b.internalDate) || a.id.localeCompare(b.id));
    const bodies = messages.map(m => `${m.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value || ''}\n${content(m.payload)}`);
    if (!bodies.some(schedulingSignal) && !trackedKeys.includes(`${prefix}${id}`)) continue;
    const aliases = messages.map(m => `gmail:${email}:${m.id}`);
    // Only exact provider links establish cross-source identity. Different emails
    // with similar subjects, or two inspections at one house, never auto-merge.
    for (const body of bodies) for (const match of body.matchAll(/https:\/\/(?:www\.google\.com\/calendar|calendar\.google\.com)[^\s<>"']+/g)) {
      const key = sourceKeyFromUrl(match[0].replace(/&amp;/g, '&'), email);
      if (key?.startsWith(`gcal:${email}:`)) aliases.push(key);
    }
    // A thread may discuss several events: ambiguous links do not deduplicate it.
    const calendarKeys = [...new Set(aliases.filter(k => k.startsWith('gcal:')))];
    const safeAliases = calendarKeys.length > 1 ? aliases.filter(k => !k.startsWith('gcal:')) : aliases;
    const key = `${prefix}${id}`;
    captures.push(messageCapture('gmail', key, safeAliases, `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#all/${id}`, messages.map((m, i) => [m.id, m.internalDate, bodies[i]]), now));
  }
  return captures;
}
