/**
 * "This week" for open work: one rule, read by the home page's "Open work ·
 * this week" count and by the board's This week and My week
 * (`workThisWeek` in work-board-view.ts).
 *
 * The window is today and the six days after it, in Gloucester. A slip
 * counts when its scheduled date, or a task when its due date, falls on or
 * before the window's last day, overdue included. Undated work is the
 * backlog (some 280 slips team-wide), and a count of the backlog changes
 * nothing anyone does today.
 *
 * Pure and import-free (the board module imports this one, never the other
 * way round), so `npm test` pins the window.
 */

/** "This week": today and the six days after it. */
export const WORK_WEEK_DAYS = 7;

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
