/**
 * Linked listings, the IO half (rules: listing-links-core.ts). Every run:
 *
 *   1. read each group's bookings: Guesty reservations (confirmed, not yet
 *      checked out) for a Guesty-run member, reserved events on its own
 *      export feed for a member Guesty does not run;
 *   2. work out the blocks they call for and diff them with what Helm placed;
 *   3. place new blocks (Guesty calendar 'unavailable' with Helm's note, or
 *      a row the member's Helm iCal feed serves) and reopen the ones no
 *      longer wanted, a day at a time and only where Helm's own note is the
 *      day's only block.
 *
 * A failed read of any member stops that group's run (absence is not a
 * fact: a feed that failed to load must not reopen the whole house).
 */

import { supabaseAdmin, isServiceConfigured } from './supabase-admin.ts';
import { guestyGet, guestyWrite } from './guesty.ts';
import { parseIcal } from './ical.ts';
import {
  contiguousRuns,
  desiredBlocks,
  diffBlocks,
  helmLinkNote,
  isReservedEvent,
  linkedOverlaps,
  mayReopenDay,
  nightsOf,
  type CalendarDayLite,
  type DesiredBlock,
  type ExistingBlock,
  type LinkBooking,
  type LinkMember,
} from './listing-links-core.ts';

export type LinkRunGroup = {
  group_key: string;
  placed: string[];
  reopened: string[];
  kept_closed: string[];
  failed: string[];
  overlaps: string[];
  error: string | null;
};

export type LinkRunSummary = { groups: LinkRunGroup[]; dry: boolean };

type GuestyReservation = {
  _id: string;
  status?: string;
  checkIn?: string;
  checkOut?: string;
  checkInDateLocalized?: string;
  checkOutDateLocalized?: string;
  confirmationCode?: string;
};

const LIVE_RESERVATION = new Set(['confirmed', 'reserved', 'checked_in', 'checkedin']);

