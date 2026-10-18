/**
 * "This week" for open work: the home page's "Open work · this week" count.
 *
 * A slip counts when its scheduled date, or a task when its due date, falls
 * on or before the sixth day after today in Gloucester: due this week, and
 * anything already overdue. Undated work is the backlog, not this week.
 * Same date fields and same "overdue" as the board (`workOverdue` in
 * work-board-view.ts).
 *
 * Pure, so `npm test` pins the window.
 */

/** The last day of the week window, YYYY-MM-DD: today plus six. */
export function workWeekEnd(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/** True when a dated item is due by the end of the week (overdue included). */
export function dueThisWeek(date: string | null | undefined, today: string): boolean {
  return !!date && date.slice(0, 10) <= workWeekEnd(today);
}
