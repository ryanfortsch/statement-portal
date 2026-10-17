/**
 * The kinds under the Cleaners tab's one number (2026-10-17). The pill sums
 * pending texts, a pending schedule digest and open "clean after?" questions
 * (see /api/messaging/pending-count), so a "3" on the tab can be one text,
 * one schedule and one question. This names them in the page's title row,
 * zero kinds omitted, each linking to its section.
 */
export type CleanerKindCounts = {
  /** Pending cleaner texts (not scheduled sends); null when unreadable. */
  texts: number | null;
  /** A pending schedule digest waiting on approval: 0 or 1. */
  schedules: number | null;
  /** Owner blocks still asking "clean after?". */
  questions: number | null;
};

export type CleanerKind = { label: string; href: string };

export function cleanerKindsLine(c: CleanerKindCounts): CleanerKind[] {
  const parts: CleanerKind[] = [];
  const add = (n: number | null, one: string, many: string, href: string) => {
    if (n && n > 0) parts.push({ label: n === 1 ? `1 ${one}` : `${n} ${many}`, href });
  };
  add(c.texts, 'text', 'texts', '#needs-review');
  add(c.schedules, 'schedule', 'schedules', '#schedule-digest');
  add(c.questions, 'question', 'questions', '#owner-holds');
  return parts;
}
