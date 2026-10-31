/**
 * This week on the home feed: the signed-in person's next seven days as one
 * list, day by day. The walks planned for them, their meetings (every one
 * for an owner, the ones they logged for staff) and the slips and to-dos of
 * theirs that carry a date inside the window. Before this (2026-10-30) the
 * feed showed walks and meetings as two cards with no shared clock, and a
 * meeting past tomorrow was on nobody's page but its contact's.
 *
 * The window is `work-week.ts`'s: the same seven days as the home's "Open
 * work · this week" count and the board's My week, so the page never says
 * "this week" twice and means two things. Pure: the loaders and the rows
 * live in `components/ForMeFeed.tsx`. Dates are Eastern calendar days
 * (YYYY-MM-DD) throughout; `house-date.ts` prints them without a time zone
 * moving them.
 */

import { houseDay } from './house-date.ts';
import { WORK_WEEK_DAYS, workWeekEnd } from './work-week.ts';

/** Today and the six days after it. */
export const WEEK_DAYS = WORK_WEEK_DAYS;

export type WeekKind = 'walk' | 'meeting' | 'task' | 'slip';

/** The least a thing needs to land on a day. */
export type WeekEntry = {
  kind: WeekKind;
  /** The Eastern calendar day it happens. */
  date: string;
  /** Postgres `time` or "HH:MM" when a clock was agreed; null otherwise. */
  time: string | null;
};

export type WeekDay<T extends WeekEntry> = {
  date: string;
  /** "Today", "Tomorrow", then the weekday: "Sunday". */
  name: string;
  /** "Fri, Oct 30". */
  dateText: string;
  isToday: boolean;
  items: T[];
};

/** `iso` plus `days` calendar days, at noon UTC so no zone moves it. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The window: today through the last of the seven days, inclusive. */
export function weekWindow(today: string): { from: string; to: string } {
  return { from: today, to: workWeekEnd(today) };
}

export function inWeek(date: string | null | undefined, today: string): boolean {
  if (!date) return false;
  const { from, to } = weekWindow(today);
  const d = date.slice(0, 10);
  return d >= from && d <= to;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Today", "Tomorrow", else the weekday's full name. */
export function dayName(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
}

/** A clock sorts before anything without one; then what has a fixed place
 *  in the day (a walk is tied to a check-in), then an untimed meeting, then
 *  the office to-dos and the slips. Ties keep the caller's order. */
const KIND_RANK: Record<WeekKind, number> = { walk: 1, meeting: 2, task: 3, slip: 4 };

function rank(e: WeekEntry): number {
  return e.time ? 0 : KIND_RANK[e.kind];
}

function clock(e: WeekEntry): string {
  return (e.time ?? '').slice(0, 5);
}

/**
 * Bucket the entries inside the window by day, days ascending, each day's
 * items in the order a day is lived. Days with nothing are left out: the
 * list is what needs you, not a calendar grid.
 */
export function groupByDay<T extends WeekEntry>(items: T[], today: string): WeekDay<T>[] {
  const byDate = new Map<string, T[]>();
  for (const item of items) {
    if (!inWeek(item.date, today)) continue;
    const key = item.date.slice(0, 10);
    const bucket = byDate.get(key) ?? [];
    bucket.push(item);
    byDate.set(key, bucket);
  }
  return [...byDate.keys()].sort().map((date) => ({
    date,
    name: dayName(date, today),
    dateText: houseDay(date),
    isToday: date === today,
    items: [...(byDate.get(date) ?? [])].sort((a, b) => rank(a) - rank(b) || clock(a).localeCompare(clock(b))),
  }));
}

/** How many entries fall after the window: the walks the grid still holds. */
export function countLater(items: readonly { date: string | null }[], today: string): number {
  const { to } = weekWindow(today);
  return items.filter((i) => !!i.date && i.date.slice(0, 10) > to).length;
}

export type WorkDateKind = 'scheduled' | 'follow_up' | 'due';

/**
 * Which day a piece of work lands on this week, and why. A slip has two
 * clocks, the visit it is scheduled for and the office follow-up; the
 * earliest one inside the window wins, and a date already past does not
 * pull a later one out of the week. A to-do has its due date. Null means
 * it has no day this week.
 */
export function workDay(
  dates: { scheduled?: string | null; followUp?: string | null; due?: string | null },
  today: string,
): { date: string; kind: WorkDateKind } | null {
  const candidates: Array<{ date: string; kind: WorkDateKind }> = [];
  if (dates.scheduled) candidates.push({ date: dates.scheduled.slice(0, 10), kind: 'scheduled' });
  if (dates.followUp) candidates.push({ date: dates.followUp.slice(0, 10), kind: 'follow_up' });
  if (dates.due) candidates.push({ date: dates.due.slice(0, 10), kind: 'due' });
  const inside = candidates.filter((c) => inWeek(c.date, today)).sort((a, b) => a.date.localeCompare(b.date));
  return inside[0] ?? null;
}

/** The word on the row under a day heading. */
export function workDateLabel(kind: WorkDateKind): string {
  return kind === 'scheduled' ? 'Scheduled' : kind === 'follow_up' ? 'Follow up' : 'Due';
}

/** "3 through Thu, Nov 5". */
export function weekEyebrow(count: number, today: string): string {
  return `${count} through ${houseDay(weekWindow(today).to)}`;
}