function todayEastern(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

async function guestyBookings(member: LinkMember, today: string): Promise<LinkBooking[]> {
  const filters = JSON.stringify([
    { field: 'listingId', operator: '$eq', value: member.guesty_listing_id },
    { field: 'checkOut', operator: '$gte', value: today },
  ]);
  const out: LinkBooking[] = [];
  for (let skip = 0; skip < 1000; skip += 100) {
    const page = await guestyGet<{ results?: GuestyReservation[] }>('/v1/reservations', {
      fields: '_id status checkIn checkOut checkInDateLocalized checkOutDateLocalized confirmationCode',
      filters,
      limit: 100,
      skip,
    });
    const rows = page.results ?? [];
    for (const r of rows) {
      if (!LIVE_RESERVATION.has(String(r.status ?? '').toLowerCase())) continue;
      const ci = (r.checkInDateLocalized ?? r.checkIn ?? '').slice(0, 10);
      const co = (r.checkOutDateLocalized ?? r.checkOut ?? '').slice(0, 10);
      if (!ci || !co) continue;
      out.push({ member_key: member.member_key, source_key: `guesty:${r._id}`, check_in: ci, check_out: co, label: r.confirmationCode ?? null });
    }
    if (rows.length < 100) break;
  }
  return out;
}

async function icalBookings(member: LinkMember, today: string): Promise<LinkBooking[]> {
  const res = await fetch(member.ical_url as string, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${member.label}: feed answered ${res.status}`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error(`${member.label}: feed is not a calendar`);
  return parseIcal(text)
    .filter((e) => !e.cancelled && isReservedEvent(e.summary))
    .map((e) => ({ member_key: member.member_key, source_key: `ical:${e.uid}`, check_in: e.dtstart.slice(0, 10), check_out: e.dtend.slice(0, 10), label: null }))
    .filter((b) => b.check_out >= today);
}

type GuestyCalendar = { days?: CalendarDayLite[]; data?: { days?: CalendarDayLite[] } };

async function closeInGuesty(listingId: string, b: DesiredBlock): Promise<void> {
  const last = nightsOf(b.check_in, b.check_out).pop();
  if (!last) return;
  await guestyWrite('PUT', `/v1/availability-pricing/api/calendar/listings/${listingId}`, {
    startDate: b.check_in,
    endDate: last,
    status: 'unavailable',
    blockReason: 'Other',
    note: helmLinkNote(b.source_key),
  });
}

/** Reopen only the days whose sole block is Helm's own for this source. Returns the days left closed. */
async function reopenInGuesty(listingId: string, b: ExistingBlock): Promise<string[]> {
  const nights = nightsOf(b.check_in, b.check_out);
  if (nights.length === 0) return [];
  const cal = await guestyGet<GuestyCalendar>(`/v1/availability-pricing/api/calendar/listings/${listingId}`, {
    startDate: nights[0],
    endDate: nights[nights.length - 1],
  });
  const days = cal.days ?? cal.data?.days ?? [];
  const note = helmLinkNote(b.source_key);
  const reopen: string[] = [];
  const keep: string[] = [];
  for (const d of days) (mayReopenDay(d, note) ? reopen : keep).push(String(d.date).slice(0, 10));
  for (const run of contiguousRuns(reopen)) {
    await guestyWrite('PUT', `/v1/availability-pricing/api/calendar/listings/${listingId}`, {
      startDate: run.start,
      endDate: run.end,
      status: 'available',
    });
  }
  return keep;
}

/** Active members only, except for a dry run, which also reads switched-off
 *  groups so an operator sees what they would do before turning them on. */
async function loadMembers(includeInactive: boolean): Promise<LinkMember[]> {
  let q = supabaseAdmin.from('listing_links').select('group_key, member_key, label, role, guesty_listing_id, ical_url');
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw new Error(`listing_links: ${error.message}`);
  return (data ?? []) as LinkMember[];
}

export async function runListingLinks(opts: { dry?: boolean; now?: Date } = {}): Promise<LinkRunSummary> {
  const dry = !!opts.dry;
  const now = opts.now ?? new Date();
  if (!isServiceConfigured) return { groups: [], dry };
  const today = todayEastern(now);
  const members = await loadMembers(dry);
  const groups = [...new Set(members.map((m) => m.group_key))];
  const summary: LinkRunSummary = { groups: [], dry };

  for (const group_key of groups) {
    const g: LinkRunGroup = { group_key, placed: [], reopened: [], kept_closed: [], failed: [], overlaps: [], error: null };
    summary.groups.push(g);
    const gm = members.filter((m) => m.group_key === group_key);
    const byKey = new Map(gm.map((m) => [m.member_key, m]));
    try {
      // 1. Every member's bookings, or nothing changes this run.
      const bookings: LinkBooking[] = [];
      for (const m of gm) {
        if (m.guesty_listing_id) bookings.push(...(await guestyBookings(m, today)));
        else if (m.ical_url) bookings.push(...(await icalBookings(m, today)));
      }
      for (const o of linkedOverlaps(gm, bookings)) {
        const message = `Double booked: ${byKey.get(o.a.member_key)?.label} ${o.a.check_in} to ${o.a.check_out} overlaps ${byKey.get(o.b.member_key)?.label} ${o.b.check_in} to ${o.b.check_out}. One house, two guests: sort it out with the OTA today.`;
        g.overlaps.push(message);
        if (!dry) {
          const fingerprint = [o.a.source_key, o.b.source_key].sort().join('|');
          await supabaseAdmin.from('listing_link_alerts').upsert({ group_key, fingerprint, message }, { onConflict: 'fingerprint', ignoreDuplicates: true });
        }
      }

      // 2. What Helm placed before.
      const { data: rows, error } = await supabaseAdmin
        .from('listing_link_blocks')
        .select('id, group_key, target_member, source_member, source_key, check_in, check_out, status')
        .eq('group_key', group_key)
        .in('status', ['active', 'failed']);
      if (error) throw new Error(`listing_link_blocks: ${error.message}`);
      const existing = ((rows ?? []) as ExistingBlock[]).map((r) => ({ ...r, check_in: String(r.check_in).slice(0, 10), check_out: String(r.check_out).slice(0, 10) }));
      const diff = diffBlocks(desiredBlocks(gm, bookings), existing);
      if (dry) {
        g.placed = diff.create.map((b) => `${b.target_member} ${b.check_in}..${b.check_out}`);
        g.reopened = diff.remove.map((b) => `${b.target_member} ${b.check_in}..${b.check_out}`);
        continue;
      }

      // 3a. Reopen what is no longer wanted (before placing, so a moved
      //     booking's new dates are never reopened by its old row).
      for (const b of diff.remove) {
        const target = byKey.get(b.target_member);
        try {
          const keep = target?.guesty_listing_id ? await reopenInGuesty(target.guesty_listing_id, b) : [];
          if (keep.length > 0) g.kept_closed.push(`${target?.label}: ${keep.join(', ')} kept closed (another block or a booking is on them)`);
          await supabaseAdmin.from('listing_link_blocks').update({ status: 'removed', error: null, updated_at: new Date().toISOString() }).eq('id', b.id);
          g.reopened.push(`${target?.label} ${b.check_in} to ${b.check_out}`);
        } catch (err) {
          g.failed.push(`reopen ${target?.label} ${b.check_in} to ${b.check_out}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      // 3b. Place the new ones.
      for (const b of diff.create) {
        const target = byKey.get(b.target_member);
        let status: 'active' | 'failed' = 'active';
        let errText: string | null = null;
        try {
          if (target?.guesty_listing_id) await closeInGuesty(target.guesty_listing_id, b);
        } catch (err) {
          status = 'failed';
          errText = err instanceof Error ? err.message : String(err);
          g.failed.push(`close ${target?.label} ${b.check_in} to ${b.check_out}: ${errText}`);
        }
        const { error: upErr } = await supabaseAdmin.from('listing_link_blocks').upsert(
          { ...b, status, error: errText, updated_at: new Date().toISOString() },
          { onConflict: 'group_key,target_member,source_key' },
        );
        if (upErr) g.failed.push(`record ${target?.label}: ${upErr.message}`);
        if (status === 'active') g.placed.push(`${target?.label} ${b.check_in} to ${b.check_out} (${byKey.get(b.source_member)?.label} booked)`);
      }
    } catch (err) {
      g.error = err instanceof Error ? err.message : String(err);
    }
  }
  return summary;
}

