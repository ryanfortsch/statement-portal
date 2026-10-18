/**
 * "This week" for the home page's "Open work · this week" count.
 *
 * The window is the board's (`WORK_WEEK_DAYS` in work-board-view.ts): today
 * and the six days after it, in Gloucester. The home counts the team's DATED
 * work in it: a slip scheduled, or a task due, on or before the window's last
 * day, overdue included. The board's My week also carries undated work
 * assigned to me; team-wide, undated work is the backlog (some 280 slips),
 * and a count of the backlog changes nothing anyone does today.
 *
 * Pure, so `npm test` pins the window.
 */

import { WORK_WEEK_DAYS } from './work-board-view.ts';

/** The last day of the week window, YYYY-MM-DD. */
export function workWeekEnd(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + WORK_WEEK_DAYS - 1);
  return d.toISOString().slice(0, 10);
}

/** True when a dated item is due by the end of the week (overdue included). */
export function dueThisWeek(date: string | null | undefined, today: string): boolean {
  return !!date && date.slice(0, 10) <= workWeekEnd(today);
}
