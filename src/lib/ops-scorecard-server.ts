/**
 * Reads for the operations scorecard (ops-scorecard.ts has the rules). One
 * read per tile, each failing soft to null so one bad table costs its own
 * tile ("Unavailable"), never the band or the home page. Nothing here reads
 * money: the letter's standards are about guests, work and records.
 */
import 'server-only';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { collapseWorkIssues } from '@/lib/work-issues';
import { loadWorkIssueLinks } from '@/lib/work-issues-server';
import { getReviewWindowStats } from '@/lib/reviews';
import { loadHandoffItems } from '@/lib/close-handoff-db';
import { HANDOFF_CLOSE_WINDOW_DAY, fmtDay, handoffDueDate, monthName } from '@/lib/close-handoff';
import { operatingDate } from '@/lib/operating-date';
import { CAPE_ANN_REGION } from '@/lib/property-scope';
import {
  NOTE_WINDOW_DAYS, RATING_WINDOW_DAYS, SCHEDULE_WINDOW_DAYS, WINTER_CHECK_DAYS,
  ageDays, closeMonthFor, closeTile, hasClearNote, isWinter, ratingTile, recordsTile, scheduleTile, winterTile, workTile,
  type ScorecardTile,
} from '@/lib/ops-scorecard';

const ACTIVE = ['open', 'in_progress', 'scheduled'];

function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

async function soft<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.warn('[ops-scorecard] read failed', err instanceof Error ? err.message : err);
    return null;
  }
}

async function readWork(today: string) {
  const since = new Date(Date.now() - NOTE_WINDOW_DAYS * 86_400_000).toISOString();
  const [rows, links, closed] = await Promise.all([
    selectAllPaged<{ id: string; property_id: string; created_at: string }>((from, to) =>
      supabase.from('work_slips').select('id, property_id, created_at').in('status', ACTIVE).order('id').range(from, to)),
    loadWorkIssueLinks(supabase),
    selectAllPaged<{ id: string; resolution_notes: string | null }>((from, to) =>
      supabase.from('work_slips').select('id, resolution_notes').eq('status', 'done').gte('completed_at', since).order('id').range(from, to)),
  ]);
  const open = collapseWorkIssues(rows, links).length;
  const oldest = rows.reduce<string | null>((min, r) => (!min || r.created_at < min ? r.created_at : min), null);
  return {
    open,
    oldestDays: oldest ? ageDays(oldest, today) : null,
    closed: closed.length,
    closedWithNote: closed.filter((r) => hasClearNote(r.resolution_notes)).length,
  };
}

async function readSchedule(today: string) {
  const { data, error } = await supabase
    .from('cleaner_schedule_digests')
    .select('service_date, sent_at, stats')
    .eq('region', CAPE_ANN_REGION)
    .gte('service_date', shiftDay(today, -(SCHEDULE_WINDOW_DAYS - 1)))
    .lte('service_date', today);
  if (error) throw new Error(error.message);
  const days = ((data ?? []) as Array<{ sent_at: string | null; stats: { checkouts?: number } | null }>)
    .filter((d) => (d.stats?.checkouts ?? 0) > 0);
  return { days: days.length, sent: days.filter((d) => !!d.sent_at).length };
}

async function readClose(today: string) {
  const month = closeMonthFor(today, HANDOFF_CLOSE_WINDOW_DAY);
  const items = await loadHandoffItems({ months: [month], statuses: ['open', 'sent', 'filed'] });
  const sentDays = items.filter((i) => i.sent_at).map((i) => operatingDate(new Date(i.sent_at as string))).sort();
  const due = handoffDueDate(month);
  return {
    month,
    monthName: monthName(month),
    due,
    // 'Thu, Oct 29' without the weekday: the line has room for one fact.
    dueLabel: fmtDay(due).replace(/^[A-Za-z]+, /, ''),
    today,
    open: items.filter((i) => i.status === 'open').length,
    sent: items.filter((i) => i.status !== 'open').length,
    lastSentDay: sentDays.length > 0 ? sentDays[sentDays.length - 1] : null,
  };
}

async function capeAnnHomes(): Promise<string[]> {
  const { data, error } = await supabase.from('properties').select('id, region').eq('is_active', true).limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; region: string | null }>)
    .filter((p) => (p.region ?? CAPE_ANN_REGION) === CAPE_ANN_REGION)
    .map((p) => p.id);
}

async function readRecords() {
  const homes = await capeAnnHomes();
  const [rooms, notes] = await Promise.all([
    selectAllPaged<{ property_id: string }>((from, to) =>
      supabase.from('property_rooms').select('property_id').order('property_id').range(from, to)),
    selectAllPaged<{ property_id: string }>((from, to) =>
      supabase.from('property_notes').select('property_id').eq('guest_facing', true).is('resolved_at', null).order('property_id').range(from, to)),
  ]);
  const withRooms = new Set(rooms.map((r) => r.property_id));
  const withNotes = new Set(notes.map((n) => n.property_id));
  return { homes: homes.length, complete: homes.filter((h) => withRooms.has(h) && withNotes.has(h)).length };
}

async function readWinter(today: string) {
  const homes = await capeAnnHomes();
  const since = new Date(Date.now() - WINTER_CHECK_DAYS * 86_400_000).toISOString();
  const [stays, walks] = await Promise.all([
    supabase
      .from('bookings')
      .select('property_id')
      .in('status', ['confirmed', 'completed'])
      .is('duplicate_of', null)
      .lte('check_in', today)
      .gt('check_out', today),
    supabase.from('inspections').select('property_id').gte('completed_at', since),
  ]);
  if (stays.error) throw new Error(stays.error.message);
  if (walks.error) throw new Error(walks.error.message);
  const occupied = new Set(((stays.data ?? []) as Array<{ property_id: string }>).map((s) => s.property_id));
  const walked = new Set(((walks.data ?? []) as Array<{ property_id: string }>).map((w) => w.property_id));
  const empty = homes.filter((h) => !occupied.has(h));
  return { empty: empty.length, checked: empty.filter((h) => walked.has(h)).length };
}

export async function loadOpsScorecard(): Promise<ScorecardTile[] | null> {
  if (!isServiceConfigured) return null;
  const today = operatingDate();
  const [rating, work, schedule, close, records, winter] = await Promise.all([
    soft(getReviewWindowStats(RATING_WINDOW_DAYS, { strict: true })),
    soft(readWork(today)),
    soft(readSchedule(today)),
    soft(readClose(today)),
    soft(readRecords()),
    isWinter(today) ? soft(readWinter(today)) : Promise.resolve(null),
  ]);
  return [
    ratingTile(rating),
    workTile(work),
    scheduleTile(schedule),
    closeTile(close),
    recordsTile(records),
    winterTile(today, winter),
  ];
}