/** The active closures one member's Helm feed serves (a member Guesty does not run imports it). */
export async function linkedFeedFor(token: string): Promise<{ label: string; blocks: Array<{ source_key: string; check_in: string; check_out: string }> } | null> {
  if (!isServiceConfigured || !token || token.length < 16) return null;
  const { data: member } = await supabaseAdmin
    .from('listing_links')
    .select('group_key, member_key, label, active')
    .eq('export_token', token)
    .maybeSingle();
  const m = member as { group_key: string; member_key: string; label: string; active: boolean } | null;
  if (!m || !m.active) return null;
  const { data, error } = await supabaseAdmin
    .from('listing_link_blocks')
    .select('source_key, check_in, check_out')
    .eq('group_key', m.group_key)
    .eq('target_member', m.member_key)
    .eq('status', 'active');
  if (error) throw new Error(`listing_link_blocks: ${error.message}`);
  return {
    label: m.label,
    blocks: ((data ?? []) as Array<{ source_key: string; check_in: string; check_out: string }>).map((b) => ({
      source_key: b.source_key,
      check_in: String(b.check_in).slice(0, 10),
      check_out: String(b.check_out).slice(0, 10),
    })),
  };
}

/** Recent activity and problems, for the daily brief. */
export async function linkedListingNotices(sinceIso: string): Promise<string[]> {
  if (!isServiceConfigured) return [];
  const { data: alerts } = await supabaseAdmin
    .from('listing_link_alerts')
    .select('message')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(10);
  const loud = ((alerts ?? []) as Array<{ message: string }>).map((a) => a.message);
  const { data } = await supabaseAdmin
    .from('listing_link_blocks')
    .select('group_key, target_member, source_member, check_in, check_out, status, error, updated_at')
    .gte('updated_at', sinceIso)
    .order('updated_at', { ascending: false })
    .limit(20);
  const { data: mem } = await supabaseAdmin.from('listing_links').select('member_key, group_key, label');
  const label = new Map(((mem ?? []) as Array<{ member_key: string; group_key: string; label: string }>).map((m) => [`${m.group_key}|${m.member_key}`, m.label]));
  return [...loud, ...((data ?? []) as Array<Record<string, string>>).map((r) => {
    const t = label.get(`${r.group_key}|${r.target_member}`) ?? r.target_member;
    const s = label.get(`${r.group_key}|${r.source_member}`) ?? r.source_member;
    const dates = `${String(r.check_in).slice(0, 10)} to ${String(r.check_out).slice(0, 10)}`;
    if (r.status === 'failed') return `Could not close ${t} for ${dates} (${s} is booked): ${r.error ?? 'unknown error'}. Close it by hand.`;
    if (r.status === 'removed') return `Reopened ${t} for ${dates}: the ${s} booking went away.`;
    return `Closed ${t} for ${dates}: ${s} is booked.`;
  })];
}
